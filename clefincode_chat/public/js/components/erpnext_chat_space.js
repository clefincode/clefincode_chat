const script = document.createElement('script');
script.src = "https://cdnjs.cloudflare.com/ajax/libs/emojione/3.1.0/emojione.min.js";
script.onload = function () {
    console.log("Emojione library loaded");
};
document.head.appendChild(script);
import {
  scroll_to_bottom,
  get_date_from_now,
  get_time,
  is_date_change,
  is_image,
  is_video,
  is_audio,
  is_document,
  is_voice_clip,
  get_avatar_html,
  mark_messsages_as_read,
  contains_arabic,
  check_if_chat_window_open,
  get_profile_full_name,
  convertToUTC,
  send_message,
  create_sub_channel,
  get_time_now,
  get_chat_members,
  check_if_contributor_active,
  hide_overlay,
  show_overlay,
} from "./erpnext_chat_utils";
import { check_if_contact_has_chat } from "./erpnext_chat_contact";
import TypeMessageInput from "./type_message_input";
import TagBlot from "./tag_blot";
import ChatInfo from "./erpnext_chat_info";
import VoiceClip from "./voice_clip_widget";
import ChatWindow from "./erpnext_chat_window";
import ChatContactList from "./erpnext_chat_contact_list";

import { add_group_member, create_group } from "./erpnext_chat_contact_list";

export default class ChatSpace {
  constructor(opts) {
    this.$wrapper = opts.$wrapper;
    this.profile = opts.profile;
    this.$chat_room = opts.$chat_room;
    this.new_group = opts.new_group;
    this.chat_list = opts.chat_list;
    this.file = null;
    this.is_open = 1;
    this.typing = false;
    this.is_first_message = 0;
    this.lastScrollTop = 0;
    this.scrollUpThresholdPercent = 90;
    this.bottomThresholdPercent = 25;
    this.audiodict = [];
    this.messages_limit = 10;
    this.messages_offset = 0;
    this.isTypingIndicatorActive = false;
    this.typingTimeout = false;
    this.contributors = [];
    this.reference_doctypes = [];
    this.online_timeout = null;
    this.is_disk = "desk" in frappe;  

    this.unseenMessagesCount = 0;
    this.autoScrollThresholdPx = 120;

    // open chat space for showing topic information
   this.chat_topic_space = opts.chat_topic;
    this.chat_topic_channel = opts.chat_topic_channel;
    this.is_private_topic = opts.is_private_topic;

    this.chat_topic_space_subject = this.normalizeTopicSubject(
      opts.chat_topic_subject,
      opts.alternative_subject || opts.chat_topic || ""
    );

    this.alternative_subject = this.normalizeTopicSubject(
      opts.alternative_subject,
      opts.chat_topic_subject || opts.chat_topic || ""
    );
    this.topic_write_mode = opts.topic_write_mode || false;  
    this.is_topic_window = Boolean(opts.is_topic_window);
    if (this.chat_topic_space) {
      this.chat_topic = this.chat_topic_space;
    }
    this.not_authorized_user = false;
    this.chat_status = opts.chat_status;
    this.topic_can_reopen = Boolean(opts.topic_can_reopen);
    this.topic_read_only = Boolean(opts.topic_read_only);
    this.chat_topic_status = opts.chat_topic_status || null;
    this.reply_to_message_name = null;
    this.pendingReplies = [];
    this.searchResults = [];
    this.currentSearchIndex = -1;
    this.searchQuery = null;
    this.searchActive = false;

    this.realtimeHandlers = new Map();
    this.$emojiMenu = null;
    this.selectionMode = false;
    this.selectedMessages = new Set();
    this.selectionAction = null; // 'forward' | 'delete' | 'relink' | null
    this.$messageActionMenu = null;
    
    this.collapsedTopics = new Set();
    this.topicColorMap = new Map();
    this.lastRenderedTopicKey = null;
    this.allKnownTopicMetaMap = new Map();
    this.topicMetaMap = new Map();

    this.activeMessageTopic = null;
    this.activeMessageTopicSubject = null;
    this.activeMessageTopicColor = null;
    this.topicTimelineSegment = {
      activeTopicName: null,
      activeTopicSubject: null,
      activeTopicColor: null,
      realMessageCount: 0
    };
    this.$plusMenu = null;
    this.$topicSelectPopup = null;
    this.$allTopicsView = null;
    this._allTopicsState = {
      topics: [],
      offset: 0,
      limit: 20,
      totalCount: 0,
      hasMore: true,
      loading: false,
      query: ''
    };

    this.topicPalette = [
      "#7c3aed", // purple
      "#059669", // green
      "#dc2626", // red
      "#2563eb", // blue
      "#ea580c", // orange
      "#0891b2", // cyan
      "#be123c", // rose
      "#4f46e5", // indigo
      "#16a34a", // emerald
      "#9333ea"  // violet
    ];
    

    if (this.chat_topic_space) {
      if (opts.is_topic_window) {
        this.profile.room = this.chat_topic_channel || this.profile.room;
        this.profile.room_type = "Topic";
        this.profile.chat_topic = this.chat_topic_space;
        this.chat_topic = this.chat_topic_space;
      } else if (this.topic_write_mode && this.chat_topic_channel) {
        this.profile.room = this.chat_topic_channel;
        this.profile.room_type = opts.original_room_type || this.profile.room_type || "Group";
      } else {
        this.profile.room_type = "Topic";
      }
    }

    if (this.profile.room_type != "Topic") {
      if (this.profile.room_type == "Contributor") {
        frappe.ErpnextChat.settings.open_chat_space_rooms.push(
          this.profile.parent_channel
        );
      } else {
        frappe.ErpnextChat.settings.open_chat_space_rooms.push(
          this.profile.room
        );
      }
    }

    if (opts.topic_color && this.chat_topic_space) {
      this.topicColorMap.set(this.chat_topic_space, opts.topic_color);
      this.activeMessageTopicColor = opts.topic_color;
    }

    this.initial_message_to_scroll = opts.initial_message_to_scroll || opts.scroll_to_message || null;
    this.initial_message_scroll_done = false;

    this.messageCache = new Map();
    this.setup();
  }
  async fetchTopicColorFromDB(topicName) {
  if (!topicName) return null;

  try {
    const r = await frappe.call({
      method: "clefincode_chat.api.api_1_3_4.api.get_chat_topic_color",
      args: {
        chat_topic: topicName
      }
    });

    const color = r.message?.topic_color || null;

    if (color) {
      this.topicColorMap.set(topicName, color);
    }

    return color;
  } catch (e) {
    console.warn("Failed to fetch topic color", e);
    return null;
  }
}

async scrollToInitialMessageIfNeeded() {
  if (!this.initial_message_to_scroll || this.initial_message_scroll_done) return;
  this.initial_message_scroll_done = true;
  setTimeout(async () => {
    if (this.jumpToMessage) {
      await this.jumpToMessage(this.initial_message_to_scroll);
    }
  }, 250);
}

async getTopicColorFromSource(topicName, knownColor = null, opts = {}) {
  if (!topicName) return knownColor || null;

  const key = String(topicName);
  const forceRefresh = opts.forceRefresh === true;

  if (knownColor && !forceRefresh) {
    this.topicColorMap.set(key, knownColor);
    return knownColor;
  }


  if (!forceRefresh && this.topicColorMap.has(key)) {
    return this.topicColorMap.get(key);
  }

  const dbColor = await this.fetchTopicColorFromDB(key);

  if (dbColor) {
    this.topicColorMap.set(key, dbColor);
    return dbColor;
  }

  return knownColor || this.getTopicColor(key);
}

async refreshTopicColor(topicName) {
  if (!topicName) return null;

  const key = String(topicName);

  const color = await this.getTopicColorFromSource(key, null, {
    forceRefresh: true
  });

  if (!color) return null;

  this.topicColorMap.set(key, color);

  [this.topicMetaMap, this.allKnownTopicMetaMap].forEach((map) => {
    if (!map || !map.has(key)) return;

    const meta = map.get(key) || {};
    meta.color = color;
    meta.topic_color = color;
    map.set(key, meta);
  });

  const safe = CSS.escape(key);

  this.$chat_space
    .find(`[data-topic-name="${safe}"]`)
    .attr("data-topic-color", color)
    .css("--topic-color", color);

  this.$chat_space
    .find(`[data-topic-name="${safe}"] .message-topic-bar`)
    .css("background", color);

  this.$chat_space
    .find(`.set-topic[data-topic-name="${safe}"]`)
    .attr("data-topic-color", color)
    .css("--topic-color", color);

  this.$chat_space
    .find(`.topic-select-row[data-topic-name="${safe}"] .topic-dot`)
    .css("background", color);

  this.$chat_space
    .find(`.topic-select-main[data-topic-name="${safe}"]`)
    .attr("data-topic-color", color);

  if (this.activeMessageTopic === key) {
    this.activeMessageTopicColor = color;
    this.updatePlusTopicButton();
  }

  if (this.chat_topic_space === key || this.chat_topic === key) {
    this.activeMessageTopicColor = color;
    this.updateActiveTopicButton?.(key);
  }

  this.applyTopicHeaderBorderColor?.(key, color);

  if (this.$topicSelectPopup && this.$topicSelectPopup.length) {
    const query = this.$topicSelectPopup.find(".topic-select-search").val() || "";
    this.renderTopicSelectList(query);
  }

  return color;
}

getMessageTopicName(message = {}) {
  return message.chat_topic || message.topic || null;
}

getMessageTopicSubject(message = {}) {
  return (
    message.chat_topic_subject ||
    message.topic_subject ||
    message.chat_topic_title ||
    message.subject ||
    this.getMessageTopicName(message)
  );
}

getMessageTopicColor(message = {}) {
  const topicName = this.getMessageTopicName(message);
  if (!topicName) return null;
  return this.getTopicColor(
    topicName,
    message.topic_color || message.chat_topic_color || null
  );
}

isRealTopicTimelineMessage(message = {}) {
  if (!message) return false;
  if (Number(message.is_deleted || 0) === 1) return false;
  const messageType = String(message.message_type || "").toLowerCase();
  const templateType = String(message.message_template_type || "").toLowerCase();
  if (messageType === "information") return false;
  if (
    templateType === "set topic" ||
    templateType === "set-topic" ||
    templateType === "settopic" ||
    templateType === "remove topic" ||
    templateType === "remove-topic" ||
    templateType === "removetopic" ||
    templateType === "close topic" ||
    templateType === "close-topic" ||
    templateType === "closetopic"
  ) return false;
  return true;
}

makeTopicStartSeparatorHtml(topicName, topicSubject = null, topicColor = null) {
  if (!topicName) return "";
  if (this.isDedicatedTopicContext?.()) return "";
  const color = topicColor || this.getTopicColor(topicName);
  const safeTopicName = frappe.utils.escape_html(String(topicName));
  const displaySubject = this.formatTopicSeparatorSubject
    ? this.formatTopicSeparatorSubject(topicSubject, topicName)
    : String(topicSubject || topicName || __("Topic")).replace(/^topic\s*:\s*/i, "").trim();
  const safeSubject = frappe.utils.escape_html(displaySubject || topicName || __("Topic"));
  const safeColor = frappe.utils.escape_html(color || "");
  return `
    <div
      class="chat-topic-separator topic-start-separator"
      data-topic-name="${safeTopicName}"
      data-topic-subject="${safeSubject}"
      data-topic-color="${safeColor}"
      style="--topic-color:${safeColor};"
    >
      <span class="topic-separator-title">${safeSubject}</span>

      <button
        type="button"
        class="topic-open-window-btn topic-separator-open-btn"
        data-topic-name="${safeTopicName}"
        data-topic-subject="${safeSubject}"
        data-topic-color="${safeColor}"
        title="${__("Open topic in new window")}"
        aria-label="${__("Open topic in new window")}"
      >
        ↗
      </button>
    </div>
  `;
}

dedupeAdjacentTopicSeparators() {
  if (!this.$chat_space_container || !this.$chat_space_container.length) return;
  this.$chat_space_container.find(".topic-start-separator").each((_, el) => {
    const $current = $(el);
    const $prev = $current.prev(".topic-start-separator");
    if (!$prev.length) return;
    if ($prev.attr("data-topic-name") === $current.attr("data-topic-name")) {
      $current.remove();
    }
  });
}

  makeTopicSystemSeparatorHtml({
    messageName = "",
    topicName = "",
    topicSubject = null,
    topicColor = null,
    templateType = "Set Topic",
    sendDate = null,
    action = "set"
  } = {}) {
    if (!topicName) return "";
    if (this.isDedicatedTopicContext?.()) return "";

    const html = this.makeTopicStartSeparatorHtml(
      topicName,
      topicSubject || topicName,
      topicColor
    );

    if (!html) return "";

    const $separator = $(html);

    $separator
      .addClass("topic-system-separator")
      .attr("data-message-name", messageName || "")
      .attr("data-message-type", "topic-separator")
      .attr("data-message-template-type", templateType || "")
      .attr("data-send-date", sendDate || "");

    if (messageName) {
      $separator.attr("id", `msg-${messageName}`);
    }

    if (action === "remove") {
      const label = topicSubject || topicName;
      $separator.find(".topic-separator-title").text(
        label ? `${__("Topic removed")}: ${label}` : __("Topic removed")
      );
    }

    return $separator.prop("outerHTML");
  }

  getCurrentChatChannel() {
  return this.profile.room_type === "Contributor"
    ? this.profile.parent_channel
    : this.profile.room;
}

async fetchMessagesForCurrentContext(offset = this.messages_offset, limit = this.messages_limit) {
  if (this.is_topic_window) {
    if (!this.chat_topic_space) {
      console.warn("Topic window missing chat_topic_space");
      return { results: [] };
    }

    return await get_messages(
      "",
      this.profile.user_email,
      "Topic",
      this.chat_topic_space,
      this.profile.remove_date,
      limit,
      offset
    );
  }

  if (this.profile.room_type === "Topic" && this.chat_topic_space) {
    return await get_messages(
      "",
      this.profile.user_email,
      "Topic",
      this.chat_topic_space,
      this.profile.remove_date,
      limit,
      offset
    );
  }

  if (this.profile.room_type === "Contributor") {
    return await get_messages(
      this.all_sub_channels_for_contributor,
      this.profile.user_email,
      this.profile.room_type,
      null,
      null,
      limit,
      offset
    );
  }

  if (this.topic_write_mode && this.chat_topic_space) {
    return await get_messages(
      "",
      this.profile.user_email,
      "Topic",
      this.chat_topic_space,
      this.profile.remove_date,
      limit,
      offset
    );
  }

  return await get_messages(
    this.profile.room,
    this.profile.user_email,
    this.profile.room_type,
    null,
    this.profile.remove_date,
    limit,
    offset
  );
}

async openTopicChatWindow(topicName, topicSubject = null, opts = {}) {
  if (!topicName) return;

  const topicKey = String(topicName);

  let ctx = {};
  try {
    const r = await frappe.call({
      method: "clefincode_chat.api.api_1_3_4.api.get_topic_open_context",
      args: { chat_topic: topicKey }
    });
    ctx = r.message || {};
  } catch (err) {
    console.error("[ChatSpace] Failed to get topic context", err);
  }

  const chatChannel = ctx.chat_channel;

  if (!chatChannel) {
    frappe.msgprint({
      title: __("Error"),
      message: __("No chat channel found for this topic."),
      indicator: "red"
    });
    return;
  }

  const canWrite = Boolean(ctx.can_write) && String(ctx.topic_status || "").toLowerCase() !== "closed";

  const safeTopicSubject = this.normalizeTopicSubject
    ? this.normalizeTopicSubject(ctx.chat_topic_subject || topicSubject || topicKey, topicKey)
    : String(ctx.chat_topic_subject || topicSubject || topicKey);

  const topicColor =
    opts.topic_color ||
    this.topicColorMap?.get(topicKey) ||
    null;

  if (check_if_chat_window_open(topicKey, "topic")) {
    $(`.expand-chat-window[data-id|='${topicKey}']`).click();
    return;
  }

  const chat_window = new ChatWindow({
    profile: {
      topic: topicKey
    }
  });

  new ChatSpace({
    $wrapper: chat_window.$chat_window,
    profile: {
      ...this.profile,
      room: chatChannel,
      room_type: "Topic",
      room_name: safeTopicSubject,
      chat_topic: topicKey,
      chat_topic_subject: safeTopicSubject,
      is_admin: this.profile.is_admin,
      user: this.profile.user,
      user_email: this.profile.user_email,
      time_zone: this.profile.time_zone,
      remove_date: this.profile.remove_date,
      platform: ctx.platform || this.profile.platform
    },
    chat_topic: topicKey,
    chat_topic_channel: chatChannel,
    chat_topic_subject: safeTopicSubject,
    alternative_subject: safeTopicSubject,
    topic_color: topicColor,
    is_private_topic: ctx.is_private_topic || 0,

    topic_write_mode: canWrite,

    is_topic_window: true,

    topic_read_only: String(ctx.topic_status || "").toLowerCase() === "closed" || !canWrite,
    topic_can_reopen: Boolean(ctx.can_reopen),
    chat_status: ctx.chat_status,
    chat_topic_status: ctx.topic_status,
    original_room_type: ctx.room_type || this.profile.room_type
  });
}
toggleTopicMessages(topicName) {
  if (!topicName) return;

  const key = String(topicName);
  const isCollapsed = this.collapsedTopics.has(key);

  if (isCollapsed) {
    this.expandTopicMessages(key);
  } else {
    this.collapseTopicMessages(key);
  }
}

collapseTopicMessages(topicName) {
  const key = String(topicName);
  this.collapsedTopics.add(key);
  this.applyTopicVisibility();

  this.$chat_space_container
    .find(`.chat-topic-separator[data-topic-name="${this.escapeSelectorValue(key)}"]`)
    .addClass("is-collapsed")
    .find(".topic-caret")
    .text("▸");
}

expandTopicMessages(topicName) {
  const key = String(topicName);
  this.collapsedTopics.delete(key);
  this.applyTopicVisibility();

  this.$chat_space_container
    .find(`.chat-topic-separator[data-topic-name="${this.escapeSelectorValue(key)}"]`)
    .removeClass("is-collapsed")
    .find(".topic-caret")
    .text("▾");
}

applyCollapsedTopicsState() {
  if (!this.collapsedTopics || !this.collapsedTopics.size) return;
  if (!this.$chat_space_container || !this.$chat_space_container.length) return;

  this.collapsedTopics.forEach((topicName) => {
    this.$chat_space_container
      .find(`.topic-message-item[data-topic-name="${this.escapeSelectorValue(topicName)}"]`)
      .hide();

    this.$chat_space_container
      .find(`.chat-topic-separator[data-topic-name="${this.escapeSelectorValue(topicName)}"]`)
      .addClass("is-collapsed")
      .find(".topic-caret")
      .text("▸");
  });
}

updateTopicMessageCounts() {
  this.$chat_space_container.find(".chat-topic-separator").each((_, el) => {
    const $sep = $(el);
    const topicName = $sep.attr("data-topic-name");

    if (!topicName) return;

    const count = this.$chat_space_container
      .find(`.topic-message-item[data-topic-name="${this.escapeSelectorValue(topicName)}"]`)
      .length;

    $sep.find(".topic-count").text(count ? `(${count})` : "");
  });
}

escapeSelectorValue(value) {
  if (window.CSS && CSS.escape) {
    return CSS.escape(String(value));
  }

  return String(value).replace(/"/g, '\\"');
}
async relinkMessagesToTopic(topicName, messageNames = []) {
  const chatChannel = this.getCurrentChatChannel();

  if (!chatChannel) {
    frappe.msgprint({
      title: __("Error"),
      message: __("No chat channel found."),
      indicator: "red"
    });
    return;
  }

  if (!topicName || !messageNames.length) {
    frappe.msgprint({
      title: __("Error"),
      message: __("Missing topic or messages."),
      indicator: "red"
    });
    return;
  }

  await frappe.call({
    method: "clefincode_chat.api.api_1_3_4.api.relink_messages_to_topic",
    args: {
      chat_channel: chatChannel,
      topic_name: topicName,
      message_names: JSON.stringify(messageNames)
    }
  });

  frappe.show_alert({
    message: __("Messages relinked successfully"),
    indicator: "green"
  });

  this.exitSelectionMode();
}
formatTopicCreatedAt(topic = {}) {
  const rawDate =
    topic.creation ||
    topic.date ||
    topic.created_on ||
    topic.creation_date ||
    topic.created_date ||
    null;

  if (!rawDate) return "—";

  try {
    return (
      get_date_from_now(rawDate, "space", this.profile.time_zone) +
      " " +
      get_time(rawDate, this.profile.time_zone)
    );
  } catch (e) {
    return String(rawDate);
  }
}
async openRelinkTopicsDialog(messageNames = []) {
  const chatChannel = this.getCurrentChatChannel();

  if (!chatChannel) {
    frappe.msgprint({
      title: __("Error"),
      message: __("No chat channel found."),
      indicator: "red"
    });
    return;
  }

  const d = new frappe.ui.Dialog({
    title: __("ReLink Topic"),
    size: "large",
    fields: [
      {
        fieldtype: "HTML",
        fieldname: "topics_html"
      }
    ],
    primary_action_label: __("Close"),
    primary_action() {
      d.hide();
    }
  });
  this.exitSelectionMode();
  this.closeMessageActionMenu();
  this.closeEmojiMenu();
  this.hideAllReactButtons();
  d.show();

  const renderTopics = async () => {
    d.fields_dict.topics_html.$wrapper.html(`
      <div style="padding:16px; text-align:center; opacity:.7;">
        ${__("Loading topics...")}
      </div>
    `);

    try {
      const r = await frappe.call({
        method: "clefincode_chat.api.api_1_3_4.api.get_channel_topics",
        args: {
          chat_channel: chatChannel,
          topic_status: "All"
        }
      });

      const topics = r.message?.topics || [];
      const rows = topics.length
  ? topics.map((topic) => {
      const refs = topic.references || [];

      const topicName = topic.name || topic.chat_topic || "";
      const subject =
        (topic.subject || topic.chat_topic_subject || "").trim();

      const displayTitle = subject || topicName;
      const safeDisplayTitle = frappe.utils.escape_html(displayTitle || "");
      const safeTopicName = frappe.utils.escape_html(topicName || "");

      const topicColor =
        topic.topic_color ||
        topic.color ||
        this.topicColorMap.get(topicName) ||
        this.getTopicColor(topicName);

      if (topicName && topicColor) {
        this.topicColorMap.set(topicName, topicColor);
      }

      const createdAt = this.formatTopicCreatedAt(topic);

      const topicNameHtml =
        subject && topicName && subject !== topicName
          ? `<div style="font-size:12px; opacity:.65; margin-top:2px; word-break:break-all;">
               ${safeTopicName}
             </div>`
          : "";

      const refsHtml = refs.length
        ? refs.map(ref => `
            <div style="font-size:12px; opacity:.75; margin-top:2px;">
              ${frappe.utils.escape_html(ref.doctype || "")} / ${frappe.utils.escape_html(ref.docname || "")}
            </div>
          `).join("")
        : `<div style="font-size:12px; opacity:.6; margin-top:2px;">${__("No references")}</div>`;

      const colorDotHtml = topicColor
        ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${frappe.utils.escape_html(topicColor)};margin-right:6px;"></span>`
        : "";

      return `
        <div class="relink-topic-row" style="
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap:12px;
          padding:12px 0;
          border-bottom:1px solid #eee;
        ">
          <div style="min-width:0; flex:1;">
            <div style="font-weight:600;">
              ${colorDotHtml}${safeDisplayTitle}
            </div>
            ${topicNameHtml}

            <div style="font-size:12px; opacity:.7; margin-top:2px;">
              ${__("Status")}: ${frappe.utils.escape_html(topic.topic_status || "Open")}
              ${topic.is_private ? " • " + __("Private") : ""}
            </div>

            <div style="font-size:12px; opacity:.7; margin-top:2px;">
              ${__("Created At")}: ${frappe.utils.escape_html(createdAt)}
            </div>

            <div style="margin-top:6px;">
              <div style="font-size:12px; opacity:.65; margin-bottom:2px;">
                ${__("References")}:
              </div>
              ${refsHtml}
            </div>
          </div>

          <button
            type="button"
            class="btn btn-sm btn-primary pick-relink-topic"
            data-topic-name="${safeTopicName}"
            data-topic-subject="${safeDisplayTitle}"
            data-topic-color="${frappe.utils.escape_html(topicColor || "")}">
            ${__("Select")}
          </button>
        </div>
      `;
    }).join("") 
        : `
          <div style="padding:16px; text-align:center; opacity:.7;">
            ${__("No topics found for this channel.")}
          </div>
        `;

      d.fields_dict.topics_html.$wrapper.html(`
        <div class="relink-topic-dialog">
          <div style="display:flex; justify-content:flex-end; margin-bottom:12px;">
            <button type="button" class="btn btn-sm btn-secondary add-new-topic-btn">
              ${__("Add New Topic")}
            </button>
          </div>
          <div class="relink-topic-list">
            ${rows}
          </div>
        </div>
      `);

    } catch (e) {
      console.error("Failed to load channel topics", e);
      d.fields_dict.topics_html.$wrapper.html(`
        <div style="padding:16px; text-align:center; color:#d9534f;">
          ${__("Failed to load topics.")}
        </div>
      `);
    }
  };

  await renderTopics();

  d.$wrapper.off("click", ".add-new-topic-btn").on("click", ".add-new-topic-btn", async (e) => {
    e.stopPropagation();
    await this.promptCreateNewTopic({
      chatChannel,
      messageNames,
      parentDialog: d,
      afterCreate: async () => {
        await renderTopics();
      }
    });
  });

  d.$wrapper.off("click", ".pick-relink-topic").on("click", ".pick-relink-topic", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const $btn = $(e.currentTarget);
    const topicName = $btn.attr("data-topic-name");
    const topicSubject = $btn.attr("data-topic-subject") || topicName;
    const topicColor =
      $btn.attr("data-topic-color") ||
      this.topicColorMap.get(topicName) ||
      this.getTopicColor(topicName);

    if (!topicName) return;

    await frappe.call({
      method: "clefincode_chat.api.api_1_3_4.api.relink_messages_to_topic",
      args: {
        topic_name: topicName,
        message_names: JSON.stringify(messageNames)
      }
    });

    if (topicColor) {
      this.topicColorMap.set(topicName, topicColor);
    }

    this.applyRelinkedTopicToMessages(
      messageNames,
      topicName,
      topicSubject,
      topicColor
    );

    this.normalizeTopicSeparators?.();

    frappe.show_alert({
      message: __("Selected topic: {0}", [topicSubject || topicName]),
      indicator: "green"
    });

    d.hide();
    this.exitSelectionMode();
  });
}
async openCreateTopicFromPlusDialog() {
  const chatChannel = this.getCurrentChatChannel();

  if (!chatChannel) {
    frappe.msgprint({
      title: __("Error"),
      message: __("No chat channel found."),
      indicator: "red"
    });
    return;
  }

  await this.promptCreateNewTopic({
    chatChannel,
    messageNames: [],
    afterCreate: async (createdTopic) => {
      if (!createdTopic) return;

      const topicName = createdTopic.name || createdTopic.chat_topic || createdTopic.topicName;
      const topicSubject =
        createdTopic.subject ||
        createdTopic.chat_topic_subject ||
        createdTopic.topicSubject ||
        topicName;
      const topicColor =
        createdTopic.topic_color ||
        createdTopic.color ||
        null;

      if (topicName) {
        if (!this.allKnownTopicMetaMap) {
          this.allKnownTopicMetaMap = new Map();
        }

        const color = this.getTopicColor(topicName, topicColor);

        this.allKnownTopicMetaMap.set(topicName, {
          name: topicName,
          subject: topicSubject,
          color,
          topic_color: color,
          count: 0,
          latestIndex: -1,
          latestDate: ""
        });

        this.selectMessageTopic(topicName, topicSubject, { scroll: false, color, topic_color: color });
        await this.saveUserActiveChatTopic(topicName);
        setTimeout(() => {
          this.updatePlusTopicButton();
        }, 50);

        frappe.show_alert({
          message: __("Topic selected for new messages"),
          indicator: "green"
        });

        await this.loadChannelTopicsForSelect?.();
      }
    }
  });
}

async promptCreateNewTopic({ chatChannel, messageNames = [], afterCreate, parentDialog = null }) {
  const createDialog = new frappe.ui.Dialog({
    title: __("Add New Topic"),
    fields: [
      {
        label: __("Subject"),
        fieldname: "subject",
        fieldtype: "Data"
      },
      {
        label: __("DocType"),
        fieldname: "reference_doctype",
        fieldtype: "Link",
        options: "DocType"
      },
      {
        label: __("Document"),
        fieldname: "reference_docname",
        fieldtype: "Dynamic Link",
        options: "reference_doctype"
      }
    ],
    primary_action_label: __("Create"),
    primary_action: async (values) => {
      try {
        const subject = (values.subject || "").trim();
        const referenceDoctype = (values.reference_doctype || "").trim();
        const referenceDocname = (values.reference_docname || "").trim();

        const hasSubject = Boolean(subject);
        const hasFullReference = Boolean(referenceDoctype && referenceDocname);

        if (!hasSubject && !hasFullReference) {
          frappe.msgprint({
            title: __("Missing values"),
            message: __("Please enter a Subject or select both DocType and Document."),
            indicator: "orange"
          });
          return;
        }

        if ((referenceDoctype && !referenceDocname) || (!referenceDoctype && referenceDocname)) {
          frappe.msgprint({
            title: __("Missing values"),
            message: __("Please select both DocType and Document, or leave both empty."),
            indicator: "orange"
          });
          return;
        }

        const finalSubject = hasSubject
          ? subject
          : `${referenceDoctype}:${referenceDocname}`;

        const mention_doctypes = hasFullReference
          ? JSON.stringify([{ doctype: referenceDoctype, docname: referenceDocname }])
          : JSON.stringify([]);

        const r = await frappe.call({
          method: "clefincode_chat.api.api_1_3_4.api.create_chat_topic",
          args: {
            mention_doctypes,
            chat_channel: chatChannel,
            last_active_sub_channel:
              this.profile.room_type === "Contributor"
                ? this.profile.room
                : null,
            subject: finalSubject
          }
        });

        const created = r.message?.results?.[0] || {};
        const topicName = created.chat_topic || created.name;

        if (!topicName) {
          throw new Error("Topic name missing after creation");
        }

        const topicSubject =
          created.chat_topic_subject ||
          created.subject ||
          finalSubject;

        if (messageNames && messageNames.length) {
          await this.relinkMessagesToTopic(topicName, messageNames);
        }

        this.closeMessageActionMenu();
        this.closeEmojiMenu();
        this.hideAllReactButtons();

        createDialog.hide();
        if (parentDialog) {
          parentDialog.hide();
        }

        const topicColor =
            created.topic_color ||
            created.chat_topic_color ||
            created.color ||
            null;

        const createdTopic = {
          name: topicName,
          chat_topic: topicName,
          subject: topicSubject,
          chat_topic_subject: topicSubject,
          topic_color: topicColor,
          color: topicColor,
          reference_doctype: referenceDoctype || null,
          reference_docname: referenceDocname || null
        };

        if (typeof afterCreate === "function") {
          await afterCreate(createdTopic);
        }
      } catch (e) {
        console.error("Failed to create topic", e);
        frappe.msgprint({
          title: __("Error"),
          message: __("Failed to create topic"),
          indicator: "red"
        });
      }
    }
  });

  createDialog.show();
}
 parseReactionsFromReactionsJson(reactions_json) {
  try {
    if (!reactions_json) return { reactions: [], emoji_counts: {} };

    const parsed = JSON.parse(reactions_json);

    const root = Array.isArray(parsed) ? (parsed[0] || {}) : parsed;

    const reactions = root.reactions || [];
    const emoji_counts = (root.emoji_summary && root.emoji_summary.emoji_details) ? root.emoji_summary.emoji_details : {};

    return { reactions, emoji_counts };
  } catch (e) {
    return { reactions: [], emoji_counts: {} };
  }
}

async getReactionsForDialog(messageName) {
  const cached = this.messageCache.get(messageName) || {};

  if (cached.reactions_payload) {
    const { reactions, emoji_counts } = this.normalizeReactionsPayload(cached.reactions_payload);
    return { reactions: reactions || [], emoji_counts: emoji_counts || {} };
  }

  if (cached.reactions_json) {
    return this.parseReactionsFromReactionsJson(cached.reactions_json);
  }

  const payload = await this.getReactions(messageName);
  cached.reactions_payload = payload;
  this.messageCache.set(messageName, cached);

  const { reactions, emoji_counts } = this.normalizeReactionsPayload(payload);
  return { reactions: reactions || [], emoji_counts: emoji_counts || {} };
}
renderReactionsFromJson(messageName, reactions_json) {
  const { reactions, emoji_counts } = this.parseReactionsFromReactionsJson(reactions_json);
  this.renderReactions(messageName, { data: { reactions, emoji_counts } });
}
async openReactionsDialog(messageName, initialEmoji = null) {
  const { reactions, emoji_counts } = await this.getReactionsForDialog(messageName);

  const items = (reactions || []).map(r => ({
    emoji: r.emoji,
    sender: r.emoji_sender || r.sender || "",
    send_date: r.send_date || ""
  }));

  if (!items.length) {
    frappe.msgprint("No reactions yet.");
    return;
  }

  const emojis = Object.keys(emoji_counts || {});
  const hasInitial = initialEmoji && emojis.includes(initialEmoji);

  let currentFilter = hasInitial ? initialEmoji : null; // null = All

  const renderEmoji = (emo) =>
    (window.emojione && emojione.toImage) ? emojione.toImage(emo) : emo;

  const uniqueEmails = [...new Set(items.map(x => x.sender).filter(Boolean))];
  const nameMap = {};
  await Promise.all(uniqueEmails.map(async (email) => {
    try {
      nameMap[email] = (email === this.profile.user_email)
        ? "You"
        : (await get_profile_full_name(email) || email);
    } catch {
      nameMap[email] = email;
    }
  }));

  const filtersHtml = `
    <div class="rx-filters" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
      <button type="button" class="rx-filter btn btn-sm ${currentFilter ? "btn-default" : "btn-primary"}" data-emoji="">
        All <b>${items.length}</b>
      </button>

      ${emojis.map(emo => `
        <button type="button" class="rx-filter btn btn-sm ${currentFilter === emo ? "btn-primary" : "btn-default"}" data-emoji="${frappe.utils.escape_html(String(emo))}">
          ${renderEmoji(emo)} <b>${emoji_counts[emo] ?? 0}</b>
        </button>
      `).join("")}
    </div>
  `;

  const d = new frappe.ui.Dialog({
    title: "Reactions",
    size: "small",
    fields: [
      {
        fieldtype: "HTML",
        fieldname: "rx_body",
        options: `
          ${filtersHtml}
          <div class="rx-list" style="max-height:360px; overflow:auto; padding-right:6px;"></div>
        `
      }
    ],
    primary_action_label: "Close",
    primary_action() { d.hide(); }
  });

  const renderList = () => {
    const filtered = currentFilter
      ? items.filter(x => x.emoji === currentFilter)
      : items;

    filtered.sort((a, b) => (b.send_date || "").localeCompare(a.send_date || ""));

    const rows = filtered.map(x => {
      const displayName = frappe.utils.escape_html(nameMap[x.sender] || x.sender || "");
      const when = frappe.utils.escape_html(x.send_date || "");
      return `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #eee;">
          <div style="width:28px; text-align:center; font-size:18px;">${renderEmoji(x.emoji)}</div>
          <div style="flex:1; min-width:0;">
            <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${displayName}</div>
            ${when ? `<div style="font-size:11px; opacity:.7;">${when}</div>` : ``}
          </div>
        </div>
      `;
    }).join("");

    d.$wrapper.find(".rx-list").html(rows || `<div style="opacity:.7;">No reactions</div>`);
  };

  d.show();
  renderList();

  d.$wrapper.on("click", ".rx-filter", (e) => {
    const emo = $(e.currentTarget).data("emoji");
    currentFilter = emo ? String(emo) : null;

    d.$wrapper.find(".rx-filter").removeClass("btn-primary").addClass("btn-default");
    $(e.currentTarget).removeClass("btn-default").addClass("btn-primary");

    renderList();
  });
}

  stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return (div.textContent || div.innerText || "").trim();
}
htmlToCopyText(html) {
  const $tmp = $("<div>").html(html || "");

  // preserve basic line breaks from Quill / HTML
  $tmp.find("br").replaceWith("\n");
  $tmp.find("p, div, li").each(function () {
    $(this).append("\n");
  });

  return ($tmp.text() || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

getCopyableMessageText(messageName) {
  const cached = this.messageCache.get(messageName) || {};

  if (
    Number(cached.is_deleted) === 1 ||
    cached.message_type === "information"
  ) {
    return "";
  }

  let html = cached.content || "";

  if (!html) {
    const $wrapper = this.$chat_space.find(`[data-message-name="${messageName}"]`);
    const $bubble = $wrapper.find(".message-bubble").clone();

    $bubble
      .find(`
        .message-menu-trigger,
        .react-hover-btn,
        .message-select-checkbox,
        .message-actions,
        .message-reactions,
        .edited-label,
        .forwarded-label,
        .reply-link,
        .chat-read-more-btn
      `)
      .remove();

    html = $bubble.html() || "";
  }

  return this.htmlToCopyText(html);
}

async copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "-9999px";

  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

async copyMessageContent(messageName) {
  const text = this.getCopyableMessageText(messageName);

  if (!text) {
    frappe.show_alert({
      message: __("No text to copy"),
      indicator: "orange"
    });
    return;
  }

  try {
    await this.copyTextToClipboard(text);

    frappe.show_alert({
      message: __("Message copied"),
      indicator: "green"
    });
  } catch (e) {
    console.error("Failed to copy message", e);

    frappe.show_alert({
      message: __("Failed to copy message"),
      indicator: "red"
    });
  }
}
formatMessageInfoDate(sendDate, fallbackTime = "") {
  if (!sendDate) return fallbackTime || "—";

  try {
    const day = get_date_from_now(sendDate, "space", this.profile.time_zone);
    const time = get_time(sendDate, this.profile.time_zone);
    return `${day} ${time}`;
  } catch (e) {
    return fallbackTime || sendDate || "—";
  }
}

getMessageKindLabel(cached = {}) {
  if (Number(cached.is_deleted) === 1) return __("Deleted message");
  if (cached.message_type === "information") return __("Information message");
  if (cached.is_voice_clip) return __("Voice message");
  if (cached.is_document) return __("Document");
  if (cached.is_media) return __("Media");
  if (cached.is_screenshot) return __("Screenshot");
  if (cached.is_link) return __("Link");
  return __("Text message");
}
async getLinkedTopicInfo(cached = {}) {
if (this.profile.room_type === "Topic" || this.is_topic_window) {
  const topicName =
    this.chat_topic_space ||
    this.chat_topic ||
    this.profile.chat_topic ||
    cached.chat_topic ||
    null;

  const topicSubject = this.normalizeTopicSubject
    ? this.normalizeTopicSubject(
        this.chat_topic_space_subject ||
          this.chat_topic_subject ||
          this.profile.chat_topic_subject ||
          this.alternative_subject ||
          cached.chat_topic_subject,
        topicName || ""
      )
    : String(
        this.chat_topic_space_subject ||
          this.chat_topic_subject ||
          this.profile.chat_topic_subject ||
          this.alternative_subject ||
          cached.chat_topic_subject ||
          topicName ||
          ""
      );

  let references =
    Array.isArray(this.reference_doctypes) && this.reference_doctypes.length
      ? this.reference_doctypes
      : Array.isArray(cached.reference_doctypes) && cached.reference_doctypes.length
        ? cached.reference_doctypes
        : Array.isArray(cached.references) && cached.references.length
          ? cached.references
          : [];

  let status = this.chat_topic_status || cached.chat_topic_status || null;

  if ((!references || !references.length) && topicName && this.fetchTopicDetails) {
    const details = await this.fetchTopicDetails(topicName);

    if (details) {
      references =
        details.reference_doctypes ||
        details.references ||
        [];

      status = details.status || status;

      return {
        name: topicName,
        subject: details.subject || topicSubject || topicName,
        status,
        references,
        topic_color: details.topic_color || this.topicColorMap?.get(topicName) || null
      };
    }
  }

  return {
    name: topicName,
    subject: topicSubject,
    status,
    references
  };
}

  const topicName =
    cached.chat_topic ||
    cached.topic ||
    cached.topic_name ||
    null;

  const topicSubject =
    cached.chat_topic_subject ||
    cached.topic_subject ||
    cached.chat_topic_title ||
    null;

  if (!topicName && !topicSubject) {
    return null;
  }

  if (topicName && this.fetchTopicDetails) {
    const details = await this.fetchTopicDetails(topicName);

    if (details) {
      return {
        name: topicName,
        subject: details.subject || topicSubject || topicName,
        status: details.status || null,
        is_private: details.is_private || 0,
        references:
          details.reference_doctypes ||
          details.references ||
          [],
        topic_color: details.topic_color || this.topicColorMap?.get(topicName) || null
      };
    }
  }

  if (topicSubject) {
    return {
      name: topicName,
      subject: topicSubject,
      references: [],
      topic_color: this.topicColorMap?.get(topicName) || null
    };
  }

  try {
    const chatChannel = this.getCurrentChatChannel();

    if (!chatChannel || !topicName) {
      return {
        name: topicName,
        subject: null
      };
    }

    const r = await frappe.call({
      method: "clefincode_chat.api.api_1_3_4.api.get_channel_topics",
      args: {
        chat_channel: chatChannel,
        topic_status: "All"
      }
    });

    const topics = r.message?.topics || [];
    const found = topics.find(t => t.name === topicName);

    return {
        name: topicName,
        subject: found?.subject || topicName,
        status: found?.topic_status || null,
        is_private: found?.is_private || 0,
        references: found?.references || found?.reference_doctypes || []
      };
  } catch (e) {
    console.warn("Failed to load linked topic info", e);

    return {
      name: topicName,
      subject: topicName
    };
  }
}

async openMessageInfoDialog(messageName) {
  let cached = this.messageCache.get(messageName) || {};

  if (!cached.send_date || !cached.sender_email) {
    try {
      const msg = await this.fetch_single_message(messageName);

      if (msg) {
        cached = {
          ...cached,
          ...msg,
          sender: msg.sender || cached.sender,
          sender_email: msg.sender_email || cached.sender_email,
          send_date: msg.send_date || cached.send_date,
          content: msg.content || cached.content,

          chat_topic: msg.chat_topic || msg.topic || cached.chat_topic || null,
          chat_topic_subject:
            msg.chat_topic_subject ||
            msg.topic_subject ||
            msg.chat_topic_title ||
            cached.chat_topic_subject ||
            null,

          reference_doctypes:
            msg.reference_doctypes ||
            msg.references ||
            cached.reference_doctypes ||
            cached.references ||
            [],

          references:
            msg.references ||
            msg.reference_doctypes ||
            cached.references ||
            cached.reference_doctypes ||
            [],

          is_deleted: msg.is_deleted || cached.is_deleted,
          message_type: msg.message_type || cached.message_type,
          is_forwarded: msg.is_forwarded || cached.is_forwarded,
          is_edited: msg.is_edited || cached.is_edited,
        };

        this.messageCache.set(messageName, cached);
      }
    } catch (e) {
      console.warn("Failed to fetch message info", e);
    }
  }

  const senderName = cached.sender || "—";
  const senderEmail = cached.sender_email || "—";
  const sentAt = this.formatMessageInfoDate(cached.send_date, cached.display_time);
  const messageType = this.getMessageKindLabel(cached);
  const linkedTopic = await this.getLinkedTopicInfo(cached);
  const linkedTopicReferences = linkedTopic?.references || [];

const linkedTopicReferencesHtml = linkedTopicReferences.length
  ? `
    <div style="margin-top:6px;">
      <div style="font-size:12px; opacity:.65; margin-bottom:2px;">
        ${__("References")}
      </div>

      ${linkedTopicReferences.map(ref => {
        const doctype = ref.doctype || ref.reference_doctype || "";
        const docname = ref.docname || ref.reference_docname || "";

        if (!doctype || !docname) return "";

        return `
          <a href="#"
             class="message-info-doctype-link"
             data-doctype="${frappe.utils.escape_html(doctype)}"
             data-docname="${frappe.utils.escape_html(docname)}"
             style="
               display:block;
               font-size:12px;
               color:#007bff;
               text-decoration:underline;
               word-break:break-word;
               margin-top:2px;
             ">
            ${frappe.utils.escape_html(doctype)} / ${frappe.utils.escape_html(docname)}
          </a>
        `;
      }).join("")}
    </div>
  `
  : "";
const linkedTopicName = linkedTopic?.name || "";
const linkedTopicSubject = linkedTopic?.subject || linkedTopicName || "—";
const linkedTopicColor =
  linkedTopic?.topic_color ||
  linkedTopic?.color ||
  this.topicColorMap?.get(linkedTopicName) ||
  "";

const safeLinkedTopicName = frappe.utils.escape_html(linkedTopicName);
const safeLinkedTopicSubject = frappe.utils.escape_html(linkedTopicSubject);
const safeLinkedTopicColor = frappe.utils.escape_html(linkedTopicColor || "");
const linkedTopicHtml = linkedTopic
  ? `
    <div>
      <div style="opacity:.65;">${__("Linked Topic")}</div>
      <a href="#"
         class="message-info-topic-link"
         data-topic-name="${safeLinkedTopicName}"
         data-topic-subject="${safeLinkedTopicSubject}"
         data-topic-color="${safeLinkedTopicColor}"
         style="
           font-weight:600;
           color:#007bff;
           text-decoration:underline;
           cursor:pointer;
           word-break:break-word;
           display:inline-block;
         ">
        ${safeLinkedTopicSubject}
      </a>
      ${
        linkedTopic.name && linkedTopic.subject && linkedTopic.name !== linkedTopic.subject
          ? `<div style="font-size:12px; opacity:.7; word-break:break-all;">
              ${frappe.utils.escape_html(linkedTopic.name)}
            </div>`
          : ``
      }
      ${
  linkedTopic.status
    ? `<div style="font-size:12px; opacity:.7;">
        ${__("Status")}: ${frappe.utils.escape_html(linkedTopic.status)}
        ${linkedTopic.is_private ? " • " + __("Private") : ""}
      </div>`
    : ``
}
${linkedTopicReferencesHtml}
    </div>
  `
  : `
    <div>
      <div style="opacity:.65;">${__("Linked Topic")}</div>
      <div style="font-weight:600; opacity:.75;">
        ${__("No linked topic")}
      </div>
    </div>
  `;

  const statusRows = [];

  if (Number(cached.is_forwarded) === 1) {
    statusRows.push(`<div><b>${__("Forwarded")}:</b> ${__("Yes")}</div>`);
  }

  if (Number(cached.is_edited) === 1) {
    statusRows.push(`<div><b>${__("Edited")}:</b> ${__("Yes")}</div>`);
  }

  if (Number(cached.is_deleted) === 1) {
    statusRows.push(`<div><b>${__("Deleted")}:</b> ${__("Yes")}</div>`);
  }

  if (cached.reply_preview_text || cached.reply_preview_type) {
    statusRows.push(`<div><b>${__("Reply")}:</b> ${__("This message is a reply")}</div>`);
  }

  if (cached.attachment || cached.file_id) {
    statusRows.push(`<div><b>${__("Attachment")}:</b> ${frappe.utils.escape_html(cached.attachment || cached.file_id || "")}</div>`);
  }

  const d = new frappe.ui.Dialog({
    title: __("Message Info"),
    size: "small",
    fields: [
      {
        fieldtype: "HTML",
        fieldname: "message_info_html",
        options: `
          <div class="message-info-dialog" style="font-size:13px; line-height:1.7;">
            <div style="display:flex; flex-direction:column; gap:8px;">
              <div>
                <div style="opacity:.65;">${__("Sender")}</div>
                <div style="font-weight:600;">
                  ${frappe.utils.escape_html(senderName)}
                </div>
              </div>
              ${linkedTopicHtml}
              <div>
                <div style="opacity:.65;">${__("Sent At")}</div>
                <div style="font-weight:600;">
                  ${frappe.utils.escape_html(sentAt)}
                </div>
              </div>

              <div>
                <div style="opacity:.65;">${__("Message Type")}</div>
                <div style="font-weight:600;">
                  ${frappe.utils.escape_html(messageType)}
                </div>
              </div>

              <div>
                <div style="opacity:.65;">${__("Message ID")}</div>
                <div style="font-family:monospace; font-size:12px; word-break:break-all;">
                  ${frappe.utils.escape_html(messageName || "—")}
                </div>
              </div>

              ${
                statusRows.length
                  ? `<hr style="margin:8px 0;" />
                     <div style="display:flex; flex-direction:column; gap:4px;">
                       ${statusRows.join("")}
                     </div>`
                  : ``
              }
            </div>
          </div>
        `
      }
    ],
    primary_action_label: __("Close"),
    primary_action() {
      d.hide();
    }
  });

  d.show();
  d.$wrapper.off("click", ".message-info-topic-link")
  .on("click", ".message-info-topic-link", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const $link = $(e.currentTarget);

    const topicName = $link.attr("data-topic-name");
    const topicSubject = $link.attr("data-topic-subject") || topicName;
    const topicColor = $link.attr("data-topic-color") || null;

    if (!topicName) return;

    d.hide();

    if (topicColor) {
      this.topicColorMap?.set(topicName, topicColor);
    }

    await this.openTopicChatWindow(topicName, topicSubject, {
      topic_color: topicColor
    });
  });
  d.$wrapper.off("click", ".message-info-doctype-link")
  .on("click", ".message-info-doctype-link", function(e) {
    e.preventDefault();
    e.stopPropagation();

    const doctype = $(this).attr("data-doctype");
    const docname = $(this).attr("data-docname");

    if (doctype && docname) {
      d.hide();

   

    const url = getFormUrl(doctype, docname);
    console.log("Dsdsdsds");

    window.open(url, "_blank", "noopener,noreferrer");
     
    }
  });
}
openEmojiMenu({ $bubble, messageName }) {
  this.closeEmojiMenu();

  const emojis = ['👍','❤️','😂','🤝','😢','🙏','😎'];

  const $menu = $(`
    <div class="emoji-menu" role="menu" aria-label="Emoji reactions"></div>
  `);

  emojis.forEach((emo) => {
    const rendered = (window.emojione && emojione.toImage)
      ? emojione.toImage(emo)
      : emo;

    $menu.append(`
      <button type="button" class="emoji-item" data-emoji="${emo}" aria-label="${emo}">
        ${rendered}
      </button>
    `);
  });

  $("body").append($menu);

  const rect = $bubble[0].getBoundingClientRect();
  requestAnimationFrame(() => {
        const w = $menu.outerWidth();
        const h = $menu.outerHeight();

        let left = rect.left + rect.width / 2 - w / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));

        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;

        let top;

        if (spaceAbove >= h + 8) {
        
          top = rect.top - h - 8;
        } else if (spaceBelow >= h + 8) {
        
          top = rect.bottom + 8;
        } else {
        
          top = Math.max(8, Math.min(rect.top - h / 2, window.innerHeight - h - 8));
        }

        $menu.css({ left: `${left}px`, top: `${top}px` });
      });


  

$menu.on("click", ".emoji-item", async (e) => {
  e.stopPropagation();
  const emoji = $(e.currentTarget).data("emoji");

  try {
    await this.saveReaction(messageName, emoji);
   // await this.fetchAndRenderReactions(messageName);
  } finally {
    this.closeEmojiMenu();
  }
});


  $(document).off("pointerdown.emojiMenu").on("pointerdown.emojiMenu", (e) => {
    if (!$(e.target).closest(".emoji-menu").length) this.closeEmojiMenu();
  });

  this.$emojiMenu = $menu;
}
closeEmojiMenu() {
  if (this.$emojiMenu && this.$emojiMenu.length) {
    this.$emojiMenu.remove();
  }
  this.$emojiMenu = null;
  $(document).off("pointerdown.emojiMenu");
}
applyReaction(messageName, emoji) {
  const $msg = this.$chat_space.find(`#msg-${messageName}`);
  if (!$msg.length) return;

  let $reactions = $msg.find(".message-reactions");
  if (!$reactions.length) {
    $reactions = $(`<div class="message-reactions"></div>`);
    $msg.append($reactions);
  }

  const rendered = (window.emojione && emojione.toImage)
    ? emojione.toImage(emoji)
    : emoji;

  $reactions.html(rendered);


}

async performSearch(query) {
  this.searchQuery = query;
  this.searchActive = true;

  const chatChannel = this.profile.room_type === "Contributor"
    ? this.profile.parent_channel
    : this.profile.room;

  const isContributor = this.profile.room_type === "Contributor";

  const searchArgs = {
    channel: chatChannel,
    query: query,
  };

  if (isContributor) {
    searchArgs.sub_channel = this.profile.room;
  }

  if (this.profile.room_type === "Topic" || this.is_topic_window) {
    searchArgs.chat_topic = this.profile.chat_topic || this.chat_topic_space || this.chat_topic || null;
  }

  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_4.api.search_in_message_contents",
    args: searchArgs
  });
   
  
 let search_res=res.message.results[0];

  this.searchResults = search_res.results || [];
  this.currentSearchIndex = -1;

  const count = search_res.count || 0;

  this.$chat_space.find(".search-count")
    .text(count ? `0 / ${count}` : "0 results");

  if (count > 0) {
    this.goToNextResult();
  }
}
async goToNextResult() {
  if (!this.searchResults.length) return;

  this.currentSearchIndex++;

  if (this.currentSearchIndex >= this.searchResults.length) {
    this.currentSearchIndex = 0;
  }

  await this.navigateToSearchResult();
}
async goToPreviousResult() {
  if (!this.searchResults.length) return;

  this.currentSearchIndex--;

  if (this.currentSearchIndex < 0) {
    this.currentSearchIndex = this.searchResults.length - 1;
  }

  await this.navigateToSearchResult();
}

async navigateToSearchResult() {

  const result = this.searchResults[this.currentSearchIndex];
  if (!result) return;

  await this.jumpToMessage(result.name);

  this.$chat_space.find(".search-count")
    .text(`${this.currentSearchIndex + 1} / ${this.searchResults.length}`);
}



async resolvePendingReplies() {
  if (!this.pendingReplies || !this.pendingReplies.length) return;

  const items = this.pendingReplies.splice(0);

  for (const it of items) {
    this.makeReplySnippet(it.reply_message, 120)
      .then((snippet) => {
        const $box = this.$chat_space.find(
          `#msg-${it.host_message} .reply-link[data-jump="${it.reply_message}"]`
        );
        if (!$box.length) return;

        if (snippet) {
          $box.find(".reply-sender").text(snippet.sender || "");
          $box.find(".reply-text").text(snippet.text || "[Attachment]");
        } else {
          $box.find(".reply-sender").text("");
          $box.find(".reply-text").text("↩ Reply to message");
        }
      })
      .catch(() => {
        const $box = this.$chat_space.find(
          `#msg-${it.host_message} .reply-link[data-jump="${it.reply_message}"]`
        );
        if (!$box.length) return;
        $box.find(".reply-sender").text("");
        $box.find(".reply-text").text("↩ Reply to message");
      });
  }
}
async makeReplySnippet(replyMsgName, maxLen = 80) {

  let original = this.messageCache.get(replyMsgName);
  let text = '';

  
  if (!original) {
    const msg = await this.fetch_single_message(replyMsgName);
    if (!msg) return null;

    original = {
      sender: msg.sender,
      content: msg.content,
      is_deleted: msg.is_deleted || 0,

      chat_topic: msg.chat_topic || msg.topic || msg.topic_name || null,
      chat_topic_subject:
        msg.chat_topic_subject ||
        msg.topic_subject ||
        msg.chat_topic_title ||
        msg.subject ||
        null,
      topic_color: msg.topic_color || msg.chat_topic_color || null
    };

    
    this.messageCache.set(replyMsgName, original);
  }

if (original.is_deleted) {
    text = "This message was deleted";  
  } else {

    text = this.stripHtml(original.content);
    if (!text) text = "[Attachment]";
  }
  

  if (text.length > maxLen) text = text.slice(0, maxLen) + "…";

  return {
    sender: original.sender || "",
    text
  };
}
async jumpToMessage(messageName, maxTries = 50) {

  const limit = this.messages_limit || 10;
  let tries = 0;


  let $msg = this.$chat_space.find(`#msg-${messageName}`);
  if ($msg.length) {
    this.highlightAndScroll($msg);
    return;
  }

  
  while (tries < maxTries) {
    tries++;
    this.messages_offset += limit;

    const res = await this.fetchMessagesForCurrentContext(
      this.messages_offset,
      limit
    );

    
    if (!res.results || res.results.length === 0) {
      break;
    }

    
    await this.make_messages_html(res.results, 1);
    this.$chat_space_container.prepend(this.message_html);
    this.normalizeTopicSeparators();

    if (!this.chat_topic_space) {
      this.buildTopicMetaMap();
      this.applyTopicVisibility();
    }

    $msg = this.$chat_space.find(`#msg-${messageName}`);
    
 
    if ($msg.length) {
      this.highlightAndScroll($msg);
      return;
    }
  }

  frappe.msgprint("Original message not found.");
}
highlightAndScroll($msg) {
  if (!$msg || !$msg.length || !this.$chat_space_container?.length) return;

  const $container = this.$chat_space_container;
  const containerEl = $container[0];
  const targetEl = $msg[0];

  const containerRect = containerEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();

  const currentScrollTop = $container.scrollTop();
  const relativeTop = targetRect.top - containerRect.top;
  const targetScrollTop = currentScrollTop + relativeTop - 24;

  $container.stop(true).animate(
    { scrollTop: Math.max(0, targetScrollTop) },
    280
  );

  const $bubble = $msg.find(".message-bubble").first();
  if (!$bubble.length) return;

  const $longBody = $bubble.find(".message-text-body.long-message-body");
  if ($longBody.length) {
    $longBody
      .removeClass("long-message-body")
      .addClass("long-message-expanded");
    $bubble.find(".chat-read-more-btn").remove();
  }

  if (this.searchQuery) {
  const regex = new RegExp(`(${this.searchQuery})`, "gi");

  $bubble.contents().each(function () {
    if (this.nodeType === 3) { // 
      const replaced = this.nodeValue.replace(
        regex,
        '<span class="search-highlight">$1</span>'
      );
      if (replaced !== this.nodeValue) {
        $(this).replaceWith(replaced);
      }
    }
  });
}

 
  const observer = new IntersectionObserver(
    (entries, obs) => {
      const entry = entries[0];
      if (entry.isIntersecting) {
        // force restart animation
        $bubble.removeClass("reply-highlight");
        void $bubble[0].offsetWidth;
        $bubble.addClass("reply-highlight");

        obs.disconnect();
      }
    },
    {
      root: this.$chat_space_container[0],
      threshold: 0.6 
    }
  );

  observer.observe($msg[0]);
}
async saveReaction(messageName, emoji) {
  return frappe.call({
    method: "clefincode_chat.api.api_1_3_4.api.add_or_update_reaction",
    args: { message_name: messageName, emoji }
  });
}
async getReactions(messageName) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_4.api.get_reactions_for_message",
    args: { message_name: messageName }
  });

  return res.message || res;
}
renderReactions(messageName, payload) {
  const $msg = this.$chat_space.find(`#msg-${messageName}`);
  if (!$msg.length) return;

  const { reactions, emoji_counts } = this.normalizeReactionsPayload(payload);


  const emojis = Object.keys(emoji_counts || {});
  let $wrap = $msg.find(".message-reactions");

  if (!emojis.length) {
    if ($wrap.length) $wrap.remove();
    return;
  }

  const byEmojiSenders = {};
  (reactions || []).forEach((r) => {
    const e = r.emoji;
    const u = r.emoji_sender;
    if (!e) return;
    if (!byEmojiSenders[e]) byEmojiSenders[e] = [];
    if (u && !byEmojiSenders[e].includes(u)) byEmojiSenders[e].push(u);
  });

  if (!$wrap.length) {
    $wrap = $(`<div class="message-reactions"></div>`);
    $msg.find(".message-bubble").after($wrap);
  }

  const html = emojis.map((emo) => {
    const count = emoji_counts[emo] ?? 0;

    const rendered = (window.emojione && emojione.toImage)
      ? emojione.toImage(emo)
      : emo;

    const users = (byEmojiSenders[emo] || []).join("\n"); // tooltip
    const safeUsers = frappe.utils.escape_html(users);

    return `
      <span class="reaction-chip" data-emoji="${frappe.utils.escape_html(String(emo))}"
            title="${safeUsers}">
        ${rendered}<b class="reaction-count">${count}</b>
      </span>
    `;
  }).join("");

  $wrap.html(html);
}
normalizeReactionsPayload(payload) {
  
  const root = payload?.message?.data ? payload.message : payload; 
  const data = root?.data || payload?.data || null;

  return {
    reactions: data?.reactions || [],
    emoji_counts: data?.emoji_counts || {},
    users_list: data?.users_list || []
  };
}
async fetchAndRenderReactions(messageName) {
  try {
    const payload = await this.getReactions(messageName);
 
    const cached = this.messageCache.get(messageName) || {};
    cached.reactions_payload = payload;
    this.messageCache.set(messageName, cached);

    this.renderReactions(messageName, payload);
  } catch (e) {
    console.warn("Failed to load reactions", messageName, e);
  }
}
async hydrateReactionsForMessages(messages_list = []) {
  // const names = messages_list.map(m => m.message_name).filter(Boolean);
  // await Promise.all(names.map(n => this.fetchAndRenderReactions(n)));
   (messages_list || []).forEach(m => {
    if (!m?.message_name) return;
    if (m.reactions_json) {
      this.renderReactionsFromJson(m.message_name, m.reactions_json);
    }
  });

}
async fetch_single_message(messageName) {
  const args = {
    message_name: messageName,
    chat_channel: this.profile.chat_channel || this.profile.room,
    user_email: this.profile.user_email
  };

  if (this.profile.room_type === "Contributor") {
    args.sub_channel = this.profile.room;
  }

  if (this.profile.room_type === "Topic" || this.is_topic_window) {
    args.chat_topic =
      this.profile.chat_topic ||
      this.chat_topic_space ||
      this.chat_topic;
  }

  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_4.api.get_single_message",
    args
  });

  return res.message;
}
  async get_platform_icon() {
    const platform = this.profile.platform
    let platform_icon = "";
  
    if (platform === "WhatsApp" && this.profile.room_type === "Direct") {
      platform_icon = `<img title="${this.default_whatsapp_number}" src="/assets/clefincode_chat/icons/whatsapp.svg" style="margin-right:8px; margin-left:8px;">`;
    } else if (platform === "Instagram" && this.profile.room_type === "Direct") {
      platform_icon = `<img title="Instagram" src="/assets/clefincode_chat/icons/instagram.svg" style="margin-right:8px; width:20px; height:20px; margin-left:8px;">`;
    } else if (platform === "Messenger" && this.profile.room_type === "Direct") {
      platform_icon = `<img title="Messenger" src="/assets/clefincode_chat/icons/messenger.svg" style="margin-right:8px; width:20px; height:20px; margin-left:8px;">`;
    } else if (platform === "Chat" && this.profile.room_type === "Direct") {
      platform_icon = `<svg class="icon icon-lg" style="margin-right:8px; width:20px; height:20px; margin-left:8px;"><use href="#icon-small-message"></use></svg>`;
    } else if (platform === "Telegram" && this.profile.room_type === "Direct") {
      platform_icon = `<img title="Telegram" src="/assets/clefincode_chat/icons/telegram.svg" style="margin-right:6px; width:25px; margin-left:8px;">`;
    }
  
    return platform_icon;
  }
  async setup() {
    if (this.profile.room_type == "Direct") {
      this.$chat_space = $(document.createElement("div")).addClass(
        "chat-space delete-sender-name"
      );
    } else {
      this.$chat_space = $(document.createElement("div")).addClass(
        "chat-space"
      );
    }
    this.$chat_space.data("chat-space-instance", this);
    this.setup_chat_window();
    await this.setup_header();
    if (this.profile.user === "Guest") {
      this.setup_socketio();
    } else if (this.profile.room && this.new_group != 1) {
      await this.get_sub_channels_info();
    }
    this.get_chat_members();
    if (this.chat_topic_space && this.is_private_topic == 1) {
      const res = await check_if_user_has_permission(
        this.profile.user_email,
        this.chat_topic_space,
        this.chat_topic_channel
      );
      const res2 = await check_if_user_send_request(
        this.profile.user_email,
        this.chat_topic_space
      );

      if (res2) {
        this.$chat_space_container = $(document.createElement("div")).addClass(
          "chat-space-container chat-space-center"
        );
        this.$chat_space.append(this.$chat_space_container);
        this.$chat_space_container.append(
          `<div class="alert alert-secondary no-messages-info">Your request has been sent</div>`
        );
        this.render();
        return;
      }
      if (!res && !res2) {
        this.request_for_access_topic();
        return;
      }      
    }
    // Get topic info first so reference_doctypes is available when rendering messages
    if (this.chat_topic_space) {
      await this.get_topic_info();
    }
    this.profile.room || this.chat_topic_space
      ? await this.fetch_and_setup_messages()
      : this.create_empty_space();

    await this.scrollToInitialMessageIfNeeded();
  }

 setup_chat_window() {
  const screen_width = $("body").outerWidth() || 0;
  const right_width  = $(".chat_right_section").outerWidth() || 0;
  const left_width   = $(".chat_left_section").outerWidth() || 0;

  if (!screen_width) return;

  if (right_width + left_width > screen_width) {
  
    if (screen_width < 750) {
      const $closeChatList = $(".close-chat-list");
      if ($closeChatList.length) $closeChatList.trigger("click");
    }

    
    const $currentWin = this.$wrapper.closest(".chat-window");

    $(".chat-window").each(function () {
      const $win = $(this);
      if ($win.is($currentWin)) return;
      if ($win.css("display") === "none") return;

      const $collapse = $win.find(".collapse-chat-window");
      if ($collapse.length) $collapse.trigger("click");

      return false; // break
    });
  }
}

  async setup_header() {
    let header_title;
    let header_full_name;

    if (this.chat_topic_space) {
        this.avatar_html = "";

        const topicName =
          this.chat_topic_space ||
          this.chat_topic ||
          this.profile?.chat_topic ||
          "";

        const topicSubject =
          this.chat_topic_space_subject ||
          this.profile?.chat_topic_subject ||
          this.chat_topic_subject ||
          this.alternative_subject ||
          topicName;

        header_title = "#" + this.normalizeTopicSubject(topicSubject, topicName);
        header_full_name = header_title;
        header_title = header_title.length > 25 ? header_title.substring(0, 25) + "..." : header_title;
    } else {
        this.avatar_html = get_avatar_html(this.profile.room_name, this.profile.room_type);
        header_full_name = this.profile.room_name;
        header_title = this.profile.room_name.length > 20 ? this.profile.room_name.substring(0, 20) + "..." : this.profile.room_name;
    }

    let last_active = "";
    let user_datetime = "";

    if (this.profile.room_type === "Direct") {
        const last_active_value = await get_last_active(this.profile.contact, this.profile.user_email);
        if (last_active_value) {
            last_active =
                get_date_from_now(last_active_value, "space", this.profile.time_zone) +
                " " +
                get_time(last_active_value, this.profile.time_zone);
            const current_user_datetime = await get_time_now(this.profile.user_email);
            user_datetime =
                get_date_from_now(current_user_datetime, "space", this.profile.time_zone) +
                " " +
                get_time(current_user_datetime, this.profile.time_zone);
        }
    }
    

    const icon_html = await this.get_platform_icon();

    const header_html = `
        <div class='chat-header'>
            ${this.avatar_html}
            <div class='chat-profile-info'>
                <div class='chat-profile-name' title="${header_full_name}">${header_title}</div>
                <div class='chat-profile-status'>${last_active !== user_datetime ? last_active : ""}</div>
            </div>
            
            ${icon_html}
    

            ${
                this.profile.is_admin === true && this.profile.room_type !== "Topic"
                    ? `<span class='collapse-chat-window'>${frappe.utils.icon("collapse", "md")}</span>`
                    : ``
            }
            ${
                this.profile.is_admin === true
                    ? `<span class='close-chat-window'>${frappe.utils.icon("close", "lg")}</span>`
                    : ``
            }
        </div>
       
            <div class="chat-search">
        <div class="chat-search__bar">
          <span class="chat-search__icon">${frappe.utils.icon("search", "sm")}</span>

          <input type="text" class="chat-search-input chat-search__input"
            placeholder="Search in chat… (Enter)"
            autocomplete="off" />

          <button type="button" class="chat-search__clear" title="Clear" aria-label="Clear">✕</button>

          <span class="search-count chat-search__count">0</span>

          <div class="chat-search__nav">
            <button type="button" class="search-prev chat-search__btn" title="Previous (Shift+Enter)" aria-label="Previous">‹</button>
            <button type="button" class="search-next chat-search__btn" title="Next (Enter)" aria-label="Next">›</button>
          </div>

          <span class="chat-search__spinner" aria-hidden="true"></span>
        </div>

       
      </div>

    `;


    this.$chat_space.append(header_html);

    this.applyTopicHeaderBorderColor?.();
  
            const $search = this.$chat_space.find(".chat-search");
            $search.hide();
            // Hotkeys for chat search (Ctrl+Shift+F + "/" + try Ctrl+F)
              if (!window.__chatSearchHotkeysBound) {
                window.__chatSearchHotkeysBound = true;

                window.addEventListener(
                  "keydown",
                  (e) => {
                    const key = (e.key || "").toLowerCase();

                    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
                    const isCtrlF = isCtrlOrCmd && e.code === "KeyF";               
                    const isCtrlShiftF = isCtrlOrCmd && e.shiftKey && e.code === "KeyF"; // 
                  

                    const openSearch = () => {
                      const $chat = $(".chat-space:visible").last();
                      const $search = $chat.find(".chat-search");
                      if (!$search.length) return;

                      $search.stop(true, true).slideDown(150);
                      setTimeout(() => {
                        $chat.find(".chat-search-input").focus().select();
                      }, 0);
                    };

                    const closeSearch = () => {
                      const $chat = $(".chat-space:visible").last();
                      const $search = $chat.find(".chat-search");
                      if (!$search.length || !$search.is(":visible")) return;

                      $search.stop(true, true).slideUp(150);
                      $chat.find(".search-count").text("0");
                      $chat.find(".search-highlight").each(function () {
                        $(this).replaceWith($(this).text());
                      });
                    };

                    if (isCtrlShiftF ) {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                      openSearch();
                      return;
                    }

                    if (isCtrlF) {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                      openSearch();
                      return;
                    }

                  if (key === "escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          if (e.stopImmediatePropagation) e.stopImmediatePropagation();

                          const $visibleSearch = $(".chat-space:visible").last().find(".chat-search");

                          if ($visibleSearch.length && $visibleSearch.is(":visible")) {
                            closeSearch();
                          } else {
                            $(".chat-space:visible").last().find(".close-chat-window").trigger("click");
                          }
                        }
                  },
                  true
                );
              }


            this.$chat_space.find(".toggle-search").on("click", () => {
              $search.stop(true, true).slideToggle(150);

            
              if ($search.is(":visible")) {
                setTimeout(() => {
                  this.$chat_space.find(".chat-search-input").focus();
                }, 0);
              } else {
                
                this.searchActive = false;
                this.searchQuery = null;
              }
            });
            $(document).off("click.chatSearch").on("click.chatSearch", (e) => {
                const $t = $(e.target);
                const inside =
                  $t.closest(".chat-search").length ||
                  $t.closest(".toggle-search").length;

                if (!inside) $search.stop(true, true).slideUp(150);
              });
            this.$chat_space.find(".chat-search__clear").on("click", () => {
              this.$chat_space.find(".chat-search-input").val("");
              this.searchResults = [];
              this.currentSearchIndex = -1;
              this.$chat_space.find(".search-count").text("0");

              $search.stop(true, true).slideUp(150);
            });

          this.$chat_space.find(".chat-search-input").on("keyup", async (e) => {
        if (e.key === "Enter") {
          const value = $(e.target).val().trim();
          if (!value) return;

          await this.performSearch(value);
        }
      });

      this.$chat_space.find(".search-next").on("click", () => {
        this.goToNextResult();
      });

      this.$chat_space.find(".search-prev").on("click", () => {
        this.goToPreviousResult();
      });

    if (
        this.profile.room_type === "Direct" &&
        last_active &&
        user_datetime &&
        last_active === user_datetime
    ) {
        this.set_online();
    }
}


  async get_sub_channels_info() {
    await this.get_last_active_sub_channel();
    if (
      this.profile.room_type != "Contributor" &&
      !this.last_active_sub_channel
    ) {
      this.setup_socketio();
      return;
    }

    if (
      this.profile.room_type == "Contributor" &&
      this.last_active_sub_channel
    ) {
      this.contributors = await get_sub_channel_members(
        this.last_active_sub_channel,
        this.profile.user_email
      );
    } else {
      this.contributors = await get_contributors(this.profile.room);
    }
    this.$chat_space.removeClass("delete-sender-name");
    this.setup_socketio();
  }

  async fetch_and_setup_messages() {
    try {
      let res;
      // if(!this.profile.room || !this.chat_topic_space) return;

      if (this.new_group == 1) {
        this.$chat_space_container = $(document.createElement("div")).addClass(
          "chat-space-container"
        );
        this.$chat_space.append(this.$chat_space_container);

        const scroll_arrow = `
          <div class='arrow-button'>
          <button class='arrow'>
            <span data-icon="down" class="btn-ar">
              <svg viewBox="0 0 19 20" height="20" width="19" preserveAspectRatio="xMidYMid meet" class="" version="1.1" x="0px" y="0px"><path fill="currentColor" d="M3.8,6.7l5.7,5.7l5.7-5.7l1.6,1.6l-7.3,7.2L2.2,8.3L3.8,6.7z"></path></svg>
            </span>
          </button>
          </div>
      `;
        this.$chat_space_container.append(scroll_arrow);
        const content = `
      <div class="create-group" data-template = "create_group_template">
      <span class="sender-user" data-user="${this.profile.user_email}"></span><span> created this group </span>
      </div>
      `;

        const message_info = {
          content: content,
          user: this.profile.user,
          room: this.profile.room,
          email: this.profile.user_email,
          is_first_message: 1,
          message_type: "information",
          message_template_type: "Create Group",
        };
        send_message(message_info);

        await this.setup_actions();
        this.render();
        this.setup_socketio();
        return;
      }

      await this.get_all_sub_channels_for_contributor();
      res = await this.fetchMessagesForCurrentContext(
        this.messages_offset,
        this.messages_limit
      );
      await this.setup_messages(res.results || []);
      await this.setup_actions();
      await this.applySavedActiveTopic();
      this.render();
    } catch (error) {
      console.log(error);
    }
  }

  async create_empty_space() {
    try {
      this.$chat_space_container = $(document.createElement("div")).addClass(
        "chat-space-container chat-space-center"
      );
      this.$chat_space.append(this.$chat_space_container);
      const no_messages_info = `<div class="no-messages-info">No messages are available. Once you send message they will appear here.</div>`;
      this.$chat_space_container.append(no_messages_info);

      const scroll_arrow = `
    <div class='arrow-button'>
    <button class='arrow'>
      <span data-icon="down" class="btn-ar">
        <svg viewBox="0 0 19 20" height="20" width="19" preserveAspectRatio="xMidYMid meet" class="" version="1.1" x="0px" y="0px"><path fill="currentColor" d="M3.8,6.7l5.7,5.7l5.7-5.7l1.6,1.6l-7.3,7.2L2.2,8.3L3.8,6.7z"></path></svg>
      </span>
    </button>
    </div>`;

      this.$chat_space_container.append(scroll_arrow);
      await this.setup_actions();
      this.render();
      this.setup_socketio();
    } catch (error) {
      console.log(error);
    }
  }

  async request_for_access_topic() {
    try {
      this.$chat_space_container = $(document.createElement("div")).addClass(
        "chat-space-container request-access-container"
      );
      this.$chat_space.append(this.$chat_space_container);
      const no_messages_info = `<div class="no-messages-info">You are not authorized to access this conversation.</div><div class="btn btn-primary mt-3 topic-request-access">Request Access</div>`;
      this.$chat_space_container.append(no_messages_info);
      this.render();
      this.not_authorized_user = true;
    } catch (error) {
      console.log(error);
    }
  }

  async get_chat_members() {
    if (!this.profile.room) {
      this.chat_members = [];
    } else {
      if (this.profile.parent_channel) {
        this.chat_members = await get_chat_members(this.profile.parent_channel);
      } else {
        this.chat_members = await get_chat_members(this.profile.room);
      }
    }
  }

  async get_topic_info() {
    if (this.chat_topic_space && this.fetchTopicDetails) {
      const details = await this.fetchTopicDetails(this.chat_topic_space);

      if (details) {
        this.chat_topic = details.name;
        this.chat_topic_subject = details.subject;
        this.chat_topic_status = details.status;

        if (Array.isArray(details.references) && details.references.length) {
          this.reference_doctypes = details.references;
        }
      }

      return;
    }

    if (!this.profile.room) {
      return;
    }
    let topic_info = await get_topic_info(
      this.profile.room_type == "Contributor"
        ? this.profile.parent_channel
        : this.profile.room
    );
    this.chat_topic = topic_info[0].chat_topic;
    if (topic_info[0].topic_color) {
      this.topicColorMap.set(this.chat_topic, topic_info[0].topic_color);
      this.activeMessageTopicColor = topic_info[0].topic_color;
      this.applyTopicHeaderBorderColor?.(this.chat_topic, topic_info[0].topic_color);
    }
    this.updateActiveTopicButton(this.chat_topic);
    this.chat_topic_subject = topic_info[0].chat_topic_subject;
    this.chat_topic_status = topic_info[0].chat_topic_status;

    const refs =
      topic_info[0].reference_doctypes ||
      topic_info[0].references ||
      null;

    if (Array.isArray(refs) && refs.length) {
      this.reference_doctypes = refs;
    }

  }

  async fetchTopicDetails(topicName) {
    if (!topicName) return null;

    try {
      const r = await frappe.call({
        method: "clefincode_chat.api.api_1_3_4.api.get_chat_topic_details",
        args: {
          chat_topic: topicName
        }
      });

      const details = r.message || null;
      if (!details) return null;

      const refs =
        details.reference_doctypes ||
        details.references ||
        [];

      if (Array.isArray(refs) && refs.length) {
        this.reference_doctypes = refs;
      }

      const subject =
        details.chat_topic_subject ||
        details.subject ||
        topicName;

      this.chat_topic_subject = subject;
      this.chat_topic_space_subject = this.normalizeTopicSubject
        ? this.normalizeTopicSubject(subject, topicName)
        : String(subject || topicName);

      this.chat_topic_status = details.topic_status || this.chat_topic_status;

      if (details.topic_color) {
        this.topicColorMap?.set(topicName, details.topic_color);
        this.activeMessageTopicColor = details.topic_color;
        this.applyTopicHeaderBorderColor?.(topicName, details.topic_color);
      }

      return {
        name: details.chat_topic || details.name || topicName,
        subject,
        status: details.topic_status || null,
        is_private: details.is_private || 0,
        topic_color: details.topic_color || null,
        references: refs,
        reference_doctypes: refs
      };
    } catch (e) {
      console.warn("Failed to fetch topic details", e);
      return null;
    }
  }

  getRealtimeHandlerKey(channel) {
    const roomOrTopic =
      this.chat_topic_space ||
      this.chat_topic ||
      this.profile?.room ||
      this.profile?.parent_channel ||
      "unknown";

    return `${String(channel || "")}::${String(roomOrTopic)}::${Math.random().toString(36).slice(2)}`;
  }

  bindRealtimeChannel(channel, handler) {
    if (!channel || typeof handler !== "function") return;

    if (!this.realtimeHandlers) {
      this.realtimeHandlers = new Map();
    }

    this.unbindRealtimeChannel(channel);

    frappe.realtime.on(channel, handler);
    this.realtimeHandlers.set(channel, handler);
  }

  unbindRealtimeChannel(channel) {
    if (!channel || !this.realtimeHandlers) return;

    const handler = this.realtimeHandlers.get(channel);
    if (!handler) return;

    try {
      if (frappe.realtime.off.length >= 2) {
        frappe.realtime.off(channel, handler);
      }
    } catch (e) {
      console.warn("[ChatSpace] Failed to unbind realtime handler safely", channel, e);
    }

    this.realtimeHandlers.delete(channel);
  }

  unbindAllRealtimeChannels() {
    if (!this.realtimeHandlers) return;

    [...this.realtimeHandlers.keys()].forEach((channel) => {
      this.unbindRealtimeChannel(channel);
    });
  }

  setup_socketio() {
    const me = this;

    this.bindUserActiveTopicRealtime();

    const updateLastActiveHandler = function (res) {
      if (
        res.sender_email == me.profile.contact &&
        me.profile.room_type == "Direct"
      ) {
        me.set_online();
      }
    };

    this.bindRealtimeChannel("update_last_active", updateLastActiveHandler);

    if (!this.profile.room) return;

    const target_channel =
      me.profile.room_type === "Contributor" && me.last_active_sub_channel
        ? me.last_active_sub_channel
        : me.profile.room;

    this.set_channel_realtime(target_channel);
  }

  async setup_actions() {
    
    const isDedicatedTopic =
      this.isDedicatedTopicContext?.() ||
      this.is_topic_window ||
      this.profile?.room_type === "Topic" ||
      this.chat_topic_space;

    const topicStatus =
      this.chat_topic_status ||
      this.profile?.chat_topic_status ||
      this.profile?.topic_status ||
      "";

    const isClosedTopic =
      isDedicatedTopic &&
      String(topicStatus).toLowerCase() === "closed";

    if (isClosedTopic) {
      this.$chat_actions = $(document.createElement("div"))
        .addClass("chat-space-actions text-center readonly-topic-actions")
        .css({
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          marginBottom: "40px",
        });

      this.$chat_actions.append(`
        <div class="small text-muted">
          ${__("Read-only conversation")}
        </div>
      `);

      if (this.topic_can_reopen) {
        this.$chat_actions.append(`
          <div>
            <button type="button" class="btn btn-primary reopen-topic-btn">
              ${__("Reopen Topic")}
            </button>
          </div>
        `);
      }

      this.$chat_space.append(this.$chat_actions);
      this.setup_events();
      return;
    }

    const isReadonlyTopic =
      isDedicatedTopic &&
      (
        this.topic_read_only === true ||
        this.topic_write_mode === false
      );

    if (
      this.profile.room_type == "Contributor" &&
      this.last_active_sub_channel == ""
    ) {
      return;
    }

    if (isReadonlyTopic) {
      this.$chat_actions = $(document.createElement("div"))
        .addClass("chat-space-actions text-center readonly-topic-actions");

      this.$chat_actions.append(
        `<div class="small text-muted">${__("Read-only conversation")}</div>`
      );

      this.$chat_space.append(this.$chat_actions);
      this.setup_events();
      return;
    }

    if (this.profile.room_type == "Group" || this.chat_status == "Closed") {
      
      if (this.chat_status == "Closed") {
        this.$chat_actions = $(document.createElement("div"))
          .addClass("chat-space-actions text-center")
          .css({
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            marginBottom: "40px",
          });

        

        // Add Reopen button
        const $reopenBtn = $(
          `<button class="btn btn-primary">Reopen</button>`
        ).css({ marginRight: "10px" });

        // Add Create New button
        const $createNewBtn = $(
          `<button class="btn btn-secondary">Create New</button>`
        );

        
        // Append buttons inside a wrapper
        const $btnWrapper = $("<div>")
          .css({ display: "flex", justifyContent: "center", gap: "10px" })


        if (this.profile.is_removed != 1) {
          // Add info message
          this.$chat_actions.append(
            `<div style="margin-bottom: 10px;">This is a closed channel. To start chatting, create a new one or reopen this one.</div>`
          );
          $btnWrapper.append($reopenBtn);
          if (this.profile.room_type != "Group") {
            $btnWrapper.append($createNewBtn);
          }
          this.$chat_actions.append($btnWrapper);
          this.$chat_space.append(this.$chat_actions);

                  const room = this.profile.room;

        // Set up button events
        $reopenBtn.on("click", () => {
          frappe.call({
            method: "clefincode_chat.api.api_1_2_1.api.trigger_chat_channel_status",
            args: { room: room,
                    is_open: false
                  },
            callback: async (r) => {
              if (!r.exc) {
                // 1) Flip your local state so you’re no longer “removed / closed”
                this.profile.is_removed = 0;
                this.chat_status = 'Open';

                // 2) Remove the “closed” UI you injected
                this.$chat_actions.remove();
                this.$chat_space.find('.no-messages-info').remove();

                // 3) Reset any “previous message” memory so the date-line will render
                this.prevMessage = {};

                // 4) Reload the last N messages and scroll to bottom
                this.messages_offset = 0;
                this.messages_limit = 10;

                await this.fetch_and_setup_messages();
              }
            }
          });
        });

        $createNewBtn.on("click", () => {
          const contact = this.profile.contact;
          const contact_name = this.profile.room_name;
          const platform = this.profile.platform;
          this.open_chat_space(contact, contact_name, platform);
        });

        return;
      }
    }
        



      if (this.profile.is_removed == 1) {
        this.$chat_actions = $(document.createElement("div")).addClass(
          "chat-space-actions text-center"
        );
        this.$chat_actions.append(
          `You can't send messages to this group because you're no longer a participant.`
        );
        this.$chat_space.append(this.$chat_actions);
        this.setup_events();
        return;
      }
    }

    this.$chat_actions = $(document.createElement("div")).addClass(
      "chat-space-actions"
    );
    this.type_message_input = new TypeMessageInput({ chat_space: this });
    this.voice_clip = new VoiceClip({ chat_space: this });

    const isDedicatedTopicWindow = Boolean(this.chat_topic_space || this.is_topic_window);

    const topicMenuItems = isDedicatedTopicWindow
      ? ``
      : `
            <button type="button" class="chat-plus-topics">${frappe.utils.icon("tag", "sm")} ${__("Select Topic")}</button>
            <button type="button" class="chat-plus-add-topic">${frappe.utils.icon("small-add", "sm")} ${__("Add New Topic")}</button>
            <button type="button" class="chat-plus-remove-topic" style="${this.activeMessageTopic ? "" : "display:none;"}">${frappe.utils.icon("remove", "sm")} ${__("Unselect Topic")}</button>
          `;

    const plus_btn = `<span class="open-chat-plus-menu plus-btn">＋</span>`;

    const chat_actions_html = `
      <div class="message-section" style="position:relative;">
          ${this.profile.room_type != "Guest" ? plus_btn : ``}
          ${this.type_message_input.wrapper}
          <span class='message-send-button' style="display:none">
              <svg xmlns="http://www.w3.org/2000/svg" width="1.1rem" height="1.1rem" viewBox="0 0 24 24">
                  <path d="M24 0l-6 22-8.129-7.239 7.802-8.234-10.458 7.227-7.215-1.754 24-12zm-15 16.668v7.332h3.258-4.431-3.258-2.901z"/>
              </svg>
          </span>
          <div class="chat-plus-menu" style="display:none;">
            <button type="button" class="chat-plus-attach">${frappe.utils.icon("attachment", "sm")} ${__("Attach File")}</button>
            ${topicMenuItems}
          </div>
          <input type='file' id='chat-file-uploader' 
            accept='image/*, application/pdf, .doc, .docx'
            style='display: none;'>
      </div>
      <div class="voice-section">
      </div>
      `;
    this.$chat_actions.html(chat_actions_html);

    if (this.profile.room_type != "Guest") {
      this.$chat_actions
        .find(".message-section")
        .append(this.voice_clip.$voice_clip);
      this.$chat_actions
        .find(".voice-section")
        .append(this.voice_clip.$voice_message);
    }

    this.$chat_space.append(this.$chat_actions);

    if (this.chat_topic) {
      this.updateActiveTopicButton(this.chat_topic);
    }

    this.add_tag_section(this.contributors);
  }

