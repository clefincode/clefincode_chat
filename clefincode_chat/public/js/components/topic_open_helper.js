import { check_if_chat_window_open } from "./erpnext_chat_utils";
import ChatWindow from "./erpnext_chat_window";
import ChatSpace from "./erpnext_chat_space";

export async function open_topic_chat_window_from_context({
  chat_topic,
  chat_topic_subject = null,
  message_name = null,
  topic_color = null,
} = {}) {
  if (!chat_topic) {
    console.warn("[ClefinCode Chat] Missing chat_topic");
    return;
  }

  if (check_if_chat_window_open(chat_topic, "topic")) {
    $(`.expand-chat-window[data-id|='${chat_topic}']`).click();
    return;
  }

  let ctx = {
    can_write: false,
    chat_topic,
    chat_topic_subject,
    chat_channel: null,
    room_name: chat_topic_subject || "Topic",
    room_type: "Group",
    is_private_topic: 0,
  };

  try {
    const r = await frappe.call({
      method: "clefincode_chat.api.api_1_3_4.api.get_topic_open_context",
      args: {
        chat_topic,
        ...(message_name ? { message_name } : {}),
      },
    });
    ctx = { ...ctx, ...(r.message || {}) };
  } catch (err) {
    console.error("[ClefinCode Chat] Failed to get topic context", err);
  }

  const topicKey = ctx.chat_topic || chat_topic;
  const topicSubject = ctx.chat_topic_subject || chat_topic_subject || topicKey;
  const chatChannel = ctx.chat_channel;

  if (!chatChannel) {
    frappe.msgprint({
      title: __("Error"),
      message: __("No chat channel found for this topic."),
      indicator: "red",
    });
    return;
  }

  console.log("topic ctx", ctx);
  const canWrite = Boolean(ctx.can_write) && String(ctx.topic_status || "").toLowerCase() !== "closed";

  const chat_window = new ChatWindow({
    profile: {
      chat_topic: topicKey,
    },
  });

  new ChatSpace({
    $wrapper: chat_window.$chat_window,

    chat_topic: topicKey,
    chat_topic_subject: topicSubject,
    chat_topic_channel: chatChannel,
    is_private_topic: ctx.is_private_topic || 0,
    alternative_subject: topicSubject,

    is_topic_window: true,

    topic_write_mode: canWrite,
    topic_read_only: String(ctx.topic_status || "").toLowerCase() === "closed" || !canWrite,
    topic_can_reopen: Boolean(ctx.can_reopen),
    chat_status: ctx.chat_status,
    chat_topic_status: ctx.topic_status,
    original_room_type: ctx.room_type || "Group",
    topic_color: topic_color || ctx.topic_color || null,

    profile: {
      is_admin: true,
      user: frappe.session.user,
      user_email: frappe.session.user_email || frappe.session.user,

      room: chatChannel,
      room_type: "Topic",
      room_name: topicSubject,
      chat_topic: topicKey,
      chat_topic_subject: topicSubject,

      platform: ctx.platform || "Chat",
      is_removed: ctx.is_removed || 0,
      remove_date: ctx.remove_date || null,
      chat_status: ctx.chat_status,
    },
  });
}
