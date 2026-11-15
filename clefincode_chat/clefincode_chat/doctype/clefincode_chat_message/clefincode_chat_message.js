// Copyright (c) 2024, Ahmad Kamaleddin and contributors
// Voice transcripts live in Content and render inline; there is no transcript popup.
frappe.ui.form.on("ClefinCode Chat Message", {
    after_save(frm) {
        window.CCRecordingFeatures?.refreshAll?.();
    },
    refresh(frm) {
        if (frm.is_new()) return;
        frm.add_custom_button(__("Open Chat"), async () => {
            try {
                const r = await frappe.call({
                    method: "clefincode_chat.api.api_1_4_1.api.get_message_open_context",
                    args: { message_name: frm.doc.name },
                });
                const ctx = r.message || {};
                if (ctx.can_open !== true) {
                    frappe.msgprint({ title: __("Not Allowed"),
                        message: __("You are not allowed to open this chat channel."), indicator: "orange" });
                    return;
                }
                const room = ctx.chat_channel;
                if (window.CCCheckIfChatWindowOpen(room, "room")) {
                    $(`.expand-chat-window[data-id|='${room}']`).click();
                    setTimeout(() => {
                        const instances = window.CCChatSpaceInstances || [];
                        for (const cs of instances) {
                            if (cs && cs.profile?.room === room && typeof cs.jumpToMessage === "function") {
                                cs.jumpToMessage(ctx.message_name);
                                break;
                            }
                        }
                    }, 300);
                    return;
                }
                const profile = {
                    is_admin: true, user: frappe.session.user,
                    user_email: frappe.session.user_email || frappe.session.user,
                    room, room_name: ctx.room_name || room,
                    room_type: ctx.room_type || "Group", platform: ctx.platform || "Chat",
                    chat_status: ctx.chat_status,
                };
                const chat_window = new window.CCChatWindow({ profile: { room } });
                new window.CCChatSpace({
                    $wrapper: chat_window.$chat_window, profile,
                    chat_status: ctx.chat_status, initial_message_to_scroll: ctx.message_name,
                });
            } catch (error) {
                console.error("[CC AI][message.open.error]", error);
                frappe.msgprint({ title: __("Error"), message: __("Failed to open chat message."), indicator: "red" });
            }
        });

        if (!frm.doc.is_voice_clip || !frm.doc.file_id) return;

        frm.add_custom_button(__("Transcribe"), async () => {
            await ccMessageRequestTranscription(frm);
        }, __("Recording AI"));

        frm.add_custom_button(__("View Transcript Below"), async () => {
            frm.__cc_show_transcript_temporarily = true;
            await ccMessageTranscriptPreview(frm, true);
        }, __("Recording AI"));

        frm.add_custom_button(__("Find Word"), async () => {
            await frappe.require("/assets/clefincode_chat/js/recording_features.js");
            window.CCRecordingFeatures.search(frm.doc.chat_channel, {
                subChannel: frm.doc.sub_channel || null,
                chatTopic: frm.doc.chat_topic || null,
            });
        }, __("Recording AI"));

        void ccMessageTranscriptPreview(frm, false);
    },
    show_transcript(frm) {
        void ccMessageTranscriptPreview(frm, false);
    },
});

async function ccMessageRequestTranscription(frm) {
    try {
        const result = await frappe.call({
            method: "clefincode_chat.api.api_1_4_1.audio_features.request_recording_transcription",
            type: "POST", args: { message_name: frm.doc.name, force: 0 },
        });
        frm.__cc_show_transcript_temporarily = true;
        frappe.show_alert({ message: __("Whisper") + ": " + (result.message?.status || "Queued"), indicator: "blue" });
        await ccMessageTranscriptPreview(frm, false);
    } catch (error) {
        console.error("[CC AI] transcription request failed", error);
        frappe.msgprint({ title: __("Recording AI"), message: __("Could not queue transcription."), indicator: "red" });
    }
}

async function ccMessageTranscriptPreview(frm, requestIfMissing = false) {
    const wrapper = frm.fields_dict.audio_transcript_inline?.$wrapper?.[0];
    if (!wrapper) return;
    wrapper.textContent = "";
    if (!frm.doc.is_voice_clip || !frm.doc.file_id) return;
    if (!frm.doc.show_transcript && !frm.__cc_show_transcript_temporarily) return;

    const heading = document.createElement("strong");
    heading.textContent = __("Transcript");
    const content = document.createElement("div");
    content.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;padding:10px 0;line-height:1.6;";
    content.textContent = __("Loading...");
    wrapper.appendChild(heading);
    wrapper.appendChild(content);
    const messageName = frm.doc.name;

    try {
        for (let attempt = 0; attempt < 90; attempt++) {
            if (frm.doc.name !== messageName || !wrapper.isConnected) return;
            let response = await frappe.call({
                method: "clefincode_chat.api.api_1_4_1.audio_features.get_recording_features",
                args: { message_name: messageName },
            });
            const info = response.message || {};
            if (info.status === "Completed") {
                content.textContent = info.transcript || __("No speech detected.");
                return;
            }
            if ((info.status === "Failed" || info.status === "Not Processed") && requestIfMissing) {
                requestIfMissing = false;
                response = await frappe.call({
                    method: "clefincode_chat.api.api_1_4_1.audio_features.request_recording_transcription",
                    type: "POST", args: { message_name: messageName, force: 0 },
                });
                content.textContent = __("Transcribing voice recording...");
            } else if (info.status === "Queued" || info.status === "Processing") {
                content.textContent = __("Transcribing voice recording...");
            } else {
                content.textContent = info.error || __("No transcript available yet.");
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        content.textContent = __("Still processing. Refresh to check again.");
    } catch (error) {
        content.textContent = __("Could not load transcript; check your channel permissions.");
        console.warn("[CC AI] inline message preview failed", error);
    }
}