enterSelectionMode(initialMessageName = null) {
  this.selectionMode = true;
  this.$chat_space.addClass("selection-mode");

  this.closeMessageActionMenu();
  this.closeEmojiMenu();
  this.hideAllReactButtons();

  if (initialMessageName) {
    const $msg = this.$chat_space.find(`[data-message-name="${initialMessageName}"]`);
    const cached = this.messageCache.get(initialMessageName) || {};
    const isRightMessage = $msg.hasClass("recipient-message");

    const blocked =
      Number(cached.is_deleted) === 1 ||
      cached.message_type === "information" ||
      (this.selectionAction === "delete" && !isRightMessage);

    if (!blocked) {
      this.selectedMessages.add(initialMessageName);
      $msg.addClass("is-selected");
      $msg.find('.message-select-checkbox input').prop("checked", true);
    }
  }

  this.$chat_space.find("[data-message-name]").each((_, el) => {
    const $msg = $(el);
    const name = $msg.data("message-name");
    const cached = this.messageCache.get(name) || {};
    const isRightMessage = $msg.hasClass("recipient-message");

    const shouldDisable =
      Number(cached.is_deleted) === 1 ||
      cached.message_type === "information" ||
      (this.selectionAction === "delete" && !isRightMessage);

    $msg.toggleClass("selection-disabled", shouldDisable);
    $msg.find(".message-select-checkbox input").prop("disabled", shouldDisable);
  });

  this.renderSelectionBar();
}

toggleMessageSelection(messageName) {
  if (!messageName) return;

  const cached = this.messageCache.get(messageName) || {};
  const $msg = this.$chat_space.find(`[data-message-name="${messageName}"]`);

  if (cached.message_type === "information" || Number(cached.is_deleted) === 1) {
    $msg.find('.message-select-checkbox input').prop("checked", false);
    return;
  }

  const isRightMessage = $msg.hasClass("recipient-message");

  if (this.selectionAction === "delete" && !isRightMessage) {
    $msg.find('.message-select-checkbox input').prop("checked", false);
    return;
  }

  if (this.selectedMessages.has(messageName)) {
    this.selectedMessages.delete(messageName);
    $msg.removeClass("is-selected");
    $msg.find('.message-select-checkbox input').prop("checked", false);
  } else {
    this.selectedMessages.add(messageName);
    $msg.addClass("is-selected");
    $msg.find('.message-select-checkbox input').prop("checked", true);
  }

  this.renderSelectionBar();
}
renderSelectionBar() {
  let $bar = this.$chat_space.find(".bulk-selection-bar");

  if (!this.selectionMode) {
    $bar.remove();
    return;
  }

  let actionButton = "";

  if (this.selectionAction === "forward") {
    actionButton = `
      <button type="button" class="btn btn-sm btn-primary confirm-forward-btn">
        Forward
      </button>
    `;
  } else if (this.selectionAction === "delete") {
    actionButton = `
      <button type="button" class="btn btn-sm btn-danger confirm-delete-btn">
        Delete
      </button>
    `;
  } else if (this.selectionAction === "relink" || this.selectionAction === null) {
    actionButton = `
      <button type="button" class="btn btn-sm btn-primary relink-topic-btn">
        ReLink Topic
      </button>
    `;
  }

  if (!$bar.length) {
    $bar = $(`
      <div class="bulk-selection-bar">
        <span class="selection-count">0 selected</span>
        <div class="bulk-selection-actions">
          ${actionButton}
          <button type="button" class="btn btn-sm btn-default cancel-selection-btn">
            Cancel
          </button>
        </div>
      </div>
    `);

    if (this.$chat_actions && this.$chat_actions.length) {
      this.$chat_actions.before($bar);
    } else {
      this.$chat_space.append($bar);
    }
  } else {
    $bar.find(".bulk-selection-actions").html(`
      ${actionButton}
      <button type="button" class="btn btn-sm btn-default cancel-selection-btn">
        Cancel
      </button>
    `);
  }

  $bar.find(".selection-count").text(`${this.selectedMessages.size} selected`);
}

exitSelectionMode() {
  this.selectionMode = false;
  this.selectionAction = null;
  this.selectedMessages.clear();
  this.$chat_space.removeClass("selection-mode");
  this.$chat_space.find("[data-message-name]").removeClass("is-selected selection-disabled");
  this.$chat_space.find('.message-select-checkbox input')
    .prop("checked", false)
    .prop("disabled", false);
  this.renderSelectionBar();
}
showReactButtonForMessage(messageName) {
  this.$chat_space.find("[data-message-name]").removeClass("show-react-btn");

  if (!messageName) return;

  this.$chat_space
    .find(`[data-message-name="${messageName}"]`)
    .addClass("show-react-btn");
}

hideAllReactButtons() {
  this.$chat_space.find("[data-message-name]").removeClass("show-react-btn");
}



closeMessageActionMenu() {
  if (this.$messageActionMenu && this.$messageActionMenu.length) {
    this.$messageActionMenu.remove();
  }

  this.$messageActionMenu = null;
  $(document).off("pointerdown.messageActionMenu");
}

startBulkSelection(action, initialMessageName) {
  this.selectionAction = action; // 'forward' | 'delete' | 'relink'
  this.enterSelectionMode(initialMessageName);
}

async handleBulkForward() {
  const selected = [...this.selectedMessages];
  if (!selected.length) {
    frappe.show_alert({
      message: __("No messages selected"),
      indicator: "orange"
    });
    return;
  }

  const forward_payload = selected.map((messageName) => {
    const cached = this.messageCache.get(messageName) || {};
    const $wrapper = this.$chat_space.find(`[data-message-name="${messageName}"]`);

    return {
      message_name: messageName,
      sender: cached.sender || "",
      content:
        cached.content ||
        $wrapper.find(".message-bubble").clone()
          .find(".message-menu-trigger, .react-hover-btn, .message-actions, .edited-label, .forwarded-label")
          .remove()
          .end()
          .html(),
      is_link: cached.is_link || 0,
      is_media: cached.is_media || 0,
      is_document: cached.is_document || 0,
      is_voice_clip: cached.is_voice_clip || 0,
      is_screenshot: cached.is_screenshot || 0,
      file_id: cached.file_id || null,
      attachment: cached.attachment || null,
      message_type: cached.message_type || null,
      is_forwarded: 1
    };
  });

  this.exitSelectionMode();

  erpnext_chat_app.chat_contact_list = new ChatContactList({
    $wrapper: this.$wrapper,
    profile: this.profile,
    forward: 1,
    forward_payload,
    chat_space: this
  });

  erpnext_chat_app.chat_contact_list.render();
}

async handleBulkDelete() {
  const selected = [...this.selectedMessages];
  if (!selected.length) {
    frappe.show_alert({
      message: __("No messages selected"),
      indicator: "orange"
    });
    return;
  }

  frappe.confirm(
    `Delete ${selected.length} message(s)?`,
    async () => {
      for (const messageName of selected) {
        await frappe.call({
          method: "clefincode_chat.api.api_1_3_4.api.delete_chat_message",
          args: {
            message_name: messageName,
            user_email: this.profile.user_email
          }
        });

        const $wrapper = this.$chat_space.find(`[data-message-name="${messageName}"]`);
        const $bubble = $wrapper.find(".message-bubble");

        $bubble.html(`
          <div style="font-style:italic; opacity:0.6;">
            This message was deleted
          </div>
        `);
      }

      this.exitSelectionMode();
    }
  );
}
  setup_events() {
    const me = this;

    const LONG_PRESS_MS = 450;
    const MOVE_CANCEL_PX = 12;


    // ================topic collapse====================
          this.$chat_space.on("click", ".topic-collapse-toggle", function (e) {
        e.preventDefault();
        e.stopPropagation();

        const topicName = $(this).attr("data-topic-name");
        me.toggleTopicMessages(topicName);
      });

      this.$chat_space.on("click", ".topic-open-window-btn", async function (e) {
        e.preventDefault();
        e.stopPropagation();

        const topicName = $(this).attr("data-topic-name");
        const rawSubject = $(this).attr("data-topic-subject") || topicName;
        const safeSubject = me.normalizeTopicSubject
          ? me.normalizeTopicSubject(rawSubject, topicName)
          : String(rawSubject || topicName);

        const topicColor = $(this).attr("data-topic-color") || null;

        if (topicColor) {
          me.topicColorMap?.set(topicName, topicColor);
        }

        await me.openTopicChatWindow(topicName, safeSubject, {
          topic_color: topicColor
        });
      });

// ===== Reopen topic button =====
this.$chat_space.off("click.reopenTopic", ".reopen-topic-btn")
  .on("click.reopenTopic", ".reopen-topic-btn", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const topicName =
      me.chat_topic_space ||
      me.chat_topic ||
      me.profile?.chat_topic;

    const chatChannel =
      me.chat_topic_channel ||
      me.profile?.room;

    if (!topicName) {
      frappe.msgprint({
        title: __("Error"),
        message: __("No topic found."),
        indicator: "red"
      });
      return;
    }

    try {
      const r = await frappe.call({
        method: "clefincode_chat.api.api_1_3_4.api.reopen_chat_topic",
        args: {
          chat_topic: topicName,
          chat_channel: chatChannel
        }
      });

      me.chat_topic_status = "Open";
      me.topic_read_only = false;
      me.topic_write_mode = true;
      me.topic_can_reopen = false;

      me.$chat_actions?.remove();
      me.$chat_actions = null;

      await me.setup_actions();
      me.setup_events();

      frappe.show_alert({
        message: __("Topic reopened"),
        indicator: "green"
      });
    } catch (err) {
      console.error("Failed to reopen topic", err);
      frappe.msgprint({
        title: __("Error"),
        message: __("Failed to reopen topic."),
        indicator: "red"
      });
    }
  });

// ===== Message action menu =====

this.$chat_space.on("click", ".message-select-checkbox", function (e) {
  e.stopPropagation();
});

this.$chat_space.on("change", ".message-select-checkbox input", function (e) {
  e.stopPropagation();

  if (!me.selectionMode) return;

  const messageName = $(this).closest("[data-message-name]").data("message-name");
  me.toggleMessageSelection(messageName);
});
this.$chat_space.on("click", ".message-bubble", function (e) {
  e.stopPropagation();

  const $wrapper = $(this).closest("[data-message-name]");
  const messageName = $wrapper.data("message-name");

  if (me.selectionMode) {
   // me.toggleMessageSelection(messageName);
    return;
  }

  me.closeMessageActionMenu();
  me.hideAllReactButtons();
  me.showReactButtonForMessage(messageName);
});

this.$wrapper.off("click.chatMenuActions", ".relink-action")
  .on("click.chatMenuActions", ".relink-action", function (e) {
    e.stopPropagation();
    me.closeMessageActionMenu();

    const messageName = $(this).data("message-name");
    me.startBulkSelection("relink", messageName);
  });
this.$wrapper.off("click.chatMenuActions", ".message-topic-open-action")
  .on("click.chatMenuActions", ".message-topic-open-action", async function (e) {
    e.preventDefault();
    e.stopPropagation();

    const $btn = $(this);

    const topicName = $btn.attr("data-topic-name");
    const rawSubject = $btn.attr("data-topic-subject") || topicName;
    const topicColor = $btn.attr("data-topic-color") || null;

    if (!topicName) return;

    me.closeMessageActionMenu();

    const topicSubject = me.normalizeTopicSubject
      ? me.normalizeTopicSubject(rawSubject, topicName)
      : String(rawSubject || topicName);

    if (topicColor) {
      me.topicColorMap?.set(topicName, topicColor);
    }

    await me.openTopicChatWindow(topicName, topicSubject, {
      topic_color: topicColor
    });
  });
this.$wrapper.off("click.chatMenuActions", ".message-info-action")
  .on("click.chatMenuActions", ".message-info-action", async function (e) {
    e.stopPropagation();
    me.closeMessageActionMenu();

    const messageName = $(this).data("message-name");
    await me.openMessageInfoDialog(messageName);
  });
this.$wrapper.off("click.chatMenuActions", ".edit-action")
  .on("click.chatMenuActions", ".edit-action", function (e) {
    e.stopPropagation();
    me.closeMessageActionMenu();

    const messageName = $(this).data("message-name");
    const cached = me.messageCache.get(messageName) || {};
    const isEditedBefore = Number(cached.is_edited || 0) === 1;
    const $wrapper = me.$chat_space.find(`[data-message-name="${messageName}"]`);

    if (isEditedBefore) {
      const d = new frappe.ui.Dialog({
        title: "Edit Message",
        fields: [
          {
            label: "Original Message",
            fieldname: "original_message",
            fieldtype: "Text Editor",
            read_only: 1,
            default: cached.original_content || "—"
          },
          {
            label: "Current Message",
            fieldname: "current_message",
            fieldtype: "Text Editor",
            read_only: 1,
            default: cached.content || "—"
          }
        ],
        primary_action_label: "OK",
        primary_action: () => d.hide()
      });

      d.show();
      d.$body.prepend(`
        <div class="alert alert-warning" style="margin-bottom:10px;">
          Editing is not allowed because it was edited before.
        </div>
      `);
      return;
    }

    const d = new frappe.ui.Dialog({
      title: "Edit Message",
      fields: [
        {
          label: "Message",
          fieldname: "content",
          fieldtype: "Text Editor",
          reqd: 1,
          default: cached.content || ""
        }
      ],
      primary_action_label: "Save",
      primary_action: async (values) => {
        let formattedContent = values.content || "";

        const $tmp = $("<div>").html(formattedContent);
        const $ql = $tmp.find(".ql-editor").first();
        formattedContent = $ql.length ? $ql.html() : $tmp.html();

        formattedContent = me.check_if_content_has_email(formattedContent);
        formattedContent = me.check_if_content_has_link(formattedContent);

        await frappe.call({
          method: "clefincode_chat.api.api_1_3_4.api.edit_chat_message",
          args: {
            message_name: messageName,
            new_content: formattedContent
          }
        });

        const $bubble = $wrapper.find(".message-bubble");
        const $menuTrigger = $bubble.find(".message-menu-trigger").detach();
        const $reactHoverBtn = $bubble.find(".react-hover-btn").detach();
        const $replyLink = $bubble.find(".reply-link").detach();
        const $forwardedLabel = $bubble.find(".forwarded-label").detach();

        $bubble.empty();

        if ($replyLink.length) $bubble.append($replyLink);
        if ($forwardedLabel.length) $bubble.append($forwardedLabel);

        $bubble.append(formattedContent);
        $bubble.append(`
          <div class="edited-label" style="font-size:11px;opacity:.6;margin-top:4px;">
            Edited
          </div>
        `);

        $bubble.append($menuTrigger);
        $bubble.append($reactHoverBtn);

        cached.content = formattedContent;
        cached.is_edited = 1;
        me.messageCache.set(messageName, cached);

        d.hide();
      },
      secondary_action_label: "Cancel",
      secondary_action: () => d.hide()
    });

    d.show();
    d.fields_dict.content.$wrapper.attr("dir", "auto");
  });
this.$wrapper.off("click.chatMenuActions", ".copy-action")
  .on("click.chatMenuActions", ".copy-action", async function (e) {
    e.stopPropagation();
    me.closeMessageActionMenu();

    const messageName = $(this).data("message-name");
    await me.copyMessageContent(messageName);
  });
this.$wrapper.off("click.chatMenuActions", ".reply-action")
  .on("click.chatMenuActions", ".reply-action", async function (e) {
    e.stopPropagation();
    me.closeMessageActionMenu();

    const messageName = $(this).data("message-name");
    me.reply_to_message_name = messageName;

    const snippet = await me.makeReplySnippet(messageName, 120);
    const text = snippet?.text || "[Attachment]";

    let $host = me.$chat_space.children(".reply-preview-host");
    if (!$host.length) {
      $host = $('<div class="reply-preview-host"></div>');
      me.$chat_actions.before($host);
    }

    $host.html(`
      <div class="reply-preview">
        <span class="reply-preview__icon">↩</span>
        <span class="reply-preview__text"></span>
        <button type="button" class="reply-preview__close cancel-reply" aria-label="Cancel">×</button>
      </div>
    `);

    $host.find(".reply-preview__text").text(text);

    setTimeout(() => {
      if (me.type_message_input?.quill) {
        me.type_message_input.quill.focus();
        me.type_message_input.quill.setSelection(
          me.type_message_input.quill.getLength(),
          0
        );
        return;
      }

      const $editor = me.$chat_actions?.find(".type-message .ql-editor");
      if ($editor?.length) $editor.trigger("focus");
    }, 0);
  });

this.$wrapper.off("click.chatMenuActions", ".react-action")
  .on("click.chatMenuActions", ".react-action", function (e) {
    e.stopPropagation();
    me.closeMessageActionMenu();

    const messageName = $(this).data("message-name");
    const $wrapper = me.$chat_space.find(`[data-message-name="${messageName}"]`);
    const $bubble = $wrapper.find(".message-bubble").first();

    if (!$bubble.length) return;

    me.openEmojiMenu({
      $bubble,
      messageName
    });
  });

this.$wrapper.off("click.chatMenuActions", ".forward-action")
  .on("click.chatMenuActions", ".forward-action", function (e) {
    e.stopPropagation();
    me.closeMessageActionMenu();

    const messageName = $(this).data("message-name");
    me.startBulkSelection("forward", messageName);
  });

this.$wrapper.off("click.chatMenuActions", ".delete-action")
  .on("click.chatMenuActions", ".delete-action", function (e) {
    e.stopPropagation();
    me.closeMessageActionMenu();

    const messageName = $(this).data("message-name");
    me.startBulkSelection("delete", messageName);
  });

this.$wrapper.off("click.chatMenuActions", ".remove-message-topic-action")
  .on("click.chatMenuActions", ".remove-message-topic-action", async function (e) {
    e.preventDefault();
    e.stopPropagation();

    const messageName = $(this).data("message-name");
    me.closeMessageActionMenu();

    if (!messageName) return;

    frappe.confirm(
      __("Remove topic from this message?"),
      async () => {
        await me.removeTopicFromMessage(messageName);
      }
    );
  });

this.$wrapper.off("click.chatBubbleActions").on("click.chatBubbleActions", function (e) {
  const insideMenu = $(e.target).closest(".message-action-menu, .message-menu-trigger").length;
  if (!insideMenu) {
    me.closeMessageActionMenu();
    me.hideAllReactButtons();
  }
});

this.$chat_space.on("click", ".cancel-selection-btn", function (e) {
  e.stopPropagation();
  me.exitSelectionMode();
});

this.$chat_space.on("click", ".relink-topic-btn", async function (e) {
  e.stopPropagation();

  const selected = [...me.selectedMessages];
  if (!selected.length) {
    frappe.show_alert({
      message: __("No messages selected"),
      indicator: "orange"
    });
    return;
  }

  await me.openRelinkTopicsDialog(selected);
});
this.$chat_space.on("click", ".message-menu-trigger", function (e) {
  e.stopPropagation();

  const $trigger = $(this);
  const $wrapper = $trigger.closest("[data-message-name]");
  const messageName = $wrapper.data("message-name");
  const cached = me.messageCache.get(messageName) || {};

  const isMyMessage = $trigger.attr("data-is-my-message") === "1";
  const isTextOnly =
    $trigger.attr("data-is-text-only") === "1" &&
    !cached.is_media &&
    !cached.is_document &&
    !cached.is_voice_clip &&
    !cached.attachment;

  me.openMessageActionMenu({
    $trigger,
    messageName,
    isMyMessage,
    isTextOnly
  });
});



 $(document)
  .off("click.chatMenuActions", ".react-action")
  .on("click.chatMenuActions", ".react-action", function (e) {
    e.stopPropagation();
    me.closeMessageActionMenu();

    const messageName = $(this).data("message-name");
    const $wrapper = me.$chat_space.find(`[data-message-name="${messageName}"]`);
    const $bubble = $wrapper.find(".message-bubble").first();

    if (!$bubble.length) return;

    me.openEmojiMenu({
      $bubble,
      messageName
    });
  });





this.$chat_space.on("click", ".confirm-forward-btn", async function (e) {
  e.stopPropagation();
  await me.handleBulkForward();
});

this.$chat_space.on("click", ".confirm-delete-btn", async function (e) {
  e.stopPropagation();
  await me.handleBulkDelete();
});

this.$chat_space.on("click", ".cancel-reply", function () {
  me.reply_to_message_name = null;
  me.$chat_space.find(".reply-preview").remove();
});

