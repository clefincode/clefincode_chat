// Copyright (c) 2024, Ahmad Kamaleddin and contributors
// For license information, please see license.txt
frappe.ui.form.on("ClefinCode Chat Channel", {
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
                    is_admin: true,
                    user: frappe.session.user,
                    user_email: frappe.session.user_email || frappe.session.user,
                    room,
                    room_name: ctx.room_name || room,
                    room_type: ctx.room_type || "Group",
                    platform: ctx.platform || "Chat",
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
