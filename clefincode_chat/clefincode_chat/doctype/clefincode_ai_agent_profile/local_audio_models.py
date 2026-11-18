"""Discover installed local speech-to-text models without downloading them.

The bundled Local runtime currently understands CTranslate2 directories, including
Hugging Face cached Faster-Whisper snapshots. This function is intentionally
isolated from the agent form so another local adapter can extend it later.
No arbitrary paths are accepted as model IDs during new profile configuration.
"""

from __future__ import annotations

import os
from pathlib import Path

import frappe

MAX_SCAN_DIRECTORIES = 1000
MAX_MODELS = 100
MAX_DEPTH = 5


def bench_root() -> Path:
    return Path(frappe.get_site_path()).resolve().parent.parent


def resolve_model_directory(value: str) -> Path:
    """Expand administrator-provided model location using the active Bench root."""
    value = str(value or "").strip()
    root = str(bench_root())
    if value == "$PWD" or value.startswith("$PWD/"):
        value = root + value[len("$PWD"):]
    elif value == "${PWD}" or value.startswith("${PWD}/"):
        value = root + value[len("${PWD}"):]
    expanded = Path(os.path.expandvars(os.path.expanduser(value)))
    if not expanded.is_absolute():
        expanded = bench_root() / expanded
    return expanded.resolve()


def _is_ct2_model(folder: Path) -> bool:
    """CTranslate2 models require both the weights and their config."""
    return (folder / "model.bin").is_file() and (folder / "config.json").is_file()


def _local_model_option(root: Path, folder: Path) -> dict:
    """Make absolute paths the default: no ambiguity about model repositories.

    Only canonical Systran Faster-Whisper caches immediately under the selected
    HF cache root receive their familiar short IDs (e.g. medium, small). That
    makes existing offline installations compatible with the runtime loader.
    """
    relative = folder.relative_to(root)
    parts = relative.parts
    value = str(folder)
    label = folder.name if relative == Path(".") else str(relative)

    if (len(parts) == 3 and parts[0].startswith("models--")
            and parts[1] == "snapshots"):
        repository = parts[0].removeprefix("models--").replace("--", "/")
        label = repository
        prefix = "Systran/faster-whisper-"
        if repository.startswith(prefix):
            alias = repository[len(prefix):]
            # Faster-Whisper's own short aliases resolve to these repositories.
            known = {
                "tiny", "tiny.en", "base", "base.en", "small", "small.en",
                "medium", "medium.en", "large-v1", "large-v2", "large-v3",
                "large-v3-turbo",
            }
            if alias in known:
                value = alias
                label = f"{alias} ({repository})"

    return {"value": value, "label": label}


def discover_installed_local_audio_models(directory: str) -> list[dict]:
    """Return models already installed below directory; never download weights.

    Recognition is limited to model layouts supported by the current built-in
    inference adapter. Other formats should be added via a matching adapter,
    not presented as runnable models merely because a directory exists.
    """
    if not str(directory or "").strip():
        return []
    root = resolve_model_directory(directory)
    if not root.is_dir():
        raise ValueError(f"Model Directory does not exist: {root}")

    installed = []
    visited = 0
    for current, dirs, files in os.walk(root, followlinks=False):
        visited += 1
        if visited > MAX_SCAN_DIRECTORIES or len(installed) >= MAX_MODELS:
            break
        folder = Path(current)
        depth = len(folder.relative_to(root).parts)
        if depth >= MAX_DEPTH:
            dirs[:] = []
        else:
            dirs[:] = sorted(name for name in dirs if not name.startswith("."))

        if {"model.bin", "config.json"}.issubset(files) and _is_ct2_model(folder):
            installed.append(_local_model_option(root, folder))
            # One runnable model per directory. Nested folders do not matter.
            dirs[:] = []

    # Prefer human-readable model identifiers, then deterministic folder paths.
    installed.sort(key=lambda item: ("/" in item["value"], item["label"].lower()))
    deduped = []
    seen = set()
    for option in installed:
        if option["value"] not in seen:
            seen.add(option["value"])
            deduped.append(option)
    return deduped