this.$chat_space.on("click", ".reply-link", async function () {
  const target = $(this).data("jump");

  const $msg = me.$chat_space.find(`#msg-${target}`);
  if ($msg.length) {
    me.highlightAndScroll($msg);
    return;
  }

  await me.jumpToMessage(target);
});





    // pointerdown
    // this.$chat_space.on("pointerdown", ".message-bubble", (e) => {
    //   if (e.pointerType === "mouse" && e.button !== 0) return;

    //   this.longPress.fired = false;
    //   this.longPress.targetMessage = $(e.currentTarget)
    //     .closest("[data-message-name]")
    //     .data("message-name");

    //   this.longPress.startX = e.clientX;
    //   this.longPress.startY = e.clientY;

    //   clearTimeout(this.longPress.timer);

    //   this.longPress.timer = setTimeout(() => {
    //     this.longPress.fired = true;

        
    //     $(".message-actions").hide();

    //     const $bubble = $(e.currentTarget);
    //     this.openEmojiMenu({
    //       $bubble,
    //       messageName: this.longPress.targetMessage,
    //     });
    //   }, LONG_PRESS_MS);
    // });
    this.$chat_space.on("click", ".react-hover-btn", function (e) {
          e.stopPropagation();

          const $wrapper = $(this).closest("[data-message-name]");
          const messageName = $wrapper.data("message-name");
          const $bubble = $wrapper.find(".message-bubble");

          me.openEmojiMenu({
            $bubble,
            messageName
          });
        });
    this.$chat_space
      .find(".topic-request-access")
      .on("click", async function () {
        await send_topic_access_request(
          me.profile.user_email,
          me.chat_topic_space,
          me.chat_topic_channel,
          me.chat_topic_space_subject,
          cur_frm.doc.doctype,
          cur_frm.doc.name
        );
        me.$chat_space_container.html(
          `<div class="alert alert-secondary no-messages-info">Your request has been sent</div>`
        );
      });

    this.$chat_space.find(".close-chat-window").on("click", function () {
      if (me.voice_clip && me.voice_clip.stream) {
        const tracks = me.voice_clip.stream.getTracks();
        tracks.forEach((track) => {
          track.stop();
        });
      }
      if (me.audiodict !== "undefined" && me.audiodict !== undefined) {
        for (let audio in me.audiodict) {
          if (me.audiodict.hasOwnProperty(audio)) {
            if (!me.audiodict[audio].paused) me.audiodict[audio].pause();
          }
        }
      }
      me.audiodict = [];

      me.is_open = 0;
      me.unbindAllRealtimeChannels();
      if (me.profile.room_type == "Contributor") {
        frappe.ErpnextChat.settings.open_chat_space_rooms =
          frappe.ErpnextChat.settings.open_chat_space_rooms.filter(
            (item) => item != me.profile.parent_channel
          );
      } else {
        frappe.ErpnextChat.settings.open_chat_space_rooms =
          frappe.ErpnextChat.settings.open_chat_space_rooms.filter(
            (item) => item != me.profile.room
          );
      }

      $(this).closest(".chat-window").remove();

const app = window.erpnext_chat_app;
if (app && app.is_webview) {
  const $left = $(".chat_left_section");


  const anyOpen = $(".chat-window").length > 0;

  if (!anyOpen) {
    if (app.$empty_state && app.$empty_state.length) {
      if (!$left.find(".chat-empty-state").length) {
        $left.append(app.$empty_state);
      }
      app.$empty_state.show();
    } else {
      $left.find(".chat-empty-state").show();
    }
  } else {
    
    if (app.$empty_state && app.$empty_state.length) app.$empty_state.hide();
    $left.find(".chat-empty-state").hide();
  }
}

    });
    
    this.$chat_space.find(".avatar").on("click", function () {
      $(this).closest(".chat-space").find(".chat-profile-info").click();
    });

    this.$chat_space.find(".chat-profile-info").on("click", function () {
      if (me.not_authorized_user) {
        return;
      }
      me.$chat_space.find(".mentioned-doctype-section").remove();
      me.chat_info = new ChatInfo({
        chat_space: me,
        chat_status: this.chat_status
      });
      me.$chat_space.find(".arrow-button").css("z-index", "0");
    });

    this.$chat_space.find(".collapse-chat-window").on("click", function () {
      
      me.is_open = 0;
      if (me.profile.room_type == "Contributor") {
      
        frappe.ErpnextChat.settings.open_chat_space_rooms =
          frappe.ErpnextChat.settings.open_chat_space_rooms.filter(
            (item) => item != me.profile.parent_channel
          );
      } else {
   
        frappe.ErpnextChat.settings.open_chat_space_rooms =
          frappe.ErpnextChat.settings.open_chat_space_rooms.filter(
            (item) => item != me.profile.room
          );
      }

      var id0 = $(this).closest(".chat-window").attr("data-room");
      var id1 = $(this).closest(".chat-window").attr("data-contact");
      var id2 = $(this).closest(".chat-window").attr("data-topic");
      var attr;
      var id;
      if (typeof id0 == "undefined" && typeof id1 == "undefined") {
        id = id2;
        attr = "data-topic";
      } else if (typeof id0 == "undefined" && typeof id2 == "undefined") {
        id = id1;
        attr = "data-contact";
      } else {
        id = id0;
        attr = "data-room";
      }
      var tit = $(this)
        .closest(".chat-window")
        .find(".chat-profile-name")
        .text();
      var chat_bottom = $(".chat_bottom");
    
      chat_bottom.append(`
    <div  data-id="${id}" class="minimized-chat" style="min-width:190px; display:flex;">
      <span class="test"></span>
      <span class='expand-chat-window' style="margin-right:auto;display:block;cursor: pointer;width: 100%;  white-space: nowrap;overflow: hidden;text-overflow: ellipsis;" onclick="expand_me('${id}','${attr}','${me.profile.room_type}','${me.profile.room}','${me.profile.parent_channel}','${me.chat_topic_space}')">${tit} </span>
      <span data-id="${id}"  class='expand-chat-window' style="cursor: pointer;" onclick="expand_me('${id}','${attr}','${me.profile.room_type}','${me.profile.room}','${me.profile.parent_channel}','${me.chat_topic_space}'); " >${frappe.utils.icon("expand", "md")}</span>
      <span  class='close-small-chat-window' style="cursor: pointer;"  onclick="closeMe('${id}','${attr}'); ">${frappe.utils.icon("close", "lg")}</span>
    </div>

    `);

      $(this).closest(".chat-window").css("display", "none");
    });

      this.$chat_space.find(".arrow").on("click", function () {
      $(this)
        .closest(".chat-space-container")
        .animate(
          { scrollTop: me.$chat_space_container.prop("scrollHeight") },
          "fast"
        );

      $(this).css("display", "none");
      me.resetUnreadBadge();
    });

    me.$chat_space_container.on("scroll", function () {
      me.on_scroll();
    });

    if (this.$chat_actions && this.$chat_actions.length > 0) {
      this.$chat_actions.find(".open-chat-plus-menu").on("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        me.togglePlusMenu();
      });

      this.$chat_actions.find('#chat-file-uploader').on('change', function () {
        if (this.files.length > 0) {
          me.file = {};
          me.file.file_obj = this.files[0];
          me.handle_upload_file(me.file);
          me.file = null;
        }
      });

      this.$chat_actions.find(".message-send-button").on("click", function () {
        if (me.press_enter === 1) {
          return;
        }
        me.press_enter = 1;

        me.handle_send_message()
          .then(() => {
            me.press_enter = 0;
          })
          .catch((error) => {
            console.error("An error occurred:", error);
            me.press_enter = 0;
          });
      });

      this.$chat_actions.find(".type-message").on("input", function () {
        const textValue = $(this).find(".ql-editor").text();
        if (me.profile.room) {
          // Only call setupTypingIndicator if it's not already active
          if (!me.isTypingIndicatorActive) {
              
       

          if (!me.isTypingIndicatorActive) {
            if (textValue.startsWith("/") && textValue.length === 1) {
              
              me.setupTypingIndicator(textValue);
            } else {
              me.setupTypingIndicator();
              const container = document.querySelector("#template-suggestions");
              if (container) container.remove();
            }
            me.isTypingIndicatorActive = true;
          }
           else {
              const container = document.querySelector("#template-suggestions");
              if (container) container.remove();
            }
          }
        }
        else{
          if (textValue.startsWith("/")) {
              me.debouncedFetchTemplates(textValue);
            } else {
              me.removeTemplateSuggestions();
            }
        }

        me.toggle_voice_clip_icon();

        if (me.isDedicatedTopicContext?.()) {
          const textVal = $(this).find(".ql-editor").text();
          if (textVal.trim()) {
            const docMentions = me.extractDoctypeMentionsFromComposer();
            me.showTopicMentionReferenceHint(docMentions);
          } else {
            me.clearTopicMentionReferenceHint?.();
          }
        }

        if (contains_arabic($(this).find(".ql-editor").find("p").text())) {
          $(this).find(".ql-editor").css({
            direction: "rtl",
            "text-align": "right",
          });
        } else {
          $(this).find(".ql-editor").css({
            direction: "ltr",
            "text-align": "left",
          });
        }
      });

      this.$chat_actions.find(".type-message").on("keyup", function (e) {
        me.toggle_voice_clip_icon();

        const ql_mention_list_container = me.type_message_input.quill.is_open;
        if (e.which === 13) {
          e.preventDefault();
          if (ql_mention_list_container == 1) {
            return;
          } else {
            if (!e.shiftKey) {
              if (me.press_enter === 1) {
                return;
              }
              me.press_enter = 1;

              me.handle_send_message()
                .then(() => {
                  me.press_enter = 0;
                })
                .catch((error) => {
                  console.error("An error occurred:", error);
                  me.press_enter = 0;
                });
            }
          }
        }
      });
    }

    this.$chat_space_container.find("span.mention").on("click", function () {
      if (
        $(this).data("id") == me.profile.user_email ||
        $(this).data("is-doctype") == 1
      ) {
        return;
      }
      me.check_if_contact_has_chat(
        me.profile.user_email,
        $(this).data("id"),
        $(this).data("name"),
        "Chat"
      );
    });

    me.setup_voice_clip_event();

    // Show reply/forward when clicking message


this.$chat_space.on("click", ".message-reactions .reaction-chip", async function (e) {
  e.stopPropagation();

  const $msg = $(this).closest("[data-message-name]");
  const messageName = $msg.data("message-name");
  const emoji = $(this).data("emoji"); 

  await me.openReactionsDialog(messageName, emoji);
});



this.$chat_space.on("click", ".message-reactions", async function (e) {
  e.stopPropagation();

 
  if ($(e.target).closest(".reaction-chip").length) return;

  const messageName = $(this).closest("[data-message-name]").data("message-name");
  await me.openReactionsDialog(messageName, null); // All
});


// this.$chat_space.on("click", ".message-reactions .reaction-chip", async function (e) {
//   e.stopPropagation();

//   const messageName = $(this).closest("[data-message-name]").data("message-name");
//   const emoji = $(this).data("emoji");
//   await me.openReactionsDialog(messageName, emoji); // preselect emoji
// });

// ================= Plus Menu & Topic Select Events =================
if (!me.chat_topic_space) {
  me.$chat_space.on("click", ".chat-plus-attach", function (e) {
    e.preventDefault();
    e.stopPropagation();
    me.closePlusMenu();
    if(!me.is_disk){
      me.$chat_actions.find('#chat-file-uploader').click();
    }else{
      new frappe.ui.FileUploader({
        allow_multiple: false,
        async on_success(file) {
          await me.handle_send_message(
            file.file_url,
            file.file_name,
            file.name
          );
        },
      });
    }
  });

  me.$chat_space.on("click", ".chat-plus-topics", function (e) {
    e.preventDefault();
    e.stopPropagation();
    me.closePlusMenu();
    me.openTopicSelectPopup();
  });

  me.$chat_space.on("click", ".chat-plus-remove-topic", async function (e) {
    e.preventDefault();
    e.stopPropagation();
    const topicToClear = me.activeMessageTopic || null;
    me.closePlusMenu();
    me.clearMessageTopic(false);
    await me.clearUserActiveChatTopic(topicToClear);
  });

  me.$chat_space.on("click", ".chat-plus-add-topic", async function (e) {
    e.preventDefault();
    e.stopPropagation();
    me.closePlusMenu();
    await me.openCreateTopicFromPlusDialog();
  });

  me.$chat_space.on("click", ".chat-read-more-btn", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const $btn = $(this);
    const $textBody = $btn.siblings(".message-text-body").first();
    if (!$textBody.length) return;

    let step = parseInt($textBody.attr("data-read-more-step") || "0", 10);
    const nextStep = step + 1;

    if (nextStep >= 2) {
      $textBody
        .removeClass("long-message-body")
        .addClass("long-message-expanded");
      $btn.remove();
    } else {
      const heights = [320, 640, 960];
      $textBody.css("max-height", heights[nextStep] + "px");
      $textBody.attr("data-read-more-step", nextStep);
    }
  });

  me.$chat_space.on("input", ".topic-select-search", function () {
    const query = $(this).val() || "";
    me.renderTopicSelectList(query);
  });

  me.$chat_space.on("click", ".topic-select-main", async function (e) {
  e.preventDefault();
  e.stopPropagation();

  const $btn = $(this);
  const topicName = $btn.attr("data-topic-name");
  const topicSubject = $btn.attr("data-topic-subject") || topicName;
  let topicColor = $btn.attr("data-topic-color") || null;

  if (!topicName) return;

  topicColor = await me.getTopicColorFromSource(topicName, null, { forceRefresh: true });

  me.selectMessageTopic(topicName, topicSubject, {
    scroll: false,
    color: topicColor,
    topic_color: topicColor
  });

  await me.saveUserActiveChatTopic(topicName);

  me.closeTopicSelectPopup?.();
  me.closeAllTopicsView?.();
});

  me.$chat_space.on("click", ".topic-select-open", async function (e) {
    e.preventDefault();
    e.stopPropagation();
    const topicName = $(this).data("topic-name");
    const rawSubject = $(this).data("topic-subject") || topicName;
    const safeSubject = me.normalizeTopicSubject
      ? me.normalizeTopicSubject(rawSubject, topicName)
      : String(rawSubject || topicName);
    if (!topicName) return;
    await me.openTopicChatWindow(topicName, safeSubject);
  });

  me.$chat_space.on("click", ".topic-select-see-more", function (e) {
    e.preventDefault();
    e.stopPropagation();
    me.closeTopicSelectPopup();
    me.openAllTopicsView();
  });

  me.$chat_space.on("click", ".all-topics-back", function (e) {
    e.preventDefault();
    e.stopPropagation();
    me.closeAllTopicsView();
  });

  me.$chat_space.on("input", ".all-topics-search", function () {
    const query = $(this).val() || "";
    me._allTopicsState.query = query;
    me.renderAllTopicsList();
  });

  me.$chat_space.on("scroll", ".all-topics-list", function () {
    const el = this;
    if (me._allTopicsState.loading || !me._allTopicsState.hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
      me.loadMoreAllTopics();
    }
  });
}

$(document).on("click.plusMenuClose", function (e) {
  if (
    me.$plusMenu &&
    me.$plusMenu.length &&
    !$(e.target).closest(".chat-plus-menu").length &&
    !$(e.target).closest(".open-chat-plus-menu").length
  ) {
    me.closePlusMenu();
  }
});

$(document).on("click.topicSelectClose", function (e) {
  if (
    me.$topicSelectPopup &&
    me.$topicSelectPopup.length &&
    !$(e.target).closest(".topic-select-panel").length &&
    !$(e.target).closest(".open-chat-plus-menu").length &&
    !$(e.target).closest(".chat-plus-topics").length
  ) {
    me.closeTopicSelectPopup();
  }
});
  } //End setup_events
  
  async handle_upload_file(file) {
    const dataurl = await frappe.dom.file_to_base64(file.file_obj);
    file.dataurl = dataurl;
    file.name = file.file_obj.name;
    return this.upload_file(file);
  }

  upload_file(file) {
    const me = this;        

    return new Promise((resolve, reject) => {
      show_overlay("Uploading...");
      let xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('load', () => {        
        resolve();
      });

      xhr.addEventListener('error', () => {
        hide_overlay();
        reject(frappe.throw(__('Internal Server Error')));
      });
      xhr.onreadystatechange = () => {
        if (xhr.readyState == XMLHttpRequest.DONE) {
          if (xhr.status === 200) {
            let r = null;
            let file_doc = null;
            try {
              r = JSON.parse(xhr.responseText);
              if (r.message.doctype === 'File') {
                file_doc = r.message;
              }
            } catch (e) {
              r = xhr.responseText;
            }
            try {
              if (file_doc === null) {
                hide_overlay();
                reject(frappe.throw(__('File upload failed!')));
              }              
              me.handle_send_message(file_doc.file_url, file_doc.file_name, file_doc.name);
            } catch (error) {
              console.log(error)
            }
          } else {
            try {
              const error = JSON.parse(xhr.responseText);
              const messages = JSON.parse(error._server_messages);
              const errorObj = JSON.parse(messages[0]);
              hide_overlay();
              reject(frappe.throw(__(errorObj.message)));
            } catch (e) {
              console.log(e)
            }
          }
        }
      };

      xhr.open('POST', '/api/method/upload_file', true);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('X-Frappe-CSRF-Token', frappe.csrf_token);

      let form_data = new FormData();

      form_data.append('file', file.file_obj, file.name);
      form_data.append('is_private', +false);

      form_data.append('doctype', 'ClefinCode Chat Message');
      form_data.append('docname', this.profile.room);
      form_data.append('optimize', +true);
      xhr.send(form_data);
    });
  }

  setup_voice_clip_event() {
    let me = this;
    me.$chat_space.on("click", ".message-bubble .audio-btn", function () {
      const audioUrl = "/private/files/";
      if (me.audiodict === undefined || me.audiodict === "undefined")
        me.audiodict = [];

      const $voiceClipContainer = $(this).closest(".voice-clip-container");
      const filename = $voiceClipContainer.data("audio");
      if (!this.audio) {
        // The src attribute should be set to the audio file URL
        if (filename in me.audiodict) {
          this.audio = me.audiodict[filename];
        } else {
          this.audio = new Audio();

          this.audio.src = audioUrl + filename;
          me.audiodict[filename] = this.audio;
        }
        let duration = $voiceClipContainer.data("duration");

        // When the audio can play through, play it and update the progress bar
        this.audio.addEventListener("canplaythrough", () => {
          this.audio.play();
          $(this).find('[data-icon="audio-play"]').hide();
          $(this).find(".stop-btn").show();
        });

        // Update the progress bar as the audio plays
        this.audio.addEventListener("timeupdate", () => {
          let percentage = (this.audio.currentTime / duration) * 100;
          let remainingTime = duration - this.audio.currentTime;

          // Set the width immediately without transition
          $voiceClipContainer
            .find(".record-sec")
            .css("--progress-width", `${percentage}%`);

          // Now set a transition to match the remaining time of the audio
          $voiceClipContainer
            .find(".record-sec")
            .css("transition", `width ${remainingTime}s linear`);
        });

        // When the audio ends, reset the progress bar
        this.audio.addEventListener("ended", () => {
          $voiceClipContainer.find(".record-sec").css("--progress-width", "0%");
          $voiceClipContainer.find(".record-sec").css("transition", "none");
          $(this).find(".stop-btn").hide();
          $(this).find('[data-icon="audio-play"]').show();
        });
      } else {
        // Toggle play/pause if the audio is already initialized
        if (this.audio.paused) {
          this.audio.play();
          $(this).find('[data-icon="audio-play"]').hide();
          $(this).find(".stop-btn").show();
        } else {
          this.audio.pause();
          $(this).find(".stop-btn").hide();
          $(this).find('[data-icon="audio-play"]').show();
        }
        if (!(filename in me.audiodict)) {
          me.audiodict[filename] = this.audio;
        }
      }
      for (let audio in me.audiodict) {
        if (me.audiodict[audio] != this.audio) {
          let $cont = $(".voice-clip-container[data-audio='" + audio + "']");
          if ($cont.length > 0) {
            $cont.find(".stop-btn").hide();
            $cont.find('[data-icon="audio-play"]').show();
          }
          me.audiodict[audio].pause();
        }
      }
    });

    me.$chat_space.on(
      "click",
      ".message-bubble .record-canvas",
      function (event) {
        const $voiceClipContainer = $(this).closest(".voice-clip-container");
        const filename = $voiceClipContainer.data("audio");
        const duration = $voiceClipContainer.data("duration");
        let audio = null;
        if (!me.audiodict[filename]) {
          const audioUrl = "/private/files/" + filename;
          audio = new Audio(audioUrl);
          me.audiodict[filename] = audio;
        } else {
          audio = me.audiodict[filename];
        }
        const rect = this.getBoundingClientRect();
        const x = event.clientX - rect.left; // x position within the element
        const totalWidth = $(this).width();
        const clickPositionRatio = x / totalWidth;

        const audioTime = clickPositionRatio * duration;

        audio.currentTime = audioTime; // Set the audio time

        // Update the progress bar
        const percentage = (audio.currentTime / duration) * 100;
        $voiceClipContainer
          .find(".record-sec")
          .css("--progress-width", `${percentage}%`);
      }
    );
  }

  async check_if_contact_has_chat(user_email, contact, contact_name, platform="test") {
    const me = this;
    const room = await check_if_contact_has_chat(user_email, contact, platform);
    if (room.results.name) {
      this.open_chat_space(contact, contact_name, platform, room.results.name);
    } else {
      this.open_chat_space(contact, contact_name, platform);
    }
  }

  open_chat_space(contact, contact_name, platform, room = null) {
    if (room) {
      if (check_if_chat_window_open(room, "room")) {
        $(".expand-chat-window[data-id|='" + room + "']").click();
        return;
      }

      this.chat_window = new ChatWindow({
        profile: {
          room: room,
        },
      });

      let profile = {
        is_admin: this.profile.is_admin,
        user: this.profile.user,
        user_email: this.profile.user_email,
        time_zone: this.profile.time_zone,
        room: room,
        room_name: contact_name,
        room_type: "Direct",
        contact: contact,
        is_first_message: 0,
        platform: platform,
      };
      this.chat_space = new ChatSpace({
        $wrapper: this.chat_window.$chat_window,
        profile: profile,
      });
    } else {
      if (check_if_chat_window_open(contact, "contact")) {
        $(".expand-chat-window[data-id|='" + contact + "']").click();
        return;
      }
      this.chat_window = new ChatWindow({
        profile: {
          contact: contact,
          platform: platform,
        },
      });

      let profile = {
        is_admin: this.profile.is_admin,
        user: this.profile.user,
        user_email: this.profile.user_email,
        time_zone: this.profile.time_zone,
        room: null,
        room_name: contact_name,
        room_type: "Direct",
        contact: contact,
        is_first_message: 1,
        platform: platform,
      };

      this.chat_space = new ChatSpace({
        $wrapper: this.chat_window.$chat_window,
        profile: profile,
      });
    }
  }

  toggle_voice_clip_icon() {
  const $editor = this.$chat_actions.find(".type-message .ql-editor");

  const text = ($editor.text() || "").trim();
  const hasImages = $editor.find("img").length > 0;

  if (text.length > 0 || hasImages) {
    this.voice_clip.$voice_clip.css("display", "none");
    this.$chat_actions.find(".message-send-button").css("display", "flex");
  } else {
    this.voice_clip.$voice_clip.css("display", "block");
    this.$chat_actions.find(".message-send-button").css("display", "none");
  }
}

async setup_messages(messages_list) {
    if (this.$chat_space_container && this.$chat_space_container.length == 1) {
      this.$chat_space_container.remove();
    }
    this.$chat_space_container = $(document.createElement("div")).addClass(
      "chat-space-container"
    );
    this.topicTimelineSegment = {
      activeTopicName: null,
      activeTopicSubject: null,
      activeTopicColor: null,
      realMessageCount: 0
    };
    await this.make_messages_html(messages_list);
    this.$chat_space_container.html(this.message_html);
    this.normalizeTopicSeparators();
    this.$chat_space.append(this.$chat_space_container);

    this.updateTopicMessageCounts();
    this.applyCollapsedTopicsState();

    if (!this.chat_topic_space) {
      this.buildTopicMetaMap();
      this.applyTopicVisibility();
    }

    this.resolvePendingReplies();
    this.hydrateReactionsForMessages(messages_list);
  }
    getTopicColor(topicName = "", dbColor = null) {
      if (!topicName) return dbColor || null;

      const key = String(topicName);

      if (dbColor) {
        this.topicColorMap.set(key, dbColor);
        return dbColor;
      }

      if (this.topicColorMap.has(key)) {
        return this.topicColorMap.get(key);
      }

      let hash = 0;

      for (let i = 0; i < key.length; i++) {
        hash = key.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash;
      }

      const color = this.topicPalette[Math.abs(hash) % this.topicPalette.length];
      this.topicColorMap.set(key, color);

      return color;
    }

  isSetTopicInfoMessage(params = {}) {
    const template = String(params.message_template_type || "").toLowerCase();
    const contentText = this.stripHtml(params.content || "").toLowerCase();
    return (
      template === "set topic" ||
      template === "set-topic" ||
      template === "settopic" ||
      contentText.includes("you set topic") ||
      contentText.includes("you added")
    );
  }

  isRemoveTopicInfoMessage(params = {}) {
    const template = String(params.message_template_type || "").toLowerCase();
    const contentText = this.stripHtml(params.content || "").toLowerCase();

    return (
      template === "remove topic" ||
      template === "remove-topic" ||
      template === "removetopic" ||
      contentText.includes("removed topic") ||
      contentText.includes("you removed topic") ||
      contentText.includes("topic removed")
    );
  }

  isCloseTopicInfoMessage(params = {}) {
    const template = String(params.message_template_type || "").toLowerCase();
    const contentText = this.stripHtml(params.content || "").toLowerCase();

    return (
      template === "close topic" ||
      template === "close-topic" ||
      template === "closetopic" ||
      contentText.includes("closed topic") ||
      contentText.includes("you closed topic") ||
      contentText.includes("topic closed")
    );
  }

  makeTopicSeparatorHtml(topicName, topicSubject) {
  if (!topicName) return "";
  if (this.isDedicatedTopicContext?.()) return "";

  const color = this.getTopicColor(topicName);
  const safeTopicName = frappe.utils.escape_html(String(topicName));
  const displaySubject = this.formatTopicSeparatorSubject
    ? this.formatTopicSeparatorSubject(topicSubject, topicName)
    : String(topicSubject || topicName || __("Topic")).replace(/^topic\s*:\s*/i, "").trim();
  const title = frappe.utils.escape_html(displaySubject || topicName || __("Topic"));

  return `
    <div
      class="chat-topic-separator"
      data-topic-name="${safeTopicName}"
      style="--topic-color:${color}; background:${color};"
    >
      <button
        type="button"
        class="topic-collapse-toggle"
        data-topic-name="${safeTopicName}"
        title="${__("Show / Hide topic messages")}"
      >
        <span class="topic-caret">▾</span>
        <span class="topic-title">${title}</span>
        <span class="topic-count"></span>
      </button>

      <button
        type="button"
        class="topic-open-window-btn"
        data-topic-name="${safeTopicName}"
        data-topic-subject="${title}"
        data-topic-color="${color}"
        title="${__("Open topic in new window")}"
      >
        Open
      </button>
    </div>
  `;
}

    shouldRenderTopicSeparator(topicName, previousTopicName) {
      if (!topicName) return false;
      return String(topicName) !== String(previousTopicName || "");
    }

    updateActiveTopicButton(topicName = null) {
      const $btn = this.$chat_space.find(".open-chat-plus-menu");

      if (!$btn.length) return;

      if (topicName) {
        const color =
          this.activeMessageTopicColor ||
          this.topicColorMap.get(topicName) ||
          this.getTopicColor(topicName);
        $btn.addClass("active-topic");
        $btn.css("--topic-color", color);
      } else {
        $btn.removeClass("active-topic");
        $btn.css("--topic-color", "");
      }
    }

    updatePlusTopicButton() {
      const $btn = (
        this.$chat_actions?.find(".open-chat-plus-menu, .plus-btn").first()?.length
          ? this.$chat_actions.find(".open-chat-plus-menu, .plus-btn").first()
          : this.$chat_space?.find(".open-chat-plus-menu, .plus-btn").first()
      );
      if (!$btn?.length) return;

      if (this.activeMessageTopic) {
        const color =
          this.activeMessageTopicColor ||
          this.topicColorMap.get(this.activeMessageTopic) ||
          this.getTopicColor(this.activeMessageTopic);
        $btn.addClass("active-topic");
        $btn.css("--topic-color", color);
        $btn.attr("title", __("Topic: {0}", [this.activeMessageTopicSubject || this.activeMessageTopic]));
      } else {
        $btn.removeClass("active-topic");
        $btn.css("--topic-color", "");
        $btn.attr("title", __("More"));
      }
    }

getOutgoingTopicInfo() {
  const isTopicWindow = this.is_topic_window || this.profile.room_type === "Topic";

  const topicName = isTopicWindow
    ? this.chat_topic_space || this.profile.chat_topic || this.chat_topic
    : this.activeMessageTopic || null;

  if (!topicName) return null;

  const topicSubject = isTopicWindow
    ? this.chat_topic_space_subject || this.profile.chat_topic_subject || topicName
    : this.activeMessageTopicSubject || topicName;

  const topicColor = isTopicWindow
    ? this.topicColorMap.get(topicName) || this.activeMessageTopicColor || this.getTopicColor(topicName)
    : this.activeMessageTopicColor || this.topicColorMap.get(topicName) || this.getTopicColor(topicName);

  return {
    chat_topic: topicName,
    chat_topic_subject: topicSubject,
    topic_color: topicColor
  };
}

async getReplyMessageTopicInfo() {
  const replyMessageName = this.reply_to_message_name;
  if (!replyMessageName) return null;

  let original = this.messageCache.get(replyMessageName);

  if (!original || (!original.chat_topic && !original.topic && !original.topic_name)) {
    try {
      const msg = await this.fetch_single_message(replyMessageName);
      if (msg) {
        original = {
          ...(original || {}),
          ...msg,
          chat_topic: msg.chat_topic || msg.topic || msg.topic_name || null,
          chat_topic_subject:
            msg.chat_topic_subject ||
            msg.topic_subject ||
            msg.chat_topic_title ||
            msg.subject ||
            null,
          topic_color: msg.topic_color || msg.chat_topic_color || null
        };

        this.messageCache.set(replyMessageName, original);
      }
    } catch (e) {
      console.warn("Failed to fetch reply topic info", e);
    }
  }

  const topicName =
    original?.chat_topic ||
    original?.topic ||
    original?.topic_name ||
    null;

  if (!topicName) return null;

  const topicSubject =
    original.chat_topic_subject ||
    original.topic_subject ||
    original.chat_topic_title ||
    original.subject ||
    topicName;

  const topicColor =
    original.topic_color ||
    original.chat_topic_color ||
    this.topicColorMap?.get(topicName) ||
    this.getTopicColor(topicName);

  if (topicColor) {
    this.topicColorMap?.set(topicName, topicColor);
  }

  return {
    chat_topic: topicName,
    chat_topic_subject: topicSubject,
    topic_color: topicColor
  };
}

getIncomingMessageTopic(payload = {}) {
  const msg = payload.message || payload.data || payload;
  return (
    msg.chat_topic ||
    msg.topic ||
    msg.topic_name ||
    payload.chat_topic ||
    payload.topic ||
    null
  );
}

getIncomingMessageChannel(payload = {}) {
  const msg = payload.message || payload.data || payload;
  return (
    msg.chat_channel ||
    msg.room ||
    msg.channel ||
    payload.chat_channel ||
    payload.room ||
    payload.channel ||
    null
  );
}

shouldAppendRealtimeMessage(payload = {}) {
  const incomingTopic = this.getIncomingMessageTopic(payload);
  const incomingChannel = this.getIncomingMessageChannel(payload);

  const currentTopic = this.chat_topic_space || this.profile.chat_topic || this.chat_topic || null;

  const currentChannel =
    this.chat_topic_channel ||
    this.profile.room ||
    this.profile.parent_channel ||
    null;

  if (this.is_topic_window || this.profile.room_type === "Topic") {
    if (!currentTopic) return false;

    if (!incomingTopic) {
      return false;
    }

    return String(incomingTopic) === String(currentTopic);
  }

  if (incomingChannel && currentChannel) {
    return String(incomingChannel) === String(currentChannel);
  }

  return true;
}

getCurrentTopicWindowColor() {
  const topicName =
    this.chat_topic_space ||
    this.chat_topic ||
    this.profile?.chat_topic ||
    null;

  if (!topicName) return null;

  return (
    this.activeMessageTopicColor ||
    this.topicColorMap?.get(topicName) ||
    this.getTopicColor?.(topicName) ||
    null
  );
}

applyTopicHeaderBorderColor(topicName = null, topicColor = null) {
  if (!(this.is_topic_window || this.profile?.room_type === "Topic")) return;

  const key =
    topicName ||
    this.chat_topic_space ||
    this.chat_topic ||
    this.profile?.chat_topic ||
    null;

  if (!key) return;

  const color =
    topicColor ||
    this.activeMessageTopicColor ||
    this.topicColorMap?.get(key) ||
    null;

  if (!color) return;

  this.activeMessageTopicColor = color;
  this.topicColorMap?.set(key, color);

  this.$chat_space
    .find(".chat-header")
    .addClass("topic-chat-header-border")
    .removeClass("topic-chat-header")
    .css({
      "--topic-color": color,
      background: "",
      color: "",
      border: "",
      borderBottom: `3px solid ${color}`
    })
    .attr("data-topic-color", color);
}

isDedicatedTopicContext() {
  return Boolean(
    this.is_topic_window ||
    this.profile?.room_type === "Topic" ||
    this.chat_topic_space
  );
}

getTopicReferenceTargetForSend() {
  const isTopicWindow = Boolean(
    this.is_topic_window ||
    this.profile?.room_type === "Topic" ||
    this.chat_topic_space
  );

  const topicName = isTopicWindow
    ? (
        this.chat_topic_space ||
        this.profile?.chat_topic ||
        this.chat_topic ||
        null
      )
    : (
        this.activeMessageTopic ||
        null
      );

  if (!topicName) return null;

  const topicSubject = isTopicWindow
    ? (
        this.chat_topic_space_subject ||
        this.profile?.chat_topic_subject ||
        this.chat_topic_subject ||
        topicName
      )
    : (
        this.activeMessageTopicSubject ||
        topicName
      );

  const topicColor =
    this.activeMessageTopicColor ||
    this.topicColorMap?.get(topicName) ||
    this.getTopicColor(topicName);

  return {
    name: String(topicName),
    subject: this.normalizeTopicSubject
      ? this.normalizeTopicSubject(topicSubject, topicName)
      : String(topicSubject || topicName),
    color: topicColor
  };
}

showMentionWillBeAddedToTopicMessage(topicTarget, mentions = []) {
  if (!topicTarget || !mentions.length) return;

  const label =
    mentions.length === 1
      ? `${mentions[0].doctype} / ${mentions[0].docname}`
      : `${mentions.length} ${__("documents")}`;

  frappe.show_alert({
    message: ` ${label} will be added as a reference to topic: ${topicTarget.subject || topicTarget.name}`,
    indicator: "blue"
  });
}

mergeTopicReferencesLocally(topicName, mentionDoctypes = []) {
  if (!topicName || !mentionDoctypes.length) return;

  if (!Array.isArray(this.reference_doctypes)) {
    this.reference_doctypes = [];
  }

  mentionDoctypes.forEach((m) => {
    const exists = this.reference_doctypes.some((r) => {
      const rDoctype = r.doctype || r.reference_doctype;
      const rDocname = r.docname || r.reference_docname;

      return rDoctype === m.doctype && rDocname === m.docname;
    });

    if (!exists) {
      this.reference_doctypes.push({
        doctype: m.doctype,
        docname: m.docname
      });
    }
  });

  if (this.messageCache) {
    this.messageCache.forEach((cachedMsg) => {
      if (
        cachedMsg.chat_topic === topicName ||
        cachedMsg.topic === topicName
      ) {
        cachedMsg.reference_doctypes = this.reference_doctypes;
        cachedMsg.references = this.reference_doctypes;
      }
    });
  }

  if (this.topicDetailsCache?.has(topicName)) {
    const cached = this.topicDetailsCache.get(topicName) || {};
    cached.reference_doctypes = this.reference_doctypes;
    cached.references = this.reference_doctypes;
    this.topicDetailsCache.set(topicName, cached);
  }
}

