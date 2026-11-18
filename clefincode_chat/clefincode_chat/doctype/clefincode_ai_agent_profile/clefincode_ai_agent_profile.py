# Copyright (c) 2025, ClefinCode L.L.C-FZ and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import cint
from .local_audio_models import (
    discover_installed_local_audio_models, resolve_model_directory,
)

AI_RESPONSE = "AI Response"
AUDIO_TRANSCRIPTION = "Audio Transcription"
LOCAL_PROVIDER = "Local"
TRANSCRIPTION_API_PROVIDERS = {"OpenAI", "Groq", "Custom"}
RESPONSE_PROVIDERS = {"OpenAI", "Claude", "Groq"}


def agent_purpose(profile):
    """Older AI-agent rows without a purpose remain chat response agents."""
    return (profile.get("agent_purpose") or AI_RESPONSE).strip()


@frappe.whitelist(methods=["GET"])
def get_installed_local_audio_models(directory=None):
    """List installed local audio models for the administrator's agent form.

    Never download or open arbitrary model files in an HTTP worker.
    """
    if not frappe.has_permission("ClefinCode AI Agent Profile", ptype="read"):
        frappe.throw("You do not have permission to configure AI agents.", frappe.PermissionError)
    directory = str(directory or "").strip()
    if not directory:
        return {"models": [], "directory": ""}
    try:
        models = discover_installed_local_audio_models(directory)
    except ValueError as exc:
        frappe.throw(str(exc))
    return {"models": models, "directory": str(resolve_model_directory(directory))}


class ClefinCodeAIAgentProfile(Document):
    def validate(self):
        purpose = agent_purpose(self)
        if purpose not in (AI_RESPONSE, AUDIO_TRANSCRIPTION):
            frappe.throw("Agent Purpose must be AI Response or Audio Transcription.")
        self.agent_purpose = purpose

        self.provider = (self.provider or "OpenAI").strip()
        self.model = (self.model or "").strip()
        if purpose == AUDIO_TRANSCRIPTION and not self.model:
            frappe.throw("Please set Model for this Audio Transcription agent.")

        if purpose == AI_RESPONSE and self.provider not in RESPONSE_PROVIDERS:
            frappe.throw("AI Response supports OpenAI, Claude and Groq providers.")
        if purpose == AUDIO_TRANSCRIPTION:
            if self.provider not in TRANSCRIPTION_API_PROVIDERS | {LOCAL_PROVIDER}:
                frappe.throw(
                    "Audio Transcription supports OpenAI, Groq, Custom and Local providers."
                )
            if cint(self.audio_max_seconds or 0) < 0 or cint(self.audio_max_seconds or 0) > 7200:
                frappe.throw("Maximum Recording Seconds must be between 0 and 7200.")
            # Only the built-in local adapter consumes these optional runtime
            # parameters. Remote providers use the shared API fields instead.
            if self.provider == LOCAL_PROVIDER:
                # Existing profiles keep working without changing saved models.
                # Newly created profiles (or model/directory changes) must select
                # an installed model from the selected directory.
                if self._local_model_selection_changed():
                    directory = str(self.get("model_cache_dir") or "").strip()
                    if not directory:
                        frappe.throw("Enter Model Directory before selecting a Local audio model.")
                    try:
                        installed = discover_installed_local_audio_models(directory)
                    except ValueError as exc:
                        frappe.throw(str(exc))
                    if not installed:
                        frappe.throw("No supported installed audio models were found in Model Directory.")
                    selected = {item["value"] for item in installed}
                    if self.model not in selected:
                        frappe.throw("Select a detected installed model from Model Directory.")
                if self.get("processing_device") and self.processing_device not in ("auto", "cpu", "cuda"):
                    frappe.throw("Processing Device must be auto, cpu or cuda.")
                if self.get("compute_type") and self.compute_type not in (
                    "default", "int8", "int8_float16", "float16", "float32"
                ):
                    frappe.throw("Unsupported Compute Type for the installed local adapter.")
                threads = cint(self.get("cpu_threads") or 4)
                if not 1 <= threads <= 32:
                    frappe.throw("CPU Threads must be between 1 and 32.")
                beam_size = cint(self.get("decoding_beam_size") or 5)
                if not 1 <= beam_size <= 10:
                    frappe.throw("Decoding Beam Size must be between 1 and 10.")

        if self.provider != LOCAL_PROVIDER:
            if not (self.api_key or "").strip():
                frappe.throw("Set an API Key for the configured provider.")
            if self.provider == "Custom" and not (self.url or "").strip():
                frappe.throw("Custom transcription providers require an HTTPS base URL.")

        # Never allow an in-use profile to be repurposed to the wrong role.
        if not self.is_new():
            if purpose == AUDIO_TRANSCRIPTION and frappe.db.exists(
                "ClefinCode Chat Profile", {"ai_agent_profile": self.name, "is_ai_bot": 1}
            ):
                frappe.throw("This profile is assigned to a chat bot. Create a separate Audio Transcription profile.")
            if purpose == AI_RESPONSE and frappe.db.exists(
                "ClefinCode Chat Channel", {"transcription_agent": self.name}
            ):
                frappe.throw("This profile is assigned to a channel for transcription. Create a separate AI Response profile.")

        if cint(self.is_default):
            # Existing response profiles might still have NULL purpose until the migration runs.
            rows = frappe.db.sql(
                """
                SELECT name FROM `tabClefinCode AI Agent Profile`
                WHERE name != %s AND is_default = 1
                  AND COALESCE(NULLIF(agent_purpose, ''), 'AI Response') = %s
                LIMIT 1
                """, (self.name, purpose), as_dict=True,
            )
            if rows:
                frappe.throw(
                    f"'{rows[0].name}' is already the default {purpose} profile. "
                    "Disable its default flag first."
                )

    def _local_model_selection_changed(self):
        """Do not invalidate unchanged legacy model IDs on unrelated edits."""
        if self.is_new():
            return True
        original = frappe.db.get_value(
            "ClefinCode AI Agent Profile", self.name,
            ["agent_purpose", "provider", "model", "model_cache_dir"],
            as_dict=True,
        )
        if not original:
            return True
        return any(
            str(original.get(key) or "") != str(self.get(key) or "")
            for key in ("agent_purpose", "provider", "model", "model_cache_dir")
        )
