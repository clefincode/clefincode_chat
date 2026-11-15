"""Offline Faster Whisper voice-note transcription and timestamped search.
Install in clefincode_chat/api/api_1_4_1/audio_features.py.
All user-facing endpoints require authenticated channel/thread membership; workers are
not whitelisted. In particular, do not expose these endpoints with allow_guest=True.
"""
from __future__ import annotations
import json
import html
import math
import os
import re
import subprocess
import tempfile
import unicodedata
from collections import Counter
from functools import lru_cache
from uuid import uuid4
from pathlib import Path
from bs4 import BeautifulSoup
import frappe
from frappe.utils import cint, now_datetime
from .ai_agent import strip_html
DOCTYPE = "ClefinCode Chat Message"
# All audio processing is LOCAL; no file is uploaded to OpenAI or any other server.
# Convert each clip to 16-kHz mono WAV to support Ogg/Opus, WebM and other
# formats even when the installed PyAV codec bundle differs.
CHUNK_SECONDS = 600
MAX_RECORDING_SECONDS = 2 * 60 * 60
TRANSCRIPTION_TIMEOUT = 7200
SEARCH_LIMIT = 100
# --------------------------- access checks --------------------------------
def _current_user():
    user = frappe.session.user
    if not user or user == "Guest":
        frappe.throw("Please sign in to use recording AI features.", frappe.PermissionError)
    return user
def _parent_member(channel, user):
    return bool(frappe.db.exists(
        "ClefinCode Chat Channel User",
        {"parent": channel, "user": user, "is_removed": 0},
    ))
def _thread_member(sub_channel, user):
    return bool(frappe.db.exists(
        "ClefinCode Chat Channel User",
        {"parent": sub_channel, "user": user, "active": 1, "is_removed": 0},
    ))
def _assert_channel_access(channel, sub_channel=None, chat_topic=None):
    user = _current_user()
    if not channel or not frappe.db.exists("ClefinCode Chat Channel", channel):
        frappe.throw("Unknown chat channel.", frappe.DoesNotExistError)
    if sub_channel:
        parent = frappe.db.get_value("ClefinCode Chat Channel", sub_channel, "parent_channel")
        if parent != channel or not (
            _thread_member(sub_channel, user) or _parent_member(channel, user)
        ):
            frappe.throw("You cannot access this contributor thread.", frappe.PermissionError)
    elif not _parent_member(channel, user):
        frappe.throw("You cannot access this chat channel.", frappe.PermissionError)
    if chat_topic:
        topic_channel = frappe.db.get_value("ClefinCode Chat Topic", chat_topic, "chat_channel")
        if topic_channel != channel:
            frappe.throw("Chat topic does not belong to this channel.", frappe.PermissionError)
    return user
def _can_access_message(msg, *, user=None):
    user = user or _current_user()
    if cint(getattr(msg, "is_deleted", 0)):
        return False
    receiver = getattr(msg, "only_receive_by", None)
    if receiver and receiver != user:
        return False
    channel = getattr(msg, "chat_channel", None)
    sub_channel = getattr(msg, "sub_channel", None)
    if not channel:
        return False
    if sub_channel:
        if frappe.db.get_value("ClefinCode Chat Channel", sub_channel, "parent_channel") != channel:
            return False
        # The normal parent-channel chat view includes contributor-tagged
        # messages. Allow an authorized, non-removed parent-channel member to
        # access those same recordings, even if they are not a bot-thread member.
        # This intentionally follows the existing _parent_member policy, which
        # does not require active=1. Keep only_receive_by and deletion checks.
        if not (_thread_member(sub_channel, user) or _parent_member(channel, user)):
            return False
    elif not _parent_member(channel, user):
        return False
    topic = getattr(msg, "chat_topic", None)
    if topic and frappe.db.get_value("ClefinCode Chat Topic", topic, "chat_channel") != channel:
        return False
    return True
def _get_allowed_recording(message_name):
    _current_user()
    if not message_name or not frappe.db.exists(DOCTYPE, message_name):
        frappe.throw("Recording message not found.", frappe.DoesNotExistError)
    msg = frappe.get_doc(DOCTYPE, message_name)
    if not _can_access_message(msg):
        frappe.throw("You cannot access this recording.", frappe.PermissionError)
    if not cint(msg.is_voice_clip) or not msg.file_id:
        frappe.throw("This message is not a voice recording.")
    return msg
# ------------------------------ audio I/O ----------------------------------
def _recording_path(msg):
    file_doc = frappe.get_doc("File", msg.file_id)
    # The original app links the File to the message after send().
    # Check the association so a tampered file_id can't read unrelated files.
    if (file_doc.attached_to_doctype != DOCTYPE or
            file_doc.attached_to_name != msg.name):
        frappe.throw("The recording is not linked to this message.")
    path = file_doc.get_full_path()
    if not os.path.isfile(path):
        frappe.throw("The recording file was not found on the server.")
    return path, file_doc
def _audio_duration(path):
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            check=True, capture_output=True, text=True, timeout=30,
        )
        seconds = float(result.stdout.strip())
        if not math.isfinite(seconds) or seconds <= 0:
            raise ValueError("Invalid audio duration")
        return seconds
    except (FileNotFoundError, subprocess.SubprocessError, ValueError) as exc:
        raise ValueError("ffprobe cannot read this recording; ensure FFmpeg is installed.") from exc