extractDoctypeMentionsFromComposer() {
  const mentions = [];

  const $editor = this.$chat_actions?.find(".type-message .ql-editor");

  if (!$editor || !$editor.length) return mentions;

  $editor.find("span.mention").each(function () {
    const $mention = $(this);

    const isDoctype =
      String($mention.attr("data-is-doctype") || $mention.data("is-doctype") || "") === "1";

    if (!isDoctype) return;

    const doctype =
      $mention.attr("data-doctype") ||
      $mention.data("doctype") ||
      "";

    const docname =
      $mention.attr("data-id") ||
      $mention.data("id") ||
      "";

    if (doctype && docname) {
      mentions.push({ doctype, docname });
    }
  });

  const seen = new Set();
  return mentions.filter((m) => {
    const key = `${m.doctype}::${m.docname}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

showTopicMentionReferenceHint(mentions = []) {
  if (!this.isDedicatedTopicContext?.()) return;

  const $messageSection = this.$chat_actions?.find(".message-section");
  if (!$messageSection?.length) return;

  this.clearTopicMentionReferenceHint();

  if (!mentions || !mentions.length) return;

  const label =
    mentions.length === 1
      ? `${mentions[0].doctype} / ${mentions[0].docname}`
      : `${mentions.length} ${__("references")}`;

  const html = `
    <div class="topic-mention-reference-hint">
      ${__("This mentioned document will be added as a reference to this topic")}:
      <b>${frappe.utils.escape_html(label)}</b>
    </div>
  `;

  $messageSection.append(html);
}

clearTopicMentionReferenceHint() {
  this.$chat_actions?.find(".topic-mention-reference-hint").remove();
}

async addMentionedDoctypesAsTopicReferences(mentions = []) {
  if (!this.isDedicatedTopicContext?.()) return;
  if (!mentions || !mentions.length) return;

  const topicName =
    this.chat_topic_space ||
    this.chat_topic ||
    this.profile?.chat_topic;

  if (!topicName) return;

  for (const mention of mentions) {
    if (!mention.doctype || !mention.docname) continue;

    try {
      const r = await frappe.call({
        method: "clefincode_chat.api.api_1_3_4.api.add_chat_topic_reference",
        args: {
          chat_topic: topicName,
          reference_doctype: mention.doctype,
          reference_docname: mention.docname
        }
      });

      const updated = r.message || {};
      const refs =
        updated.reference_doctypes ||
        updated.references ||
        [];

      if (Array.isArray(refs)) {
        this.reference_doctypes = refs;

        if (this.messageCache) {
          this.messageCache.forEach((cachedMsg) => {
            if (
              cachedMsg.chat_topic === topicName ||
              cachedMsg.topic === topicName
            ) {
              cachedMsg.reference_doctypes = refs;
              cachedMsg.references = refs;
            }
          });
        }
      }
    } catch (e) {
      console.warn("Failed to add mentioned document as topic reference", mention, e);
    }
  }

  this.chat_info?.refreshTopicReferencesSection?.();

  frappe.show_alert({
    message: __("Mentioned document added as topic reference"),
    indicator: "green"
  });
}

applyTopicToRenderedMessage(messageName, topicName, topicSubject = null, topicColor = null) {
  if (!messageName || !topicName || !this.$chat_space) return;

  const color =
    topicColor ||
    this.topicColorMap.get(topicName) ||
    this.getTopicColor(topicName);

  if (topicColor) {
    this.topicColorMap.set(topicName, topicColor);
  }
  const safeSubject = topicSubject || topicName;

  const $msg = this.$chat_space.find(`[data-message-name="${messageName}"]`);
  if (!$msg.length) return;

  $msg
    .addClass("topic-message-item")
    .attr("data-topic-name", topicName)
    .attr("data-topic-subject", safeSubject)
    .attr("data-topic-color", color);

  const $bubble = $msg.find(".message-bubble").first();
  if (!$bubble.length) return;

  $bubble
    .addClass("has-message-topic")
    .attr("data-topic-name", topicName)
    .attr("title", `${__("Topic")}: ${safeSubject}`);

  if (!$bubble.find(".message-topic-bar").length) {
    $bubble.prepend(`
      <div
        class="message-topic-bar"
        style="background:${color};"
        aria-hidden="true"
      ></div>
    `);
  } else {
    $bubble.find(".message-topic-bar").css("background", color);
  }
}

async removeTopicFromMessage(messageName) {
  if (!messageName) return;

  const cached = this.messageCache.get(messageName) || {};
  const oldTopic =
    cached.chat_topic ||
    cached.topic ||
    cached.topic_name ||
    null;

  if (!oldTopic) {
    frappe.show_alert({
      message: __("This message has no linked topic"),
      indicator: "orange"
    });
    return;
  }

  try {
    await frappe.call({
      method: "clefincode_chat.api.api_1_3_4.api.remove_message_topic",
      args: {
        message_name: messageName
      }
    });

    cached.chat_topic = null;
    cached.topic = null;
    cached.topic_name = null;
    cached.chat_topic_subject = null;
    cached.topic_subject = null;
    cached.chat_topic_title = null;
    cached.topic_color = null;
    cached.chat_topic_color = null;
    this.messageCache.set(messageName, cached);

    const $msg = this.$chat_space.find(`[data-message-name="${messageName}"]`);
    const $bubble = $msg.find(".message-bubble").first();

    $msg
      .removeClass("topic-message-item has-message-topic")
      .removeAttr("data-topic-name")
      .removeAttr("data-topic-subject")
      .removeAttr("data-topic-color")
      .css("--topic-color", "");

    $bubble
      .removeClass("has-message-topic")
      .removeAttr("data-topic-name")
      .removeAttr("title");

    $bubble.find(".message-topic-bar").remove();

    this.normalizeTopicSeparators?.();
    this.buildTopicMetaMap?.();
    this.applyTopicVisibility?.();
    this.refreshTopicNavBar?.();

    frappe.show_alert({
      message: __("Topic removed from message"),
      indicator: "green"
    });
  } catch (e) {
    console.error("Failed to remove message topic", e);
    frappe.msgprint({
      title: __("Error"),
      message: __("Failed to remove topic from message."),
      indicator: "red"
    });
  }
}

applyRelinkedTopicToMessages(messageNames = [], topicName, topicSubject = null, topicColor = null) {
  if (!messageNames || !messageNames.length || !topicName) return;

  const subject = topicSubject || topicName;
  const color =
    topicColor ||
    this.topicColorMap.get(topicName) ||
    this.getTopicColor(topicName);

  if (color) {
    this.topicColorMap.set(topicName, color);
  }

  messageNames.forEach((messageName) => {
    if (this.applyTopicToRenderedMessage) {
      this.applyTopicToRenderedMessage(
        messageName,
        topicName,
        subject,
        color
      );
    }

    const cached = this.messageCache.get(messageName) || {};
    cached.chat_topic = topicName;
    cached.chat_topic_subject = subject;
    cached.topic_color = color;
    this.messageCache.set(messageName, cached);

    const $msg = this.$chat_space.find(`[data-message-name="${messageName}"]`);
    if (!$msg.length) return;

    $msg
      .addClass("topic-message-item")
      .attr("data-topic-name", topicName)
      .attr("data-topic-subject", subject)
      .attr("data-topic-color", color)
      .css("--topic-color", color);

    const $bubble = $msg.find(".message-bubble").first();

    if ($bubble.length) {
      $bubble
        .addClass("has-message-topic")
        .attr("data-topic-name", topicName)
        .attr("title", `${__("Topic")}: ${subject}`);

      if (!$bubble.find(".message-topic-bar").length) {
        $bubble.prepend(`
          <div
            class="message-topic-bar"
            style="background:${frappe.utils.escape_html(color || "")};"
            aria-hidden="true"
          ></div>
        `);
      } else {
        $bubble.find(".message-topic-bar").css("background", color);
      }
    }
  });

  if (this.buildTopicMetaMap) {
    this.buildTopicMetaMap();
  }

  if (this.refreshTopicNavBar) {
    this.refreshTopicNavBar();
  }

  this.normalizeTopicSeparators();

  if (this.applyTopicVisibility) {
    this.applyTopicVisibility();
  }
}

insertTopicSeparatorBeforeMessage(messageName, topicName, topicSubject = null, topicColor = null) {
  const $msg = this.$chat_space.find(`[data-message-name="${messageName}"]`);
  if (!$msg.length || !topicName) return;
  if (this.isDedicatedTopicContext?.()) return;

  const $prev = $msg.prev();

  if (
    $prev.hasClass("chat-topic-separator") &&
    $prev.attr("data-topic-name") === topicName
  ) {
    return;
  }

  const html = this.makeTopicStartSeparatorHtml
    ? this.makeTopicStartSeparatorHtml(topicName, topicSubject || topicName, topicColor)
    : "";

  if (html) {
    $msg.before(html);
  }
}

normalizeTopicSeparators() {
  if (!this.$chat_space_container || !this.$chat_space_container.length) return;

  if (this.isDedicatedTopicContext?.()) {
    this.$chat_space_container.find(".chat-topic-separator, .topic-start-separator").remove();
    return;
  }

  const $container = this.$chat_space_container;

  $container.find(".chat-topic-separator:not(.topic-system-separator)").remove();

  const seenTopics = new Set();

  $container.find(".topic-system-separator[data-topic-name]").each((_, el) => {
    const topicName = $(el).attr("data-topic-name");
    if (topicName) {
      seenTopics.add(topicName);
    }
  });

  $container.find(".topic-message-item[data-topic-name]").each((_, el) => {
    const $msg = $(el);
    const topicName = $msg.attr("data-topic-name");

    if (!topicName || seenTopics.has(topicName)) return;

    const messageType = String($msg.attr("data-message-type") || "").toLowerCase();
    const templateType = String($msg.attr("data-message-template-type") || "").toLowerCase();

    if (
      messageType === "information" ||
      templateType === "set topic" ||
      templateType === "set-topic" ||
      templateType === "settopic"
    ) {
      return;
    }

    seenTopics.add(topicName);

    const topicSubject = $msg.attr("data-topic-subject") || topicName;
    const topicColor =
      $msg.attr("data-topic-color") ||
      this.topicColorMap?.get(topicName) ||
      this.getTopicColor(topicName);

    const html = this.makeTopicStartSeparatorHtml
      ? this.makeTopicStartSeparatorHtml(topicName, topicSubject, topicColor)
      : "";

    if (html) {
      $msg.before(html);
    }
  });
}

normalizeTopicSubject(value, fallback = "") {
  if (value == null) return String(fallback || "");

  if (typeof value === "string" || typeof value === "number") {
    return String(value).replace(/"/g, "");
  }

  if (typeof value === "object") {
    return String(
      value.chat_topic_subject ||
      value.subject ||
      value.topic_subject ||
      value.name ||
      value.chat_topic ||
      fallback ||
      ""
    ).replace(/"/g, "");
  }

  return String(value || fallback || "").replace(/"/g, "");
}

formatTopicSeparatorSubject(topicSubject, topicName = "") {
  let subject = String(topicSubject || topicName || "").trim();
  subject = subject.replace(/^topic\s*:\s*/i, "").trim();
  return subject || String(topicName || "").trim();
}

// ================= Topic Helpers =================

getActiveTopicMeta() {
  if (!this.activeMessageTopic) return null;
  return this.allKnownTopicMetaMap.get(this.activeMessageTopic) || this.topicMetaMap.get(this.activeMessageTopic) || null;
}

buildTopicMetaMap() {
  this.topicMetaMap.clear();

  const $items = this.$chat_space_container
    ? this.$chat_space_container.find(".topic-message-item[data-topic-name]")
    : $();

  $items.each((i, el) => {
    const $el = $(el);
    const name = $el.attr("data-topic-name");
    if (!name) return;

    const subject = $el.attr("data-topic-subject") || name;
    const color = $el.attr("data-topic-color") || this.getTopicColor(name);
    const sendDate = $el.attr("data-send-date") || "";
    const index = i;

    if (!this.topicMetaMap.has(name)) {
      this.topicMetaMap.set(name, {
        name,
        subject,
        color,
        count: 0,
        latestIndex: index,
        latestDate: sendDate,
      });
    }

    const meta = this.topicMetaMap.get(name);
    meta.count += 1;
    if (index > meta.latestIndex) {
      meta.latestIndex = index;
    }
    if (sendDate && sendDate > (meta.latestDate || "")) {
      meta.latestDate = sendDate;
    }
  });

  this.topicMetaMap.forEach((value, key) => {
    if (!this.allKnownTopicMetaMap.has(key)) {
      this.allKnownTopicMetaMap.set(key, { ...value });
    } else {
      const existing = this.allKnownTopicMetaMap.get(key);
      existing.count = Math.max(existing.count, value.count);
      if (value.latestDate > (existing.latestDate || "")) {
        existing.latestDate = value.latestDate;
      }
      if (value.latestIndex > (existing.latestIndex || 0)) {
        existing.latestIndex = value.latestIndex;
      }
    }
  });
}

getSortedTopics() {
  const topics = Array.from(this.topicMetaMap.values());
  topics.sort((a, b) => {
    const dateA = a.latestDate || "";
    const dateB = b.latestDate || "";
    if (dateA && dateB) return dateB.localeCompare(dateA);
    if (dateA) return -1;
    if (dateB) return 1;
    return b.latestIndex - a.latestIndex;
  });
  return topics;
}

applyTopicVisibility() {
  if (!this.$chat_space_container || !this.$chat_space_container.length) return;

  this.$chat_space_container.find(".topic-message-item").each((_, el) => {
    const $el = $(el);
    const topicName = $el.attr("data-topic-name") || "";
    const isCollapsed = this.collapsedTopics.has(topicName);

    let visible = true;

    if (isCollapsed) {
      visible = false;
    }

    $el.toggle(visible);
  });

  this.$chat_space_container.find(".chat-topic-separator[data-topic-name]").each((_, el) => {
    const $sep = $(el);
    const topicName = $sep.attr("data-topic-name") || "";
    const isCollapsed = this.collapsedTopics.has(topicName);

    let visible = true;

    if (this.activeTopicFilter) {
      visible = topicName === this.activeTopicFilter;
    }

    if (isCollapsed) {
      visible = false;
    }

    $sep.toggle(visible);
  });
}

// ================= Plus Menu =================

togglePlusMenu() {
  if (this.$plusMenu && this.$plusMenu.length && this.$plusMenu.is(":visible")) {
    this.closePlusMenu();
  } else {
    this.openPlusMenu();
  }
}

openPlusMenu() {
  this.closeTopicSelectPopup();
  if (!this.$chat_actions) return;

  this.$plusMenu = this.$chat_actions.find(".chat-plus-menu");
  if (!this.$plusMenu.length) return;

  const $removeBtn = this.$plusMenu.find(".chat-plus-remove-topic");
  $removeBtn.toggle(this.activeMessageTopic != null);

  this.$plusMenu.show();
}

closePlusMenu() {
  if (this.$plusMenu && this.$plusMenu.length) {
    this.$plusMenu.hide();
  }
}

// ================= Topic Select Popup =================

async openTopicSelectPopup() {
  this.closeTopicSelectPopup();
  if (!this.$chat_actions || !this.$chat_actions.length) return;

  this.$topicSelectPopup = $(`
    <div class="topic-select-panel">
      <input class="topic-select-search" placeholder="${__("Search topics...")}" />
      <div class="topic-select-list"></div>
    </div>
  `);

  this.$chat_actions.append(this.$topicSelectPopup);

  await this.loadChannelTopicsForSelect();
  this.renderTopicSelectList("");

  setTimeout(() => {
    this.$topicSelectPopup.find(".topic-select-search").focus();
  }, 0);
}

closeTopicSelectPopup() {
  if (this.$topicSelectPopup) {
    this.$topicSelectPopup.remove();
    this.$topicSelectPopup = null;
  }
}

// ================= All Topics Full Page View =================

openAllTopicsView() {
  this.closeAllTopicsView();
  if (!this.$chat_space || !this.$chat_space.length) return;

  const $existing = this.$chat_space.find(".all-topics-view");
  if ($existing.length) return;

  this.$allTopicsView = $(`
    <div class="all-topics-view">
      <div class="all-topics-header">
        <button type="button" class="all-topics-back" title="${__("Back")}">
          ${frappe.utils.icon("arrow-left", "sm") || "←"}
        </button>
        <input class="all-topics-search" placeholder="${__("Search all topics...")}" />
      </div>
      <div class="all-topics-list"></div>
      <div class="all-topics-loading" style="display:none;">${__("Loading...")}</div>
    </div>
  `);

  this.$chat_space.append(this.$allTopicsView);

  this._allTopicsState = {
    topics: [],
    offset: 0,
    limit: 20,
    totalCount: 0,
    hasMore: true,
    loading: false,
    query: ''
  };

  this.loadMoreAllTopics();

  setTimeout(() => {
    this.$allTopicsView.find(".all-topics-search").focus();
  }, 0);
}

closeAllTopicsView() {
  if (this.$allTopicsView) {
    this.$allTopicsView.remove();
    this.$allTopicsView = null;
  }
  this._allTopicsState = {
    topics: [],
    offset: 0,
    limit: 20,
    totalCount: 0,
    hasMore: true,
    loading: false,
    query: ''
  };
}

renderAllTopicsList() {
  if (!this.$allTopicsView) return;

  const $list = this.$allTopicsView.find(".all-topics-list");
  const $loading = this.$allTopicsView.find(".all-topics-loading");
  const query = (this._allTopicsState.query || "").toLowerCase();

  let displayTopics = this._allTopicsState.topics;
  if (query) {
    displayTopics = displayTopics.filter((topic) => {
      const name = String(topic.name || "").toLowerCase();
      const subject = String(topic.subject || "").toLowerCase();
      return name.includes(query) || subject.includes(query);
    });
  }

  if (!displayTopics.length) {
    $list.html(`<div class="all-topics-empty">${__("No topics found")}</div>`);
    $loading.hide();
    return;
  }

  $list.html(displayTopics.map((topic) => this.makeTopicSelectRowHtml(topic)).join(""));
  $loading.hide();
}

async loadMoreAllTopics() {
  if (this._allTopicsState.loading || !this._allTopicsState.hasMore) return;
  this._allTopicsState.loading = true;

  const $list = this.$allTopicsView ? this.$allTopicsView.find(".all-topics-list") : null;
  const $loading = this.$allTopicsView ? this.$allTopicsView.find(".all-topics-loading") : null;
  if ($loading && $loading.length) $loading.show();

  try {
    const chatChannel = this.getCurrentChatChannel();
    if (!chatChannel) {
      this._allTopicsState.loading = false;
      if ($loading && $loading.length) $loading.hide();
      return;
    }

    const r = await frappe.call({
      method: "clefincode_chat.api.api_1_3_4.api.get_channel_topics",
      args: {
        chat_channel: chatChannel,
        topic_status: "All",
        limit: this._allTopicsState.limit,
        offset: this._allTopicsState.offset
      }
    });

    const topics = r.message?.topics || [];
    const totalCount = r.message?.total_count || 0;

    let newRowsHtml = '';
    topics.forEach((topic) => {
      const name = topic.name;
      if (!name) return;
      const subject = topic.subject || topic.chat_topic_subject || name;
      const dbColor = topic.topic_color || topic.color || null;
      const color = this.getTopicColor(name, dbColor);

      const existing = this.allKnownTopicMetaMap.get(name) || {};
      this.allKnownTopicMetaMap.set(name, {
        ...existing,
        name,
        subject,
        color,
        topic_color: color,
        topic_status: topic.topic_status || existing.topic_status || "Open",
        status: topic.topic_status || existing.status || "Open",
        count: existing.count || 0,
        latestIndex: existing.latestIndex ?? -1,
        latestDate: existing.latestDate || topic.modified || topic.creation || ""
      });

      if (dbColor) {
        this.topicColorMap.set(name, dbColor);
      }

      if (!this._allTopicsState.topics.some(t => t.name === name)) {
        this._allTopicsState.topics.push({
          name,
          subject,
          color,
          topic_color: color,
          count: topic.references_count || 0,
          latestDate: topic.modified || topic.creation || ""
        });
        newRowsHtml += this.makeTopicSelectRowHtml({
          name, subject, color, topic_color: color,
          count: topic.references_count || 0
        });
      }
    });

    this._allTopicsState.offset += topics.length;
    this._allTopicsState.totalCount = totalCount;
    this._allTopicsState.hasMore = this._allTopicsState.offset < totalCount;

    if ($list && $list.length) {
      const query = (this._allTopicsState.query || "").toLowerCase();
      if (query) {
        this.renderAllTopicsList();
      } else {
        if (newRowsHtml) {
          const $empty = $list.find(".all-topics-empty");
          if ($empty.length) $empty.replaceWith(newRowsHtml);
          else $list.append(newRowsHtml);
        }
        if (!this._allTopicsState.topics.length) {
          $list.html(`<div class="all-topics-empty">${__("No topics found")}</div>`);
        }
      }
    }
  } catch (e) {
    console.warn("Failed to load more topics", e);
  }

  this._allTopicsState.loading = false;
  if ($loading && $loading.length) $loading.hide();
}

renderTopicSelectList(query = "") {
  if (!this.$topicSelectPopup) return;

  let topicSource;
  if (this.allKnownTopicMetaMap.size > 0) {
    topicSource = Array.from(this.allKnownTopicMetaMap.values());
  } else {
    this.buildTopicMetaMap();
    topicSource = Array.from(this.topicMetaMap.values());
  }

  topicSource.sort((a, b) => {
    const dateA = a.latestDate || "";
    const dateB = b.latestDate || "";
    if (dateA && dateB) return dateB.localeCompare(dateA);
    if (dateA) return -1;
    if (dateB) return 1;
    return (b.latestIndex || 0) - (a.latestIndex || 0);
  });

  const lowerQuery = String(query).toLowerCase();

  const filtered = topicSource.filter((topic) => {
    const status = String(topic.topic_status || topic.status || topic.chat_topic_status || "").toLowerCase();
    if (status === "closed") return false;

    if (!lowerQuery) return true;
    return (
      String(topic.name).toLowerCase().includes(lowerQuery) ||
      String(topic.subject).toLowerCase().includes(lowerQuery)
    );
  });

  const $list = this.$topicSelectPopup.find(".topic-select-list");
  if (!$list.length) return;

  if (!filtered.length) {
    $list.html(`<div class="topic-select-empty">${__("No topics found")}</div>`);
    return;
  }

  const DISPLAY_LIMIT = 6;
  const displayItems = filtered.slice(0, DISPLAY_LIMIT);
  const hasMore = filtered.length > DISPLAY_LIMIT;

  let html = displayItems.map((topic) => this.makeTopicSelectRowHtml(topic)).join("");
  if (hasMore) {
    html += `<button type="button" class="topic-select-see-more">${__("See more")}</button>`;
  }
  $list.html(html);
}

makeTopicSelectRowHtml(topic) {
  const safeName = frappe.utils.escape_html(String(topic.name));
  const safeSubject = frappe.utils.escape_html(String(topic.subject));
  const realColor =
  topic.topic_color ||
  topic.color ||
  this.topicColorMap.get(topic.name) ||
  this.getTopicColor(topic.name);

  const safeColor = frappe.utils.escape_html(String(realColor || ""));
  const isActive = this.activeMessageTopic === String(topic.name);

  return `
    <div class="topic-select-row${isActive ? " is-active" : ""}" data-topic-name="${safeName}">
      <button type="button" class="topic-select-main" data-topic-name="${safeName}" data-topic-subject="${safeSubject}" data-topic-color="${safeColor}">
        <span class="topic-dot" style="background:${safeColor};"></span>
        <span class="topic-select-title">${safeSubject}</span>
        <span class="topic-select-count">${topic.count || ""}</span>
      </button>
      <button type="button" class="topic-select-open" data-topic-name="${safeName}" data-topic-subject="${safeSubject}" title="${__("Open in new window")}">↗</button>
    </div>
  `;
}

async loadChannelTopicsForSelect() {
  const chatChannel = this.getCurrentChatChannel();
  if (!chatChannel) return;

  try {
    const r = await frappe.call({
      method: "clefincode_chat.api.api_1_3_4.api.get_channel_topics",
      args: {
        chat_channel: chatChannel,
        topic_status: "Open"
      }
    });

    const topics = r.message?.topics || [];
    topics.forEach((topic) => {
      const name = topic.name;
      if (!name) return;
      const subject = topic.subject || topic.chat_topic_subject || name;
      
      const dbColor = topic.topic_color || topic.color || null;
      const color = this.getTopicColor(name, dbColor);

      const existing = this.allKnownTopicMetaMap.get(name) || {};

      this.allKnownTopicMetaMap.set(name, {
        ...existing,
        name,
        subject,
        color,
        topic_color: color,
        topic_status: topic.topic_status || existing.topic_status || "Open",
        status: topic.topic_status || existing.status || "Open",
        count: existing.count || 0,
        latestIndex: existing.latestIndex ?? -1,
        latestDate: existing.latestDate || topic.modified || topic.creation || ""
      });

      if (dbColor) {
        this.topicColorMap.set(name, dbColor);
      }
    });
  } catch (e) {
    console.warn("Failed to load channel topics for select", e);
  }
}

// ================= Active Message Topic =================

setActiveMessageTopic(topicName, topicSubject) {
  this.activeMessageTopic = topicName || null;
  this.activeMessageTopicSubject = topicSubject || topicName || null;

  this.updateActiveTopicButton(this.activeMessageTopic);

  const $removeBtn = this.$chat_actions.find(".chat-plus-remove-topic");
  if ($removeBtn.length) {
    $removeBtn.toggle(this.activeMessageTopic != null);
  }
}

clearActiveMessageTopic() {
  this.activeMessageTopic = null;
  this.activeMessageTopicSubject = null;

  this.updateActiveTopicButton(null);

  const $removeBtn = this.$chat_actions.find(".chat-plus-remove-topic");
  if ($removeBtn.length) {
    $removeBtn.hide();
  }

  frappe.show_alert({
    message: __("Topic removed from new messages"),
    indicator: "green"
  });
}

selectMessageTopic(topicName, topicSubject = null, opts = {}) {
  if (!topicName) return;

  const key = String(topicName);
  const subject = topicSubject || key;
  const color = opts.topic_color || opts.color || this.topicColorMap.get(key) || this.getTopicColor(key);

  this.activeMessageTopic = key;
  this.activeMessageTopicSubject = subject;
  this.activeMessageTopicColor = color;

  if (color) {
    this.topicColorMap.set(key, color);
  }

  this.updatePlusTopicButton();

  const $removeBtn = this.$chat_actions?.find(".chat-plus-remove-topic");
  if ($removeBtn?.length) {
    $removeBtn.show();
  }

  // if (opts.scroll !== false) {
  //   setTimeout(() => {
  //     if (this.scrollToFirstRealTopicMessage) {
  //       this.scrollToFirstRealTopicMessage(key);
  //     } else {
  //       this.scrollToTopicStart(key);
  //     }
  //   }, 80);
  // }
}

clearMessageTopic(showAlert = true) {
  this.activeMessageTopic = null;
  this.activeMessageTopicSubject = null;
  this.activeMessageTopicColor = null;
  this.updatePlusTopicButton();

  const $removeBtn = this.$chat_actions?.find(".chat-plus-remove-topic");
  if ($removeBtn?.length) {
    $removeBtn.hide();
  }

  if (showAlert) {
    frappe.show_alert({
      message: __("Topic removed from new messages"),
      indicator: "green"
    });
  }
}

clearClosedTopicUi(topicName = null) {
  const closedTopic = topicName ? String(topicName) : null;

  this.clearMessageTopic(false);
  this.chat_topic = null;
  this.chat_topic_subject = null;
  this.chat_topic_status = "Closed";
  this.reference_doctypes = [];
  this.updateActiveTopicButton(null);
  this.updatePlusTopicButton?.();

  if (closedTopic && this.activeTopicFilter && String(this.activeTopicFilter) === closedTopic) {
    this.activeTopicFilter = null;
  }

  if (closedTopic && this.collapsedTopics) {
    this.collapsedTopics.delete(closedTopic);
  }

  [this.topicMetaMap, this.allKnownTopicMetaMap].forEach((map) => {
    if (!map || !closedTopic || !map.has(closedTopic)) return;
    const meta = map.get(closedTopic) || {};
    meta.status = "Closed";
    meta.topic_status = "Closed";
    meta.chat_topic_status = "Closed";
    map.set(closedTopic, meta);
  });

  if (closedTopic && this.messageCache) {
    this.messageCache.forEach((cached) => {
      const cachedTopic =
        cached.chat_topic ||
        cached.topic ||
        cached.topic_name ||
        null;

      if (String(cachedTopic || "") !== closedTopic) return;

      cached.chat_topic = null;
      cached.topic = null;
      cached.topic_name = null;
      cached.chat_topic_subject = null;
      cached.topic_subject = null;
      cached.chat_topic_title = null;
      cached.topic_color = null;
      cached.chat_topic_color = null;
    });
  }

  const $root = this.$chat_space_container?.length
    ? this.$chat_space_container
    : this.$chat_space;

  if (closedTopic && $root?.length && !this.isDedicatedTopicContext?.()) {
    const safe = this.escapeSelectorValue(closedTopic);

    $root
      .find(
        `.chat-topic-separator[data-topic-name="${safe}"], ` +
        `.topic-system-separator[data-topic-name="${safe}"], ` +
        `.topic-start-separator[data-topic-name="${safe}"]`
      )
      .remove();

    $root.find(`.topic-message-item[data-topic-name="${safe}"]`).each((_, el) => {
      const $msg = $(el);
      const $bubble = $msg.find(".message-bubble").first();

      $msg
        .removeClass("topic-message-item has-message-topic")
        .removeAttr("data-topic-name")
        .removeAttr("data-topic-subject")
        .removeAttr("data-topic-color")
        .css("--topic-color", "")
        .show();

      $bubble
        .removeClass("has-message-topic")
        .removeAttr("data-topic-name")
        .removeAttr("title");

      $bubble.find(".message-topic-bar").remove();
    });
  }

  this.normalizeTopicSeparators?.();
  this.buildTopicMetaMap?.();
  this.refreshTopicNavBar?.();
  this.applyTopicVisibility?.();

  if (this.$topicSelectPopup?.length) {
    const query = this.$topicSelectPopup.find(".topic-select-search").val() || "";
    this.renderTopicSelectList(query);
  }
}

async saveUserActiveChatTopic(topicName) {
  const chatChannel = this.getCurrentChatChannel?.() ||
    (this.profile.room_type === "Contributor" ? this.profile.parent_channel : this.profile.room);

  if (!chatChannel || !topicName || this.is_topic_window || this.profile.room_type === "Topic") {
    return;
  }

  try {
    await frappe.call({
      method: "clefincode_chat.api.api_1_3_4.api.set_user_active_chat_topic",
      args: {
        chat_channel: chatChannel,
        chat_topic: topicName,
        user_email: this.profile.user_email
      }
    });
  } catch (e) {
    console.warn("Failed to save active chat topic", e);
  }
}

async applySavedActiveTopic() {
  const chatChannel = this.getCurrentChatChannel?.() ||
    (this.profile.room_type === "Contributor" ? this.profile.parent_channel : this.profile.room);

  if (!chatChannel || this.is_topic_window || this.profile.room_type === "Topic" || this.chat_topic_space) {
    return;
  }

  try {
    const r = await frappe.call({
      method: "clefincode_chat.api.api_1_3_4.api.get_user_active_chat_topic",
      args: {
        chat_channel: chatChannel,
        user_email: this.profile.user_email
      }
    });

    const topic = r.message?.results?.[0];

    if (!topic || !topic.chat_topic) {
      return;
    }

    this.selectMessageTopic(
      topic.chat_topic,
      topic.chat_topic_subject || topic.chat_topic,
      {
        scroll: false,
        color: topic.topic_color,
        topic_color: topic.topic_color
      }
    );
  } catch (e) {
    console.warn("Failed to apply saved active topic", e);
  }
}

async clearUserActiveChatTopic(topicName = null) {
  const chatChannel = this.getCurrentChatChannel?.() ||
    (this.profile.room_type === "Contributor" ? this.profile.parent_channel : this.profile.room);

  if (!chatChannel || this.is_topic_window || this.profile.room_type === "Topic") {
    return;
  }

  try {
    await frappe.call({
      method: "clefincode_chat.api.api_1_3_4.api.clear_user_active_chat_topic",
      args: {
        chat_channel: chatChannel,
        chat_topic: topicName,
        user_email: this.profile.user_email
      }
    });
  } catch (e) {
    console.warn("Failed to clear active chat topic", e);
  }
}

getUserActiveTopicEventName() {
  return `user_active_topic:${this.profile.user_email}`;
}

bindUserActiveTopicRealtime() {
  if (!this.profile?.user_email) return;

  const eventName = this.getUserActiveTopicEventName();

  const handler = (res = {}) => {
    this.handleUserActiveTopicRealtime(res);
  };

  this.bindRealtimeChannel(eventName, handler);
}

handleUserActiveTopicRealtime(res = {}) {
  if (!res) return;

  const rt = res.realtime_type;
  if (rt !== "user_active_topic" && !(rt === "close_topic" && res.user_scoped == 1)) return;

  const chatChannel = this.getCurrentChatChannel?.() ||
    (this.profile.room_type === "Contributor" ? this.profile.parent_channel : this.profile.room);

  if (!chatChannel || res.chat_channel !== chatChannel) {
    return;
  }

  if (this.is_topic_window || this.profile.room_type === "Topic") {
    return;
  }

  const action = res.action;
  const topicName = res.chat_topic || res.topic_name || null;

  if (action === "select") {
    if (!topicName) return;

    this.selectMessageTopic(
      topicName,
      res.chat_topic_subject || res.topic_subject || topicName,
      {
        scroll: false,
        color: res.topic_color,
        topic_color: res.topic_color
      }
    );

    return;
  }

  if (action === "clear") {
    if (!topicName || this.activeMessageTopic === topicName) {
      this.clearMessageTopic(false);
      this.updatePlusTopicButton?.();
    }
  }
}

async closeTopicForConversation(chatTopic = null) {
  const chatChannel =
    this.profile?.room_type === "Contributor"
      ? this.profile?.parent_channel
      : this.profile?.room;

  if (!chatChannel) return;

  try {
    const results = await close_chat_topic(
      chatChannel,
      chatTopic,
      this.last_active_sub_channel,
      this.profile?.user_email,
      this.profile?.user
    );
    const closedTopic = results?.[0]?.chat_topic || chatTopic || this.chat_topic || null;

    await this.clearUserActiveChatTopic(closedTopic);
    this.clearClosedTopicUi(closedTopic);

    frappe.show_alert({
      message: __("Topic closed for this conversation"),
      indicator: "green"
    });
  } catch (error) {
    console.error("Failed to close topic", error);
    frappe.show_alert({
      message: __("Could not close topic"),
      indicator: "red"
    });
  }
}

// ================= Scroll to Topic =================

scrollToTopicStart(topicName, opts = {}) {
  if (!topicName || !this.$chat_space_container?.length) {
    return false;
  }

  const key = String(topicName);
  const safe = this.escapeSelectorValue(key);
  const $container = this.$chat_space_container;

  let $target = $container
    .find(`.set-topic[data-topic-name="${safe}"]`)
    .first();

  if (!$target.length) {
    $target = $container
      .find(`.chat-topic-separator[data-topic-name="${safe}"]`)
      .first();
  }

  if (!$target.length) {
    $target = $container
      .find(`.topic-message-item[data-topic-name="${safe}"]`)
      .first();
  }

  if (!$target.length) {
    if (!opts.silent) {
      frappe.show_alert({
        message: __("This topic is not loaded in the current messages."),
        indicator: "orange"
      });
    }
    return false;
  }

  const containerEl = $container[0];
  const targetEl = $target[0];

  const containerRect = containerEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();

  const currentScrollTop = $container.scrollTop();
  const relativeTop = targetRect.top - containerRect.top;
  const targetScrollTop = currentScrollTop + relativeTop - 12;

  $container.stop(true).animate(
    { scrollTop: Math.max(0, targetScrollTop) },
    280
  );

  this.highlightTopicScrollTarget($target);
  return true;
}

highlightTopicScrollTarget($target) {
  if (!$target || !$target.length) return;

  $target.addClass("topic-scroll-highlight");
  setTimeout(() => {
    $target.removeClass("topic-scroll-highlight");
  }, 1600);
}

async scrollToFirstRealTopicMessage(topicName) {
  if (!topicName) return false;

  const messageName = await this.getFirstRealTopicMessageName(topicName);

  if (messageName) {
    await this.jumpToMessage(messageName);
    return true;
  }

  return this.scrollToTopicStart(topicName);
}

async getFirstRealTopicMessageName(topicName) {
  if (!topicName) return null;

  const chatChannel = this.getCurrentChatChannel();

  if (!chatChannel) {
    return null;
  }

  try {
    const r = await frappe.call({
      method: "clefincode_chat.api.api_1_3_4.api.get_first_real_topic_message",
      args: {
        chat_channel: chatChannel,
        chat_topic: topicName,
        user_email: this.profile.user_email
      }
    });

    return (
      r.message?.message_name ||
      r.message?.name ||
      r.message?.result?.message_name ||
      null
    );
  } catch (e) {
    console.warn("Failed to get first real topic message", e);
    return null;
  }
}

  async make_messages_html(messages_list, scroll = 0) {
    if (!this.prevMessage) {
      this.prevMessage = {};
    }
    this.message_html = "";
    for (const element of messages_list) {
      const date_line_html = this.make_date_line_html(
        element.send_date,
        scroll
      );

      const down_arrow_html = this.make_down_arrow_html();

      this.message_html += date_line_html;
      this.message_html += down_arrow_html;

      this.prevMessage = element;

      let message_type = "sender-message";

      if (element.sender_email === this.profile.user_email) {
        message_type = "recipient-message";
      } else if (this.profile.room_type === "Guest") {
        if (this.profile.is_admin === true && element.sender !== "Guest") {
          message_type = "recipient-message";
        }
      }
      if (element.message_type == "information") {
        message_type = "info-message";
      }
      if (element.is_deleted == 1) {
            element.content = `
              <div style="font-style:italic; opacity:0.6;">
                This message was deleted
              </div>
            `;
          }
       this.messageCache.set(element.message_name, {
        sender: element.sender,
        content: element.content,
        send_date: element.send_date || "",
        display_time: get_time(
          element.send_date,
          this.profile.time_zone ? this.profile.time_zone : element.time_zone
        ),
        original_content: element.original_content || null,
        reactions_json: element.reactions_json || null,
        chat_topic: element.chat_topic || element.topic || null,
        chat_topic_subject:
          element.chat_topic_subject ||
          element.topic_subject ||
          element.chat_topic_title ||
          null,
        
        is_link: element.is_link || 0,
        is_edited: element.is_edited ||0,
        is_media: element.is_media || 0,
        is_document: element.is_document || 0,
        is_voice_clip: element.is_voice_clip || 0,
        is_screenshot: element.is_screenshot || 0,
        file_id: element.file_id || null,
        attachment: element.attachment || null,
        message_type: element.message_type || null,
        is_deleted:element.is_deleted || 0,       
        is_forwarded: element.is_forwarded || 0,
        forward_level: element.forward_level || 0,
        reply_preview_type: element.reply_preview_type,
        reply_preview_text: element.reply_preview_text,
        reply_preview_sender: element.reply_preview_sender,
        reply_preview_file_url: element.reply_preview_file_url,
      });
      
      const reply_preview = {
          type: element.reply_preview_type || null,
          text: element.reply_preview_text || null,
          sender: element.reply_preview_sender || null,
          
          file_url: element.reply_preview_file_url || null,
          file: element.reply_preview_file || null,
          original_message_name:  element.reply_to_message || null,
          is_edited: element.is_edited ,
        };

       
        const topicNameForMessage = element.chat_topic || element.topic || null;

        const isSetTopicInfo = this.isSetTopicInfoMessage({
          content: element.content,
          message_template_type: element.message_template_type
        });

        const isRemoveTopicInfo = this.isRemoveTopicInfoMessage({
          content: element.content,
          message_template_type: element.message_template_type
        });

        const isCloseTopicInfo = this.isCloseTopicInfoMessage({
          content: element.content,
          message_template_type: element.message_template_type
        });

        if (isSetTopicInfo || isRemoveTopicInfo || isCloseTopicInfo) {
          const topicNameForSystemMessage =
            element.chat_topic ||
            element.topic ||
            element.topic_name ||
            element.old_chat_topic ||
            element.removed_topic ||
            element.previous_chat_topic ||
            null;

          const topicSubjectForSystemMessage =
            element.chat_topic_subject ||
            element.topic_subject ||
            element.chat_topic_title ||
            element.old_chat_topic_subject ||
            element.removed_topic_subject ||
            element.previous_chat_topic_subject ||
            topicNameForSystemMessage ||
            null;

          const topicColorForSystemMessage = topicNameForSystemMessage
            ? this.getTopicColor(
                topicNameForSystemMessage,
                element.topic_color || element.chat_topic_color || null
              )
            : null;

          if (topicNameForSystemMessage && topicColorForSystemMessage) {
            this.topicColorMap.set(topicNameForSystemMessage, topicColorForSystemMessage);
          }

          const separatorHtml = this.makeTopicSystemSeparatorHtml({
            messageName: element.message_name,
            topicName: topicNameForSystemMessage,
            topicSubject: topicSubjectForSystemMessage,
            topicColor: topicColorForSystemMessage,
            templateType: element.message_template_type,
            sendDate: element.send_date,
            action: isRemoveTopicInfo ? "remove" : "set"
          });

          if (separatorHtml) {
            this.message_html += separatorHtml;
          }

          continue;
        }

        const message_content = await this.make_message({
          content: element.content,
          original_content: element.original_content || null,
          time: get_time(
            element.send_date,
            this.profile.time_zone ? this.profile.time_zone : element.time_zone
          ),
          type: message_type,
          sender: element.sender,
          sender_email: element.sender_email,
          message_name: element.message_name,
          message_template_type: element.message_template_type,
          get_messages: element.get_messages,
          reply_to_message: element.reply_to_message,
          reply_preview,
          is_forwarded: element.is_forwarded,
          is_deleted: element.is_deleted,
          is_edited: element.is_edited,
          reference_doctypes: (this.chat_topic_space && this.reference_doctypes) || null,
          chat_topic: topicNameForMessage,
          chat_topic_subject:
            element.chat_topic_subject ||
            element.topic_subject ||
            element.chat_topic_title ||
            null,
          topic_color: topicNameForMessage ? this.getTopicColor(topicNameForMessage, element.topic_color || element.chat_topic_color || null) : null,
          send_date: element.send_date,
        });
       
        const $messageBubble = message_content.find(".message-bubble");
        
        
     
      let attributeFound = false;
      let file_name = "";
      message_content.find("*").each(function () {
        if ($(this).attr("data-audio") !== undefined) {
          attributeFound = true;
          file_name = $(this).attr("data-audio");
          return false; // Breaks the loop once the attribute is found
        }
      });
      if (attributeFound) {
        let me = this;
        setTimeout(function () {
          let parent = $(
            ".message-bubble .voice-clip-container[data-audio='" +
              file_name +
              "']"
          );
          let element = parent.find("canvas").first();
          me.draw_clip_in_canvas("/private/files/" + file_name, element);
        }, 500);
      }
      this.message_html += message_content.prop("outerHTML");
      
    }
  }

  make_date_line_html(dateObj, scroll = 0) {
    let create_date_line = 0;
    let result = `
          <div class='date-line ${get_date_from_now(
            dateObj,
            "space",
            this.profile.time_zone
          )}'>
              <div class="for_line">
                <span class="left-line"></span>
                <span class="between-lines">
                  ${get_date_from_now(dateObj, "space", this.profile.time_zone)}
                </span>
                <span class="right-line"></span>
              </div>
          </div>
      `;
    const date_line = this.$chat_space_container.find(
      `.${get_date_from_now(dateObj, "space", this.profile.time_zone)}`
    );

    if (scroll == 1 && date_line && date_line.length == 1) {
      create_date_line = 1;
      date_line.remove();
    }
    if ($.isEmptyObject(this.prevMessage)) {
      return result;
    } else if (
      is_date_change(
        dateObj,
        this.prevMessage.send_date,
        this.profile.time_zone
      ) ||
      create_date_line == 1
    ) {
      return result;
    } else {
      return "";
    }
  }

  make_down_arrow_html() {
    return `
      <div class='arrow-button'>
      <button class='arrow'>
        <span data-icon="down" class="btn-ar">
          <svg viewBox="0 0 19 20" height="20" width="19" preserveAspectRatio="xMidYMid meet" class="" version="1.1" x="0px" y="0px"><path fill="currentColor" d="M3.8,6.7l5.7,5.7l5.7-5.7l1.6,1.6l-7.3,7.2L2.2,8.3L3.8,6.7z"></path></svg>
        </span>
      </button>
      </div> `;
  }

  _getPlainTextLength(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    return (div.textContent || div.innerText || "").length;
  }

  async make_message(params) {
    const {
      content,
      time,
      type,
      sender,
      message_name = "",
      message_template_type = null,
      get_messages = null,
      reply_to_message = null ,
      reply_preview = null,
      is_forwarded=0,
      is_deleted=0,
      sender_email,
      is_edited=0,
      original_content= null,
      reference_doctypes = null,
      chat_topic = null,
      chat_topic_subject = null,
        topic_color = null,
      send_date = null,
    } = params;
    const $recipient_element = $(document.createElement("div"))
      .addClass(type)
      .attr("data-message-name", message_name)
      .attr("data-message-type", type || "")
      .attr("data-message-template-type", message_template_type || "")
      .attr("id", `msg-${message_name}`);
    if (chat_topic) {
      const topicSubject = chat_topic_subject || chat_topic;
      $recipient_element
        .attr("data-topic-name", chat_topic)
        .attr("data-topic-subject", topicSubject)
        .attr("data-topic-color", topic_color || this.getTopicColor(chat_topic))
        .attr("data-send-date", send_date || "")
        .addClass("topic-message-item");
    }

    const isSetTopic = this.isSetTopicInfoMessage({
      content,
      message_template_type
    });

    if (isSetTopic && chat_topic) {
      const color = topic_color || this.getTopicColor(chat_topic);
      $recipient_element
        .addClass("set-topic")
        .attr("data-topic-name", chat_topic)
        .attr("data-topic-subject", chat_topic_subject || chat_topic)
        .css("--topic-color", color);
    }
    const $message_element = $(document.createElement("div"))
        .addClass("message-bubble")
        .css("position", "relative");
              const $selectionCheckbox = $(`
        <label class="message-select-checkbox" aria-label="Select message">
          <input type="checkbox" tabindex="-1" />
          <span class="message-select-checkbox-ui"></span>
        </label>
      `);
    const $reactHoverBtn = $(`
      <button type="button" class="react-hover-btn" aria-label="React">
        😊
      </button>
    `);

    const $name_element = $(document.createElement("div"))
      .addClass("message-name")
      .text(sender);

    let $sanitized_content = __($("<div>").html(content));
    if (type === "sender-message") {
      $message_element.append($name_element);
    
    }
    
    // ================= Forwarded Label =================
        const forwarded = (Number(is_forwarded) === 1);
       if (forwarded && !is_deleted) {
          let forwarded_text = "↪ Forwarded";


          const $forwarded_label = $(`
            <div class="forwarded-label" style="
              font-size:11px;
              opacity:0.7;
              margin-bottom:4px;
              user-select:none;
            ">
              ${forwarded_text}
            </div>
          `);

          $message_element.append($forwarded_label);
        }

        let $contentToAppend = $sanitized_content;

        if (
          !is_deleted &&
          type !== "info-message" &&
          this._getPlainTextLength(content) > 300
        ) {
          const cacheEntry = this.messageCache.get(message_name);
          const isTextOnly =
            !cacheEntry ||
            (!cacheEntry.is_media &&
              !cacheEntry.is_document &&
              !cacheEntry.is_voice_clip &&
              !cacheEntry.is_screenshot &&
              !cacheEntry.attachment);

          if (isTextOnly) {
            const $wrapper = $(
              '<div class="message-text-body long-message-body" data-read-more-step="0">'
            );
            $wrapper.append($sanitized_content.contents());
            $contentToAppend = $wrapper;
          }
        }

        $message_element.append($contentToAppend);
        if ($contentToAppend.is(".long-message-body")) {
          const $readMoreBtn = $(
            '<button type="button" class="chat-read-more-btn">' +
              __("Read more") +
              "</button>"
          );
          $message_element.append($readMoreBtn);
        }

// ================= Message Topic Badge =================
if (chat_topic && !is_deleted) {
  const color = topic_color || this.getTopicColor(chat_topic);
  const safeTitle = frappe.utils.escape_html(
    chat_topic_subject || chat_topic || __("Topic")
  );

  $message_element
    .addClass("has-message-topic")
    .attr("data-topic-name", chat_topic)
    .attr("title", `${__("Topic")}: ${safeTitle}`);

  $message_element.prepend(`
    <div
      class="message-topic-bar"
      style="background:${color};"
      aria-hidden="true"
    ></div>
  `);
}
// if (chat_topic) {
//   const safeTitle = frappe.utils.escape_html(
//     chat_topic_subject || chat_topic || __("Topic")
//   );

//   const tagIcon = `
//     <svg class="icon icon-md message-topic-badge__icon" aria-hidden="true">
//       <use href="#icon-tag"></use>
//     </svg>
//   `;

//   const $topicBadge = $(`
//     <button
//       type="button"
//       class="message-topic-badge"
//       title="${__('Topic')}: ${safeTitle}"
//       aria-label="${__('Topic')}"
//     >
//       ${tagIcon}
//     </button>
//   `);

//   $message_element.addClass("has-topic-badge");
//   $message_element.append($topicBadge);
// }
    // ================= Doctype Badge for Topic Messages =================
        
// ===================================================
    if (is_edited && !is_deleted) {
      $message_element.append(`
        <div class="edited-label" style="
          font-size:11px;
          opacity:0.6;
          margin-top:4px;
        ">
          Edited
        </div>
      `);
    }
    
   

if (reply_to_message && !is_deleted ) {

  let original = this.messageCache.get(reply_to_message);

  if (!original) {
      const msg = await this.fetch_single_message(reply_to_message);
      if (msg) {
        original = {
          sender: msg.sender,
          content: msg.content,
          is_deleted: msg.is_deleted || 0,
          
        };
        this.messageCache.set(reply_to_message, original);
      } else {
        original = { is_deleted: 1 };  
      }
    }
      const p = reply_preview || {};
  const previewSender = (p.sender || "").trim();
  let previewText = (p.text || "").trim();
  const previewType = (p.type || "").trim(); // text/image/video/document/voice
  const thumbUrl = p.file_url || null;

  const senderLabel = previewSender ? frappe.utils.escape_html(previewSender) : "…";
  
    if (original.is_deleted === 1) {
      previewText="This message was deleted";
        
    }

const textLabel = previewText
    ? frappe.utils.escape_html(previewText)
    : (previewType ? `[${previewType}]` : "Loading…");

  const showThumb = !!thumbUrl && (previewType === "image" || previewType === "video");
  const thumbHTML = showThumb
    ? `
      <div class="reply-thumb-wrap" style="width:36px;height:36px;flex:0 0 36px;border-radius:4px;overflow:hidden;position:relative;">
        <img src="${thumbUrl}" style="width:100%;height:100%;object-fit:cover;display:block;" />
        ${previewType === "video" ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;text-shadow:0 0 3px rgba(0,0,0,.6);">▶</span>` : ``}
      </div>
    `
    : ``;

  const icon = previewType === "video" ? "🎬" :
               previewType === "image" ? "🖼️" :
               previewType === "document" ? "📄" :
               previewType === "voice" ? "🎤" : "↩";

  const isDark = document.documentElement.getAttribute("data-theme-mode") === "dark";
  

  const bg = isDark ? "transparent" : "#f1f3f5";


  $message_element.prepend(`
    <div class="reply-link" data-jump="${reply_to_message}" style="
      border-left:3px solid #0d6efd;
      background:${bg};
      padding:6px 8px;
      margin-bottom:6px;
      border-radius:6px;
      cursor:pointer;
      font-size:12px;
      display:flex;
      gap:8px;
      align-items:center;
      max-width:235px;
    ">
      ${thumbHTML}
      <div style="min-width:0;flex:1;">
        <div class="reply-sender" style="font-weight:600; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
           ${senderLabel}
        </div>
        <div class="reply-text" style="opacity:0.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${textLabel}
        </div>
      </div>
    </div>
  `);

  if (!reply_preview || (!reply_preview.text && !reply_preview.type && !reply_preview.file_url)) {
    this.pendingReplies.push({ host_message: message_name, reply_message: reply_to_message });
  }
}
  const isDark = document.documentElement.dataset.themeMode === "dark";
  const forwardIcon = isDark
  ? "/assets/clefincode_chat/icons/forward.png"
  : "/assets/clefincode_chat/icons/forward.svg";

const deleteIcon = isDark
  ? "/assets/clefincode_chat/icons/delete.png"
  : "/assets/clefincode_chat/icons/delete.svg";
    // Forward button (hidden by default)
const isMyMessage = sender_email === this.profile.user_email;

const isTextOnly =
  !is_deleted &&
  !this.messageCache.get(message_name)?.is_media &&
  !this.messageCache.get(message_name)?.is_document &&
  !this.messageCache.get(message_name)?.is_voice_clip &&
  !this.messageCache.get(message_name)?.attachment;

const $menuTrigger = $(`
  <button type="button" class="message-menu-trigger" aria-label="Message actions">
    <svg viewBox="0 0 19 20" width="16" height="16" preserveAspectRatio="xMidYMid meet">
      <path fill="currentColor" d="M3.8,6.7l5.7,5.7l5.7-5.7l1.6,1.6l-7.3,7.2L2.2,8.3L3.8,6.7z"></path>
    </svg>
  </button>
`);

$menuTrigger.attr("data-message-name", message_name);
$menuTrigger.attr("data-is-my-message", isMyMessage ? "1" : "0");
$menuTrigger.attr("data-is-text-only", isTextOnly ? "1" : "0");

if (!is_deleted && type !== "info-message") {
  $message_element.append($menuTrigger);
}
  if (!is_deleted && type !== "info-message") {
    $message_element.append($reactHoverBtn);
  }
      if (type !== "info-message") {
    $message_element.append($selectionCheckbox);
}
    $recipient_element.append($message_element);
    if (type == "info-message") {
      if (message_template_type == "Create Group") {
        const sender_email = $sanitized_content
          .find(".sender-user")
          .attr("data-user");
        if (sender_email == this.profile.user_email) {
          $sanitized_content.find(".sender-user").html("You");
        } else {
          const sender_name = await get_profile_full_name(sender_email);
          $sanitized_content.find(".sender-user").html(sender_name);
        }
        // =================== Handling with information messages ========================
      } else if (message_template_type == "Add User") {
        const sender_email = $sanitized_content
          .find(".sender-user")
          .attr("data-user");
        const receiver_email = $sanitized_content
          .find(".receiver-user")
          .attr("data-user")
          .split(", ");

        if (sender_email == this.profile.user_email) {
          $sanitized_content.find(".sender-user").html("You");
        } else {
          const sender_name = await get_profile_full_name(sender_email);
          $sanitized_content.find(".sender-user").html(sender_name);
        }

        if (receiver_email.includes(this.profile.user_email)) {
          const index = receiver_email.indexOf(this.profile.user_email);
          if (index !== -1) {
            receiver_email[index] = "you";
          }
          let usernames = [];
          usernames = await Promise.all(
            receiver_email.map(async (email) => {
              if (email !== "you") {
                return await get_profile_full_name(email.trim());
              }
              return email;
            })
          );
          const you_index = usernames.indexOf("you");
          if (you_index !== -1) {
            const you_element = usernames.splice(you_index, 1);
            usernames.unshift(you_element);
          }
          $sanitized_content.find(".receiver-user").html(usernames.join(", "));
        } else {
          let usernames = [];
          usernames = await Promise.all(
            receiver_email.map(async (email) => {
              return await get_profile_full_name(email.trim());
            })
          );
          $sanitized_content.find(".receiver-user").html(usernames.join(", "));
        }
      }
      // ===========================================
      else if (message_template_type == "Remove User") {
        const sender_email = $sanitized_content
          .find(".sender-user")
          .attr("data-user");
        const receiver_email = $sanitized_content
          .find(".receiver-user")
          .attr("data-user");

        if (sender_email == this.profile.user_email) {
          $sanitized_content.find(".sender-user").html("You");
        } else {
          const sender_name = await get_profile_full_name(sender_email);
          $sanitized_content.find(".sender-user").html(sender_name);
        }

        if (receiver_email == this.profile.user_email) {
          $sanitized_content.find(".receiver-user").html("you");
        } else {
          const receiver_name = await get_profile_full_name(receiver_email);
          $sanitized_content.find(".receiver-user").html(receiver_name);
        }
      }
      // ===========================================
      else if (message_template_type == "User Left") {
        const sender_email = $sanitized_content
          .find(".sender-user")
          .attr("data-user");
        if (sender_email == this.profile.user_email) {
          $sanitized_content.find(".sender-user").html("You");
        } else {
          const sender_name = await get_profile_full_name(sender_email);
          $sanitized_content.find(".sender-user").html(sender_name);
        }
      }
      // ===========================================
      else if (message_template_type == "Rename Group") {
        const sender_email = $sanitized_content
          .find(".sender-user")
          .attr("data-user");
        if (sender_email == this.profile.user_email) {
          $sanitized_content.find(".sender-user").html("You");
        } else {
          const sender_name = await get_profile_full_name(sender_email);
          $sanitized_content.find(".sender-user").html(sender_name);
        }
      }
      // ===========================================
      else if (message_template_type == "Set Topic") {
        const sender_email = $sanitized_content
          .find(".sender-user")
          .attr("data-user");
        if (sender_email == this.profile.user_email) {
          $sanitized_content.find(".sender-user").html("You");
        } else {
          const sender_name = await get_profile_full_name(sender_email);
          $sanitized_content.find(".sender-user").html(sender_name);
        }
      }
      // ===========================================
      else if (message_template_type == "Add Doctype") {
        const sender_email = $sanitized_content
          .find(".sender-user")
          .attr("data-user");
        if (sender_email == this.profile.user_email) {
          $sanitized_content.find(".sender-user").html("You");
        } else {
          const sender_name = await get_profile_full_name(sender_email);
          $sanitized_content.find(".sender-user").html(sender_name);
        }
      }
      // ===========================================
      else if (message_template_type == "Remove Topic") {
        const sender_email = $sanitized_content
          .find(".sender-user")
          .attr("data-user");
        if (sender_email == this.profile.user_email) {
          $sanitized_content.find(".sender-user").html("You");
        } else {
          const sender_name = await get_profile_full_name(sender_email);
          $sanitized_content.find(".sender-user").html(sender_name);
        }
      }
      // ===========================================
      else if (message_template_type == "Close Topic") {
        const sender_email = $sanitized_content
          .find(".sender-user")
          .attr("data-user");
        if (sender_email == this.profile.user_email) {
          $sanitized_content.find(".sender-user").html("You");
        } else {
          const sender_name = await get_profile_full_name(sender_email);
          $sanitized_content.find(".sender-user").html(sender_name);
        }
      }
      // ===========================================
      else if (message_template_type == "Remove Doctype") {
        const sender_email = $sanitized_content
          .find(".sender-user")
          .attr("data-user");
        if (sender_email == this.profile.user_email) {
          $sanitized_content.find(".sender-user").html("You");
        } else {
          const sender_name = await get_profile_full_name(sender_email);
          $sanitized_content.find(".sender-user").html(sender_name);
        }
      }
      // ===========================================
      else if (message_template_type == "Rename Topic") {
        const sender_email = $sanitized_content
          .find(".sender-user")
          .attr("data-user");
        if (sender_email == this.profile.user_email) {
          $sanitized_content.find(".sender-user").html("You");
        } else {
          const sender_name = await get_profile_full_name(sender_email);
          $sanitized_content.find(".sender-user").html(sender_name);
        }
      }
      // ===========================================
      else if (message_template_type == "Set Topic Status") {
        const sender_email = $sanitized_content
          .find(".sender-user")
          .attr("data-user");
        if (sender_email == this.profile.user_email) {
          $sanitized_content.find(".sender-user").html("You");
        } else {
          const sender_name = await get_profile_full_name(sender_email);
          $sanitized_content.find(".sender-user").html(sender_name);
        }
      }
      // ===========================================
      else if (message_template_type == "Remove Contributors") {
        const sender_email = $sanitized_content
          .find(".sender-user")
          .attr("data-user");
        if (sender_email == this.profile.user_email) {
          $sanitized_content.find(".sender-user").html("You");
        } else {
          const sender_name = await get_profile_full_name(sender_email);
          $sanitized_content.find(".sender-user").html(sender_name);
        }
      }
      // ===========================================
      $recipient_element.html($sanitized_content);
    }

    const me = this;
    $message_element.find("span.mention").on("click", function () {
      if (
        $(this).data("id") == me.profile.user_email ||
        $(this).data("is-doctype") == 1
      ) {
        return;
      }
      me.check_if_contact_has_chat(
        me.profile.user_email,
        $(this).data("id"),
        $(this).data("name"),
        "Chat"
      );
    });

    if (type != "mention-message" && type != "info-message") {
      if (!get_messages) {
        const send_date = await get_time_now(me.profile.user_email, 1);
        $recipient_element.append(
          `<div class='message-time'>${send_date}</div>`
        );
      } else {
        $recipient_element.append(`<div class='message-time'>${time}</div>`);
      }
    }
    return $recipient_element;
  }

  async handle_send_message(
    attachment = null,
    file_name = null,
    file_id = null
  ) {
    if (this.isDedicatedTopicContext?.() && (this.topic_read_only || this.topic_write_mode === false)) {
      frappe.show_alert({
        message: __("This topic is closed"),
        indicator: "orange"
      });
      return;
    }

    this.$chat_space_container.removeClass("chat-space-center");
    this.$chat_space_container.find(".no-messages-info").remove();

    if (
      this.$chat_space_container.find(".ask-to-join") &&
      this.$chat_space_container.find(".ask-to-join").length > 0
    ) {
      this.$chat_space_container.find(".mention-message:last").remove();
    }

    const $editor = this.$chat_space.find(".type-message .ql-editor");
    const editorText = ($editor.text() || "").trim();
    const hasImages = $editor.find("img").length > 0;
    const messageChatTopic =
      this.isDedicatedTopicContext?.()
        ? (this.chat_topic || this.chat_topic_space || this.profile.chat_topic || null)
        : (this.activeMessageTopic || null);
    const messageChatTopicSubject = this.activeMessageTopicSubject || null;

    if (editorText.length === 0 && !attachment && !hasImages) {
      return;
    }

    let content = this.$chat_space.find(".type-message .ql-editor").html();
    (this.is_link = null),
      (this.is_media = null),
      (this.is_document = null),
      (this.is_voice_clip = null);
    let chat_room;
    let is_screenshot = 0;
    if (this.$chat_space.find(".type-message .ql-editor").find("p").find("img").length > 0) {
      is_screenshot = 1;
    }

    if(!this.profile.room && this.profile.is_website_support_group == 1){
      const results = await create_website_support_group(this.profile.user_email, content)
      this.profile.room = results.room;
      this.profile.respondent_user = results.respondent_user;
      this.setup_socketio();
    }

    if (!this.profile.room) {
      // Handle platform-specific gateway assignment
      switch (this.profile.platform) {
        case "WhatsApp":
          this.platform_gateway = this.default_whatsapp_number;
          break;
        case "Instagram":
          this.platform_gateway = this.default_instagram_profile;
          break;
        case "Messenger":
          this.platform_gateway = this.default_messenger_profile;
          break;
        case "Telegram":
          this.platform_gateway = this.default_telegram_profile;
          break;
      }
    
      // Special condition to create a group chat for WhatsApp/Instagram/Messenger/Telegram + Support
      const isSupportChannel =
        this.profile.platform === "WhatsApp" && this.default_whatsapp_type === "Support" ||
        this.profile.platform === "Instagram" && this.default_instagram_type === "Support" ||
        this.profile.platform === "Messenger" && this.default_messenger_type === "Support" ||
        this.profile.platform === "Telegram" && this.default_telegram_type === "Support";
    
      if (
        this.platform_gateway &&
        isSupportChannel
      ) {
        // Create a group chat instead of a direct one
        let selected_contacts_list = [{
          email: this.profile.contact,
          platform: this.profile.platform,
          platform_profile: this.platform_profile,
          platform_gateway: this.platform_gateway
        }];
    
        let results = await create_group(selected_contacts_list, this.profile.user_email);
        this.profile.room = results[0].room;
        this.set_channel_realtime(this.profile.room);
        this.$chat_space
          .closest(".chat-window")
          .attr("data-room", this.profile.room);
        frappe.ErpnextChat.settings.open_chat_space_rooms.push(this.profile.room);
        this.is_first_message = 0;
      } else {
        // For all other scenarios: create a direct channel
        await this.create_direct_channel(content);
      }
    }
    
    

    if(this.profile.new_member == 1){
      const new_member = [{"email" : this.profile.user_email , "platform" : "Chat"}]
      await add_group_member(
        new_member,
        this.profile.room
      );
      this.profile.new_member = 0

      const message_info = {
        content: `${this.profile.user} Joined`,
        user: this.profile.user,
        room: this.profile.room,
        email: this.profile.user_email   ,
        message_type : "information"
      };
      this.last_chat_space_message = await send_message(message_info);
    }

    if (attachment) {
      content = await this.handle_attachment(attachment, file_name);

      if (content == null) return;
      
    } else {
      content = this.check_if_content_has_email(content);
      content = this.check_if_content_has_link(content);
      if (contains_arabic(content)) {
        let $content = $(document.createElement("div")).append(content);
        $content.css({
          direction: "rtl",
          "text-align": "right",
        });
        content = $content.prop("outerHTML");
      }
    }

    if (this.profile.room_type == "Contributor") {
      chat_room = this.profile.parent_channel;
    } else {
      chat_room = this.profile.room;
    }

    this.$chat_actions.find(".ql-editor").html("");
    this.voice_clip.$voice_clip.css("display", "block");
    this.$chat_actions.find(".message-send-button").css("display", "none");

    // ================= Handling with Mentions ===========================
    if (
      this.profile.user != "Guest" &&
      !attachment &&
      this.profile.room_type != "Contributor"
    ) {
      let results = this.extract_mentions(content);
      let mention_users = [];
      let mention_doctypes = [];

      if (results.contributors.length > 0) {
        mention_users = await this.check_mentioned_user(results.contributors);
      }
      if (results.mention_doctypes.length > 0) {
        mention_doctypes = await this.check_mention_doctypes(
          results.mention_doctypes
        );
      }

      if (mention_users.length > 0 && mention_doctypes.length > 0) {
        const me = this;
        const mentioned_users_emails =
          mention_users.length > 1
            ? mention_users.map((obj) => obj.email).join(", ")
            : mention_users[0].email;
        const mentioned_users_name =
          mention_users.length > 1
            ? mention_users.map((obj) => obj.name).join(", ")
            : mention_users[0].name;

        this.ask_to_join_template = `
      <div class="ask-to-join-container">
        <div class="alert alert-primary alert-dismissible btn fade show ask-to-join btn-primary" style="width:100%;text-align:left;" role="alert">
            ${frappe.utils.icon(
              "assign",
              "md"
            )} Ask <strong>${mentioned_users_name}</strong> to join
            <button id="close-ask-to-join" type="button" class="close" data-dismiss="alert" aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
        </div>          
          </div>
        <div>
      `;
        this.$chat_space_container.append(
          await this.make_message({
            content: this.ask_to_join_template,
            type: "mention-message",
            sender: this.profile.user,
            reference_doctypes: null,
          })
        );

        this.$chat_space_container
          .find(".ask-to-join")
          .on("click", function (e) {
            const old_sub_channel = me.last_active_sub_channel;
            $(this).alert("close");
            me.handle_mentions(
              mentioned_users_name,
              mentioned_users_emails,
              content,
              mention_users,
              chat_room,
              old_sub_channel
            );

            const tag_section_exists =
              me.$chat_space.find(".tag-section").length > 0;
            if (!tag_section_exists) {
              me.add_tag_section(me.contributors);
            } else {
              for (let i = 0; i < mention_users.length; i++) {
                this.tag_blot1 = new TagBlot({
                  $wrapper: me.$chat_space.find(".tags-container"),
                  profile: {
                    chat_space: me,
                    contributor_email: mention_users[i].email,
                    contributor_name: mention_users[i].name,
                  },
                });
                me.$chat_space.find(".tags-container").append(this.tag_blot1);
              }
            }
            return;
          });

        this.$chat_space_container
          .find("#close-ask-to-join")
          .on("click", function (e) {
            e.stopPropagation(); // Stops event from bubbling up to parent
            $(this).closest(".alert").alert("close");
            me.$chat_space_container.find(".mention-message").remove();
          });

        const topicReferenceTarget = this.getTopicReferenceTargetForSend();

        const message_info = {
          content:
            content && content.length == 1
              ? content.prop("outerHTML")
              : content,
          user: this.profile.user,
          room: chat_room,
          email: this.profile.user_email,
          is_first_message: this.is_first_message,
          attachment: attachment,
          sub_channel:
            this.last_active_sub_channel == chat_room
              ? ""
              : this.last_active_sub_channel,
          is_link: this.is_link,
          is_media: this.is_media,
          is_document: this.is_document,
          is_voice_clip: this.is_voice_clip,
          file_id: file_id,
          chat_topic: topicReferenceTarget ? topicReferenceTarget.name : this.chat_topic,
          chat_topic_subject: topicReferenceTarget ? topicReferenceTarget.subject : null,
          topic_color: topicReferenceTarget ? topicReferenceTarget.color : null,
        };
        this.last_chat_space_message = await send_message(message_info);

        // ================= Handling with Doctypes Mentions =======================
        if (topicReferenceTarget) {
          this.showMentionWillBeAddedToTopicMessage(
            topicReferenceTarget,
            mention_doctypes
          );

          await add_reference_doctype(
            mention_doctypes,
            topicReferenceTarget.name,
            this.last_active_sub_channel
          );

          this.mergeTopicReferencesLocally(
            topicReferenceTarget.name,
            mention_doctypes
          );

          this.clearTopicMentionReferenceHint?.();
          this.chat_info?.refreshTopicReferencesSection?.();

          await this.send_add_document_message(mention_doctypes, chat_room);
        } else {
          let results = await create_chat_topic(
            mention_doctypes,
            chat_room,
            this.last_active_sub_channel
          );

          await this.send_set_topic_message(
            mention_doctypes[0].docname,
            chat_room
          );
        }
        return;
      }
      // =========================================================================
      else if (mention_users.length > 0) {
        const me = this;
        const mentioned_users_emails =
          mention_users.length > 1
            ? mention_users.map((obj) => obj.email).join(", ")
            : mention_users[0].email;
        const mentioned_users_name =
          mention_users.length > 1
            ? mention_users.map((obj) => obj.name).join(", ")
            : mention_users[0].name;

        this.ask_to_join_template = `
        <div class="ask-to-join-container">
          <div class="alert alert-primary alert-dismissible btn fade show ask-to-join btn-primary" style="width:100%;text-align:left;" role="alert">
              ${frappe.utils.icon(
                "assign",
                "md"
              )} Ask <strong>${mentioned_users_name}</strong> to join
              <button id="close-ask-to-join" type="button" class="close" data-dismiss="alert" aria-label="Close">
              <span aria-hidden="true">×</span>
            </button>
          </div>          
          </div>
        <div>
        `;
        this.$chat_space_container.append(
          await this.make_message({
            content: this.ask_to_join_template,
            type: "mention-message",
            sender: this.profile.user,
          })
        );

        this.$chat_space_container
          .find(".ask-to-join")
          .on("click", function (e) {
            const old_sub_channel = me.last_active_sub_channel;
            $(this).alert("close");
            me.handle_mentions(
              mentioned_users_name,
              mentioned_users_emails,
              content,
              mention_users,
              chat_room,
              old_sub_channel
            );

            const tag_section_exists =
              me.$chat_space.find(".tag-section").length > 0;
            if (!tag_section_exists) {
              me.add_tag_section(me.contributors);
            } else {
              for (let i = 0; i < mention_users.length; i++) {
                this.tag_blot1 = new TagBlot({
                  $wrapper: me.$chat_space.find(".tags-container"),
                  profile: {
                    chat_space: me,
                    contributor_email: mention_users[i].email,
                    contributor_name: mention_users[i].name,
                  },
                });
                me.$chat_space.find(".tags-container").append(this.tag_blot1);
              }
            }
            return;
          });

        this.$chat_space_container
          .find("#close-ask-to-join")
          .on("click", function (e) {
            e.stopPropagation(); // Stops event from bubbling up to parent
            $(this).closest(".alert").alert("close");
            me.$chat_space_container.find(".mention-message").remove();
          });
      }
      // =========================================================================
      else if (mention_doctypes.length > 0) {
        const topicReferenceTarget = this.getTopicReferenceTargetForSend();

        let message_info = {
          content:
            content && content.length == 1
              ? content.prop("outerHTML")
              : content,
          user: this.profile.user,
          room: chat_room,
          email: this.profile.user_email,
          is_first_message: this.is_first_message,
          attachment: attachment,
          sub_channel:
            this.last_active_sub_channel == chat_room
              ? ""
              : this.last_active_sub_channel,
          is_link: this.is_link,
          is_media: this.is_media,
          is_document: this.is_document,
          is_voice_clip: this.is_voice_clip,
          file_id: file_id,

          chat_topic: topicReferenceTarget ? topicReferenceTarget.name : null,
          chat_topic_subject: topicReferenceTarget ? topicReferenceTarget.subject : null,
          topic_color: topicReferenceTarget ? topicReferenceTarget.color : null,
        };

        if (topicReferenceTarget) {
          this.showMentionWillBeAddedToTopicMessage(
            topicReferenceTarget,
            mention_doctypes
          );

          this.last_chat_space_message = await send_message(message_info);

          await add_reference_doctype(
            mention_doctypes,
            topicReferenceTarget.name,
            this.last_active_sub_channel
          );

          this.mergeTopicReferencesLocally(
            topicReferenceTarget.name,
            mention_doctypes
          );

          this.clearTopicMentionReferenceHint?.();
          this.chat_info?.refreshTopicReferencesSection?.();

          await this.send_add_document_message(mention_doctypes, chat_room);

          return;
        }

        // No selected/current topic: keep old behavior and create a new topic.
        let results = await create_chat_topic(
          mention_doctypes,
          chat_room,
          this.last_active_sub_channel
        );

        const createdTopicName = results[0].chat_topic;
        const createdTopicColor = results[0].topic_color || null;

        if (createdTopicName) {
          this.topicColorMap.set(
            createdTopicName,
            createdTopicColor || this.getTopicColor(createdTopicName)
          );

          this.activeMessageTopic = createdTopicName;
          this.activeMessageTopicSubject =
            mention_doctypes[0].docname || createdTopicName;

          this.activeMessageTopicColor =
            createdTopicColor || this.getTopicColor(createdTopicName);

          this.updatePlusTopicButton?.();
          this.saveUserActiveChatTopic(createdTopicName);
        }

        message_info.chat_topic = createdTopicName;
        message_info.chat_topic_subject =
          mention_doctypes[0].docname || createdTopicName;
        message_info.topic_color = createdTopicColor;

        this.last_chat_space_message = await send_message(message_info);

        if (this.last_chat_space_message && createdTopicName) {
          setTimeout(() => {
            this.applyTopicToRenderedMessage(
              this.last_chat_space_message,
              createdTopicName,
              this.activeMessageTopicSubject,
              createdTopicColor
            );
          }, 150);
        }

        await this.send_set_topic_message(
          mention_doctypes[0].docname,
          chat_room
        );

        return;
      }
    }
    // ================= End Handling with Mentions ===========================

    const outgoingTopic = this.getOutgoingTopicInfo();
    const replyTopic = outgoingTopic ? null : await this.getReplyMessageTopicInfo();
    const finalOutgoingTopic = outgoingTopic || replyTopic;

    const message_info = {
      content:
        content && content.length == 1 ? content.prop("outerHTML") : content,
      user: this.profile.user,
      room: chat_room,
      email: this.profile.user_email,
      is_first_message: this.is_first_message,
      attachment: attachment,
      sub_channel:
        this.last_active_sub_channel == chat_room
          ? ""
          : this.last_active_sub_channel,
      is_link: this.is_link,
      is_media: this.is_media,
      is_document: this.is_document,
      is_voice_clip: this.is_voice_clip,
      file_id: file_id,
      chat_topic: finalOutgoingTopic ? finalOutgoingTopic.chat_topic : (this.chat_topic || messageChatTopic),
      chat_topic_subject: finalOutgoingTopic ? finalOutgoingTopic.chat_topic_subject : null,
      topic_color: finalOutgoingTopic ? finalOutgoingTopic.topic_color : null,
      is_screenshot: is_screenshot,
      reply_to_message_name: this.reply_to_message_name,
    };
   
    this.last_chat_space_message = await send_message(message_info);

    if (this.last_chat_space_message && finalOutgoingTopic) {
      setTimeout(() => {
        this.applyTopicToRenderedMessage(
          this.last_chat_space_message,
          finalOutgoingTopic.chat_topic,
          finalOutgoingTopic.chat_topic_subject,
          finalOutgoingTopic.topic_color
        );
      }, 600);
    }

    this.reply_to_message_name = null;
    this.$chat_space.children(".reply-preview-host").remove();
        hide_overlay();
      } //End handle_send_message

  async handle_mentions(
    mentioned_users_name,
    mentioned_users_emails,
    content,
    mention_users,
    chat_room,
    old_sub_channel
  ) {
    let contributors;
    if (this.contributors && this.contributors.length > 0) {
      contributors = this.contributors.concat(mention_users);
    } else {
      contributors = mention_users;
    }
    this.contributors = contributors;

    const mention_msg = `
  <div class="add-user" data-template="added_user_template"><span class="sender-user" data-user="${this.profile.user_email}"></span><span> added </span><span class="receiver-user" data-user="${mentioned_users_emails}"></span></div>`;

    this.$chat_actions.find(".ql-editor").html("");
    this.voice_clip.$voice_clip.css("display", "block");
    this.$chat_actions.find(".message-send-button").css("display", "none");

    this.last_active_sub_channel = await create_sub_channel({
      new_contributors: mention_users,
      parent_channel: chat_room,
      user: this.profile.user,
      user_email: this.profile.user_email,
      last_active_sub_channel: this.last_active_sub_channel,
    });

    const mention_message_info = {
      content: mention_msg,
      user: this.profile.user,
      room: chat_room,
      email: this.profile.user_email,
      sub_channel:
        this.last_active_sub_channel == chat_room
          ? ""
          : this.last_active_sub_channel,
      message_type: "information",
      message_template_type: "Add User",
      chat_topic: this.chat_topic,
    };
    await send_message(mention_message_info);
    update_sub_channel_for_last_message(
      this.profile.user,
      this.profile.user_email,
      mentioned_users_emails,
      this.last_chat_space_message,
      this.last_active_sub_channel,
      content,
      chat_room,
      old_sub_channel
    );
  }

  extract_mentions(message) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(message, "text/html");
    const mentions = doc.querySelectorAll(".mention");
    const contributors = [];
    const uniqueEmails = new Set();
    let mention_doctypes = [];

    mentions.forEach((mention) => {
      if (mention.getAttribute("data-is-doctype") != 1) {
        const email = mention.getAttribute("data-id");
        if (!uniqueEmails.has(email)) {
          uniqueEmails.add(email);
          contributors.push({
            name: mention.getAttribute("data-name"),
            email: email,
          });
        }
      } else
        mention_doctypes.push({
          doctype: mention.getAttribute("data-doctype"),
          docname: mention.getAttribute("data-id"),
        });
    });
    return { contributors: contributors, mention_doctypes: mention_doctypes };
  }

  async check_mentioned_user(mentioned_users) {
    const updatedMentionedUsers = mentioned_users.filter((mentioned) => {
      return !(
        this.chat_members.some((member) => member.email === mentioned.email) ||
        (this.contributors &&
          this.contributors.some(
            (contributor) => contributor.email === mentioned.email
          ))
      );
    });
    return updatedMentionedUsers;
  }

  async check_mention_doctypes(mention_doctypes) {
    const updatedMentionedDoctypes = mention_doctypes.filter((mentioned) => {
      return !(
        this.reference_doctypes &&
        this.reference_doctypes.some((doc) => doc.docname === mentioned.docname)
      );
    });
    return updatedMentionedDoctypes;
  }

debouncedFetchTemplates(textValue) {
  clearTimeout(this.templateTimeout);
  this.templateTimeout = setTimeout(() => {
    this.fetchTemplateSuggestions(textValue);
  }, 250);
}
removeTemplateSuggestions() {
  this.$wrapper
    .closest(".chat-window")
    .find("#template-suggestions")
    .remove();
}

async fetchTemplateSuggestions(textValue) {
  if (!textValue || !textValue.startsWith("/")) {
    this.removeTemplateSuggestions();
    return;
  }

  try {
    const res = await frappe.call({
      method: "clefincode_chat.api.api_1_3_4.api.get_template_suggestions",
      args: {
        user: this.profile.user_email,
        platform: this.profile.platform || "Chat",
        text: textValue
      }
    });

    if (res.message && res.message.length > 0) {
      this.showTemplateSuggestions({
        template: res.message,
        user: this.profile.user_email
      });
    } else {
      this.removeTemplateSuggestions();
    }
  } catch (err) {
    console.error("Template suggestions error:", err);
  }
}

  async create_direct_channel(content) {


    switch (this.profile.platform) {
      case "WhatsApp":
        this.platform_profile = "ClefinCode WhatsApp Profile";
        this.platform_gateway = window.erpnext_chat_app.res.default_whatsapp_number;
        break;
      case "Instagram":
        this.platform_profile = "ClefinCode Instagram Profile" ;
        this.platform_gateway = window.erpnext_chat_app.res.default_instagram_profile;
        break;
      case "Messenger":
        this.platform_profile = "ClefinCode Facebook Messenger Profile";
        this.platform_gateway = window.erpnext_chat_app.res.default_messenger_profile;
        break;
      case "Telegram":
        this.platform_profile = "ClefinCode Telegram Profile";
        this.platform_gateway = window.erpnext_chat_app.res.default_telegram_profile;
        break;
    }

    this.chat_members.push({
      email: this.profile.user_email,
      name: this.profile.user_email,
      platform: "Chat"      
    });
    this.chat_members.push({
      email: this.profile.contact,
      name: this.profile.room_name,
      platform: this.profile.platform,
      platform_profile: this.platform_profile,
      platform_gateway: this.platform_gateway
    });

    this.is_first_message = 1;
    let res = await frappe.call({
      method: "clefincode_chat.api.api_1_2_1.api.create_channel",
      args: {
        channel_name: "",
        users: this.chat_members,
        type: "Direct",
        last_message: content,
        creator_email: this.profile.user_email,
        creator: this.profile.user
      },
      callback: function (r) {
        return r.message;
      },
    });
    this.profile.room = res.message.results[0].room;
    this.set_channel_realtime(this.profile.room);
    this.$chat_space
      .closest(".chat-window")
      .attr("data-room", this.profile.room);
    frappe.ErpnextChat.settings.open_chat_space_rooms.push(this.profile.room);
    this.is_first_message = 0;
  }

  check_if_content_has_link(message_content) {
    const me = this;
    const parser = new DOMParser();
    const doc = parser.parseFromString(message_content, "text/html");

    const paragraphs = doc.querySelectorAll("p");

    paragraphs.forEach((p) => {
      const urlRegex =
        /((https?:\/\/|www\.|(?<![\w-])[\w-]+\.)[-\w.]+(:\d+)?(\/([\w/_\-.%]*(\?\S+)?)?)?)/gi;
      let link = "";
      Array.from(p.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const replacedText = node.textContent.replace(
            urlRegex,
            function (matched) {
              me.is_link = 1;
              if (!(matched.includes("http") || matched.includes("https"))) {
                link = "https://";
              }
              return (
                '<a href="' +
                link +
                matched +
                '" target="_blank" style="color:#027eb5">' +
                matched +
                "</a>"
              );
            }
          );
          const fragment = document
            .createRange()
            .createContextualFragment(replacedText);
          p.replaceChild(fragment, node);
        }
      });
    });
    return doc.body.innerHTML;
  }

  check_if_content_has_email(message_content) {
    const me = this;
    const parser = new DOMParser();
    const doc = parser.parseFromString(message_content, "text/html");

    const paragraphs = doc.querySelectorAll("p");

    paragraphs.forEach((p) => {
      const mailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      Array.from(p.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const replacedText = node.textContent.replace(
            mailRegex,
            function (matched) {
              me.is_link = 1;
              return (
                '<a href="mailto:' +
                matched +
                '" target="_blank" style="color:#027eb5">' +
                matched +
                "</a>"
              );
            }
          );
          const fragment = document
            .createRange()
            .createContextualFragment(replacedText);
          p.replaceChild(fragment, node);
        }
      });
    });
    return doc.body.innerHTML;
  }

  handle_attachment(file_url, file_name) {
    let $content;
    if (file_url.startsWith("/files") || file_url.startsWith("/private")) {
      if (is_image(file_name)) {
        this.is_media = 1;
        $content = $(document.createElement("a"));
        $content.attr({ href: file_url, target: "_blank" });
        $content.append(
          `<img src="${file_url}" class="img-responsive chat-image">`
        );
        $content.append(`<span class="hidden">${file_name}</span>`);
      } else if (is_video(file_name)) {
        this.is_media = 1;
        $content = $(document.createElement("div"));
        $content.append(
          `<video src="${file_url}" controls style="width:235px"></video>
          `
        );
        $content.append(`<span class="hidden">${file_name}</span>`);
      } else if (is_document(file_name)) {
        this.is_document = 1;
        $content = $(document.createElement("div"));
        $content.css("width", "235px");
        // alaa
        const excel = ["xlsx", "xls", "csv"];
        const word = ["doc", "docx"];
        const pdf = ["pdf"];
        const powerpoint = ["pptx", "ppt", "ppsx"];
        const rar = ["zip", "rar"];
        $content.addClass(
          "document-container d-flex flex-row justify-content-start align-items-center"
        );
        let extension = file_name.substring(file_name.lastIndexOf(".") + 1);
        if (word.includes(extension)) {
          $content.append(
            `<img style="height: 32px;margin-right: 8px;" src="/assets/clefincode_chat/images/docx.png">`
          );
        } else if (excel.includes(extension)) {
          $content.append(
            `<img style="height: 32px;margin-right: 8px;" src="/assets/clefincode_chat/images/xlsx.png">`
          );
        } else if (pdf.includes(extension)) {
          $content.append(
            `<img style="height: 32px;margin-right: 8px;" src="/assets/clefincode_chat/images/pdf-red.png">`
          );
        } else if (rar.includes(extension)) {
          $content.append(
            `<img style="height: 32px;margin-right: 8px;" src="/assets/clefincode_chat/images/rar.png">`
          );
        } else if (powerpoint.includes(extension)) {
          $content.append(
            `<img style="height: 32px;margin-right: 8px;" src="/assets/clefincode_chat/images/ppt.png">`
          );
        } else {
          $content.append(
            `<img style="height: 32px;margin-right: 8px;" src="/assets/clefincode_chat/images/txt.png">`
          );
        }

        $content.append(
          `<a href="${file_url}" target ="_blank" style="white-space: pre-wrap;word-break: break-word;">${file_name}</a>`
        );
      } else if (is_audio(file_name)) {
        this.is_document = 1;
        $content = $(document.createElement("audio"));
        $content.attr({ src: file_url, controls: "controls" });
        $content.addClass("voice-clip");
        $content.css("width", "235px");
        $content.append(file_name);
      } else if (is_voice_clip(file_name)) {
        this.is_voice_clip = 1;
        $content = this.create_canvas_clip(file_name);
      } else {
        frappe.msgprint("Unsupported type");
        return;
      }
    } else if (file_name) {
      this.is_link = 1;
      $content = $(document.createElement("a"));
      $content.attr({ href: file_url, target: "_blank" });
      $content.append(file_url);
      $content.css("color", "#027eb5");
    } else {
      frappe.msgprint("Unknown type");
    }

    return $content;
  }

  create_canvas_clip(file_name) {
    const me = this;
    let $content = $(document.createElement("div"));

    let $container = $(document.createElement("div"))
      .addClass("voice-clip-container")
      .attr("data-audio", file_name);

    let playbutton = `
  <button class="audio-btn" aria-label="Play voice message">
    <span data-icon="audio-play" class="">
      <svg viewBox="0 0 45 34" height="34" width="34" preserveAspectRatio="xMidYMid meet" class="" version="1.1" x="0px" y="0px" enable-background="new 0 0 34 34">
        <path fill="currentColor" d="M8.5,8.7c0-1.7,1.2-2.4,2.6-1.5l14.4,8.3c1.4,0.8,1.4,2.2,0,3l-14.4,8.3 c-1.4,0.8-2.6,0.2-2.6-1.5V8.7z"></path>
      </svg>
    </span>
    <span data-icon="audio-pause" class="stop-btn">
      <svg viewBox="0 0 45 34" height="34" width="34" preserveAspectRatio="xMidYMid meet" class="" version="1.1" x="0px" y="0px" enable-background="new 0 0 34 34">
        <path fill="currentColor" d="M9.2,25c0,0.5,0.4,1,0.9,1h3.6c0.5,0,0.9-0.4,0.9-1V9c0-0.5-0.4-0.9-0.9-0.9h-3.6 C9.7,8,9.2,8.4,9.2,9V25z M20.2,8c-0.5,0-1,0.4-1,0.9V25c0,0.5,0.4,1,1,1h3.6c0.5,0,1-0.4,1-1V9c0-0.5-0.4-0.9-1-0.9 C23.8,8,20.2,8,20.2,8z"></path>
      </svg>
    </span>
  </button>
  `;

    let $record = $(document.createElement("div"))
      .addClass("record-sec")
      .append($(document.createElement("div")).addClass("record-line"));
    let $canvas = $(document.createElement("canvas")).addClass("record-canvas");

    $record.find(".record-line").append($canvas);

    $container.append($record);
    $container.append(playbutton);

    //$content.append(file_name);

    setTimeout(function () {
      let parent = $(
        ".message-bubble .voice-clip-container[data-audio='" + file_name + "']"
      );
      let element = parent.find("canvas").first();
      me.draw_clip_in_canvas("/private/files/" + file_name, element);
      //me.draw_clip_in_canvas(file_url, $canvas)
    }, 3000);
    $content.append($container);
    return $content;
  }

  draw_clip_in_canvas(file_url, canvas) {
    const ctx = canvas[0].getContext("2d");
    const audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();
    const drawAudio = (url) => {
      fetch(url)
        .then((response) => response.arrayBuffer())
        .then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
        .then((audioBuffer) => {
          if (
            canvas.closest(".voice-clip-container").find(".duration").length > 0
          )
            return;

          const duration = audioBuffer.duration;
          canvas
            .closest(".voice-clip-container")
            .attr("data-duration", duration.toFixed(2));
          const minutes = Math.floor(duration / 60);
          const remainingSeconds = Math.floor(duration % 60);

          // Pad the minutes and seconds with leading zeros if needed
          const paddedMinutes = String(minutes).padStart(2, "0");
          const paddedSeconds = String(remainingSeconds).padStart(2, "0");

          let duration_html = $("<div></div>")
            .addClass("duration")
            .text(`${paddedMinutes}:${paddedSeconds}`);

          canvas.closest(".voice-clip-container").append(duration_html);
          draw(normalizeData(filterData(audioBuffer)));
        });
    };

    const filterData = (audioBuffer) => {
      const rawData = audioBuffer.getChannelData(0); // We only need to work with one channel of data
      const samples = 70; // Number of samples we want to have in our final data set
      const blockSize = Math.floor(rawData.length / samples); // the number of samples in each subdivision
      const filteredData = [];
      for (let i = 0; i < samples; i++) {
        let blockStart = blockSize * i; // the location of the first sample in the block
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum = sum + Math.abs(rawData[blockStart + j]); // find the sum of all the samples in the block
        }
        filteredData.push(sum / blockSize); // divide the sum by the block size to get the average
      }

      return filteredData;
    };

    const normalizeData = (filteredData) => {
      const maxVal = Math.max(...filteredData);
      const multiplier = maxVal > 0 ? 2 / maxVal : 1;
      // const multiplier = Math.pow(Math.max(...filteredData), -1);
      return filteredData.map((n) => n * multiplier);
    };

    const draw = (normalizedData) => {
      // set up the canvas
      const dpr = window.devicePixelRatio || 1;
      const padding = 8;
      canvas[0].width = canvas.outerWidth() * dpr;
      canvas[0].height = canvas.outerHeight() * dpr;
      ctx.scale(dpr, dpr);
      ctx.translate(0, canvas.height() / 2); // set Y = 0 to be in the middle of the canvas
      // draw the line segments
      const width = canvas.outerWidth() / normalizedData.length;
      for (let i = 0; i < normalizedData.length; i++) {
        const x = width * i;
        let height = normalizedData[i] * canvas.height() - padding;
        if (height < 0) {
          height = 0;
        } else if (height > canvas.height() / 2) {
          height = Math.min(height, canvas.height() / 2);
        }
        drawLineSegment(ctx, x, height, width, (i + 1) % 2);
      }
    };

    const drawLineSegment = (ctx, x, height, width, isEven) => {
      ctx.lineWidth = 1; // how thick the line is
      ctx.strokeStyle = "#8f9294"; // what color our line is
      ctx.beginPath();
      ctx.moveTo(x, -height / 2);
      ctx.lineTo(x, height / 2);
      ctx.arc(x + width / 2, height, width / 2, Math.PI, 0, isEven);
      ctx.lineTo(x + width, 0);
      ctx.stroke();
    };
    drawAudio(file_url);
  }

  async receive_message(res, time) {
    this.messages_offset += 1;
    if (this.$chat_space_container.find(".date-line").length == 0) {
      this.$chat_space_container.prepend(
        this.make_date_line_html(res.send_date)
      );
    } else {
      this.$chat_space_container.append(
        this.make_date_line_html(res.send_date)
      );
    }

    let chat_type = "sender-message";

    if (res.sender_email == this.profile.user_email) {
    
      chat_type = "recipient-message";
    }

    if (this.profile.room_type === "Guest") {
      if (this.profile.is_admin === true && res.user !== "Guest") {
        chat_type = "recipient-message";
      }
    }

    if (res.message_type == "information") {
      chat_type = "info-message";
    }

    if (this.add_member_again == 1) {
      this.add_member_again = 0;
      this.messages_offset = 0;
      await this.fetch_and_setup_messages();
    } else {
    
      this.messageCache.set(res.message_name, {
        sender: res.sender,
        content: res.content,
        chat_topic: res.chat_topic || res.topic || null,
    chat_topic_subject:
      res.chat_topic_subject ||
      res.topic_subject ||
      res.chat_topic_title ||
      null,
        original_content: res.original_content || null,
        is_link: res.is_link || 0,
        is_media: res.is_media || 0,
        is_document: res.is_document || 0,
        is_voice_clip: res.is_voice_clip || 0,
        is_screenshot: res.is_screenshot || 0,
        file_id: res.file_id || null,
        attachment: res.attachment || null,
        message_type: res.message_type || null,       
        is_forwarded: res.is_forwarded || 0,
        forward_level: res.forward_level || 0,
        reply_to_message:res.reply_to_message ,
        reply_preview_type: res.reply_preview_type,
        reply_preview_text: res.reply_preview_text,
        reply_preview_sender: res.reply_preview_sender,
        reply_preview_file_url: res.reply_preview_file_url,
        is_deleted:res.is_deleted,
        is_edited: res.is_edited ,

        
      });
      const topicNameForRealtime = res.chat_topic || res.topic || null;
      const topicColorForRealtime = res.topic_color || (topicNameForRealtime ? this.getTopicColor(topicNameForRealtime) : null);

      if (topicNameForRealtime && topicColorForRealtime) {
        this.topicColorMap.set(topicNameForRealtime, topicColorForRealtime);
      }

      const isSetTopicInfoRealtime = this.isSetTopicInfoMessage({
        content: res.content,
        message_template_type: res.message_template_type
      });

      const isRemoveTopicInfoRealtime = this.isRemoveTopicInfoMessage({
        content: res.content,
        message_template_type: res.message_template_type
      });

      const isCloseTopicInfoRealtime = this.isCloseTopicInfoMessage({
        content: res.content,
        message_template_type: res.message_template_type
      });

      if (isSetTopicInfoRealtime || isRemoveTopicInfoRealtime || isCloseTopicInfoRealtime) {
        const topicNameForSystemMessage =
          res.chat_topic ||
          res.topic ||
          res.topic_name ||
          res.old_chat_topic ||
          res.removed_topic ||
          res.previous_chat_topic ||
          null;

        const topicSubjectForSystemMessage =
          res.chat_topic_subject ||
          res.topic_subject ||
          res.chat_topic_title ||
          res.old_chat_topic_subject ||
          res.removed_topic_subject ||
          res.previous_chat_topic_subject ||
          topicNameForSystemMessage ||
          null;

        const topicColorForSystemMessage = topicNameForSystemMessage
          ? this.getTopicColor(
              topicNameForSystemMessage,
              res.topic_color || res.chat_topic_color || null
            )
          : null;

        if (topicNameForSystemMessage && topicColorForSystemMessage) {
          this.topicColorMap.set(topicNameForSystemMessage, topicColorForSystemMessage);
        }

        const separatorHtml = this.makeTopicSystemSeparatorHtml({
          messageName: res.message_name,
          topicName: topicNameForSystemMessage,
          topicSubject: topicSubjectForSystemMessage,
          topicColor: topicColorForSystemMessage,
          templateType: res.message_template_type,
          sendDate: res.send_date,
          action: isRemoveTopicInfoRealtime ? "remove" : "set"
        });

        if (separatorHtml) {
          const $separator = $(separatorHtml);
          const shouldAutoScroll =
            res.sender_email === this.profile.user_email || this.isNearBottom();

          this.$chat_space_container.append($separator);

          this.normalizeTopicSeparators?.();

          if (!this.chat_topic_space) {
            this.buildTopicMetaMap?.();
            this.applyTopicVisibility?.();
          }

          if (shouldAutoScroll) {
            scroll_to_bottom(this.$chat_space_container);
            this.resetUnreadBadge?.();
          } else {
            this.unseenMessagesCount += 1;
            this.updateUnreadBadge?.();
          }
        }

        this.prevMessage = res;
        return;
      }

      let message_content = await this.make_message({
        content: res.content,
        original_content: res.original_content || null,
        time: time,
        type: chat_type,
        sender: res.user,
        sender_email: res.sender_email, 
        message_name: res.message_name,
        message_template_type: res.message_template_type,
        chat_topic: topicNameForRealtime,
        chat_topic_subject: res.chat_topic_subject || res.topic_subject || res.chat_topic_title || topicNameForRealtime,
        topic_color: topicColorForRealtime,
        send_date: res.send_date,
        reply_to_message:res.reply_to_message ,
        reply_preview: {
            type: res.reply_preview_type || null,
            text: res.reply_preview_text || null,
            sender: res.reply_preview_sender || null,
            sender_email: res.reply_preview_sender_email || null,
            file_url: res.reply_preview_file_url || null,
            file: res.reply_preview_file || null,
            original_message_name: res.reply_preview_message_name || res.reply_to_message || null,
          },
        is_forwarded: res.is_forwarded || 0,
        is_deleted:res.is_deleted || 0,
        is_edited: res.is_edited || 0,
        reference_doctypes: this.chat_topic_space ? this.reference_doctypes : null,
      });
      let attributeFound = false;
      let file_name = "";
      message_content.find("*").each(function () {
        if ($(this).attr("data-audio") !== undefined) {
          attributeFound = true;
          file_name = $(this).attr("data-audio");
          return false; // Breaks the loop once the attribute is found
        }
      });
      if (attributeFound) {
        let me = this;
        setTimeout(function () {
          let parent = $(
            ".message-bubble .voice-clip-container[data-audio='" +
              file_name +
              "']"
          );
          let element = parent.find("canvas").first();
          me.draw_clip_in_canvas("/private/files/" + file_name, element);
        }, 500);
      }
      const shouldAutoScroll =
  res.sender_email === this.profile.user_email || this.isNearBottom();

        this.$chat_space_container.append(message_content);
        this.normalizeTopicSeparators();
        if (topicNameForRealtime) {
          this.applyTopicToRenderedMessage(
            res.message_name,
            topicNameForRealtime,
            res.chat_topic_subject || res.topic_subject || topicNameForRealtime,
            topicColorForRealtime
          );
        }
        if (!this.chat_topic_space) {
          this.buildTopicMetaMap();
          this.applyTopicVisibility();
        }
        this.resolvePendingReplies();

        if (shouldAutoScroll) {
          scroll_to_bottom(this.$chat_space_container);
          this.resetUnreadBadge();
        } else {
          this.unseenMessagesCount += 1;
          this.updateUnreadBadge();
        }

        this.fetchAndRenderReactions(res.message_name);
       }
    this.prevMessage = res;
  }

openMessageActionMenu({ $trigger, messageName, isMyMessage, isTextOnly }) {
  this.closeMessageActionMenu();

  const icon = (name) => {
    const icons = {
      edit: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 17.25V21h3.75L17.8 9.95l-3.75-3.75L3 17.25z"></path>
          <path d="M20.7 7.05c.4-.4.4-1 0-1.4l-2.35-2.35a1 1 0 0 0-1.4 0l-1.85 1.85 3.75 3.75 1.85-1.85z"></path>
        </svg>
      `,
      reply: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-.7-5-3.6-11-11-11z"></path>
        </svg>
      `,
      copy: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M16 1H4c-1.1 0-2 .9-2 2v12h2V3h12V1z"></path>
          <path d="M19 5H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"></path>
        </svg>
      `,
      react: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM8.5 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM12 17.5c-2.3 0-4.2-1.3-5-3.2h10c-.8 1.9-2.7 3.2-5 3.2z"></path>
        </svg>
      `,
      forward: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 8V4l8 8-8 8v-4H4v-8h8z"></path>
        </svg>
      `,
      relink: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3.9 12a5 5 0 0 1 5-5h4v2h-4a3 3 0 0 0 0 6h4v2h-4a5 5 0 0 1-5-5z"></path>
          <path d="M8 13h8v-2H8v2z"></path>
          <path d="M11 17h4a3 3 0 0 0 0-6h-4V9h4a5 5 0 0 1 0 10h-4v-2z"></path>
        </svg>
      `,
      delete: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12z"></path>
          <path d="M8 4l1-1h6l1 1h4v2H4V4h4z"></path>
        </svg>
      `,
      info: `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 17h2v-6h-2v6z"></path>
          <path d="M11 9h2V7h-2v2z"></path>
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z"></path>
        </svg>
      `
    };

    return `<span class="menu-icon">${icons[name] || ""}</span>`;
  };

  const safeMessageName = frappe.utils.escape_html(String(messageName || ""));

  const item = ({ actionClass, iconName, label, danger = false }) => `
    <button
      type="button"
      class="menu-item ${actionClass} ${danger ? "danger" : ""}"
      data-message-name="${safeMessageName}"
    >
      ${icon(iconName)}
      <span class="menu-label">${__(label)}</span>
    </button>
  `;

  const items = [];

  if (isTextOnly && isMyMessage) {
    items.push(item({
      actionClass: "edit-action",
      iconName: "edit",
      label: "Edit"
    }));
  }

  items.push(item({
    actionClass: "reply-action",
    iconName: "reply",
    label: "Reply"
  }));

  items.push(item({
    actionClass: "copy-action",
    iconName: "copy",
    label: "Copy"
  }));

  items.push(item({
    actionClass: "react-action",
    iconName: "react",
    label: "React"
  }));

  items.push(item({
    actionClass: "forward-action",
    iconName: "forward",
    label: "Forward"
  }));

  const cachedForMenu = this.messageCache.get(messageName) || {};

  const menuTopicName =
    cachedForMenu.chat_topic ||
    cachedForMenu.topic ||
    cachedForMenu.topic_name ||
    "";

  const menuTopicSubject =
    cachedForMenu.chat_topic_subject ||
    cachedForMenu.topic_subject ||
    cachedForMenu.chat_topic_title ||
    cachedForMenu.subject ||
    menuTopicName;

  const menuTopicColor =
    cachedForMenu.topic_color ||
    cachedForMenu.chat_topic_color ||
    this.topicColorMap?.get(menuTopicName) ||
    "";

  const safeMenuTopicName = frappe.utils.escape_html(String(menuTopicName || ""));
  const safeMenuTopicSubject = frappe.utils.escape_html(String(menuTopicSubject || menuTopicName || ""));
  const safeMenuTopicColor = frappe.utils.escape_html(String(menuTopicColor || ""));

  const openTopicButtonHtml = menuTopicName
    ? `
    <button
      type="button"
      class="relink-topic-menu-open topic-open-window-btn message-topic-open-action"
      data-message-name="${safeMessageName}"
      data-topic-name="${safeMenuTopicName}"
      data-topic-subject="${safeMenuTopicSubject}"
      data-topic-color="${safeMenuTopicColor}"
      title="${__("Open topic in new window")}"
      aria-label="${__("Open topic in new window")}"
    >
      ↗
    </button>
  `
    : "";

  if (isMyMessage) {
    items.push(`
      <div class="menu-item relink-topic-menu-row ${menuTopicName ? "" : "no-linked-topic"}" role="group">
        <button
          type="button"
          class="relink-topic-menu-main relink-action"
          data-message-name="${safeMessageName}"
          title="${__("ReLink Topic")}"
        >
          ${icon("relink")}
          <span class="menu-label">${__("ReLink")}</span>
        </button>

        ${openTopicButtonHtml}
      </div>
    `);
  } else if (menuTopicName) {
    items.push(`
      <div class="menu-item relink-topic-menu-row" role="group">
        <button
          type="button"
          class="relink-topic-menu-main topic-open-window-btn message-topic-open-action"
          data-message-name="${safeMessageName}"
          data-topic-name="${safeMenuTopicName}"
          data-topic-subject="${safeMenuTopicSubject}"
          data-topic-color="${safeMenuTopicColor}"
          title="${__("Open topic in new window")}"
          aria-label="${__("Open topic in new window")}"
        >
          ${icon("relink")}
          <span class="menu-label">${__("Open Topic")}</span>
        </button>
      </div>
    `);
  }

  if (isMyMessage && menuTopicName) {
    items.push(item({
      actionClass: "remove-message-topic-action",
      iconName: "delete",
      label: "Remove Topic",
      danger: true
    }));
  }

  if (isMyMessage) {
    items.push(item({
      actionClass: "delete-action",
      iconName: "delete",
      label: "Delete",
      danger: true
    }));
  }

  items.push(item({
    actionClass: "message-info-action",
    iconName: "info",
    label: "Message Info"
  }));

  const $menu = $(`
    <div class="message-action-menu" role="menu">
      ${items.join("")}
    </div>
  `);

  this.$wrapper.append($menu);
  this.$messageActionMenu = $menu;

  const triggerRect = $trigger[0].getBoundingClientRect();

  requestAnimationFrame(() => {
    const menuWidth = $menu.outerWidth();
    const menuHeight = $menu.outerHeight();

    let left = triggerRect.right - menuWidth;
    let top = triggerRect.bottom + 6;

    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));

    if (top + menuHeight > window.innerHeight - 8) {
      top = triggerRect.top - menuHeight - 6;
    }

    top = Math.max(8, top);

    $menu.css({
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      zIndex: 99999
    });
  });


  setTimeout(() => {
    $(document)
      .off("pointerdown.messageActionMenu")
      .on("pointerdown.messageActionMenu", (e) => {
        const insideMenu = $(e.target).closest(".message-action-menu").length;
        const insideTrigger = $(e.target).closest(".message-menu-trigger").length;

        if (!insideMenu && !insideTrigger) {
          this.closeMessageActionMenu();
          this.hideAllReactButtons();
        }
      });
  }, 0);
}


  render() {
    const me = this;
    this.$wrapper.css("display", "");
    this.$wrapper.html(this.$chat_space);
    this.$chat_space_container.animate(
      { scrollTop: this.$chat_space_container.prop("scrollHeight") },
      "fast"
    );
    this.setup_events();
  }

  checkScrollCondition() {
    if (
      this.$chat_space_container.scrollTop() +
        this.$chat_space_container.innerHeight() <
      this.$chat_space_container[0].scrollHeight
    ) {
      scroll_to_bottom(this.$chat_space_container);
    }
  }

  async set_channel_realtime(targetChannel) {
    const me = this;

    if (!targetChannel) return;

    const realtimeHandler = async function (res) {
      if (res.realtime_type == "create_sub_channel") {
        const last_active_sub_channel_before_realtime =
          me.last_active_sub_channel;
        me.last_active_sub_channel = res.sub_channel;
        if (me.profile.room_type == "Contributor") {
          if (!me.last_active_sub_channel) {
            me.$chat_actions.remove();
            me.$chat_actions = null;
            return;
          }
          const is_active_contributor = await me.is_active_contributor();
          if (is_active_contributor == 0) {
            me.last_active_sub_channel = "";
            me.$chat_actions.remove();
            me.$chat_actions = null;
          } else {
            me.unbindRealtimeChannel(last_active_sub_channel_before_realtime);
            me.set_channel_realtime(me.last_active_sub_channel);
            me.contributors = await get_sub_channel_members(
              me.last_active_sub_channel,
              me.profile.user_email
            );
            me.add_tag_section(me.contributors, 1);
            if (!me.$chat_actions) {
              await me.setup_actions();
              me.setup_events();
            }
          }
        } else if (me.last_active_sub_channel == me.profile.room) {
          me.last_active_sub_channel = "";
          me.contributors = await get_contributors(me.profile.room);
          me.add_tag_section(me.contributors, 1);
        } else if (me.last_active_sub_channel) {
          me.contributors = await get_contributors(me.profile.room);
          me.add_tag_section(me.contributors, 1);
        }
      } else if (res.realtime_type == "send_message") {
        if (res.sender_email != me.profile.user_email) {
          if (
            (me.profile.room_type == "Contributor" &&
              frappe.ErpnextChat.settings.open_chat_space_rooms.includes(
                me.profile.parent_channel
              )) ||
            (me.profile.room_type != "Contributor" &&
              frappe.ErpnextChat.settings.open_chat_space_rooms.includes(
                me.profile.room
              ))
          ) {
            frappe.utils.play_sound("chat-message-receive");
          }
        }

        if (
          me.profile.room_type == "Contributor" &&
          frappe.ErpnextChat.settings.open_chat_space_rooms.includes(
            me.profile.parent_channel
          )
        ) {
          mark_messsages_as_read(
            me.profile.user_email,
            null,
            me.profile.parent_channel
          );
        } else if (
          frappe.ErpnextChat.settings.open_chat_space_rooms.includes(
            me.profile.room
          )
        ) {
          mark_messsages_as_read(me.profile.user_email, me.profile.room);
        }
        if (!me.shouldAppendRealtimeMessage(res)) {
          return;
        }
        me.receive_message(res, get_time(res.send_date, me.profile.time_zone));

        const incomingTopic = res.chat_topic || res.topic || null;
        if (incomingTopic && !me.chat_topic_space && !me.is_topic_window && me.profile.room_type !== "Topic") {
         // me.setActiveMessageTopic(incomingTopic, res.chat_topic_subject || null);
          me.expandTopicMessages(incomingTopic);
        }
      } else if (res.realtime_type == "add_group_member") {
        if (
          res.added_user_email.some(
            (user) => user.email === me.profile.user_email
          )
        ) {
          me.profile.is_removed = 0;
          me.profile.remove_date = null;
          me.messages_offset = 0;
          me.messages_limit = 10;
          me.$chat_actions.remove();
          me.add_member_again = 1;
        }
        await me.get_chat_members();
      } else if (res.realtime_type == "remove_group_member") {
        if (res.removed_user_email == me.profile.user_email) {
          me.$chat_actions.html(
            `<div class='text-center'>You can't send messages to this group because you're no longer a participant. </div>`
          );
          me.profile.is_removed = 1;
          me.profile.remove_date = res.remove_date;
        }
        const removed_member = {
          name: res.removed_user,
          email: res.removed_user_email,
        };
        const exists = me.chat_members.some(
          (obj) => obj.email === removed_member.email
        );
        if (exists) {
          me.chat_members = me.chat_members.filter(
            (user) => user.email !== removed_member.email
          );
        }
      } else if (res.realtime_type == "rename_group") {
        me.$chat_space
          .find(".chat-profile-name")
          .text(
            res.new_group_name.length > 20
              ? res.new_group_name.substring(0, 20) + "..."
              : res.new_group_name
          )
          .attr("title", res.new_group_name);
      } else if (res.realtime_type == "typing") {
        let channel =
          me.profile.room_type == "Contributor"
            ? me.profile.parent_channel
            : me.profile.room;

        if (res.channel === channel) {
          if (res.is_typing == "true" && res.user !== me.profile.user_email) {
            me.showTypingIndicator(res.first_name, res.mobile_app, res.user);
          }
          // for mobile app
          if (
            res.mobile_app == "1" &&
            res.is_typing == "false" &&
            res.user !== me.profile.user_email
          ) {
            me.hideTypingIndicator(res.user);
          }
        }
      } else if (res.realtime_type == "show_template") {
      
        
       
          if (res.user === me.profile.user_email && res.template && res.template.length > 0) {
            me.showTemplateSuggestions(res);
          } 
      } else if (res.realtime_type == "set_topic") {
        me.chat_topic = res.chat_topic;
        me.reference_doctypes = me.reference_doctypes.concat(
          res.mention_doctypes
        );
        me.chat_topic_status = "private";
      } else if (res.realtime_type == "add_doctype") {
        me.reference_doctypes = me.reference_doctypes.concat(
          res.mention_doctypes
        );
      } else if (res.realtime_type == "remove_topic") {
        me.chat_topic = null;
        me.reference_doctypes = [];
        me.clearMessageTopic(false);
        me.updateActiveTopicButton(null);
      } else if (res.realtime_type == "clear_message_topic") {
        const topicToClear = res.chat_topic ? String(res.chat_topic) : null;
        const activeTopic = me.activeMessageTopic ? String(me.activeMessageTopic) : null;
        if (!topicToClear || !activeTopic || activeTopic === topicToClear) {
          me.clearMessageTopic(false);
        }
      } else if (res.realtime_type == "close_topic" && res.user_scoped == 1) {
        const topicToClear = res.chat_topic || res.topic_name || null;
        const rtChatChannel = me.getCurrentChatChannel?.() ||
          (me.profile.room_type === "Contributor" ? me.profile.parent_channel : me.profile.room);

        if (res.chat_channel && rtChatChannel && res.chat_channel !== rtChatChannel) {
          return;
        }

        if (!topicToClear || me.activeMessageTopic === topicToClear) {
          me.clearMessageTopic(false);
          me.updatePlusTopicButton?.();
        }
      } else if (res.realtime_type == "close_topic") {
        const closedTopic = res.chat_topic || me.chat_topic || null;
        if (closedTopic && (!me.activeMessageTopic || String(me.activeMessageTopic) === String(closedTopic))) {
          me.clearMessageTopic(false);
        }
        me.clearClosedTopicUi(closedTopic);
      } else if (res.realtime_type == "remove_doctype") {
        if (me.reference_doctypes.length == 1) {
          me.reference_doctypes = [];
        } else {
          me.reference_doctypes = me.reference_doctypes.filter(
            (doc) => doc.docname !== res.removed_doctype
          );
        }
      } else if (res.realtime_type == "rename_topic") {
        me.chat_topic_subject = res.new_subject;

        const renamedTopic =
          res.chat_topic ||
          me.chat_topic_space ||
          me.chat_topic ||
          null;

        if (
          me.isDedicatedTopicContext?.() &&
          renamedTopic &&
          String(renamedTopic) === String(me.chat_topic_space || me.chat_topic || me.profile?.chat_topic)
        ) {
          me.chat_topic_space_subject = me.normalizeTopicSubject
            ? me.normalizeTopicSubject(res.new_subject, renamedTopic)
            : String(res.new_subject || renamedTopic);

          const displayTitle = me.chat_topic_space_subject;
          me.$chat_space
            .find(".chat-profile-name")
            .text(displayTitle.length > 25 ? displayTitle.substring(0, 25) + "..." : displayTitle)
            .attr("title", displayTitle);
        }

        [me.topicMetaMap, me.allKnownTopicMetaMap].forEach((map) => {
          if (!map || !renamedTopic || !map.has(String(renamedTopic))) return;
          const meta = map.get(String(renamedTopic)) || {};
          meta.subject = res.new_subject || meta.subject;
          map.set(String(renamedTopic), meta);
        });
      } else if (res.realtime_type == "set_topic_status") {
        me.chat_topic_status = res.chat_topic_status;
    } else if (res.realtime_type == "delete_message") {

  const $msg = me.$chat_space.find(`#msg-${res.message_name}`);
  if ($msg.length) {
    const $bubble = $msg.find(".message-bubble");
    $bubble.html(`
      <div style="font-style:italic; opacity:0.6;">
        This message was deleted
      </div>
    `);
    
   
    const cached = me.messageCache.get(res.message_name);
    if (cached) {
      cached.is_deleted = 1;
      cached.content = '<div style="font-style:italic; opacity:0.6;">This message was deleted</div>';
        me.messageCache.set(res.message_name, cached);
    };
  }
      } else if (res.realtime_type == "update_message") {

  await me.handleMessageUpdate(
    res.message_name,
    res.changes || {},
    res.force_rebuild || false
  );

      } else if (res.realtime_type == "edit_message") {
  await me.handleMessageEdit(res);
      } else if (res.realtime_type == "reactions_message") {
       

  me.renderReactions(res.message_name, {
    data: {
      reactions: res.reactions,
      emoji_counts: res.emoji_counts
    }
  });
      const cached = me.messageCache.get(res.message_name) || {};
        cached.reactions_json = JSON.stringify([{
          reactions: res.reactions || [],
          emoji_summary: {
            total_emojis: Object.values(res.emoji_counts || {}).reduce((a,b)=>a+(b||0), 0),
            emoji_details: res.emoji_counts || {}
          }
        }]);
        me.messageCache.set(res.message_name, cached);
      }
    };

    // If Frappe's realtime.off() does not support handler-specific unbind
    // (off.length < 2), unbindRealtimeChannel skips global off() to avoid
    // breaking other ChatSpace instances. Old handlers remain but are tracked
    // per-instance so unbindAllRealtimeChannels can still clean up safely.

    this.bindRealtimeChannel(targetChannel, realtimeHandler);
  }
