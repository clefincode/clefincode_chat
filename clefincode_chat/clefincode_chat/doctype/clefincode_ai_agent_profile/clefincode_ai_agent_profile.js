// Copyright (c) 2025, ClefinCode L.L.C-FZ and contributors
// For license information, please see license.txt

const CC_RESPONSES_ENDPOINT = "/v1/responses";
const CC_AUDIO_ENDPOINT = "/v1/audio/transcriptions";
const CC_GROQ_AUDIO_ENDPOINT = "/openai/v1/audio/transcriptions";
const CC_DISCOVER_MODELS = "clefincode_chat.clefincode_chat.doctype.clefincode_ai_agent_profile.clefincode_ai_agent_profile.get_installed_local_audio_models";

function ccIsLocalAudio(frm) {
    return frm.doc.agent_purpose === "Audio Transcription" && frm.doc.provider === "Local";
}

function ccConfigureAgentFields(frm) {
    const isAudio = frm.doc.agent_purpose === "Audio Transcription";
    const isLocal = ccIsLocalAudio(frm);
    frm.set_df_property("provider", "options", isAudio
        ? "OpenAI\nGroq\nCustom\nLocal"
        : "OpenAI\nClaude\nGroq");
    frm.set_df_property("model", "description", isLocal
        ? __("Select Model Directory first. Choose an installed model from the suggestions; the server scans for available local models.")
        : __("Enter the hosted AI model identifier used by this provider."));
    frm.set_df_property("endpoint_responses", "label", isAudio
        ? __("API Endpoint (path)")
        : __("Responses Endpoint (path)"));
    // Legacy Local profiles may not yet have a directory. Permit unrelated
    // edits, but require the directory for newly created Local profiles.
    frm.toggle_reqd("model_cache_dir", isLocal && (frm.is_new() || !!frm.doc.model_cache_dir));
    frm.set_df_property("model", "read_only", isLocal && !(frm.doc.model_cache_dir || "").trim());
    if (!isLocal) {
        frm.fields_dict.model?.set_data?.([]);
    }
}

function ccSetStandardEndpoint(frm) {
    const isAudio = frm.doc.agent_purpose === "Audio Transcription";
    const provider = frm.doc.provider || "OpenAI";
    const current = (frm.doc.endpoint_responses || "").trim();
    const knownDefaults = ["", CC_RESPONSES_ENDPOINT, CC_AUDIO_ENDPOINT, CC_GROQ_AUDIO_ENDPOINT];
    if (!knownDefaults.includes(current)) return;
    let wanted = CC_RESPONSES_ENDPOINT;
    if (isAudio && provider !== "Local") {
        wanted = provider === "Groq" ? CC_GROQ_AUDIO_ENDPOINT : CC_AUDIO_ENDPOINT;
    }
    if (current !== wanted) frm.set_value("endpoint_responses", wanted);
}

async function ccDiscoverInstalledModels(frm, notify = false) {
    const control = frm.fields_dict.model;
    const directory = (frm.doc.model_cache_dir || "").trim();
    const serial = (frm.__ccModelLookupSerial || 0) + 1;
    frm.__ccModelLookupSerial = serial;
    if (!ccIsLocalAudio(frm) || !directory) {
        control?.set_data?.([]);
        return;
    }
    frm.set_df_property("model", "read_only", true);
    try {
        const result = await frappe.call({
            method: CC_DISCOVER_MODELS,
            type: "GET",
            args: {directory},
        });
        if (serial !== frm.__ccModelLookupSerial || !ccIsLocalAudio(frm)
            || directory !== (frm.doc.model_cache_dir || "").trim()) return;
        const models = result.message?.models || [];
        frm.set_df_property("model", "read_only", models.length === 0);
        frm.fields_dict.model?.set_data?.(models.map(m => ({value: m.value, label: m.label})));
        if (notify) {
            frappe.show_alert({
                message: models.length
                    ? __("Found {0} installed audio model(s). Open Model to choose one.", [models.length])
                    : __("No supported installed audio models were found in this directory."),
                indicator: models.length ? "green" : "orange",
            });
        }
        frm.__ccInstalledModelValues = models.map(m => m.value);
    } catch (error) {
        if (serial !== frm.__ccModelLookupSerial) return;
        frm.set_df_property("model", "read_only", true);
        frm.fields_dict.model?.set_data?.([]);
        frm.__ccInstalledModelValues = [];
        if (notify) {
            frappe.msgprint({
                title: __("Cannot scan model directory"),
                message: __("Check that the selected directory exists and contains installed models."),
                indicator: "orange",
            });
        }
        console.warn("[ClefinCode Chat] Local model discovery failed", error);
    }
}

frappe.ui.form.on("ClefinCode AI Agent Profile", {
    refresh(frm) {
        ccConfigureAgentFields(frm);
        if (ccIsLocalAudio(frm)) {
            frm.add_custom_button(__("Scan Installed Models"), () => ccDiscoverInstalledModels(frm, true));
            ccDiscoverInstalledModels(frm);
        }
    },
    agent_purpose(frm) {
        ccConfigureAgentFields(frm);
        const isAudio = frm.doc.agent_purpose === "Audio Transcription";
        const allowed = isAudio
            ? ["OpenAI", "Groq", "Custom", "Local"]
            : ["OpenAI", "Claude", "Groq"];
        if (!allowed.includes(frm.doc.provider)) {
            frm.set_value("provider", "OpenAI");
        } else {
            ccSetStandardEndpoint(frm);
            ccDiscoverInstalledModels(frm);
        }
    },
    provider(frm) {
        ccConfigureAgentFields(frm);
        ccSetStandardEndpoint(frm);
        if (ccIsLocalAudio(frm)) {
            // Never carry a hosted model ID into a Local profile.
            if (frm.is_new()) frm.set_value("model", "");
        }
        ccDiscoverInstalledModels(frm);
    },
    model_cache_dir(frm) {
        ccConfigureAgentFields(frm);
        // A new directory requires another explicit model selection.
        if (ccIsLocalAudio(frm) && frm.is_new()) frm.set_value("model", "");
        ccDiscoverInstalledModels(frm, true);
    },
});
