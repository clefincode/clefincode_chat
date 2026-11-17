// ClefinCode Chat recording asset
(function (window, document) {
    "use strict";
    const ROOT = "clefincode_chat.api.api_1_4_1.audio_features.";
    const say = (text) => typeof window.__ === "function" ? window.__(text) : text;
    async function call(name, args = {}, method = "GET") {
        const response = await window.frappe.call({
            method: ROOT + name,
            type: method,
            args
        });
        return response?.message || {};
    }
    function showError(error) {
        console.error("[CC Whisper transcription/search]", error);
        let message = say("Recording action failed. Check the browser Console or Frappe Error Log.");
        if (error && typeof error.message === "string" && error.message.length < 170) {
            message += " " + error.message;
        }
        window.frappe.msgprint({ title: say("Voice Recording"), message, indicator: "red" });
    }
    function element(tag, options = {}) {
        const node = document.createElement(tag);
        if (options.className) node.className = options.className;
        if (options.text !== undefined) node.textContent = String(options.text);
        return node;
    }
    function safeAudioURL(url) {
        if (typeof url !== "string") return "";
        return url.startsWith("/private/files/") || url.startsWith("/files/") ? url : "";
    }
    function player(fileUrl) {
        const source = safeAudioURL(fileUrl);
        if (!source) return null;
        const audio = element("audio");
        audio.controls = true;
        audio.preload = "metadata";
        audio.src = source;
        audio.style.cssText = "width:100%;min-width:210px;margin:8px 0;";
        return audio;
    }
    function timecode(value) {
        const seconds = Math.max(0, Math.floor(Number(value) || 0));
        if (seconds >= 3600) {
            return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:` +
                `${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:` +
                `${String(seconds % 60).padStart(2, "0")}`;
        }
        return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:` +
            `${String(seconds % 60).padStart(2, "0")}`;
    }
    function seek(audio, seconds) {
        if (!audio || seconds == null || !Number.isFinite(Number(seconds))) return;
        const start = Math.max(0, Number(seconds));
        const go = () => {
            try {
                audio.currentTime = start;
                const promise = audio.play();
                if (promise?.catch) promise.catch(() => {});
            } catch (error) { showError(error); }
        };
        if (audio.readyState < 1) {
            audio.addEventListener("loadedmetadata", go, { once: true });
            audio.load();
        } else {
            go();
        }
    }
    function dialog(title) {
        const popup = new window.frappe.ui.Dialog({
            title,
            size: "large",
            fields: [{ fieldtype: "HTML", fieldname: "cc_whisper_html" }]
        });
        popup.show();
        const root = popup.fields_dict.cc_whisper_html.$wrapper[0];
        root.textContent = "";
        return { popup, root };
    }
    // v4.2: direct per-voice checkbox plus channel checkbox inside Contact Info.
    // These checkboxes persist on the two existing DocType fields. Do not
    // inject transcript text into HTML: always use textContent.
    const VERSION = "4.7.0";
    const INLINE_SELECTOR = ".cc-inline-voice-transcript";
    const CONTROL_SELECTOR = ".cc-voice-transcript-switch";
    const HOST_SELECTOR = ".cc-voice-transcript-host";
    const CHANNEL_SELECTOR = ".cc-channel-transcript-switch";
    const stateCache = new Map();
    const scannedNodes = new Map();
    // DOM rows that have a recognizable voice player but lack a message ID.
    // Key by the message name returned from the authenticated File index.
    const fallbackRows = new Map();
    const channelIndexCache = new Map();
    const indexLoading = new Map();
    const INDEX_TTL_MS = 20000;
    let lastDiscovery = { withoutId: 0, resolvedByFile: 0, withoutFileKey: 0,
        duplicateFileKey: 0, noChatInstance: 0, indexFailures: 0 };
    const manualOpen = new Set();
    const polling = new Set();
    const POLL_MS = 3500;
    const AUTO_RECHECK_MS = 45000;
    let scanning = false;
    let rescanRequested = false;
    let scanTimer = null;
    let infoScanTimer = null;
    const MESSAGE_ROW_SELECTOR =
        ".chat-message, .message-row, .message-container, .message-item, " +
        ".message-wrapper, .message, .sender-message, .recipient-message";
    const MESSAGE_ID_SELECTOR = [
        "[data-message-name]", "[data-message-id]", "[data-msg-name]", "[data-msg-id]",
        ".chat-message[data-id]", ".message-row[data-id]", ".message-item[data-id]",
        ".message-container[data-id]", ".message-wrapper[data-id]",
        ".chat-message[data-name]", ".message-row[data-name]",
        ".message-item[data-name]", ".message-container[data-name]"
    ].join(",");
    function messageNameOf(el) {
        if (!el || el.closest(".message-action-menu")) return "";
        for (const key of ["data-message-name", "data-message-id", "data-msg-name", "data-msg-id",
                           "data-name", "data-id"]) {
            // `data-id`/`data-name` are safe only on a message-related element.
            if ((key === "data-id" || key === "data-name") &&
                !el.matches(MESSAGE_ROW_SELECTOR)) continue;
            const value = (el.getAttribute(key) || "").trim();
            if (value && value.length <= 140) return value;
        }
        return "";
    }
    function messageCandidates() {
        const candidates = new Map();
        for (const el of document.querySelectorAll(MESSAGE_ID_SELECTOR)) {
            const name = messageNameOf(el);
            if (!name) continue;
            const row = el.closest(MESSAGE_ROW_SELECTOR) || el.parentElement;
            if (!row || row.closest(".message-action-menu")) continue;
            // Use the outermost message row rather than an inner menu trigger.
            if (!candidates.has(name)) candidates.set(name, row);
        }
        return candidates;
    }
    function messageRows(name) {
        const rows = [];
        const seen = new Set();
        for (const el of document.querySelectorAll(MESSAGE_ID_SELECTOR)) {
            if (messageNameOf(el) !== String(name)) continue;
            const row = el.closest(MESSAGE_ROW_SELECTOR) || el.parentElement;
            if (!row || row.closest(".message-action-menu") || seen.has(row)) continue;
            seen.add(row);
            rows.push(row);
        }
        for (const row of fallbackRows.get(String(name)) || []) {
            if (!row.isConnected || seen.has(row)) continue;
            seen.add(row);
            rows.push(row);
        }
        return rows;
    }
    function messageRow(name) {
        return messageRows(name)[0] || null;
    }
    function messageTarget(row) {
        // Put controls next to the voice widget, not inside reply-quote text.
        const voice = row.querySelector(
            '.voice-clip-container, audio, .voice-message, .voice-note, .voice-clip, .audio-player, ' +
            '.audio-message, .audio-waveform, .voice-waveform, .waveform'
        );
        const bubble = voice?.closest(
            '.message-bubble, .message-body, .message-content, .message-data, .message-text'
        );
        if (bubble && row.contains(bubble)) return bubble;
        return row.querySelector(
            '.message-bubble, .message-body, .message-content, .message-data, .message-text'
        ) || row;
    }
    function transcriptHost(name, row) {
        const target = messageTarget(row);
        let host = [...row.querySelectorAll(HOST_SELECTOR)].find(
            el => el.dataset.ccVoiceMessage === name
        );
        if (!host) {
            host = element('div', { className: 'cc-voice-transcript-host' });
            host.dataset.ccVoiceMessage = name;
            host.style.cssText = 'display:block;margin-top:7px;max-width:100%;';
            target.appendChild(host);
        } else if (host.parentElement !== target && !target.contains(host)) {
            target.appendChild(host);
        }
        // Remove duplicate old controls injected by previous asset revisions.
        for (const control of row.querySelectorAll(CONTROL_SELECTOR)) {
            if (control.dataset.ccVoiceMessage === name && !host.contains(control)) control.remove();
        }
        for (const panel of row.querySelectorAll(INLINE_SELECTOR)) {
            if (panel.dataset.ccVoiceMessage === name && !host.contains(panel)) panel.remove();
        }
        return host;
    }
    function transcriptPanel(name, row) {
        const host = transcriptHost(name, row);
        let panel = [...host.querySelectorAll(INLINE_SELECTOR)].find(
            el => el.dataset.ccVoiceMessage === name
        );
        if (!panel) {
            panel = element('div', { className: 'cc-inline-voice-transcript' });
            panel.dataset.ccVoiceMessage = name;
            host.appendChild(panel);
        }
        panel.style.cssText =
            'margin-top:7px;padding:9px 11px;border:1px solid var(--border-color,#ddd);' +
            'border-radius:8px;background:var(--control-bg,#f7f8fa);' +
            'white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.55;';
        const heading = element('strong', { text: say('Transcript') });
        heading.style.cssText = 'display:block;margin-bottom:4px;';
        const body = element('div', { className: 'cc-transcript-text' });
        panel.replaceChildren(heading, body);
        return { heading, body };
    }
    function removePanels(name) {
        for (const row of messageRows(name)) {
            for (const panel of row.querySelectorAll(INLINE_SELECTOR)) {
                if (panel.dataset.ccVoiceMessage === name) panel.remove();
            }
            // Do NOT remove the permanent Show transcript checkbox.
        }
    }
    async function retryTranscript(name, button) {
        button.disabled = true;
        try {
            const response = await call('request_recording_transcription', {
                message_name: name, force: 0
            }, 'POST');
            const current = stateCache.get(name) || {};
            stateCache.set(name, { ...current, status: response.status || 'Queued', error: '' });
            renderMessage(name);
        } catch (error) {
            showError(error);
            button.disabled = false;
        }
    }
    function renderText(name, status, transcript) {
        for (const row of messageRows(name)) {
            const { heading, body } = transcriptPanel(name, row);
            if (status === 'Completed') {
                body.textContent = transcript || say('Transcript unavailable.');
            } else if (status === 'Failed') {
                heading.textContent = say('Transcription status');
                const detail = element('div', {
                    text: say('Transcription failed. Check Audio Error on the message form or server logs.')
                });
                const retry = element('button', { text: say('Retry transcription') });
                retry.type = 'button';
                retry.className = 'btn btn-xs btn-default';
                retry.style.cssText = 'margin-top:8px;cursor:pointer;';
                retry.addEventListener('click', event => {
                    event.stopPropagation();
                    void retryTranscript(name, retry);
                });
                body.append(detail, retry);
            } else if (status === 'Processing' || status === 'Queued') {
                heading.textContent = say('Transcription status');
                body.textContent = say('Transcribing voice recording...');
            } else {
                heading.textContent = say('Transcription status');
                body.textContent = say('No saved transcript yet. Use Start transcription to generate one.');
                const retry = element('button', { text: say('Start transcription') });
                retry.type = 'button';
                retry.className = 'btn btn-xs btn-default';
                retry.style.cssText = 'display:block;margin-top:8px;cursor:pointer;';
                retry.addEventListener('click', event => {
                    event.stopPropagation();
                    void retryTranscript(name, retry);
                });
                body.appendChild(retry);
            }
        }
    }
    function bindMessageToggle(name, control) {
        if (!control || control.dataset.ccVoiceBound === name) return;
        const input = control.querySelector("input[type=checkbox]");
        if (!input) return;
        control.dataset.ccVoiceBound = name;
        control.addEventListener("click", event => event.stopPropagation());
        input.addEventListener("change", async () => {
            const enabled = input.checked;
            input.disabled = true;
            let visibilitySaved = false;
            try {
                // First persist the user's visibility choice. This is independent
                // of whether Whisper can start or finish the transcription.
                await call("set_recording_transcript_visibility", {
                    message_name: name, enabled: enabled ? 1 : 0
                }, "POST");
                visibilitySaved = true;

                manualOpen.delete(name);
                const old = stateCache.get(name) || {};
                stateCache.set(name, {
                    ...old, show_transcript: enabled,
                    hide_transcript: !enabled, effective_show: enabled
                });
                renderMessage(name);
                invalidateMessageCache(name);
                scheduleInlineScan(true);

                // Unchecking only hides the transcript; it never launches a job.
                if (!enabled) return;

                // Read the authoritative saved transcript/status, because a
                // hidden transcript may not have been loaded into stateCache.
                const info = await call("get_recording_features", {
                    message_name: name
                });
                const state = stateCache.get(name) || {};
                stateCache.set(name, {
                    ...state, status: info.status || "Not Processed",
                    transcript: info.transcript || ""
                });
                renderMessage(name);

                // If a transcript is already saved, show it without reprocessing.
                // Also do not enqueue a duplicate when a worker is already running.
                if (String(info.transcript || "").trim() ||
                        info.status === "Queued" || info.status === "Processing") {
                    return;
                }

                // Not Processed / Failed (including no saved transcript):
                // checking Show transcript now starts a manual Whisper job,
                // regardless of the global Auto Transcribe Audio setting.
                const queued = await call("request_recording_transcription", {
                    message_name: name, force: 0
                }, "POST");
                const latest = stateCache.get(name) || {};
                stateCache.set(name, {
                    ...latest, status: queued.status || "Queued", error: ""
                });
                renderMessage(name); // Starts polling if queued/processing.
            } catch (error) {
                if (!visibilitySaved) {
                    // Only revert the checkbox when the visibility write failed.
                    input.checked = !enabled;
                }
                // If the transcription request failed, visibility remains saved
                // so the user can retry using the visible Start/Retry button.
                showError(error);
            } finally {
                input.disabled = !(stateCache.get(name) || {}).can_manage;
            }
        });
    }
    function messageSwitch(name, row, state) {
        const target = transcriptHost(name, row);
        let control = [...row.querySelectorAll(CONTROL_SELECTOR)].find(
            el => el.dataset.ccVoiceMessage === name
        );
        if (!control) {
            control = element("label", { className: "cc-voice-transcript-switch" });
            control.dataset.ccVoiceMessage = name;
            control.style.cssText = "display:flex;align-items:center;gap:7px;" +
                "margin-top:7px;cursor:pointer;font-size:12px;color:var(--text-muted,#666);";
            const input = element("input");
            input.type = "checkbox";
            input.className = "cc-message-transcript-checkbox";
            input.style.cssText = "margin:0;flex:0 0 auto;";
            const labelText = element("span", { text: say("Show transcript") });
            control.append(input, labelText);
            target.appendChild(control);
        }
        bindMessageToggle(name, control);
        // Keep the switch OUTSIDE the panel, so it remains after hiding it.
        const existingPanel = target.querySelector(INLINE_SELECTOR);
        if (existingPanel && control.nextElementSibling !== existingPanel) {
            target.insertBefore(control, existingPanel);
        }
        const input = control.querySelector("input[type=checkbox]");
        input.checked = !!state.effective_show;
        input.disabled = !state.can_manage;
        input.title = state.can_manage ? say("Display this voice transcript for chat members")
            : say("Only the sender or chat administrator can change this setting");
        control.style.cursor = state.can_manage ? "pointer" : "not-allowed";
        let viaChannel = control.querySelector(".cc-transcript-channel-label");
        if (state.channel_show_transcript && state.effective_show && !state.show_transcript) {
            if (!viaChannel) {
                viaChannel = element("span", {
                    className: "cc-transcript-channel-label",
                    text: say("(enabled for channel)")
                });
                control.append(viaChannel);
            }
        } else if (viaChannel) {
            viaChannel.remove();
        }
    }
    function renderMessage(name) {
        const state = stateCache.get(name);
        if (!state) return;
        for (const row of messageRows(name)) messageSwitch(name, row, state);
        if (state.effective_show || manualOpen.has(name)) {
            renderText(name, state.status, state.transcript);
            if ((state.status === "Processing" || state.status === "Queued") && !polling.has(name)) {
                void pollTranscript(name);
            }
        } else {
            removePanels(name);
        }
    }
    function invalidateMessageCache(name) {
        if (name) scannedNodes.delete(name);
        else scannedNodes.clear();
    }
    async function pollTranscript(name) {
        if (polling.has(name)) return;
        polling.add(name);
        try {
            for (let i = 0; i < 90; i++) {
                if (!messageRow(name)) return;
                const state = stateCache.get(name);
                if (!state || !(state.effective_show || manualOpen.has(name))) return;
                const info = await call("get_recording_features", { message_name: name });
                const latest = stateCache.get(name);
                if (!latest || !(latest.effective_show || manualOpen.has(name))) return;
                stateCache.set(name, { ...latest, status: info.status, transcript: info.transcript || "" });
                renderMessage(name);
                if (info.status === "Completed" || info.status === "Failed") return;
                if (info.status !== "Processing" && info.status !== "Queued") return;
                await new Promise(resolve => window.setTimeout(resolve, POLL_MS));
            }
        } catch (error) {
            console.warn("[CC recording] transcript polling failed", error);
        } finally {
            polling.delete(name);
        }
    }
    async function openTranscript(name) {
        // The menu action still allows an authenticated viewer to open a
        // transcript, even if they cannot modify another person's checkbox.
        manualOpen.add(name);
        try {
            let info = await call("get_recording_features", { message_name: name });
            const state = stateCache.get(name) || { show_transcript: info.show_transcript,
                channel_show_transcript: info.channel_show_transcript, can_manage: false };
            stateCache.set(name, { ...state, status: info.status, transcript: info.transcript || "",
                effective_show: !!(state.show_transcript || state.channel_show_transcript) });
            renderMessage(name);
            if (info.status === "Queued" || info.status === "Processing") {
                void pollTranscript(name);
            }
        } catch (error) {
            manualOpen.delete(name);
            showError(error);
        }
        return messageRow(name);
    }
    // Resolve voice rows that are not labelled with a message ID in ChatSpace.
    // Never pair clips by message order or timestamp: that can attach another
    // message's transcript to the wrong recording.
    const VOICE_SELECTOR = [
        '.voice-clip-container', 'audio', '.voice-message', '.voice-note', '.voice-clip',
        '.audio-player', '.audio-message', '.audio-waveform',
        '.voice-waveform', '.waveform', '[data-audio-url]',
        '[data-file-url]', '[data-voice-message]'
    ].join(',');
    const VOICE_ROW_SELECTOR = [
        '.chat-message', '.message-row', '.message-container',
        '.message-item', '.message-wrapper', '.message',
        '.message-bubble', '.chat-bubble', '.chat-msg', '.sender-message',
        '.recipient-message', '.voice-message',
        '.audio-message'
    ].join(',');
    function voiceRowsMissingIds() {
        const discovered = new Set();
        const rows = [];
        for (const player of document.querySelectorAll(VOICE_SELECTOR)) {
            if (player.closest('.message-action-menu, .cc-inline-voice-transcript,' +
                    '.cc-whisper-search-result')) continue;
            if (!player.isConnected || !player.getClientRects().length) continue;
            // Use the real ChatSpace wrapper; the inner bubble may lack its ID.
            const row = player.closest('.sender-message, .recipient-message') ||
                player.closest(
                    '.chat-message, .message-row, .message-container, .message-item, ' +
                    '.message-wrapper, .message, .message-bubble, .chat-bubble, .chat-msg'
                ) || player.closest(VOICE_ROW_SELECTOR) || player.parentElement;
            if (!row || discovered.has(row)) continue;
            if (row.closest('.message-action-menu')) continue;
            discovered.add(row);
            // Does the message already have an ID in its own wrapper?
            const idElement = row.matches(MESSAGE_ID_SELECTOR) ? row :
                row.querySelector(MESSAGE_ID_SELECTOR);
            const knownId = messageNameOf(idElement);
            if (knownId && row.querySelector(CONTROL_SELECTOR)) continue;
            rows.push(row);
        }
        return rows;
    }
    function filePath(value) {
        if (typeof value !== 'string' || !value.trim()) return '';
        try {
            // Handle site-relative File URLs even in embedded/preview contexts.
            if (value.startsWith('/private/files/') || value.startsWith('/files/')) {
                return decodeURIComponent(value.split('?')[0].split('#')[0]);
            }
            const url = new URL(value, window.location.href);
            if (url.origin !== window.location.origin) return '';
            const path = decodeURIComponent(url.pathname);
            if (!path.startsWith('/private/files/') && !path.startsWith('/files/')) return '';
            return path;
        } catch (_) { return ''; }
    }
    function fileKeys(row) {
        const keys = new Set();
        const nodes = [row, ...row.querySelectorAll(
            'audio,source,a[href],[data-file-url],[data-audio-url],' +
            '[data-attachment],[data-file-id],[data-src],[data-url]'
        )];
        for (const node of nodes) {
            for (const field of ['src', 'href', 'data-src', 'data-url',
                    'data-file-url', 'data-audio-url', 'data-attachment']) {
                const path = filePath(node.getAttribute?.(field));
                if (path) keys.add('url:' + path);
            }
            for (const field of ['data-file-id', 'data-file-name']) {
                const id = (node.getAttribute?.(field) || '').trim();
                if (id && id.length < 140) keys.add('file:' + id);
            }
        }
        return keys;
    }
    function getRowRoom(row) {
        for (const cs of chatInstances()) {
            const root = instanceRoot(cs);
            if (root && root.contains(row)) return cs.profile.room;
        }
        // Only fall back to room attributes on ancestors; never guess a room.
        const el = row.closest('[data-room],[data-chat-room],[data-chat-room-id]');
        return el?.getAttribute('data-chat-room') ||
            el?.getAttribute('data-chat-room-id') || el?.getAttribute('data-room') || '';
    }
    async function recordingIndex(channel) {
        const cached = channelIndexCache.get(channel);
        if (cached && Date.now() - cached.time < INDEX_TTL_MS) return cached.items;
        if (indexLoading.has(channel)) return indexLoading.get(channel);
        const request = call('get_channel_voice_recording_index', { channel, limit: 400 })
            .then(result => {
                const items = Array.isArray(result.results) ? result.results : [];
                channelIndexCache.set(channel, { time: Date.now(), items });
                return items;
            }).finally(() => indexLoading.delete(channel));
        indexLoading.set(channel, request);
        return request;
    }
    async function discoverVoiceRows() {
        for (const [name, rows] of fallbackRows) {
            const liveRows = new Set([...rows].filter(row => row.isConnected));
            if (liveRows.size) fallbackRows.set(name, liveRows);
            else fallbackRows.delete(name);
        }
        const diagnostics = { withoutId: 0, resolvedByFile: 0, withoutFileKey: 0,
            duplicateFileKey: 0, noChatInstance: 0, indexFailures: 0 };
        const byRoom = new Map();
        for (const row of voiceRowsMissingIds()) {
            const room = getRowRoom(row);
            if (!room) { diagnostics.noChatInstance++; continue; }
            const idNode = row.matches(MESSAGE_ID_SELECTOR) ? row :
                row.querySelector(MESSAGE_ID_SELECTOR);
            const id = messageNameOf(idNode);
            if (id) continue; // Real ChatSpace rows are identified directly.
            diagnostics.withoutId++;
            if (!byRoom.has(room)) byRoom.set(room, []);
            byRoom.get(room).push(row);
        }
        for (const [room, rows] of byRoom) {
            let recordings;
            try { recordings = await recordingIndex(room); }
            catch (error) {
                diagnostics.indexFailures++;
                console.warn('[CC recording] channel voice index failed', room, error);
                continue;
            }
            const matches = new Map();
            for (const item of recordings) {
                const keys = [];
                const path = filePath(item.file_url);
                if (path) keys.push('url:' + path);
                if (item.file_id) keys.push('file:' + item.file_id);
                for (const key of keys) {
                    if (!matches.has(key)) matches.set(key, new Set());
                    matches.get(key).add(item.message_name);
                }
            }
            for (const row of rows) {
                const keys = fileKeys(row);
                if (!keys.size) { diagnostics.withoutFileKey++; continue; }
                const ids = new Set();
                for (const key of keys) {
                    for (const id of matches.get(key) || []) ids.add(id);
                }
                if (ids.size !== 1) {
                    if (ids.size > 1) diagnostics.duplicateFileKey++;
                    continue;
                }
                const name = ids.values().next().value;
                if (!fallbackRows.has(name)) fallbackRows.set(name, new Set());
                fallbackRows.get(name).add(row);
                diagnostics.resolvedByFile++;
            }
        }
        lastDiscovery = diagnostics;
    }
    async function scanVisibleMessageTranscripts(force = false) {
        if (!window.frappe || !document.body) return;
        if (scanning) { rescanRequested = true; return; }
        const now = Date.now();
        // The normal renderer often lacks data-message-name on voice bubbles.
        // Use the server-authorized File association when the attribute is absent.
        await discoverVoiceRows();
        const candidates = messageCandidates();
        for (const [name, rows] of fallbackRows) {
            for (const row of rows) {
                if (row.isConnected && !candidates.has(name)) candidates.set(name, row);
            }
        }
        // Keep requests bounded. Visible voice-like rows are prioritized,
        // followed by recent rows (including custom audio widgets).
        const entries = [...candidates.entries()];
        const voiceLike = (_, row) => !!row.querySelector(
            ".voice-clip-container, audio, .voice-message, .voice-note, .voice-clip, .audio-player, " +
            ".audio-message, .audio-waveform, .voice-waveform, .waveform"
        );
        const prioritized = [
            ...entries.filter(([name, row]) => voiceLike(name, row)),
            ...entries.filter(([name, row]) => !voiceLike(name, row)).slice(-100)
        ];
        const seen = new Set();
        const names = [];
        for (const [name, row] of prioritized.slice(-320)) {
            if (seen.has(name)) continue;
            seen.add(name);
            const prev = scannedNodes.get(name);
            if (!force && prev && prev.row === row && now - prev.at < AUTO_RECHECK_MS &&
                row.querySelector(CONTROL_SELECTOR)) continue;
            names.push(name);
        }
        if (!names.length) return;
        scanning = true;
        try {
            // Python API rejects a batch above 80 names.
            for (let index = 0; index < names.length; index += 80) {
                const chunk = names.slice(index, index + 80);
                const response = await call("get_recording_transcript_controls", {
                    message_names: JSON.stringify(chunk)
                });
                const found = new Set();
                for (const state of response.results || []) {
                    if (!state?.message_name) continue;
                    found.add(state.message_name);
                    const old = stateCache.get(state.message_name);
                    if (manualOpen.has(state.message_name) && !state.transcript && old?.transcript) {
                        state.transcript = old.transcript;
                    }
                    stateCache.set(state.message_name, state);
                    renderMessage(state.message_name);
                }
                for (const name of chunk) {
                    scannedNodes.set(name, { row: messageRow(name), at: now });
                    if (!found.has(name)) {
                        stateCache.delete(name);
                        manualOpen.delete(name);
                        removePanels(name);
                        for (const row of messageRows(name)) {
                            if (row.getAttribute("data-cc-voice-recording") === "1") {
                                row.querySelectorAll(CONTROL_SELECTOR).forEach(el => {
                                    const input = el.querySelector("input[type=checkbox]");
                                    if (input) {
                                        input.checked = false;
                                        input.disabled = true;
                                        input.title = say("Transcript state unavailable or access denied");
                                    }
                                });
                            } else {
                                row.querySelectorAll(CONTROL_SELECTOR).forEach(el => el.remove());
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.warn("[CC recording] automatic message checkbox scan failed", error);
        } finally {
            scanning = false;
            if (scannedNodes.size > 400) {
                for (const [name, entry] of scannedNodes) {
                    if (!entry.row?.isConnected) scannedNodes.delete(name);
                }
            }
            if (rescanRequested) {
                rescanRequested = false;
                scheduleInlineScan(true);
            }
        }
    }
    function scheduleInlineScan(force = false) {
        if (force) invalidateMessageCache();
        if (scanTimer !== null) return;
        scanTimer = window.setTimeout(() => {
            scanTimer = null;
            void scanVisibleMessageTranscripts(force);
        }, 250);
    }
    function chatInstances() {
        return (window.CCChatSpaceInstances || []).filter(x => x && x.profile?.room);
    }
    function instanceRoot(cs) {
        for (const v of [cs.$wrapper, cs.$chat_window, cs.$container, cs.wrapper,
                         cs.chat_window?.$chat_window]) {
            const el = v?.jquery ? v[0] : (v?.nodeType === 1 ? v : v?.[0]);
            if (el?.nodeType === 1) return el;
        }
        return null;
    }
    function infoPanels() {
        const panels = new Set();
        // Use real Contact Info headings rather than attaching to the Desk
        // DocType or a random chat-window element.
        const keys = new Set(["contact info", "group info", "channel info",
            say("Contact Info").toLowerCase(), say("Group Info").toLowerCase()]);
        const heads = document.querySelectorAll("h1,h2,h3,h4,h5,strong,span,div");
        for (const h of heads) {
            if (h.children.length > 0 || !keys.has((h.textContent || "").trim().toLowerCase())) continue;
            let ancestor = h.parentElement;
            let fallback = null;
            for (let i = 0; i < 9 && ancestor && ancestor !== document.body; i++, ancestor = ancestor.parentElement) {
                const cls = typeof ancestor.className === "string" ? ancestor.className : "";
                const infoClass = /contact[-_ ]?info|group[-_ ]?info|channel[-_ ]?info|profile[-_ ]?info/i.test(cls);
                const txt = ancestor.textContent || "";
                const hasSidebarContent = /media,? links and docs|close channel|on going contributors|ongoing contributors/i.test(txt);
                if (hasSidebarContent && !ancestor.querySelector("[data-message-name]")) {
                    panels.add(ancestor);
                    break;
                }
                if (infoClass && !fallback) fallback = ancestor;
                if (!fallback && ancestor.getBoundingClientRect().width < 620 &&
                    ancestor.getBoundingClientRect().height > 180) {
                    fallback = ancestor;
                }
            }
            if (fallback && ![...panels].some(p => p.contains(h))) panels.add(fallback);
        }
        return [...panels];
    }
    function roomForPanel(panel) {
        const instances = chatInstances();
        for (const cs of instances) {
            const root = instanceRoot(cs);
            if (root && (root.contains(panel) ||
                (root.closest(".chat-window, .chat-window-container, .chat-window-wrapper")?.contains(panel)))) {
                return cs.profile.room;
            }
        }
        let el = panel;
        for (let i = 0; i < 7 && el; i++, el = el.parentElement) {
            for (const attr of ["data-room", "data-room-id", "data-chat-room"]) {
                if (el.getAttribute?.(attr)) return el.getAttribute(attr);
            }
        }
        // Safe fallback for the common single-chat-window situation.
        if (instances.length === 1 && instanceRoot(instances[0])?.isConnected) {
            return instances[0].profile.room;
        }
        return null; // Never silently toggle the wrong room with multiple windows.
    }
    function addChannelSwitch(panel, channel, info) {
        let control = panel.querySelector(CHANNEL_SELECTOR);
        if (control && control.dataset.channel !== channel) {
            control.remove();
            control = null;
        }
        if (!control) {
            control = element("label", { className: "cc-channel-transcript-switch" });
            control.dataset.channel = channel;
            control.style.cssText = "display:flex;gap:9px;align-items:center;" +
                "padding:12px 14px;border-block:1px solid var(--border-color,#e5e7eb);" +
                "background:var(--control-bg,#f7f8fa);font-size:13px;cursor:pointer;";
            const input = element("input");
            input.type = "checkbox";
            input.className = "cc-channel-transcript-checkbox";
            input.style.cssText = "margin:0;flex:0 0 auto;";
            const text = element("span", { text: say("Show all voice transcripts") });
            control.append(input, text);
            control.addEventListener("click", event => event.stopPropagation());
            input.addEventListener("change", async () => {
                const enabled = input.checked;
                input.disabled = true;
                try {
                    await call("set_channel_transcript_visibility", {
                        channel, enabled: enabled ? 1 : 0
                    }, "POST");
                    refreshChannel(channel, enabled);
                    window.frappe.show_alert({
                        message: say("Transcript setting saved"), indicator: "green"
                    });
                    scheduleInlineScan(true); // Immediately update all existing voice rows.
                } catch (error) {
                    input.checked = !enabled;
                    showError(error);
                } finally {
                    input.disabled = !info.can_manage;
                }
            });
            // Locate the Media section from the Contact Info screenshot.
            const leaves = [...panel.querySelectorAll("div,span,p,strong,h3,h4,h5")];
            const media = leaves.find(x => x.children.length === 0 &&
                /media,? links and docs/i.test((x.textContent || "").trim()));
            const after = media?.parentElement;
            if (after && after !== panel && after.parentElement && panel.contains(after)) {
                after.insertAdjacentElement("afterend", control);
            } else {
                panel.appendChild(control);
            }
        }
        const input = control.querySelector("input[type=checkbox]");
        input.checked = !!info.show_transcript;
        input.disabled = !info.can_manage;
        input.title = info.can_manage ? say("Show transcripts for all voice messages in this chat")
            : say("Only the channel creator or administrator can change this setting");
        control.style.cursor = info.can_manage ? "pointer" : "not-allowed";
        return control;
    }
    async function scanChatInfo() {
        if (!window.frappe) return;
        for (const panel of infoPanels()) {
            const channel = roomForPanel(panel);
            if (!channel) continue;
            const previous = panel.dataset.ccTranscriptChannel;
            if (previous === channel && panel.querySelector(CHANNEL_SELECTOR)) continue;
            panel.dataset.ccTranscriptChannel = channel;
            try {
                const info = await call("get_channel_transcript_control", { channel });
                if (!panel.isConnected || roomForPanel(panel) !== channel) continue;
                addChannelSwitch(panel, channel, info);
            } catch (error) {
                delete panel.dataset.ccTranscriptChannel;
                console.warn("[CC recording] channel info switch unavailable", error);
            }
        }
    }
    function scheduleInfoScan() {
        if (infoScanTimer !== null) return;
        infoScanTimer = window.setTimeout(() => {
            infoScanTimer = null;
            void scanChatInfo();
        }, 300);
    }
    function refreshMessage(messageName) {
        if (!messageName) return;
        scannedNodes.delete(String(messageName));
        scheduleInlineScan(true);
    }
    function refreshChannel(channel, enabled) {
        // Update the checkbox shown in Contact Info immediately.
        for (const el of document.querySelectorAll(CHANNEL_SELECTOR)) {
            if (el.dataset.channel !== String(channel)) continue;
            const input = el.querySelector('input[type="checkbox"]');
            if (input) input.checked = !!enabled;
        }
        // Optimistically show already-loaded voices while the authenticated
        // batch endpoint hydrates transcripts that were previously hidden.
        for (const [name, state] of stateCache) {
            if (state.chat_channel !== channel && state.sub_channel !== channel) continue;
            const updated = { ...state, channel_show_transcript: !!enabled };
            if (enabled) updated.hide_transcript = false;
            updated.effective_show =
                (updated.channel_show_transcript || updated.show_transcript) &&
                !updated.hide_transcript;
            stateCache.set(name, updated);
            if (!enabled) renderMessage(name);
        }
        scheduleInlineScan(true);
    }
    function refreshAll() {
        scheduleInlineScan(true);
        // A setting may have been changed from the Desk DocType form.
        for (const panel of infoPanels()) delete panel.dataset.ccTranscriptChannel;
        scheduleInfoScan();
    }
    function installInlineTranscripts() {
        if (!document.body) {
            document.addEventListener("DOMContentLoaded", installInlineTranscripts, { once: true });
            return;
        }
        if (window.CCRecordingInlineInstalled) return;
        window.CCRecordingInlineInstalled = true;
        const observer = new MutationObserver(mutations => {
            const additions = mutations.flatMap(m => [...m.addedNodes]);
            if (mutations.some(m => m.type === "attributes" &&
                    m.target.closest?.(MESSAGE_ROW_SELECTOR)) ||
                additions.some(n => n.nodeType === 1 &&
                    (n.matches?.(MESSAGE_ID_SELECTOR) ||
                     n.querySelector?.(MESSAGE_ID_SELECTOR) ||
                     n.matches?.(".voice-clip-container,audio,.audio-player,.voice-message,.voice-note,.waveform") ||
                     n.querySelector?.(".voice-clip-container,audio,.audio-player,.voice-message,.voice-note,.waveform")))) {
                scheduleInlineScan();
            }
            if (additions.some(n => n.nodeType === 1 &&
                (n.textContent?.includes("Contact Info") || n.textContent?.includes("Group Info") ||
                 (typeof n.className === "string" && /contact[-_]?info/i.test(n.className))))) {
                scheduleInfoScan();
            }
        });
        observer.observe(document.body, {
            childList: true, subtree: true, attributes: true,
            attributeFilter: ["data-message-name", "data-message-id", "data-msg-name", "data-msg-id",
                "data-id", "data-name", "src", "href", "data-file-url", "data-file-id", "data-audio-url"]
        });
        // Contact Info panels are usually created AFTER a header click.
        document.addEventListener("click", scheduleInfoScan, true);
        if (window.frappe?.realtime?.on) {
            window.frappe.realtime.on("cc_recording_transcript_ready", refreshAll);
            window.frappe.realtime.on("cc_recording_transcript_changed", payload => {
                refreshMessage(payload?.message_name);
            });
            window.frappe.realtime.on("cc_recording_channel_visibility_changed", payload => {
                if (payload?.channel) refreshChannel(payload.channel, payload.enabled);
            });
        }
        scheduleInlineScan();
        scheduleInfoScan();
        window.setInterval(refreshAll, AUTO_RECHECK_MS);
    }
    async function showTranscript(messageName) {
        return openTranscript(messageName);
    }
    async function requestTranscription(messageName, force = 0) {
        try {
            const result = await call(
                "request_recording_transcription",
                { message_name: messageName, force },
                "POST"
            );
            window.frappe.show_alert({
                message: `${say("Local Whisper transcription")}: ${result.status || "Queued"}`,
                indicator: result.status === "Completed" ? "green" : "blue"
            });
            return result;
        } catch (error) { showError(error); }
    }
    async function showSearchResults(query, results) {
        const { popup, root } = dialog(`${say("Search in voice recordings")}: ${query}`);
        if (!Array.isArray(results) || !results.length) {
            root.appendChild(element("p", { text: say("No matching transcribed recordings were found.") }));
            return popup;
        }
        for (const item of results) {
            const card = element("div", { className: "cc-whisper-search-result" });
            card.style.cssText = "padding:14px 0;border-bottom:1px solid var(--border-color,#ddd);";
            const header = element("div", { text: `${say("Voice recording")} · ${item.message_name || ""}` });
            header.style.cssText = "font-weight:600;";
            card.appendChild(header);
            if (item.sender_email) {
                const who = element("div", { text: item.sender_email });
                who.style.cssText = "color:var(--text-muted,#777);font-size:12px;";
                card.appendChild(who);
            }
            let audio = player(item.file_url);
            if (audio) card.appendChild(audio);
            const hits = Array.isArray(item.matches) ? item.matches : [];
            if (!hits.length) card.appendChild(element("p", { text: item.content_excerpt || "" }));
            for (const hit of hits) {
                const line = element("div");
                line.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;margin:7px 0;";
                const ts = hit.timestamp || say("Time unavailable");
                const play = element("button", { className: "btn btn-xs btn-default", text: `▶ ${ts}` });
                play.type = "button";
                play.title = hit.timestamp_source === "word"
                    ? say("Play from the matching word")
                    : say("Approximate timestamp; click to play");
                play.disabled = hit.timestamp_seconds === null || hit.timestamp_seconds === undefined;
                play.addEventListener("click", async () => {
                    try {
                        if (!audio) {
                            const info = await call("get_recording_features", { message_name: item.message_name });
                            audio = player(info.file_url);
                            if (audio) card.insertBefore(audio, line);
                        }
                        seek(audio, hit.timestamp_seconds);
                    } catch (error) { showError(error); }
                });
                line.appendChild(play);
                const excerpt = element("span", { text: hit.excerpt || item.content_excerpt || "" });
                excerpt.style.cssText = "flex:1;min-width:210px;white-space:pre-wrap;overflow-wrap:anywhere;";
                line.appendChild(excerpt);
                if (hit.timestamp_source !== "word" && hit.timestamp_seconds != null) {
                    const indicator = element("small", { text: say("estimated time") });
                    indicator.style.cssText = "color:var(--text-muted,#777);";
                    line.appendChild(indicator);
                }
                card.appendChild(line);
            }
            root.appendChild(card);
        }
        return popup;
    }
    function search(channel, { subChannel = null, chatTopic = null } = {}) {
        window.frappe.prompt(
            [{ fieldname: "query", fieldtype: "Data", label: say("Word or phrase"), reqd: 1 }],
            async (values) => {
                try {
                    const response = await call("search_recordings", {
                        channel: channel || null,
                        query: values.query,
                        sub_channel: subChannel,
                        chat_topic: chatTopic,
                        limit: 100
                    });
                    await showSearchResults(values.query, response.results || []);
                } catch (error) { showError(error); }
            },
            say("Find word in voice recordings"),
            say("Search")
        );
    }
    function mount({ container, messageName, channel = null } = {}) {
        if (!container || !messageName || container.dataset.ccRecordingAiMounted === "1") return;
        container.dataset.ccRecordingAiMounted = "1";
        const toolbar = element("div", { className: "cc-whisper-controls" });
        toolbar.style.cssText = "display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;";
        const actions = [
            [say("Find Word"), () => search(channel)],
        ];
        for (const [title, callback] of actions) {
            const button = element("button", { className: "btn btn-xs btn-default", text: title });
            button.type = "button";
            button.addEventListener("click", callback);
            toolbar.appendChild(button);
        }
        container.appendChild(toolbar);
        return { toolbar };
    }
    window.CCRecordingFeatures = {
        version: VERSION, call, timecode, seek,
        openTranscript, showTranscript, requestTranscription, search, showSearchResults, mount,
        scanVisibleMessageTranscripts, installInlineTranscripts,
        refreshAll, refreshMessage, refreshChannel,
        scheduleScan: () => scheduleInlineScan(),
        debug: () => ({ version: VERSION, channelPanels: infoPanels().length,
            instances: chatInstances().map(x => x.profile.room),
            candidateMessages: messageCandidates().size,
            transcriptControls: document.querySelectorAll(CONTROL_SELECTOR).length,
            channelControls: document.querySelectorAll(CHANNEL_SELECTOR).length,
            visibleVoicePlayers: document.querySelectorAll(VOICE_SELECTOR).length,
            mappedWithoutDomId: [...fallbackRows.values()].reduce((n, rows) => n + rows.size, 0),
            discovery: lastDiscovery })
    };
    installInlineTranscripts();
})(window, document);
