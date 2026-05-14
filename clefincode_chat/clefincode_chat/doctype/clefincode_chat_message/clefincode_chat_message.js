// Copyright (c) 2024, Ahmad Kamaleddin and contributors
// For license information, please see license.txt

frappe.ui.form.on("ClefinCode Chat Message", {
  refresh(frm) {
    if (frm.is_new()) return;

    frm.add_custom_button(__("Open Chat"), async () => {
      try {
        const r = await frappe.call({
          method: "clefincode_chat.api.api_1_3_3.api.get_message_open_context",
          args: { message_name: frm.doc.name },
        });

        const ctx = r.message || {};

        if (ctx.can_open !== true) {
          frappe.msgprint({
            title: __("Not Allowed"),
            message: __("You are not allowed to open this chat channel."),
            indicator: "orange",
          });
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
          is_admin: true,
          user: frappe.session.user,
          user_email: frappe.session.user_email || frappe.session.user,
          room: room,
          room_name: ctx.room_name || room,
          room_type: ctx.room_type || "Group",
          platform: ctx.platform || "Chat",
          chat_status: ctx.chat_status,
        };

        const chat_window = new window.CCChatWindow({
          profile: { room },
        });

        new window.CCChatSpace({
          $wrapper: chat_window.$chat_window,
          profile,
          chat_status: ctx.chat_status,
          initial_message_to_scroll: ctx.message_name,
        });
      } catch (e) {
        console.error("Failed to open chat message", e);
        frappe.msgprint({
          title: __("Error"),
          message: __("Failed to open chat message."),
          indicator: "red",
        });
      }
    });
  },
});