def _whisper_settings():
    """Read server-owned config; no model name or path is supplied by an API user."""
    model = str(frappe.conf.get("clefincode_chat_whisper_model") or "small").strip()
    # The model may be a standard Faster Whisper name or a local directory.
    local_path = (frappe.conf.get("clefincode_chat_whisper_model_path") or "").strip()
    if local_path:
        if not os.path.isabs(local_path) or not os.path.isdir(local_path):
            raise ValueError("Whisper model_path must be an existing absolute directory.")
        model = local_path
    device = str(frappe.conf.get("clefincode_chat_whisper_device") or "cpu").lower()
    if device not in {"cpu", "cuda", "auto"}:
        raise ValueError("Whisper device must be cpu, cuda or auto.")
    compute = str(frappe.conf.get("clefincode_chat_whisper_compute_type") or "int8").lower()
    if compute not in {"int8", "int8_float16", "float16", "float32", "default"}:
        raise ValueError("Unsupported Whisper compute_type.")
    cpu_threads = max(1, min(32, cint(frappe.conf.get("clefincode_chat_whisper_cpu_threads") or 4)))
    model_dir = str(frappe.conf.get("clefincode_chat_whisper_model_dir") or "").strip() or None
    if model_dir and not os.path.isabs(model_dir):
        raise ValueError("Whisper model_dir must be an absolute directory.")
    # Default: prevent any worker from downloading weights during a live request.
    offline = bool(cint(frappe.conf.get("clefincode_chat_whisper_offline", 1)))
    beam_size = max(1, min(10, cint(frappe.conf.get("clefincode_chat_whisper_beam_size") or 3)))
    use_vad = bool(cint(frappe.conf.get("clefincode_chat_whisper_vad_filter", 0)))
    return model, device, compute, cpu_threads, model_dir, offline, beam_size, use_vad
