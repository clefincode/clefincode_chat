// Copyright (c) 2024, Ahmad Kamaleddin and contributors
// The native Show Transcripts checkbox is stored on ClefinCode Chat Channel.
frappe.ui.form.on("ClefinCode Chat Channel", {
    setup(frm) {
        frm.set_query("transcription_agent", () => ({
            filters: { agent_purpose: "Audio Transcription" },
        }));
    },
    after_save(frm) {
        // Reflect changes from the Desk form in any already-open chat window.
        window.CCRecordingFeatures?.refreshAll?.();
    },
    async show_transcript(frm) {
        if (frm.is_new() || frm.__ccTranscriptUpdating) return;
        const enabled = Number(frm.doc.show_transcript || 0) === 1;
        frm.__ccTranscriptUpdating = true;
        try {
            await frappe.call({
                method: "clefincode_chat.api.api_1_4_1.audio_features.set_channel_transcript_visibility",
                type: "POST",
                args: { channel: frm.doc.name, enabled: enabled ? 1 : 0 },
            });
            // The endpoint saves immediately; no second Save is needed for
            // this checkbox (other unsaved form changes are unaffected).
            window.CCRecordingFeatures?.refreshChannel?.(frm.doc.name, enabled);
            frappe.show_alert({
                message: __("Channel transcript visibility updated"),
                indicator: "green",
            });
        } catch (error) {
            console.error("[CC recording] Channel transcript update failed", error);
            await frm.set_value("show_transcript", enabled ? 0 : 1);
            frappe.msgprint({
                title: __("Error"),
                message: __("Could not update channel transcript visibility."),
                indicator: "red",
            });
        } finally {
            frm.__ccTranscriptUpdating = false;
        }
    },
    refresh(frm) {
        if (frm.is_new()) return;
        frm.add_custom_button(__("Open Chat"), async () => {
            try {
                if (window.CC_AI_DEBUG === true) {
                    console.info("[CC AI][channel.open.input]", { chat_channel: frm.doc.name });
                }
                const r = await frappe.call({
                    method: "clefincode_chat.api.api_1_4_1.api.get_channel_open_context",
                    args: { chat_channel: frm.doc.name },
                });
                const ctx = r.message || {};
                if (window.CC_AI_DEBUG === true) {
                    console.info("[CC AI][channel.open.output]", {
                        chat_channel: frm.doc.name, can_open: ctx.can_open, room: ctx.room,
                    });
                }
                if (!ctx.can_open) {
                    frappe.msgprint({ title: __("Access Denied"),
                        message: __("You do not have access to this chat channel."), indicator: "red" });
                    return;
                }
                const room = ctx.room;
                if (window.CCCheckIfChatWindowOpen(room, "room")) {
                    $(`.expand-chat-window[data-id|='${room}']`).click();
                    return;
                }
                const profile = {
                    is_admin: true, user: frappe.session.user,
                    user_email: frappe.session.user_email || frappe.session.user,
                    room, room_name: ctx.room_name || room,
                    room_type: ctx.room_type || "Group", platform: ctx.platform || "Chat",
                    chat_status: ctx.chat_status,
                    is_removed: ctx.is_removed || 0,
                    remove_date: ctx.remove_date || null,
                };
                const chat_window = new window.CCChatWindow({ profile: { room } });
                new window.CCChatSpace({ $wrapper: chat_window.$chat_window,
                    profile, chat_status: ctx.chat_status });
            } catch (err) {
                frappe.msgprint({ title: __("Error"),
                    message: __("Failed to open chat channel."), indicator: "red" });
                console.error("[CC AI][channel.open.error]", err);
            }
        });
    },
});