async handleMessageEdit(res) {
  const { message_name, content, original_content } = res;

  const $msg = this.$chat_space.find(`#msg-${message_name}`);
  if (!$msg.length) return;

  let processedContent = content || "";
  processedContent = this.check_if_content_has_email(processedContent);
  processedContent = this.check_if_content_has_link(processedContent);

  const $bubble = $msg.find(".message-bubble");

  const $menuTrigger = $bubble.find(".message-menu-trigger").detach();
  const $reactHoverBtn = $bubble.find(".react-hover-btn").detach();
  const $replyLink = $bubble.find(".reply-link").detach();
  const $forwardedLabel = $bubble.find(".forwarded-label").detach();

  $bubble.empty();

  if ($replyLink.length) $bubble.append($replyLink);
  if ($forwardedLabel.length) $bubble.append($forwardedLabel);

  $bubble.append(processedContent);

  $bubble.append(`
    <div class="edited-label" style="
      font-size:11px;
      opacity:0.6;
      margin-top:4px;
    ">
      Edited
    </div>
  `);

  $bubble.append($menuTrigger);
  $bubble.append($reactHoverBtn);

  const cached = this.messageCache.get(message_name);
  if (cached) {
    cached.content = processedContent;
    cached.is_edited = 1;
    cached.original_content = original_content;
    this.messageCache.set(message_name, cached);
  }
}