@lru_cache(maxsize=1)
def _load_whisper_model(model_name, device, compute_type, cpu_threads, download_root, offline):
    """Keep one model per RQ worker; never load it in a browser/web request."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "faster-whisper is not installed in the Frappe Bench Python environment. "
            "Run ./env/bin/python -m pip install faster-whisper"
        ) from exc
    try:
        return WhisperModel(
            model_name, device=device, compute_type=compute_type,
            cpu_threads=cpu_threads, num_workers=1,
            download_root=download_root, local_files_only=offline,
        )
    except Exception as exc:
        if offline:
            raise RuntimeError(
                "Cannot load offline Whisper model. Download it once using the "
                "Bench Python environment, verify model_dir and restart workers. "
                f"Original error: {str(exc)[:180]}"
            ) from exc
        raise
def check_whisper_installation():
    """For bench execute/console only; not a whitelisted HTTP endpoint."""
    cfg = _whisper_settings()
    _load_whisper_model(*cfg[:6])
    return {
        "status": "ready", "model": cfg[0], "device": cfg[1],
        "compute_type": cfg[2], "model_dir": cfg[4], "offline": cfg[5],
    }
def _make_wav_chunk(source, path, offset, duration):
    """Normalize audio locally with FFmpeg; no third-party audio service."""
    try:
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
             "-ss", str(offset), "-t", str(duration), "-i", source,
             "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", path],
            check=True, capture_output=True, timeout=240,
        )
    except (FileNotFoundError, subprocess.SubprocessError) as exc:
        raise ValueError("Failed to convert recording to WAV with FFmpeg.") from exc
    if not os.path.isfile(path) or os.path.getsize(path) <= 44:
        raise ValueError("The converted recording is empty.")
    # 10 minutes at 16kHz 16-bit mono is approximately 19.2 MB.
    if os.path.getsize(path) > 32 * 1024 * 1024:
        raise ValueError("Converted audio chunk is unexpectedly large.")
def _transcribe_audio(path):
    """Return text and true per-word/segment positions from LOCAL Whisper."""
    duration = _audio_duration(path)
    limit = cint(frappe.conf.get("clefincode_chat_audio_max_seconds") or MAX_RECORDING_SECONDS)
    limit = min(MAX_RECORDING_SECONDS, max(60, limit))
    if duration > limit:
        raise ValueError(f"Recording exceeds the configured {limit // 60}-minute limit.")
    cfg = _whisper_settings()
    model = _load_whisper_model(*cfg[:6])
    _, _, _, _, _, _, beam_size, use_vad = cfg
    texts, words, segments, languages = [], [], [], []
    with tempfile.TemporaryDirectory(prefix="cc_local_whisper_") as tmp:
        for index in range(math.ceil(duration / CHUNK_SECONDS)):
            offset = index * CHUNK_SECONDS
            part_length = min(CHUNK_SECONDS, duration - offset)
            wav_path = str(Path(tmp) / f"part_{index:04d}.wav")
            _make_wav_chunk(path, wav_path, offset, part_length)
            # Faster Whisper produces a generator: iterating is what executes
            # inference. This is intentionally inside the background worker.
            decoded_segments, info = model.transcribe(
                wav_path, task="transcribe", beam_size=beam_size,
                word_timestamps=True, vad_filter=use_vad,
            )
            if getattr(info, "language", None):
                languages.append(info.language)
            for segment in decoded_segments:
                text = (getattr(segment, "text", "") or "").strip()
                if text:
                    texts.append(text)
                    segments.append({
                        "text": text,
                        "start": round(offset + max(0.0, float(segment.start)), 3),
                        "end": round(offset + max(0.0, float(segment.end)), 3),
                    })
                for word in getattr(segment, "words", None) or []:
                    token = (getattr(word, "word", "") or "").strip()
                    if not token:
                        continue
                    words.append({
                        "word": token,
                        "start": round(offset + max(0.0, float(word.start)), 3),
                        "end": round(offset + max(0.0, float(word.end)), 3),
                    })
    transcript = "\n".join(texts)
    if not transcript:
        raise ValueError("Whisper did not detect any speech in this recording.")
    language = Counter(languages).most_common(1)[0][0] if languages else ""
    return {
        "text": transcript, "words": words, "segments": segments,
        "language": language, "duration": round(duration, 3),
    }

# A hidden, escaped fragment preserves the original voice-message markup/player.
# The chat renderer never displays this fragment directly: visibility is handled
# by recording_features.js and a permission-checked API. Searches query Content only.
TRANSCRIPT_ATTR = "data-cc-voice-transcript"
TRANSCRIPT_PATTERN = re.compile(
    r"<(?P<tag>div|span)\b[^>]*\bdata-cc-voice-transcript\s*=\s*[\"']1[\"'][^>]*>.*?</(?P=tag)\s*>",
    flags=re.IGNORECASE | re.DOTALL,
)


def transcript_from_content(content):
    """Read ONLY the special hidden transcript fragment from Message.content."""
    if not content or TRANSCRIPT_ATTR not in str(content):
        return ""
    soup = BeautifulSoup(str(content), "html.parser")
    for node in soup.find_all(attrs={TRANSCRIPT_ATTR: "1"}):
        return node.get_text(separator=" ", strip=True)
    return ""


def strip_stored_transcript(content):
    """Strip previously stored transcript markup while preserving the audio HTML."""
    return TRANSCRIPT_PATTERN.sub("", str(content or "")).strip()


def content_with_transcript(original_content, transcript):
    """Idempotent replacement; escape model-produced text to prevent script injection."""
    original = strip_stored_transcript(original_content)
    text = str(transcript or "").strip()
    if not text:
        return original
    escaped_text = html.escape(text, quote=True)
    hidden = (
        '<div data-cc-voice-transcript="1" hidden="hidden" '
        'aria-hidden="true" style="display:none!important">'
        f'{escaped_text}</div>'
    )
    return (original + "\n" + hidden).strip()

# ---------------------- background transcription ---------------------------
def _update_message(name, **values):
    frappe.db.set_value(DOCTYPE, name, values, update_modified=False)
def queue_voice_clip_transcription(msg):
    """Called by api.send() once the voice File has been attached to the message."""
    if not cint(frappe.conf.get("clefincode_chat_audio_auto_process", 1)):
        return
    if not cint(getattr(msg, "is_voice_clip", 0)) or not getattr(msg, "file_id", None):
        return
    try:
        frappe.enqueue(
            "clefincode_chat.api.api_1_4_1.audio_features.process_voice_clip_transcription",
            queue="long", timeout=TRANSCRIPTION_TIMEOUT, enqueue_after_commit=True,
            job_id=f"cc_audio::{msg.name}", deduplicate=True, message_name=msg.name,
        )
        _update_message(msg.name, audio_status="Queued")
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Recording AI queue failed")
def process_voice_clip_transcription(message_name, force=False):
    """Local, private RQ worker: never whitelist this function."""
    cache = frappe.cache() if callable(frappe.cache) else frappe.cache
    lock = cache.lock(f"cc_audio:{frappe.local.site}:{message_name}", timeout=TRANSCRIPTION_TIMEOUT + 300)
    with lock:
        if not frappe.db.exists(DOCTYPE, message_name):
            return
        msg = frappe.get_doc(DOCTYPE, message_name)
        if cint(msg.is_deleted) or not cint(msg.is_voice_clip) or not msg.file_id:
            return
        if msg.audio_status == "Completed" and transcript_from_content(msg.content) and not cint(force):
            return
        _update_message(msg.name, audio_status="Processing", audio_error="")
        frappe.db.commit()
        try:
            source, _ = _recording_path(msg)
            transcription = _transcribe_audio(source)
            # If deleted/replaced while waiting for Whisper, never store its text.
            current = frappe.db.get_value(DOCTYPE, msg.name, ["is_deleted", "file_id", "content"], as_dict=True)
            if not current or current.is_deleted or current.file_id != msg.file_id:
                return
            _update_message(
                msg.name,
                content=content_with_transcript(current.content, transcription["text"]),
                audio_transcript="",  # no duplicated transcript: legacy column intentionally cleared
                audio_words_json=json.dumps(transcription["words"], ensure_ascii=False),
                audio_segments_json=json.dumps(transcription["segments"], ensure_ascii=False),
                audio_language=transcription["language"],
                audio_duration_seconds=transcription["duration"],
                audio_summary="",
                audio_summary_status="Not Processed",
                audio_summary_error="",
                audio_translations_json="{}",
                audio_translation_status_json="{}",
                audio_status="Completed",
                audio_error="",
                audio_processed_at=now_datetime(),
            )
            # Queue the already-configured chat bot(s) ONLY after speech text
            # was saved, so they can reply to the actual spoken words. The
            # existing bot still uses its AI Agent Profile provider (no separate local model).
            # All bot jobs are scheduled after the transaction commits.
            try:
                if not getattr(msg, "only_receive_by", None):
                    from .api import _queue_ai_replies_for_message
                    channel_doc = frappe.get_doc("ClefinCode Chat Channel", msg.chat_channel)
                    if channel_doc.type != "Guest":
                        _queue_ai_replies_for_message(channel_doc, msg)
            except Exception:
                # A bot failure cannot invalidate a successful transcription.
                frappe.log_error(frappe.get_traceback(), "Voice AI bot dispatch failed")
            frappe.db.commit()
        except Exception as exc:
            frappe.log_error(frappe.get_traceback(), "Recording AI transcription failed")
            _update_message(msg.name, audio_status="Failed", audio_error=str(exc)[:140])
            frappe.db.commit()
            # Leave a Failed state for the UI; the user can explicitly retry.
            raise
# -------------------------- client endpoints -------------------------------
@frappe.whitelist(methods=["POST"])
def request_recording_transcription(message_name, force=0):
    msg = _get_allowed_recording(message_name)
    force = bool(cint(force))
    if msg.audio_status == "Completed" and transcript_from_content(msg.content) and not force:
        return {"status": "Completed", "message_name": msg.name}
    if msg.audio_status in ("Queued", "Processing") and not force:
        return {"status": msg.audio_status, "message_name": msg.name}
    if force:
        user = _current_user()
        if user != msg.sender_email and not (set(frappe.get_roles(user)) & {"Chat Administrator", "System Manager"}):
            frappe.throw("Only the sender or a chat administrator may reprocess this recording.", frappe.PermissionError)
        if msg.audio_status in ("Queued", "Processing"):
            return {"status": msg.audio_status, "message_name": msg.name}
    _update_message(msg.name, audio_status="Queued", audio_error="")
    frappe.enqueue(
        "clefincode_chat.api.api_1_4_1.audio_features.process_voice_clip_transcription",
        queue="long", timeout=TRANSCRIPTION_TIMEOUT, enqueue_after_commit=True,
        job_id=f"cc_audio::{msg.name}::{uuid4().hex[:8]}", deduplicate=True,
        message_name=msg.name, force=force,
    )
    return {"status": "Queued", "message_name": msg.name}
def _safe_json(value, fallback):
    try:
        result = json.loads(value) if value else fallback
        return result if isinstance(result, type(fallback)) else fallback
    except (ValueError, TypeError):
        return fallback
@frappe.whitelist()
def get_recording_features(message_name):
    msg = _get_allowed_recording(message_name)
    file_url = ""
    try:
        _, file_doc = _recording_path(msg)
        file_url = file_doc.file_url
    except Exception:
        # Transcription can still be displayed even if the file is no longer on disk.
        pass
    return {
        "message_name": msg.name,
        "chat_channel": msg.chat_channel,
        "transcription_engine": "faster-whisper (local)",
        "status": msg.audio_status or "Not Processed",
        "error": msg.audio_error or "",
        "language": msg.audio_language or "",
        "duration_seconds": msg.audio_duration_seconds or 0,
        "transcript": transcript_from_content(msg.content),
        "show_transcript": bool(cint(getattr(msg, "show_transcript", 0))),
        "hide_transcript": bool(cint(getattr(msg, "hide_transcript", 0))),
        "channel_show_transcript": bool(
            cint(frappe.db.get_value("ClefinCode Chat Channel", msg.chat_channel, "show_transcript") or 0)
            or (msg.sub_channel and cint(frappe.db.get_value(
                "ClefinCode Chat Channel", msg.sub_channel, "show_transcript") or 0))
        ),
        "summary": msg.audio_summary or "",
        "summary_status": msg.audio_summary_status or "Not Processed",
        "summary_error": msg.audio_summary_error or "",
        "translations": _safe_json(msg.audio_translations_json, {}),
        "translation_statuses": _safe_json(msg.audio_translation_status_json, {}),
        "file_url": file_url,
    }
# --------------------- word/segment time-based search ----------------------
def _normalized_query(query):
    return unicodedata.normalize("NFKC", str(query or "")).strip()
def _timecode(seconds):
    sec = max(0, int(float(seconds)))
    return f"{sec // 60:02d}:{sec % 60:02d}" if sec < 3600 else f"{sec // 3600:02d}:{(sec // 60) % 60:02d}:{sec % 60:02d}"
def _word_matches(words, query):
    """Return exact word/phrase occurrences with local Whisper start seconds."""
    if not words or not query:
        return []
    chunks, offsets, cursor = [], [], 0
    for token in words:
        word = str(token.get("word") or "").strip()
        if not word:
            continue
        if chunks:
            cursor += 1
        start = cursor
        chunks.append(word)
        cursor += len(word)
        offsets.append((start, cursor, float(token.get("start") or 0), word))
    joined = " ".join(chunks)
    # Whitespace in user input may differ from Whisper's tokenization.
    pattern = r"(?<!\w)" + r"\s+".join(re.escape(x) for x in query.split()) + r"(?!\w)"
    matches = []
    for hit in re.finditer(pattern, joined, flags=re.IGNORECASE | re.UNICODE):
        token = next((item for item in offsets if item[0] <= hit.start() < item[1]), None)
        if not token:
            continue
        seconds = token[2]
        matches.append({
            "timestamp_seconds": round(seconds, 3),
            "timestamp": _timecode(seconds),
            "minute": int(seconds // 60),
            "excerpt": joined[max(0, hit.start() - 65): min(len(joined), hit.end() + 65)],
            "timestamp_source": "word",
        })
    return matches
def _segment_matches(segments, query):
    pattern = r"(?<!\w)" + r"\s+".join(re.escape(x) for x in query.split()) + r"(?!\w)"
    hits = []
    for segment in segments:
        text = str(segment.get("text") or "")
        start, end = float(segment.get("start") or 0), float(segment.get("end") or 0)
        for match in re.finditer(pattern, text, flags=re.IGNORECASE | re.UNICODE):
            # Segment timing only: interpolate to estimate, disclose this fact.
            sec = start + max(0, end - start) * (match.start() / max(1, len(text)))
            hits.append({"timestamp_seconds": round(sec, 3),
                         "timestamp": _timecode(sec), "minute": int(sec // 60),
                         "excerpt": text[:180], "timestamp_source": "estimated_segment"})
    return hits
def _audio_matches(msg, query):
    words = _safe_json(getattr(msg, "audio_words_json", ""), [])
    segments = _safe_json(getattr(msg, "audio_segments_json", ""), [])
    if words:
        hits = _word_matches(words, query)
        if hits:
            return hits
    segment_hits = _segment_matches(segments, query)
    if segment_hits:
        return segment_hits
    # Even for a partial/legacy transcription without timing metadata,
    # don't silently omit a real transcript hit. The timestamp is unknown.
    text = transcript_from_content(msg.content)
    pattern = r"(?<!\w)" + r"\s+".join(re.escape(x) for x in query.split()) + r"(?!\w)"
    match = re.search(pattern, text, flags=re.IGNORECASE | re.UNICODE)
    if match:
        return [{"timestamp_seconds": None, "timestamp": None, "minute": None,
                 "excerpt": text[max(0, match.start() - 60):match.end() + 60],
                 "timestamp_source": "unavailable"}]
    return []
def _search_rows(query, channel=None, sub_channel=None, chat_topic=None, limit=SEARCH_LIMIT,
                 *, include_text=False):
    user = _current_user()
    query = _normalized_query(query)
    if not query:
        return []
    if len(query) > 150:
        frappe.throw("The search phrase is too long (maximum 150 characters).")
    if channel:
        _assert_channel_access(channel, sub_channel=sub_channel, chat_topic=chat_topic)
    elif sub_channel or chat_topic:
        frappe.throw("Choose a chat channel when filtering a thread or topic.")
    limit = min(200, max(1, cint(limit) or SEARCH_LIMIT))
    params = {"needle": f"%{query.replace('%', r'\\%').replace('_', r'\\_')}%", "user": user,
              "limit": max(limit * 5, 100)}
    where = ["m.is_deleted = 0", "m.is_voice_clip = 1" if not include_text else "1=1",
             "(m.only_receive_by IS NULL OR m.only_receive_by = '' OR m.only_receive_by = %(user)s)"]
    if include_text:
        where.append("m.content LIKE %(needle)s")
    else:
        where.extend(["m.audio_status = 'Completed'", "m.content LIKE %(needle)s"])
    if channel:
        where.append("m.chat_channel = %(channel)s")
        params["channel"] = channel
        if sub_channel:
            where.append("m.sub_channel = %(sub_channel)s")
            params["sub_channel"] = sub_channel
        else:
            # Whole-channel search matches the same parent-member visibility
            # as the normal chat list and per-recording access checks. Each
            # candidate is still individually authorization-checked below.
            pass
        if chat_topic:
            where.append("m.chat_topic = %(topic)s")
            params["topic"] = chat_topic
    # For global searches, only consider channels linked to the current user.
    # _can_access_message validates every candidate again (incl. contributor threads).
    else:
        where.append("""EXISTS (
            SELECT 1 FROM `tabClefinCode Chat Channel User` u
            WHERE u.parent = m.chat_channel AND u.user = %(user)s AND u.is_removed = 0
        ) OR EXISTS (
            SELECT 1 FROM `tabClefinCode Chat Channel User` t
            WHERE t.parent = m.sub_channel AND t.user = %(user)s
                AND t.active = 1 AND t.is_removed = 0
        )""")
    # Make OR clauses explicit to avoid bypassing the deleted/recipient filters.
    clause = " AND ".join(f"({part})" for part in where)
    sql = f"""
        SELECT m.name, m.chat_channel, m.sub_channel, m.chat_topic,
               m.send_date, m.sender, m.sender_email, m.file_type,
               m.content, m.file_id, m.only_receive_by, m.audio_status,
               m.is_deleted, m.is_voice_clip,
               m.audio_words_json, m.audio_segments_json
        FROM `tabClefinCode Chat Message` m
        WHERE {clause}
        ORDER BY m.send_date DESC, m.name DESC
        LIMIT %(limit)s
    """
    rows = frappe.db.sql(sql, params, as_dict=True)
    results = []
    for msg in rows:
        if not _can_access_message(msg, user=user):
            continue
        audio_hits = []
        if cint(msg.is_voice_clip) and transcript_from_content(msg.content):
            audio_hits = _audio_matches(msg, query)
        if audio_hits:
            file_url = ""
            if msg.file_id:
                file_ref = frappe.db.get_value(
                    "File", msg.file_id,
                    ["attached_to_doctype", "attached_to_name", "file_url"],
                    as_dict=True,
                )
                if (file_ref and file_ref.attached_to_doctype == DOCTYPE
                        and file_ref.attached_to_name == msg.name
                        and str(file_ref.file_url or "").startswith(("/private/files/", "/files/"))):
                    file_url = file_ref.file_url
            results.append({
                "name": msg.name, "message_name": msg.name,
                "chat_channel": msg.chat_channel, "sub_channel": msg.sub_channel,
                "chat_topic": msg.chat_topic, "send_date": msg.send_date,
                "file_id": msg.file_id, "file_url": file_url,
                "is_voice_clip": 1, "file_type": msg.file_type,
                "sender": msg.sender, "sender_email": msg.sender_email,
                "content": "Voice recording · " + (audio_hits[0]["timestamp"] or "time unavailable")
                           + " · " + audio_hits[0]["excerpt"],
                "match_type": "recording",
                "matches": audio_hits[:30], "timestamp": audio_hits[0]["timestamp"],
                "timestamp_seconds": audio_hits[0]["timestamp_seconds"],
                "content_excerpt": audio_hits[0]["excerpt"],
            })
        if include_text and not cint(msg.is_voice_clip):
            plain = strip_html(msg.content or "")
            pattern = re.compile(r"(?<!\w)" + r"\s+".join(re.escape(x) for x in query.split()) + r"(?!\w)", re.I)
            hit = pattern.search(plain)
            if hit:
                results.append({
                    "name": msg.name, "message_name": msg.name,
                    "chat_channel": msg.chat_channel, "sub_channel": msg.sub_channel,
                    "chat_topic": msg.chat_topic, "send_date": msg.send_date,
                    "match_type": "text", "timestamp": None,
                    "content": plain,
                    "sender": msg.sender, "sender_email": msg.sender_email,
                    "is_voice_clip": 0, "file_type": msg.file_type,
                    "timestamp_seconds": None,
                    "matches": [],
                    "content_excerpt": plain[max(0, hit.start() - 55):hit.end() + 55],
                })
        if len(results) >= limit:
            break
    return results[:limit]

@frappe.whitelist()
def get_visible_recording_transcripts(message_names):
    """Batch-load automatically visible transcripts for chat rendering.

    Channel Show Transcript OR Message Show Transcript enables each message.
    A member must still be allowed to read the specific voice message.
    No unchecked transcript is returned by this endpoint.
    """
    user = _current_user()
    if isinstance(message_names, str):
        try:
            message_names = json.loads(message_names)
        except ValueError:
            frappe.throw("Invalid message_names JSON.")
    if not isinstance(message_names, list) or len(message_names) > 80:
        frappe.throw("message_names must be a list containing at most 80 names.")
    names = list(dict.fromkeys(str(n) for n in message_names if isinstance(n, str) and n))
    if not names:
        return {"results": []}
    rows = frappe.get_all(DOCTYPE,
                          filters={"name": ["in", names], "is_voice_clip": 1, "is_deleted": 0},
                          fields=["name", "chat_channel", "sub_channel", "chat_topic",
                                  "only_receive_by", "is_deleted", "is_voice_clip", "file_id",
                                  "audio_status", "content", "show_transcript", "hide_transcript"],
                          limit_page_length=len(names))
    channel_flags = {}
    results = []
    for row in rows:
        if not cint(row.is_voice_clip) or not _can_access_message(row, user=user):
            continue
        channel = row.chat_channel
        if channel not in channel_flags:
            channel_flags[channel] = cint(frappe.db.get_value(
                "ClefinCode Chat Channel", channel, "show_transcript") or 0)
        sub_channel = row.sub_channel
        if sub_channel and sub_channel not in channel_flags:
            channel_flags[sub_channel] = cint(frappe.db.get_value(
                "ClefinCode Chat Channel", sub_channel, "show_transcript") or 0)
        channel_enabled = bool(channel_flags[channel] or
                               (sub_channel and channel_flags[sub_channel]))
        effective_show = (bool(cint(row.show_transcript)) or channel_enabled) and not bool(cint(row.hide_transcript))
        if not effective_show:
            continue
        results.append({
            "message_name": row.name,
            "status": row.audio_status or "Not Processed",
            "transcript": transcript_from_content(row.content)
                          if row.audio_status == "Completed" else "",
        })
    return {"results": results}


# -------------------- persisted in-chat transcript switches --------------------
# The two Check fields already exist in the supplied Channel and Message DocTypes.
# These endpoints are intentionally POST-only for writes, and do not bypass the
# existing recording/recipient visibility restrictions.
def _can_access_transcript_channel(channel, user):
    if not channel or not frappe.db.exists("ClefinCode Chat Channel", channel):
        return False
    if _parent_member(channel, user) or _thread_member(channel, user):
        return True
    parent = frappe.db.get_value("ClefinCode Chat Channel", channel, "parent_channel")
    return bool(parent and _parent_member(parent, user))


def _can_manage_transcript_channel(channel, user):
    if not _can_access_transcript_channel(channel, user):
        return False
    if set(frappe.get_roles(user)) & {"Chat Administrator", "System Manager"}:
        return True
    creator = frappe.db.get_value("ClefinCode Chat Channel", channel, "channel_creator")
    if creator and creator == user:
        return True
    return bool(frappe.db.get_value(
        "ClefinCode Chat Channel User",
        {"parent": channel, "user": user, "is_removed": 0},
        "is_admin",
    ))


def _can_manage_recording_switch(msg, user):
    return bool(
        user == (getattr(msg, "sender_email", None) or "")
        or _can_manage_transcript_channel(msg.chat_channel, user)
        or (msg.sub_channel and _can_manage_transcript_channel(msg.sub_channel, user))
    )


@frappe.whitelist(methods=["GET"])
def get_channel_transcript_control(channel):
    """Return the stored channel preference, including edit permission."""
    user = _current_user()
    if not _can_access_transcript_channel(channel, user):
        frappe.throw("You cannot access this chat channel.", frappe.PermissionError)
    return {
        "channel": channel,
        "show_transcript": bool(cint(frappe.db.get_value(
            "ClefinCode Chat Channel", channel, "show_transcript") or 0)),
        "can_manage": _can_manage_transcript_channel(channel, user),
    }


@frappe.whitelist(methods=["POST"])
def set_channel_transcript_visibility(channel, enabled):
    """Persist the channel-wide checkbox for its creator/admin."""
    user = _current_user()
    if not _can_manage_transcript_channel(channel, user):
        frappe.throw("Only the channel creator or an administrator can change this setting.",
                     frappe.PermissionError)
    value = _checked_switch_value(enabled)
    old_value = cint(frappe.db.get_value("ClefinCode Chat Channel", channel, "show_transcript") or 0)
    frappe.db.set_value("ClefinCode Chat Channel", channel, "show_transcript", value,
                        update_modified=False)
    if value and not old_value:
        # A new channel-wide enable applies to ALL voice notes. It resets old
        # message-level hide overrides; a user may hide an individual note again.
        frappe.db.sql("""
            UPDATE `tabClefinCode Chat Message`
            SET hide_transcript = 0
            WHERE is_voice_clip = 1 AND is_deleted = 0
              AND (chat_channel = %s OR sub_channel = %s)
        """, (channel, channel))

    channel_doc = frappe.get_doc("ClefinCode Chat Channel", channel)
    recipients = {user}
    candidates = [channel]
    if channel_doc.parent_channel:
        candidates.append(channel_doc.parent_channel)
    for channel_name in candidates:
        for row in frappe.get_all(
                "ClefinCode Chat Channel User",
                filters={"parent": channel_name, "is_removed": 0},
                fields=["user"]):
            if row.user:
                recipients.add(row.user)
    for recipient in recipients:
        frappe.publish_realtime(
            event="cc_recording_channel_visibility_changed",
            message={"channel": channel, "enabled": bool(value)},
            user=recipient,
            after_commit=True,
        )
    return {"channel": channel, "show_transcript": bool(value)}


def _checked_switch_value(value):
    if str(value).lower() not in {"0", "1", "false", "true"}:
        frappe.throw("The checkbox value must be 0 or 1.")
    return int(str(value).lower() in {"1", "true"})


@frappe.whitelist(methods=["POST"])
def edit_voice_transcript(message_name, new_transcript):
    """Edit a voice transcript in Content without changing its audio player.

    Uses the same sender-only and edit-time rules as the normal message edit.
    The edited text is escaped by content_with_transcript; old word timings are
    invalid after a manual rewrite and therefore intentionally cleared.
    """
    user = _current_user()
    msg = _get_allowed_recording(message_name)
    if msg.sender_email != user:
        frappe.throw("Only the sender can edit this voice transcript.", frappe.PermissionError)
    if cint(msg.is_edited):
        frappe.throw("This message has already been edited and cannot be edited again.")
    if msg.audio_status in ("Processing", "Queued"):
        frappe.throw("Wait until transcription finishes before editing its text.")
    if not isinstance(new_transcript, str):
        frappe.throw("Transcript must be text.")
    new_transcript = new_transcript.strip()
    if not new_transcript:
        frappe.throw("Transcript cannot be empty.")
    if len(new_transcript) > 30000:
        frappe.throw("Transcript is too long (30,000 characters maximum).")

    from frappe.utils import now_datetime as _now
    settings = frappe.get_single("ClefinCode Chat Settings")
    max_edit_time = cint(settings.max_edit_time or 0)
    if max_edit_time > 0:
        elapsed = (_now() - msg.creation).total_seconds()
        if elapsed > max_edit_time * 60:
            frappe.throw("Editing time has expired for this message.")

    previous_text = transcript_from_content(msg.content)
    if previous_text == new_transcript:
        return {"message_name": msg.name, "transcript": previous_text, "status": msg.audio_status}

    # Preserve original audio HTML, File link and other fields.
    original_content = msg.content or ""
    msg.content = content_with_transcript(original_content, new_transcript)
    msg.audio_transcript = ""
    msg.audio_words_json = "[]"   # Old ASR word/segment positions are no longer valid.
    msg.audio_segments_json = "[]"
    msg.audio_summary = ""
    msg.audio_summary_status = "Not Processed"
    msg.audio_summary_error = ""
    msg.audio_translations_json = "{}"
    msg.audio_translation_status_json = "{}"
    msg.audio_status = "Completed"
    msg.audio_error = ""
    msg.is_edited = 1
    frappe.get_doc({
        "doctype": "CiC Backup Chat Message",
        "original_content": original_content,
        "original_message": msg.name,
        "change_type": "Edit",
    }).insert(ignore_permissions=True)
    msg.save(ignore_permissions=True)

    # Notify other open chat windows WITHOUT an `edit_message` event: the
    # standard handler replaces message bubbles and would destroy voice players.
    channel = frappe.get_doc("ClefinCode Chat Channel", msg.chat_channel)
    recipients = {user}
    if getattr(msg, "only_receive_by", None):
        recipients.add(msg.only_receive_by)
    else:
        recipients.update(member.user for member in channel.members
                          if member.user and not cint(getattr(member, "is_removed", 0))
                          and member.platform == "Chat")
    for recipient in recipients:
        frappe.publish_realtime(
            event="cc_recording_transcript_changed",
            message={"message_name": msg.name, "channel": msg.chat_channel},
            user=recipient,
            after_commit=True,
        )
    return {"message_name": msg.name, "transcript": new_transcript, "status": "Completed"}


@frappe.whitelist(methods=["POST"])
def set_recording_transcript_visibility(message_name, enabled):
    """Persist one recording's checkbox without rewriting audio/content."""
    user = _current_user()
    msg = _get_allowed_recording(message_name)
    if not _can_manage_recording_switch(msg, user):
        frappe.throw("Only the sender or a channel administrator can change this setting.",
                     frappe.PermissionError)
    value = _checked_switch_value(enabled)
    # Persist an individual override, even when the channel-level default is ON.
    # Unchecking must hide the panel for this message after refreshing the page.
    frappe.db.set_value(DOCTYPE, msg.name, {
        "show_transcript": value,
        "hide_transcript": 0 if value else 1,
    }, update_modified=False)
    return {"message_name": msg.name, "show_transcript": bool(value),
            "hide_transcript": not bool(value), "effective_show": bool(value),
            "chat_channel": msg.chat_channel}


@frappe.whitelist(methods=["GET"])
def get_channel_voice_recording_index(channel, limit=400):
    """Authenticated File-to-message index for custom voice players.

    Some ChatSpace variants do not render data-message-name in the DOM.
    The browser can match a rendered audio File URL to one accessible message.
    No transcript content, unrelated messages, or unlinked Files are returned.
    """
    user = _current_user()
    if not _can_access_transcript_channel(channel, user):
        frappe.throw("You cannot access this chat channel.", frappe.PermissionError)
    limit = min(400, max(1, cint(limit) or 400))
    parent = frappe.db.get_value("ClefinCode Chat Channel", channel, "parent_channel")
    filters = {"chat_channel": parent or channel, "is_voice_clip": 1,
               "is_deleted": 0}
    if parent:
        filters["sub_channel"] = channel
    rows = frappe.get_all(
        DOCTYPE,
        filters=filters,
        fields=["name", "chat_channel", "sub_channel", "chat_topic",
                "only_receive_by", "is_deleted", "is_voice_clip", "file_id"],
        order_by="send_date desc",
        limit_page_length=limit,
    )
    results = []
    for msg in rows:
        if not msg.file_id or not _can_access_message(msg, user=user):
            continue
        file_info = frappe.db.get_value(
            "File", msg.file_id,
            ["file_url", "attached_to_doctype", "attached_to_name"],
            as_dict=True,
        )
        if not file_info or file_info.attached_to_doctype != DOCTYPE or \
                file_info.attached_to_name != msg.name:
            continue
        file_url = file_info.file_url or ""
        if not file_url.startswith(("/private/files/", "/files/")):
            continue
        results.append({"message_name": msg.name,
                        "file_id": msg.file_id,
                        "file_url": file_url})
    return {"results": results}