async handleMessageUpdate(messageName, changes = {}, forceRebuild = false) {

  const $msg = this.$chat_space.find(`#msg-${messageName}`);
  if (!$msg.length) return;


  if (forceRebuild) {
    await this.rebuildMessage(messageName);
    return;
  }

  const rebuildFields = [
    "message_type",
    "attachment",
    "is_media",
    "is_document",
    "is_voice_clip",
    "reply_to_message"
  ];

  const shouldRebuild = Object.keys(changes).some(field =>
    rebuildFields.includes(field)
  );

  if (shouldRebuild) {
    await this.rebuildMessage(messageName);
    return;
  }

  // ===== PATCH MODE =====
  const $bubble = $msg.find(".message-bubble");

  // content
  if (changes.content !== undefined) {
    const $menuTrigger = $bubble.find(".message-menu-trigger").detach();
const $reactHoverBtn = $bubble.find(".react-hover-btn").detach();
const $replyLink = $bubble.find(".reply-link").detach();
const $forwardedLabel = $bubble.find(".forwarded-label").detach();
const $editedLabel = $bubble.find(".edited-label").detach();

$bubble.empty();

if ($replyLink.length) $bubble.append($replyLink);
if ($forwardedLabel.length) $bubble.append($forwardedLabel);

let patchedContent = changes.content || "";
patchedContent = this.check_if_content_has_email(patchedContent);
patchedContent = this.check_if_content_has_link(patchedContent);

$bubble.append(patchedContent);

if ($editedLabel.length) $bubble.append($editedLabel);
$bubble.append($menuTrigger);
$bubble.append($reactHoverBtn);

  }

  // forwarded
  if (changes.is_forwarded !== undefined) {
    if (Number(changes.is_forwarded) === 1) {
      if (!$bubble.find(".forwarded-label").length) {
        $bubble.prepend(`
          <div class="forwarded-label"
               style="font-size:11px; opacity:0.7; margin-bottom:4px;">
            ↪ Forwarded
          </div>
        `);
      }
    } else {
      $bubble.find(".forwarded-label").remove();
    }
  }

  // reply text
  if (changes.reply_preview_text !== undefined) {
    $bubble.find(".reply-text").text(changes.reply_preview_text);
  }

  // reply sender
  if (changes.reply_preview_sender !== undefined) {
    $bubble.find(".reply-sender").text(changes.reply_preview_sender);
  }

  const cached = this.messageCache.get(messageName) || {};
  Object.assign(cached, changes);
  this.messageCache.set(messageName, cached);

}
async rebuildMessage(messageName) {

  const msg = await this.fetch_single_message(messageName);
  if (!msg) return;

  let message_type = "sender-message";

  if (msg.sender_email === this.profile.user_email) {
    message_type = "recipient-message";
  }

  if (msg.message_type === "information") {
    message_type = "info-message";
  }

      const rebuiltTopicName = msg.chat_topic || msg.topic || null;
      const rebuilt = await this.make_message({
        content: msg.content,
        original_content: msg.original_content || null,
        time: get_time(msg.send_date, this.profile.time_zone),
        type: message_type,
        sender: msg.sender,
        message_name: msg.message_name,
        message_template_type: msg.message_template_type,
        chat_topic: rebuiltTopicName,
        chat_topic_subject: msg.chat_topic_subject || msg.topic_subject || msg.chat_topic_title || null,
        topic_color: rebuiltTopicName ? this.getTopicColor(rebuiltTopicName, msg.topic_color || msg.chat_topic_color || null) : null,
        send_date: msg.send_date,
        reply_to_message: msg.reply_to_message,
        reply_preview: {
          type: msg.reply_preview_type,
          text: msg.reply_preview_text,
          sender: msg.reply_preview_sender,
          file_url: msg.reply_preview_file_url
        },
        is_forwarded: msg.is_forwarded,
        is_edited: msg.is_edited ,
        reference_doctypes: this.chat_topic_space ? this.reference_doctypes : null,
      });

  const $old = this.$chat_space.find(`#msg-${messageName}`);
  if ($old.length) {
    $old.replaceWith(rebuilt);
  }

  this.messageCache.set(messageName, msg);
}

  async get_last_active_sub_channel() {
    let is_active_contributor = 1;
    if (this.profile.room_type == "Contributor") {
      this.last_active_sub_channel = await get_last_active_sub_channel(
        this.profile.parent_channel
      );
      if (!this.last_active_sub_channel) {
        return;
      }
      is_active_contributor = await check_if_contributor_active(
        this.last_active_sub_channel,
        this.profile.user_email
      );
      if (is_active_contributor == 0) {
        this.last_active_sub_channel = "";
      }
    } else {
      this.last_active_sub_channel = await get_last_active_sub_channel(
        this.profile.room
      );
    }
  }

  async add_tag_section(contributors, reset = 0) {
    const tag_section_exists = this.$chat_space.find(".tag-section").length > 0;
    if (contributors && contributors.length > 0) {
      const tag_section = `
    <div class="tag-section">
      <div class='show-contributors'><span class="contributors_count_icon" onclick = "openAll(this);">${frappe.utils.icon(
        "users",
        "md"
      )}</span> </div>
      <div class='tags-container'>  
      </div>
    </div>
    
    <script>
      function openAll(el) {
        
        $(el).closest('.chat-space').find('.tags-container').css("display","flex")
        $(el).closest('.tag-section').css("botton","63px")
        $(el).closest('.tag-section').css("overflow","auto")
        $(el).closest('.tag-section').find(".tag-blot").removeClass("tag-blot-hidden");
      }

      $(document).on('click', function (e) {
        if ($(e.target).closest(".tag-section").length === 0) {
            $(e.target).closest('.chat-space').find(".tags-container").hide();
        }
      }); 

    </script>`;

      if (tag_section_exists && reset == 1) {
        await this.$chat_space.find(".tag-section").remove();
      }

      if (!tag_section_exists || reset == 1) {
        await this.$chat_space.find(".message-send-button").after(tag_section);
      }

      this.add_tag_blot(contributors);
    } else if (tag_section_exists) {
      this.$chat_space.find(".tag-section").remove();
    }
  }

  async add_tag_blot(contributors) {
    if (contributors.length > 0) {
      for (let i = 0; i < contributors.length; i++) {
        this.tag_blot = new TagBlot({
          $wrapper: this.$chat_space.find(".tags-container"),
          profile: {
            chat_space: this,
            contributor_email: contributors[i].email,
            contributor_name: contributors[i].name,
          },
        });
        this.$chat_space.find(".tags-container").append(this.tag_blot);
        var count = this.$chat_space.find(".tag-blot").length;
        if (count > 0) {
          this.$chat_space.find(".tag-blot").addClass("tag-blot-hidden");
        }
      }
    }
  }

  async get_all_sub_channels_for_contributor() {
    if (this.profile.room_type == "Contributor") {
      this.all_sub_channels_for_contributor =
        await get_all_sub_channels_for_contributor(
          this.profile.parent_channel,
          this.profile.user_email
        );
    }
  }

  async is_active_contributor() {
    return await check_if_contributor_active(
      this.last_active_sub_channel,
      this.profile.user_email
    );
  }

  async on_scroll() {
    const me = this;
    // loading old messages
    if (me.$chat_space_container.scrollTop() == 0) {
      if (me.loading_messages_timeout) {
        clearTimeout(me.loading_messages_timeout);
        me.loading_messages_timeout = null;
      }
      me.loading_messages_timeout = setTimeout(async () => {
        me.messages_offset += me.messages_limit;

        const res = await me.fetchMessagesForCurrentContext(
          me.messages_offset,
          me.messages_limit
        );

        const olderMessages = res.results || [];

        if (!olderMessages.length) {
          return;
        }

        await me.make_messages_html(olderMessages, 1);
        me.$chat_space_container.prepend(me.message_html);
        me.normalizeTopicSeparators();
        if (!me.chat_topic_space) {
          me.buildTopicMetaMap();
          me.applyTopicVisibility();
        }
        me.resolvePendingReplies();
        me.hydrateReactionsForMessages(res.results);
        if (res.results.length != 0) {
          me.$chat_space_container.off("scroll");
          me.$chat_space_container.scrollTop(300);
          me.$chat_space_container.on("scroll", function () {
            me.on_scroll();
          });
        }
      }, 300);
    }
    // show the scroll down icon
    const $chatBox = me.$chat_space_container;
    const st = me.$chat_space_container.scrollTop();
    const totalHeight = $chatBox.prop("scrollHeight");
    const visibleHeight = $chatBox.outerHeight();

    const scrollableHeight = totalHeight - visibleHeight;

    const scrollUpThreshold =
      (me.scrollUpThresholdPercent / 100) * scrollableHeight;
    const bottomThreshold =
      (me.bottomThresholdPercent / 100) * scrollableHeight;
    var arrowButton = me.$chat_space_container.find(".arrow-button");

    if (st < me.lastScrollTop && st < scrollUpThreshold) {
      // Show button only if scrolled up beyond threshold percentage
      arrowButton.css("display", "inline-flex");
    } else if (st + visibleHeight >= totalHeight - bottomThreshold) {
      // Hide button if scrolled to the bottom (within threshold percentage)
      arrowButton.css("display", "none");
    }
    if (this.isNearBottom()) {
        this.resetUnreadBadge();
      }

    me.lastScrollTop = st; // Update last scroll position
  }