@frappe.whitelist(methods=["GET"])
def get_recording_transcript_controls(message_names):
    """Accessible voice rows, including those with show_transcript OFF.

    The original bulk API returned ONLY checked recordings, so the browser
    could not draw a checkbox for unchecked voice messages. This endpoint
    includes their flags but returns transcript text only when effective_show
    is enabled. A user may still manually request an allowed transcript.
    """
    user = _current_user()
    if isinstance(message_names, str):
        try:
            message_names = json.loads(message_names)
        except (ValueError, TypeError):
            frappe.throw("Invalid message_names JSON.")
    if not isinstance(message_names, list) or len(message_names) > 80:
        frappe.throw("message_names must contain at most 80 entries.")
    names = list(dict.fromkeys(
        name for name in message_names if isinstance(name, str) and name.strip()
    ))
    if not names:
        return {"results": []}
    rows = frappe.get_all(
        DOCTYPE,
        filters={"name": ["in", names], "is_voice_clip": 1, "is_deleted": 0},
        fields=["name", "chat_channel", "sub_channel", "chat_topic", "sender_email",
                "only_receive_by", "is_deleted", "is_voice_clip", "file_id",
                "audio_status", "content", "show_transcript", "hide_transcript"],
        limit_page_length=len(names),
    )
    channel_flags = {}
    channel_manage = {}
    result = []
    for msg in rows:
        if not msg.file_id or not _can_access_message(msg, user=user):
            continue
        channel_names = [msg.chat_channel] + ([msg.sub_channel] if msg.sub_channel else [])
        for channel in channel_names:
            if channel not in channel_flags:
                channel_flags[channel] = bool(cint(frappe.db.get_value(
                    "ClefinCode Chat Channel", channel, "show_transcript") or 0))
                channel_manage[channel] = _can_manage_transcript_channel(channel, user)
        channel_show = any(channel_flags[channel] for channel in channel_names)
        own_show = bool(cint(msg.show_transcript))
        hidden_override = bool(cint(msg.hide_transcript))
        effective_show = (channel_show or own_show) and not hidden_override
        status = msg.audio_status or "Not Processed"
        result.append({
            "message_name": msg.name,
            "chat_channel": msg.chat_channel,
            "sub_channel": msg.sub_channel,
            "show_transcript": own_show,
            "hide_transcript": hidden_override,
            "channel_show_transcript": channel_show,
            "effective_show": effective_show,
            "can_manage": bool(user == (msg.sender_email or "") or any(
                channel_manage[channel] for channel in channel_names)),
            "status": status,
            "transcript": transcript_from_content(msg.content)
                          if effective_show and status == "Completed" else "",
        })
    return {"results": result}


def migrate_legacy_audio_transcripts(limit=500, dry_run=True):
    """One-time bench-console migration; NOT an HTTP endpoint.

    Put old transcripts into Message.content (escaped/hidden), and clear the
    deprecated column. Run with dry_run=True before an actual migration.
    Call in batches until converted/cleared counts are zero.
    """
    dry_run = bool(cint(dry_run))
    limit = min(5000, max(1, cint(limit) or 500))
    candidates = frappe.db.sql("""
        SELECT name, content, audio_transcript
        FROM `tabClefinCode Chat Message`
        WHERE is_voice_clip = 1 AND is_deleted = 0
          AND audio_transcript IS NOT NULL AND audio_transcript != ''
        ORDER BY creation ASC
        LIMIT %(limit)s
    """, {"limit": limit}, as_dict=True)
    converted = 0
    cleared = 0
    for msg in candidates:
        if transcript_from_content(msg.content):
            # Old duplicated content: keep the new Content text; clear only legacy.
            cleared += 1
            if not dry_run:
                _update_message(msg.name, audio_transcript="")
            continue
        converted += 1
        if not dry_run:
            _update_message(msg.name,
                content=content_with_transcript(msg.content, msg.audio_transcript),
                audio_transcript="")
    if not dry_run:
        frappe.db.commit()
    return {"converted": converted, "legacy_cleared": cleared,
            "dry_run": dry_run, "batch_count": len(candidates)}