async setupTypingIndicator(textValue) {
    let user = this.profile.user_email;
    let room;

    if (this.profile.room_type == "Contributor") {
      room = this.profile.parent_channel;
    } else {
      room = this.profile.room;
    }
   
    if (textValue && textValue.startsWith("/")) {
      this.callSetTypingAPI(user, room, "true", textValue);
      
    } else {
    
      this.callSetTypingAPI(user, room, "true");
    }



    setTimeout(async () => {
      this.isTypingIndicatorActive = false;
    }, 2500);

    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    // for mobile app
    this.typingTimeout = setTimeout(async () => {
      this.callSetTypingAPI(user, room, "false");
    }, 3000);
  }

  callSetTypingAPI(user, room, isTyping,textValue) {
   
    frappe.call({
      method: "clefincode_chat.api.api_1_3_4.api.set_typing",
      args: {
        user: user,
        room: room,
        is_typing: isTyping,
        last_active_sub_channel: this.last_active_sub_channel,
        text: textValue,
      },
    });
  }

  showTypingIndicator(user, mobile_app, user_email) {
    const statusDiv = this.$chat_space.find(".chat-profile-status");
    statusDiv.text(`${user} is typing...`);
    if (!mobile_app) {
      if (this.showTypingIndicatorTimeout) {
        clearTimeout(this.showTypingIndicatorTimeout);
        this.showTypingIndicatorTimeout = null;
      }
      this.showTypingIndicatorTimeout = setTimeout(() => {
        this.hideTypingIndicator(user_email);
      }, 3000);
    }
  }
showTemplateSuggestions(res) {
  let chatWindow;
    const me = this; 


if (res.room) {
  chatWindow = $(`.chat-window[data-room="${res.room}"]`);
}

else {
  chatWindow = this.$wrapper.closest(".chat-window");
}

if (!chatWindow || !chatWindow.length) {
  console.warn("Chat window not found");
  return;
}

  const editor = chatWindow.find(".type-message .ql-editor");


  chatWindow.find("#template-suggestions").remove();
  
  const container = $(`
   <div id="template-suggestions"
  style="
    position:absolute;
    background:#fff;
    border:1px solid #ccc;
    border-radius:6px;
    box-shadow:0 4px 10px rgba(0,0,0,0.15);
    padding:8px;
    z-index:500;
    max-height:220px;
    overflow-y:auto;
    font-size:13px;
    width:256px;
    opacity:0;
    transform:translateY(10px);
    transition:all 0.25s ease;
  ">
</div>
  `);
  
  res.template.forEach((t) => {
    const name = t.name || "Unnamed Template";
    const doctype_type=t.doctype

   const item = $(`
  <div style="padding:8px; cursor:pointer; border-bottom:1px solid #eee;">
    <table style="width:100%; font-size:13px;">
      <tr>
        <td style="font-weight:bold; color:#333;">${t.meta_template_name || t.template_name}</td>
       
      </tr>
      
    </table>
  </div>
`);

    item.hover(
      function () {
        $(this).css("background", "#e6dedeff");
      },
      function () {
        $(this).css("background", "transparent");
      }
    );

   item.on("click", async function () {
      if (!res.room) {
    await me.create_direct_channel(name);
  }
    editor.text("/" + name);
    container.fadeOut(200, () => container.remove());

    const check = await check_reference_doctype_empty(name, doctype_type);

    // Determine template type based on the doctype
    let template_type = (doctype_type === "Clefincode Chat Template")
        ? "Send Template Public"
        : "Send Template";

    if (check.empty) {
          const room =
            me.profile.room_type === "Contributor"
              ? me.profile.parent_channel
              : me.profile.room;
        const message_info = {
            content: name,
            user: me.profile.user,
            room: room,
            email:  me.profile.user,
            message_type: "information",
            message_template_type: template_type
        };

        send_message(message_info);
        editor.html("");
    }
    else {
                const room =
            me.profile.room_type === "Contributor"
              ? me.profile.parent_channel
              : me.profile.room;

          if (!room) {
            console.warn("No room available for topic info");
            return;
          }


        let topic_info = await get_topic_info(room);

        if (!topic_info || !topic_info.length) {
            console.error("topic_info is empty", topic_info);
            return;
        }

        let topic = topic_info[0];
        let reference_doctypes = topic.reference_doctypes;

        // If doctype exists in reference list
        if (reference_doctypes.some(d => d.doctype === check.value)) {
            console.log("Value exists in reference_doctypes");
        }

        // Select docname
        show_doctype_selector(check.value, function (selected_docname) {

            const message_info = {
                content: name + "," + selected_docname,
                user:  me.profile.user,
                room: room,
                email:  me.profile.user,
                message_type: "information",
                message_template_type: template_type
            };

            send_message(message_info);
            editor.html("");
        });
    }
});


    container.append(item);
  });

  
  editor.parent().css("position", "relative");
  editor.after(container);

  
  const rect = editor[0].getBoundingClientRect();
  const containerHeight = container.outerHeight();

  container.css({
    top: -(containerHeight + 5) + "px",
    left: "0px",
    width: rect.width + "px",
  });

  setTimeout(() => {
    container.css({
      opacity: "1",
      transform: "translateY(0)",
    });
  }, 10);
}
insertTemplateText (text) {
  const editor = me.$chat_actions.find(".ql-editor");
  if (editor && editor.length > 0) {
    editor.text(text);
  }
};
  async hideTypingIndicator(user_email) {
    if (this.profile.room_type == "Direct") {
      if (user_email && this.profile.contact == user_email) {
        this.set_online();
      } else {
        const last_active_value = await get_last_active(
          this.profile.contact,
          this.profile.user_email
        );
        if (last_active_value) {
          const last_active =
            get_date_from_now(
              last_active_value,
              "space",
              this.profile.time_zone
            ) +
            " " +
            get_time(last_active_value, this.profile.time_zone);
          this.$chat_space.find(".chat-profile-status").text(last_active);
        }
      }
    } else {
      this.$chat_space.find(".chat-profile-status").text(``);
    }
  }

  render_mentioned_doctype_section(docname) {
    this.$chat_space.find(".mentioned-doctype-section").remove();
    return;
  }

  async send_set_topic_message(docname, chat_channel) {
    const mention_msg_info = `
    <div class="set-topic" data-template = "set_topic_template">
    <span class="sender-user" data-user="${this.profile.user_email}"></span><span> set topic: "${docname}" </span>
    </div>`;

    const message_info = {
      content: mention_msg_info,
      user: this.profile.user,
      room: chat_channel,
      email: this.profile.user_email,
      message_type: "information",
      send_date: get_time(frappe.datetime.now_time(), this.profile.time_zone),
      message_template_type: "Set Topic",
      sub_channel: this.last_active_sub_channel,
      chat_topic: this.chat_topic,
    };

    await send_message(message_info);
  }

  async send_remove_topic_message(chat_channel, chat_topic_subject) {
    if (!chat_topic_subject) {
      chat_topic_subject = this.reference_doctypes[0].docname;
    }
    const mention_msg_info = `
    <div class="remove-topic" data-template = "remove_topic_template">
    <span class="sender-user" data-user="${this.profile.user_email}"></span><span> removed topic: "${chat_topic_subject}" </span>
    </div>`;

    const message_info = {
      content: mention_msg_info,
      user: this.profile.user,
      room: chat_channel,
      email: this.profile.user_email,
      message_type: "information",
      send_date: get_time(frappe.datetime.now_time(), this.profile.time_zone),
      message_template_type: "Remove Topic",
      sub_channel: this.last_active_sub_channel,
      chat_topic: this.chat_topic,
    };

    await send_message(message_info);
  }

  async send_rename_topic_message(new_subject, chat_channel) {
    const mention_msg_info = `
    <div class="rename-topic" data-template = "rename_topic_template">
    <span class="sender-user" data-user="${this.profile.user_email}"></span><span> changed the topic's subject to "${new_subject}" </span>
    </div>`;

    const message_info = {
      content: mention_msg_info,
      user: this.profile.user,
      room: chat_channel,
      email: this.profile.user_email,
      message_type: "information",
      send_date: get_time(frappe.datetime.now_time(), this.profile.time_zone),
      message_template_type: "Rename Topic",
      sub_channel: this.last_active_sub_channel,
      chat_topic: this.chat_topic,
    };

    await send_message(message_info);
  }

  async send_add_document_message(docnames, chat_channel) {
    let documents =
      docnames.length > 1
        ? docnames.map((obj) => obj.docname).join(", ")
        : docnames[0].docname;
    const mention_msg_info = `
    <div class="add-doctype" data-template = "add_doctype_template">
    <span class="sender-user" data-user="${this.profile.user_email}"></span><span> added ${documents} </span>
    </div>`;

    const message_info = {
      content: mention_msg_info,
      user: this.profile.user,
      room: chat_channel,
      email: this.profile.user_email,
      message_type: "information",
      send_date: get_time(frappe.datetime.now_time(), this.profile.time_zone),
      message_template_type: "Add Doctype",
      sub_channel: this.last_active_sub_channel,
      chat_topic: this.chat_topic,
    };

    await send_message(message_info);
  }

  set_online() {
    if (this.profile.room_type == "Direct") {
      this.$chat_space.find(".chat-profile-status").text("online");
      if (this.online_timeout) {
        clearTimeout(this.online_timeout);
        this.online_timeout = null;
      }
      this.online_timeout = setTimeout(async () => {
        const last_active_value = await get_last_active(
          this.profile.contact,
          this.profile.user_email
        );
        if (last_active_value) {
          const last_active =
            get_date_from_now(
              last_active_value,
              "space",
              this.profile.time_zone
            ) +
            " " +
            get_time(last_active_value, this.profile.time_zone);
          this.$chat_space.find(".chat-profile-status").text(last_active);
        }
      }, 60000);
    } else {
      this.$chat_space.find(".chat-profile-status").text("");
    }
  }
  isNearBottom(threshold = this.autoScrollThresholdPx) {
  if (!this.$chat_space_container || !this.$chat_space_container.length) return true;

  const el = this.$chat_space_container[0];
  const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);

  return distanceFromBottom <= threshold;
}

ensureUnreadBadge() {
  let $badge = this.$chat_space.find(".new-messages-badge");

  if (!$badge.length) {
    $badge = $(`
      <div class="new-messages-badge" style="
        display:none;
        position:absolute;
        right:16px;
        bottom:84px;
        z-index:20;
      ">
        <button type="button" class="new-messages-btn" style="
          border:none;
          border-radius:999px;
          padding:8px 12px;
          box-shadow:0 4px 12px rgba(0,0,0,.18);
          cursor:pointer;
          font-size:12px;
          display:flex;
          align-items:center;
          gap:8px;
        ">
          <span class="new-messages-text">0 new messages</span>
          <span class="new-messages-arrow">↓</span>
        </button>
      </div>
    `);

    this.$chat_space.css("position", "relative");
    this.$chat_space.append($badge);

    $badge.on("click", ".new-messages-btn", () => {
      scroll_to_bottom(this.$chat_space_container);
      this.resetUnreadBadge();
    });
  }

  return $badge;
}

updateUnreadBadge() {
  const $badge = this.ensureUnreadBadge();

  if (this.unseenMessagesCount <= 0) {
    $badge.hide();
    return;
  }

  const label =
    this.unseenMessagesCount === 1
      ? "1 new message"
      : `${this.unseenMessagesCount} new messages`;

  $badge.find(".new-messages-text").text(label);
  $badge.show();

  this.$chat_space_container.find(".arrow-button").css("display", "inline-flex");
}

resetUnreadBadge() {
  this.unseenMessagesCount = 0;
  const $badge = this.$chat_space.find(".new-messages-badge");
  if ($badge.length) $badge.hide();
}

} //End class ChatSpace

async function get_messages(
  room,
  user_email,
  room_type,
  chat_topic_space,
  remove_date,
  limit,
  offset
) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_4.api.get_messages",
    args: {
      room: room,
      user_email: user_email,
      chat_topic: chat_topic_space,
      remove_date: remove_date,
      room_type: room_type,
      limit: limit,
      offset: offset,
    },
  });

  return await res.message;
}

async function get_contributors(room) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_2_1.api.get_contributors",
    args: {
      room: room,
    },
  });
  return await res.message.results[0].contributors;
}

async function get_sub_channel_members(room, user_email) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_2_1.api.get_sub_channel_members",
    args: {
      room: room,
      user_email: user_email,
    },
  });
  return await res.message.results[0].contributors;
}

async function get_last_active_sub_channel(room) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_2_1.api.get_last_active_sub_channel",
    args: {
      room: room,
    },
  });
  return await res.message.results[0].last_active_sub_channel;
}

async function get_all_sub_channels_for_contributor(
  parent_channel,
  user_email
) {
  const res = await frappe.call({
    type: "GET",
    method:
      "clefincode_chat.api.api_1_2_1.api.get_all_sub_channels_for_contributor",
    args: {
      parent_channel: parent_channel,
      user_email: user_email,
    },
  });
  return await res.message.results;
}

async function update_sub_channel_for_last_message(
  user,
  user_email,
  mentioned_users_emails,
  last_chat_space_message,
  last_active_sub_channel,
  content,
  chat_room,
  old_sub_channel
) {
  const res = frappe.call({
    type: "POST",
    method:
      "clefincode_chat.api.api_1_2_1.api.update_sub_channel_for_last_message",
    args: {
      user: user,
      user_email: user_email,
      mentioned_users_emails: mentioned_users_emails,
      last_chat_space_message: last_chat_space_message,
      last_active_sub_channel: last_active_sub_channel,
      content: content,
      chat_room: chat_room,
      old_sub_channel: old_sub_channel,
    },
  });
  return res.message;
}

async function get_last_active(contact_email, user_email) {
  const last_active = await frappe.call({
    method: "clefincode_chat.api.api_1_2_1.api.get_last_active",
    args: {
      contact_email: contact_email,
      user_email: user_email,
    },
  });
  return await last_active.message.results[0].last_active;
}

async function add_reference_doctype(
  mention_doctypes,
  chat_topic,
  last_active_sub_channel
) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_2_1.api.add_reference_doctype",
    args: {
      mention_doctypes: mention_doctypes,
      chat_topic: chat_topic,
      last_active_sub_channel: last_active_sub_channel,
    },
  });
  return await res.message;
}

async function get_topic_info(chat_channel) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_4.api.get_topic_info",
    args: {
      chat_channel: chat_channel,
    },
  });
  return await res.message.results;
}

async function create_chat_topic(
  mention_doctypes,
  chat_channel,
  last_active_sub_channel
) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_4.api.create_chat_topic",
    args: {
      mention_doctypes: mention_doctypes,
      chat_channel: chat_channel,
      last_active_sub_channel: last_active_sub_channel,
    },
  });
  return await res.message.results;
}

export async function remove_chat_topic(
  chat_topic,
  chat_channel,
  last_active_sub_channel
) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_2_1.api.remove_chat_topic",
    args: {
      chat_topic: chat_topic,
      chat_channel: chat_channel,
      last_active_sub_channel: last_active_sub_channel,
    },
  });
  return await res.message.results;
}

async function close_chat_topic(
  chat_channel,
  chat_topic,
  last_active_sub_channel,
  user_email,
  user_name
) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_4.api.close_chat_topic",
    args: {
      chat_channel: chat_channel,
      chat_topic: chat_topic,
      last_active_sub_channel: last_active_sub_channel,
      user_email: user_email,
      user_name: user_name,
    },
  });
  return await res.message.results;
}

async function clear_message_topic(
  chat_channel,
  chat_topic,
  last_active_sub_channel
) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_4.api.clear_message_topic",
    args: {
      chat_channel: chat_channel,
      chat_topic: chat_topic,
      last_active_sub_channel: last_active_sub_channel,
    },
  });
  return await res.message.results;
}

async function check_if_user_has_permission(
  user_email,
  chat_topic_space,
  chat_topic_channel
) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_2_1.api.check_if_user_has_permission",
    args: {
      user_email: user_email,
      chat_topic: chat_topic_space,
      chat_channel: chat_topic_channel,
    },
  });
  return await res.message;
}

async function check_if_user_send_request(user_email, chat_topic_space) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_2_1.api.check_if_user_send_request",
    args: {
      user_email: user_email,
      chat_topic: chat_topic_space,
    },
  });
  return await res.message;
}

async function send_topic_access_request(
  user_email,
  chat_topic_space,
  chat_topic_channel,
  chat_topic_space_subject,
  reference_doctype,
  reference_docname
) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_2_1.api.send_topic_access_request",

    args: {
      user_email: user_email,
      chat_topic: chat_topic_space,
      chat_channel: chat_topic_channel,
      chat_topic_subject: chat_topic_space_subject,
      reference_doctype: reference_doctype,
      reference_docname: reference_docname,
    },
  });
  return await res.message;
}

async function create_website_support_group(website_user_email, content) {
  const res = await frappe.call({
    method:
      "clefincode_chat.api.api_1_0_1.chat_portal.create_website_support_group",
    args: {
      website_user_email: website_user_email,
      content: content
    },
  });
  return await res.message.results[0];
}

async function check_reference_doctype_empty(docname,template_type) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_4.api.is_reference_doctype_Template_empty",
    args: { docname,template_type },
  });
  
  return res.message; // { empty: true/false, value: "DocType" }
}

function show_doctype_selector(doctype, callback) {
  const d = new frappe.ui.Dialog({
    title: `Select ${doctype}`,
    fields: [
      {
        fieldname: "docname",
        label: `Select ${doctype}`,
        fieldtype: "Link",
        options: doctype,
        reqd: 1
      }
    ],
    primary_action_label: "Select",
    primary_action(values) {
      d.hide();
      callback(values.docname);
    }
  });

  d.show();
}
 function getDeskBasePath() {
  const path = window.location.pathname || "";

  // Frappe v16
  if (path.startsWith("/desk")) return "/desk";

  // Frappe v15
  if (path.startsWith("/app")) return "/app";

  // fallback: v15 default
  return "/app";
}

 function getFormUrl(doctype, docname) {
  const routeDoctype =
    frappe.router && frappe.router.slug
      ? frappe.router.slug(doctype)
      : doctype.toLowerCase().replace(/\s+/g, "-");

  return `${getDeskBasePath()}/${routeDoctype}/${encodeURIComponent(docname)}`;
}