@frappe.whitelist()
def search_recordings(query, channel=None, sub_channel=None, chat_topic=None, limit=100):
    """Search recordings in one channel or all authorized channels."""
    return {"results": _search_rows(query, channel, sub_channel, chat_topic, limit)}
@frappe.whitelist()
def search_messages_and_recordings(channel, query, sub_channel=None, chat_topic=None, limit=100):
    """Existing chat search envelope, now includes indexed voice-recording matches."""
    if not channel or not _normalized_query(query):
        return {"results": []}
    results = _search_rows(query, channel, sub_channel, chat_topic, limit, include_text=True)
    return {"results": [{"results": results, "count": len(results)}]}
@frappe.whitelist(methods=["POST"])
def backfill_voice_recordings(limit=50):
    """Admin-only explicit batch of previously sent voice clips (not automatic)."""
    _current_user()
    frappe.only_for("System Manager")
    limit = min(100, max(1, cint(limit) or 50))
    candidates = frappe.db.sql("""
        SELECT m.name, m.file_id
        FROM `tabClefinCode Chat Message` m
        WHERE m.is_voice_clip = 1 AND m.is_deleted = 0 AND m.file_id IS NOT NULL
          AND m.file_id != ''
          AND (m.audio_status IS NULL OR m.audio_status = ''
               OR m.audio_status = 'Not Processed' OR m.audio_status = 'Failed')
        ORDER BY m.send_date DESC
        LIMIT %(limit)s
    """, {"limit": limit}, as_dict=True)
    queued, skipped = 0, 0
    for row in candidates:
        file_ref = frappe.db.get_value(
            "File", row.file_id, ["attached_to_doctype", "attached_to_name"], as_dict=True,
        )
        if not file_ref or file_ref.attached_to_doctype != DOCTYPE or file_ref.attached_to_name != row.name:
            skipped += 1
            continue
        _update_message(row.name, audio_status="Queued", audio_error="")
        frappe.enqueue(
            "clefincode_chat.api.api_1_4_1.audio_features.process_voice_clip_transcription",
            queue="long", timeout=TRANSCRIPTION_TIMEOUT, enqueue_after_commit=True,
            job_id=f"cc_audio_backfill::{row.name}::{uuid4().hex[:8]}",
            message_name=row.name,
        )
        queued += 1
    return {"queued": queued, "skipped": skipped,
            "message": "Only already-linked, unprocessed recordings were queued."}
@frappe.whitelist(methods=["GET"])
def probe_voice_recording(message_name):
    """Safely classify a chat menu item without exposing unrelated messages.
    The frontend uses this instead of guessing from waveform CSS classes.
    Unavailable and unauthorized messages intentionally return the same result.
    """
    _current_user()
    if not message_name or not frappe.db.exists(DOCTYPE, message_name):
        return {"is_recording": False}
    msg = frappe.get_doc(DOCTYPE, message_name)
    if not _can_access_message(msg):
        return {"is_recording": False}
    if not cint(getattr(msg, "is_voice_clip", 0)):
        return {"is_recording": False}
    return {
        "is_recording": True,
        "message_name": msg.name,
        "chat_channel": msg.chat_channel,
        "sub_channel": getattr(msg, "sub_channel", None) or None,
        "chat_topic": getattr(msg, "chat_topic", None) or None,
        "has_file": bool(getattr(msg, "file_id", None)),
        "status": getattr(msg, "audio_status", None) or "Not Processed",
    }
