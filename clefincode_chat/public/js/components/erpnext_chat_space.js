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

    // open chat space for showing topic information
    this.chat_topic_space = opts.chat_topic;
    this.chat_topic_channel = opts.chat_topic_channel;
    this.is_private_topic = opts.is_private_topic;
    this.chat_topic_space_subject = opts.chat_topic_subject;
    this.alternative_subject = opts.alternative_subject;
    this.not_authorized_user = false;
    this.chat_status = opts.chat_status;
    this.reply_to_message_name = null;
    this.pendingReplies = [];
    this.searchResults = [];
    this.currentSearchIndex = -1;
    this.searchQuery = null;
    this.searchActive = false;

    this.longPress = {
      timer: null,
      startX: 0,
      startY: 0,
      fired: false,
      targetMessage: null,
    };
    this.$emojiMenu = null;

    if (this.chat_topic_space) {
      this.profile.room_type = "Topic";
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
    this.messageCache = new Map();
    this.setup();
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

  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_3.api.search_in_message_contents",
    args: {
      channel: this.profile.room,
      query: query,
      sub_channel: this.last_active_sub_channel || null
    }
  });
   

  this.searchResults = res.message.results || [];
  this.currentSearchIndex = -1;

  const count = res.message.count || 0;

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
      is_deleted: msg.is_deleted || 0
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

    let res;
    if (this.profile.room_type === "Contributor") {
      res = await get_messages(
        this.all_sub_channels_for_contributor,
        this.profile.user_email,
        this.profile.room_type,
        null,
        null,
        limit,
        this.messages_offset
      );
    } else if (this.profile.room_type === "Topic") {
      res = await get_messages(
        "",
        this.profile.user_email,
        this.profile.room_type,
        this.chat_topic_space,
        this.profile.remove_date,
        limit,
        this.messages_offset
      );
    } else {
      res = await get_messages(
        this.profile.room,
        this.profile.user_email,
        this.profile.room_type,
        null,
        this.profile.remove_date,
        limit,
        this.messages_offset
      );
    }

    
    if (!res.results || res.results.length === 0) {
      break;
    }

    
    await this.make_messages_html(res.results, 1);
    this.$chat_space_container.prepend(this.message_html);

    
    $msg = this.$chat_space.find(`#msg-${messageName}`);
    

    if ($msg.length) {
      this.highlightAndScroll($msg);
      return;
    }
  }

  frappe.msgprint("Original message not found.");
}
highlightAndScroll($msg) {
  const $bubble = $msg.find(".message-bubble").first();
  if (!$bubble.length) return;


  $msg[0].scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
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
    method: "clefincode_chat.api.api_1_3_3.api.add_or_update_reaction",
    args: { message_name: messageName, emoji }
  });
}
async getReactions(messageName) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_3.api.get_reactions_for_message",
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

  if (this.profile.room_type === "Topic") {
    args.chat_topic = this.profile.chat_topic;
  }

  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_1.api.get_single_message",
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
    this.profile.room || this.chat_topic_space
      ? await this.fetch_and_setup_messages()
      : this.create_empty_space();
    await this.get_topic_info();
  }

  setup_chat_window() {
    var screen_width = $("body").outerWidth();
    var right_width = $(".chat_right_section").outerWidth();
    var left_width = $(".chat_left_section").outerWidth();
    if (right_width + left_width > screen_width) {
      if (screen_width < 750) {
        $(".close-chat-list").click();
        if (left_width > screen_width) {
          $(".chat-window").each(function (index) {
            if ($(this).css("display") != "none") {
              $(".collapse-chat-window")[index].click();
              return false;
            }
          });
        }
      } else {
        $(".chat-window").each(function (index) {
          if ($(this).css("display") != "none") {
            $(".collapse-chat-window")[index].click();
            return false;
          }
        });
      }
    }
  }

  async setup_header() {
    let header_title;
    let header_full_name;

    if (this.chat_topic_space) {
        this.avatar_html = "";
        header_title = this.chat_topic_space_subject
            ? this.chat_topic_space_subject.replace(/"/g, "")
            : this.alternative_subject;
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
  
            const $search = this.$chat_space.find(".chat-search");
            $search.hide();


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
      if (this.profile.room_type == "Contributor") {
        res = await get_messages(
          this.all_sub_channels_for_contributor,
          this.profile.user_email,
          this.profile.room_type,
          null,
          null,
          this.messages_limit,
          this.messages_offset
        );
      } else if (this.profile.room_type == "Topic") {
        res = await get_messages(
          "",
          this.profile.user_email,
          this.profile.room_type,
          this.chat_topic_space,
          this.profile.remove_date,
          this.messages_limit,
          this.messages_offset
        );
      } else {
        res = await get_messages(
          this.profile.room,
          this.profile.user_email,
          this.profile.room_type,
          null,
          this.profile.remove_date,
          this.messages_limit,
          this.messages_offset
        );
      
      }
      await this.setup_messages(res.results);
      await this.setup_actions();
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
    if (!this.profile.room) {
      return;
    }
    let topic_info = await get_topic_info(
      this.profile.room_type == "Contributor"
        ? this.profile.parent_channel
        : this.profile.room
    );
    this.chat_topic = topic_info[0].chat_topic;
    this.chat_topic_subject = topic_info[0].chat_topic_subject;
    this.chat_topic_status = topic_info[0].chat_topic_status;
    this.reference_doctypes = topic_info[0].reference_doctypes;
    if (this.chat_topic) {
      this.render_mentioned_doctype_section(this.chat_topic_subject);
    }
  }

  setup_socketio() {
    const me = this;
    frappe.realtime.on("update_last_active", function (res) {
      if (
        res.sender_email == me.profile.contact &&
        me.profile.room_type == "Direct"
      ) {
        me.set_online();
      }
    });

    
    if (!this.profile.room) return;

    const target_channel =
      me.profile.room_type === "Contributor" && me.last_active_sub_channel
        ? me.last_active_sub_channel
        : me.profile.room;
    this.set_channel_realtime(target_channel);
  }

  async setup_actions() {
    
    if (
      (this.profile.room_type == "Contributor" &&
        this.last_active_sub_channel == "") ||
      this.profile.room_type == "Topic"
    ) {
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

    const file_attachment = `<span class='open-attach-items'>
  ${frappe.utils.icon("attachment", "lg")}
  </span>
  <input type='file' id='chat-file-uploader' 
    accept='image/*, application/pdf, .doc, .docx'
    style='display: none;'>`;

    const chat_actions_html = `
      <div class="message-section">
          ${this.profile.room_type != "Guest" ? file_attachment : ``}
          ${this.type_message_input.wrapper}
          <span class='message-send-button' style="display:none">
              <svg xmlns="http://www.w3.org/2000/svg" width="1.1rem" height="1.1rem" viewBox="0 0 24 24">
                  <path d="M24 0l-6 22-8.129-7.239 7.802-8.234-10.458 7.227-7.215-1.754 24-12zm-15 16.668v7.332l3.258-4.431-3.258-2.901z"/>
              </svg>
          </span>
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

    this.add_tag_section(this.contributors);
  }

  setup_events() {
    const me = this;
    
    const LONG_PRESS_MS = 450;
    const MOVE_CANCEL_PX = 12;

    // pointerdown
    this.$chat_space.on("pointerdown", ".message-bubble", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;

      this.longPress.fired = false;
      this.longPress.targetMessage = $(e.currentTarget)
        .closest("[data-message-name]")
        .data("message-name");

      this.longPress.startX = e.clientX;
      this.longPress.startY = e.clientY;

      clearTimeout(this.longPress.timer);

      this.longPress.timer = setTimeout(() => {
        this.longPress.fired = true;

        
        $(".message-actions").hide();

        const $bubble = $(e.currentTarget);
        this.openEmojiMenu({
          $bubble,
          messageName: this.longPress.targetMessage,
        });
      }, LONG_PRESS_MS);
    });

    
    this.$chat_space.on("pointermove", ".message-bubble", (e) => {
      if (!this.longPress.timer) return;

      const dx = Math.abs(e.clientX - this.longPress.startX);
      const dy = Math.abs(e.clientY - this.longPress.startY);

      if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
        clearTimeout(this.longPress.timer);
        this.longPress.timer = null;
      }
    });

    // pointerup/cancel
    this.$chat_space.on("pointerup pointercancel", ".message-bubble", () => {
      clearTimeout(this.longPress.timer);
      this.longPress.timer = null;
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
      frappe.realtime.off(me.profile.room);
      frappe.realtime.off(me.last_active_sub_channel);
      frappe.realtime.off("update_last_active");
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
    });

    me.$chat_space_container.on("scroll", function () {
      me.on_scroll();
    });

    if (this.$chat_actions && this.$chat_actions.length > 0) {
      this.$chat_actions.find(".open-attach-items").on("click", function () {
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
this.$chat_space.on("click", ".message-bubble", function (e) {
  e.stopPropagation();
  if (me.longPress && me.longPress.fired) {
    me.longPress.fired = false;
    return;
  }
  // hide all actions first
  $(".message-actions").hide();

  // show only for this message
  $(this).find(".message-actions").show();
});

// Hide when clicking outside
$(document).on("click", function () {
  $(".message-actions").hide();
});
this.$chat_space.on("click", ".edit-btn", function (e) {
  e.stopPropagation();

  const $wrapper = $(this).closest("[data-message-name]");
  const messageName = $wrapper.data("message-name");

  const cached = me.messageCache.get(messageName) || {};
  
  const isEditedBefore = Number(cached.is_edited || 0) === 1;

  const currentText = (cached.content || "")
  .replace(/<\/p>\s*<p>/g, "\n")
  .replace(/<\/?p>/g, "")
  .trim();

  if (isEditedBefore) {
   
    const originalText = me.stripHtml(cached.original_content || "") || "—";

    const d = new frappe.ui.Dialog({
      title: "Edit Message",
      fields: [
        {
          label: "Original Message",
          fieldname: "original_message",
          fieldtype: "Small Text",
          read_only: 1,
          default: originalText
        },
        {
          label: "Current Message",
          fieldname: "current_message",
          fieldtype: "Small Text",
          read_only: 1,
          default: currentText || "—"
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
        fieldtype: "Small Text",
        reqd: 1,
        default: currentText || ""
      }
    ],
    primary_action_label: "Save",
    primary_action: async (values) => {
      const formattedContent = values.content
      .split("\n")
      .map(line => `<p>${line.trim()}</p>`)
      .join("");
      await frappe.call({
        method: "clefincode_chat.api.api_1_3_3.api.edit_chat_message",
        args: {
          message_name: messageName,
          new_content: formattedContent,
        }
      });
      const $bubble = $wrapper.find(".message-bubble");

      
      const $actions = $bubble.find(".message-actions").detach();

      
      $bubble.find("p").remove();
      $bubble.find(".edited-label").remove();

      
      // $bubble.contents().filter((_, n) => n.nodeType === 3).remove(); // text nodes

    
      $bubble.append(formattedContent);

      
      $bubble.append(`
        <div class="edited-label" style="
          font-size:11px;
          opacity:0.6;
          margin-top:4px;
        ">Edited</div>
      `);

     
      if ($actions.length) $bubble.append($actions);

 
      

        cached.content = formattedContent;
        cached.is_edited = 1;

        me.messageCache.set(messageName, cached);

      d.hide();
    },
    secondary_action_label: "Cancel",
    secondary_action: () => d.hide()
  });

  d.show();
});

    // Reply button click
this.$chat_space.on("click", ".reply-btn", async function (e) {
  e.stopPropagation();

  const $wrapper = $(this).closest("[data-message-name]");
  const messageName = $wrapper.data("message-name");
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
});


  this.$chat_space.on("click", ".forward-btn", async function (e) {
  e.stopPropagation();

  const $wrapper = $(this).closest("[data-message-name]");
  const messageName = $wrapper.data("message-name");


  const cached = me.messageCache.get(messageName);

  const forward_payload = {
    message_name: messageName,
    sender: cached?.sender || "",
    content: cached?.content || $wrapper.find(".message-bubble").clone()
      .find(".message-actions").remove().end().html(),
                
            
            is_link: cached.is_link || 0,
            is_media: cached.is_media || 0,
            is_document: cached.is_document || 0,
            is_voice_clip: cached.is_voice_clip || 0,
            is_screenshot: cached.is_screenshot || 0,
            file_id: cached.file_id || null,
            attachment: cached.attachment || null,
            message_type: cached.message_type || null,

            
            is_forwarded: 1,
  };


  erpnext_chat_app.chat_contact_list = new ChatContactList({
    $wrapper: me.$wrapper,         
    profile: me.profile,
    forward: 1,
    forward_payload,
    chat_space: me,               
  });

  erpnext_chat_app.chat_contact_list.render();
});

this.$chat_space.on("click", ".cancel-reply", function () {
  me.reply_to_message_name = null;
  $(".reply-preview").remove();
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
this.$chat_space.on("click", ".delete-btn", function (e) {
  e.stopPropagation();

  const $wrapper = $(this).closest("[data-message-name]");
  const messageName = $wrapper.data("message-name");

  frappe.confirm(
    "Are you sure you want to delete this message?",
    async function () {

      await frappe.call({
        method: "clefincode_chat.api.api_1_3_3.api.delete_chat_message",
        args: {
          message_name: messageName,
          user_email: me.profile.user_email
        }
      });

      const $bubble = $wrapper.find(".message-bubble");
      $bubble.html(`
        <div style="font-style:italic; opacity:0.6;">
          This message was deleted
        </div>
      `);
    }
  );
});
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
    const type_message_input = this.$chat_actions.find(".type-message");
    if (
      type_message_input.find(".ql-editor").find("p").text() != "" ||
      type_message_input.find(".ql-editor").find("p").find("img").length > 0
    ) {
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
    await this.make_messages_html(messages_list);
    this.$chat_space_container.html(this.message_html);
    this.$chat_space.append(this.$chat_space_container);
    this.resolvePendingReplies();
    this.hydrateReactionsForMessages(messages_list);
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
      this.prevMessage = element;
      const down_arrow_html = this.make_down_arrow_html();
      this.message_html += date_line_html;
      this.message_html += down_arrow_html;

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
        original_content: element.original_content || null,
        reactions_json: element.reactions_json || null,

        
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
        is_forwarded:element.is_forwarded,
         is_deleted: element.is_deleted,
          is_edited: element.is_edited ,

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
    } = params;
    const $recipient_element = $(document.createElement("div"))
      .addClass(type)
      .attr("data-message-name", message_name)
      .attr("id", `msg-${message_name}`);

    const $message_element = $(document.createElement("div"))
  .addClass("message-bubble")
  .css("position", "relative");

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

        $message_element.append($sanitized_content);
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
  console.log("is dark", isDark)

  const bg = isDark ? "transparent" : "#f1f3f5";
  console.log("the bg", bg)

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
  const $messageActions = $(`
  <div class="message-actions" style="
    display:none;
    margin-top:6px;
    
    gap:12px;
    font-size:12px;
    color:#6c757d;
    cursor:pointer;
  ">
  <span class="edit-btn">
        ${frappe.utils.icon("edit", "sm")} Edit
      </span>
    <span class="reply-btn" style="margin-left:8px;">
      ${frappe.utils.icon("reply", "sm")} Reply
    </span>
    <span class="forward-btn">
      <img src="${forwardIcon}"
       width="14" height="14"
       style="margin-left:8px;"> Forward
    </span>
    
    <span class="delete-btn">
      <img src="${deleteIcon}"
       width="14" height="14"
       style="margin-left:8px;"> Delete
    </span>

  </div>
`);

const isMyMessage = sender_email === this.profile.user_email;

if (!is_deleted) {
  const isTextOnly =
  !is_deleted &&
  !this.messageCache.get(message_name)?.is_media &&
  !this.messageCache.get(message_name)?.is_document &&
  !this.messageCache.get(message_name)?.is_voice_clip &&
  !this.messageCache.get(message_name)?.attachment;


  if (!isMyMessage ) {
    $messageActions.find(".delete-btn").remove();
    $messageActions.find(".edit-btn").remove();
  }
   if ( !isTextOnly) {
   
    $messageActions.find(".edit-btn").remove();
  }

  $message_element.append($messageActions);
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
    this.$chat_space_container.removeClass("chat-space-center");
    this.$chat_space_container.find(".no-messages-info").remove();

    if (
      this.$chat_space_container.find(".ask-to-join") &&
      this.$chat_space_container.find(".ask-to-join").length > 0
    ) {
      this.$chat_space_container.find(".mention-message:last").remove();
    }

    if (
      this.$chat_space.find(".ql-editor").find("p").text().trim().length == 0 &&
      !attachment &&
      this.$chat_space.find(".ql-editor").find("img").length == 0
    ) {
      return;
    }

    let content = this.$chat_space.find(".ql-editor").html();
    (this.is_link = null),
      (this.is_media = null),
      (this.is_document = null),
      (this.is_voice_clip = null);
    let chat_room;
    let is_screenshot = 0;
    if (this.$chat_space.find(".ql-editor").find("p").find("img").length > 0) {
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
          chat_topic: this.chat_topic,
        };
        this.last_chat_space_message = await send_message(message_info);

        // ================= Handling with Doctypes Mentions =======================
        if (this.chat_topic) {
          await add_reference_doctype(
            mention_doctypes,
            this.chat_topic,
            this.last_active_sub_channel
          );
          await this.send_add_document_message(mention_doctypes, chat_room);
        } else {
          let results = await create_chat_topic(
            mention_doctypes,
            chat_room,
            this.last_active_sub_channel
          );
          // we must update the chat topic in the chat channel message
          // this.chat_topic = results[0].chat_topic
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
          chat_topic: this.chat_topic,
        };

        if (this.chat_topic) {
          await add_reference_doctype(
            mention_doctypes,
            this.chat_topic,
            this.last_active_sub_channel
          );

          this.last_chat_space_message = await send_message(message_info);
          await this.send_add_document_message(mention_doctypes, chat_room);
        } else {
          let results = await create_chat_topic(
            mention_doctypes,
            chat_room,
            this.last_active_sub_channel
          );
          message_info["chat_topic"] = results[0].chat_topic;

          this.last_chat_space_message = await send_message(message_info);
          await this.send_set_topic_message(
            mention_doctypes[0].docname,
            chat_room
          );
        }
        return;
      }
    }
    // ================= End Handling with Mentions ===========================

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
      chat_topic: this.chat_topic,
      is_screenshot: is_screenshot,
      reply_to_message_name: this.reply_to_message_name,
    };
   
    this.last_chat_space_message = await send_message(message_info);
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
      method: "clefincode_chat.api.api_1_3_1.api.get_template_suggestions",
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
      const mailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
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
      let message_content = await this.make_message({
        content: res.content,
        original_content: res.original_content || null,
        time: time,
        type: chat_type,
        sender: res.user,
        sender_email: res.sender_email, 
        message_name: res.message_name,
        message_template_type: res.message_template_type,
        reply_to_message:res.reply_to_message,
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
      this.$chat_space_container.append(message_content);
      this.resolvePendingReplies();

      scroll_to_bottom(this.$chat_space_container);
      this.fetchAndRenderReactions(res.message_name);
    }
    this.prevMessage = res;
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
    frappe.realtime.on(targetChannel, async function (res) {
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
            frappe.realtime.off(last_active_sub_channel_before_realtime);
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
        me.receive_message(res, get_time(res.send_date, me.profile.time_zone));
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
          // check if user not in chat details page
          if (
            !(
              me.$wrapper.find(".chat-info") &&
              me.$wrapper.find(".chat-info").length > 0
            )
          ) {
            me.render_mentioned_doctype_section(me.chat_topic_subject);
          }
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
        me.render_mentioned_doctype_section(res.mention_doctypes[0].docname);
      } else if (res.realtime_type == "add_doctype") {
        // empty chat topic
        if (!me.chat_topic && me.reference_doctypes.length == 0) {
          me.render_mentioned_doctype_section(res.mention_doctypes[0].docname);
        }
        me.reference_doctypes = me.reference_doctypes.concat(
          res.mention_doctypes
        );
      } else if (res.realtime_type == "remove_topic") {
        me.$chat_space.find(".mentioned-doctype-section").remove();
        me.chat_topic = null;
        me.reference_doctypes = [];
      } else if (res.realtime_type == "remove_doctype") {
        if (!me.chat_topic_subject) {
          if (res.removed_doctype == me.reference_doctypes[0].docname) {
            me.$chat_space
              .find(".mentioned-doctype-section")
              .find(".chat_topic_subject")
              .html(
                me.reference_doctypes[1].docname.length > 30
                  ? me.reference_doctypes[1].docname.substring(0, 30) + "..."
                  : me.reference_doctypes[1].docname
              );
          }
        }

        if (me.reference_doctypes.length == 1) {
          me.reference_doctypes = [];
        } else {
          me.reference_doctypes = me.reference_doctypes.filter(
            (doc) => doc.docname !== res.removed_doctype
          );
        }
      } else if (res.realtime_type == "rename_topic") {
        me.$chat_space
          .find(".mentioned-doctype-section")
          .find(".chat_topic_subject")
          .html(
            res.new_subject.length > 30
              ? res.new_subject.substring(0, 30) + "..."
              : res.new_subject
          );
        me.chat_topic_subject = res.new_subject;
      } else if (res.realtime_type == "set_topic_status") {
        let chat_topic_status_icon = `<img title="private topic" src="/assets/clefincode_chat/icons/eye-slash.svg">`;
        if (res.chat_topic_status == "public") {
          chat_topic_status_icon = `<img title="public topic" src="/assets/clefincode_chat/icons/eye.svg">`;
        }
        me.$chat_space
          .find(".mentioned-doctype-section")
          .find(".topic-status")
          .html(chat_topic_status_icon);
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
    }
    
  
    me.$chat_space.find(`.reply-link[data-jump="${res.message_name}"]`).each(function() {
      const $link = $(this);
      $link.find(".reply-text").text("This message was deleted");
     
      $link.find(".reply-thumb-wrap").remove();  
    });
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


    });
  }
  async handleMessageEdit(res) {
  
  const { message_name, content,original_content } = res;

  const $msg = this.$chat_space.find(`#msg-${message_name}`);
  if (!$msg.length) return;

  const $bubble = $msg.find(".message-bubble");


  const $actions = $bubble.find(".message-actions").detach();

  $bubble.html(content);


  $bubble.append(`
    <div class="edited-label" style="
      font-size:11px;
      opacity:0.6;
      margin-top:4px;
    ">
      Edited
    </div>
  `);

  if ($actions.length) {
    $bubble.append($actions);
  }

 
  const cached = this.messageCache.get(message_name);
  if (cached) {
    cached.content = content;
    cached.is_edited = 1;
    cached.original_content=original_content;
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
    $bubble.children().not(".message-actions").remove();
    $bubble.prepend(changes.content);
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

  const rebuilt = await this.make_message({
    content: msg.content,
    original_content: msg.original_content || null,
    time: get_time(msg.send_date, this.profile.time_zone),
    type: message_type,
    sender: msg.sender,
    message_name: msg.message_name,
    message_template_type: msg.message_template_type,
    reply_to_message: msg.reply_to_message,
    reply_preview: {
      type: msg.reply_preview_type,
      text: msg.reply_preview_text,
      sender: msg.reply_preview_sender,
      file_url: msg.reply_preview_file_url

    },
    is_forwarded: msg.is_forwarded,
     is_edited: msg.is_edited ,
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
        me.messages_offset += 10;
        let res;
        if (me.profile.room_type == "Contributor") {
          res = await get_messages(
            me.all_sub_channels_for_contributor,
            me.profile.user_email,
            me.profile.room_type,
            null,
            null,
            me.messages_limit,
            me.messages_offset
          );
        } else if (me.profile.room_type == "Topic") {
          res = await get_messages(
            "",
            me.profile.user_email,
            me.profile.room_type,
            me.chat_topic_space,
            me.profile.remove_date,
            me.messages_limit,
            me.messages_offset
          );
        } else {
          res = await get_messages(
            me.profile.room,
            me.profile.user_email,
            me.profile.room_type,
            null,
            me.profile.remove_date,
            me.messages_limit,
            me.messages_offset
          );
        }
        await me.make_messages_html(res.results, 1);
        me.$chat_space_container.prepend(me.message_html);
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
      method: "clefincode_chat.api.api_1_3_3.api.set_typing",
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
    const me = this;
    if (
      me.$chat_space.find(".mentioned-doctype-section") &&
      me.$chat_space.find(".mentioned-doctype-section").length > 0
    ) {
      me.$chat_space.find(".mentioned-doctype-section").remove();
    }
    let chat_topic_status_icon =
      me.chat_topic_status && me.chat_topic_status == "private"
        ? `<img title="private topic" src="/assets/clefincode_chat/icons/eye-slash.svg">`
        : `<img  title="public topic" src="/assets/clefincode_chat/icons/eye.svg">`;
    if (me.chat_topic && me.reference_doctypes.length == 0 && !docname) {
      docname = me.chat_topic_subject;
    } else if (!docname && me.reference_doctypes.length > 0) {
      docname = me.reference_doctypes[0].docname;
    }
    const mentioned_doctype_section = `
  <div class="mentioned-doctype-section">
    <div style="flex:1;margin-left:8px">
      <span><img src="/assets/clefincode_chat/icons/tag.svg"> </span><span class="chat_topic_subject" title="${docname}">${
      docname.length > 30 ? docname.substring(0, 30) + "..." : docname
    }</span>
    </div>
    <div> 
      <span class="topic-status mr-2">${chat_topic_status_icon}</span>     
      ${
        this.profile.room_type != "Contributor" && this.profile.is_removed != 1 && this.profile.user_type != "website_user"
          ? `
      <span class="edit-chat-topic-subject mr-2" ><img src="/assets/clefincode_chat/icons/edit.svg"></span>
      <span class="remove-topic" ><img src="/assets/clefincode_chat/icons/close.svg"></span>
      `
          : ``
      }
    </div>
  </div>`;

    this.$chat_space.find(".chat-header").after(mentioned_doctype_section);

    this.$chat_space.find(".remove-topic").on("click", function () {
      frappe.confirm(
        "Are you sure you want to remove this topic?",
        async function () {
          const chat_channel =
            me.profile.room_type == "Contributor"
              ? me.profile.parent_channel
              : me.profile.room;
          let chat_topic_subject = "";
          if (me.chat_topic_subject) {
            chat_topic_subject = me.chat_topic_subject;
          } else {
            chat_topic_subject = me.reference_doctypes[0].docname;
          }
          await remove_chat_topic(
            me.chat_topic,
            chat_channel,
            me.last_active_sub_channel
          );
          await me.send_remove_topic_message(chat_channel, chat_topic_subject);
        }
      );
    });

    this.$chat_space.find(".edit-chat-topic-subject").on("click", function () {
      const chat_channel =
        me.profile.room_type == "Contributor"
          ? me.profile.parent_channel
          : me.profile.room;
      var d = new frappe.ui.Dialog({
        title: "Edit Topic Subject",
        fields: [
          {
            label: "New Subject",
            fieldname: "chat_topic_subject",
            fieldtype: "Data",
            length: 50,
            reqd: 1,
          },
        ],
        primary_action: function () {
          var data = d.get_values();

          frappe.call({
            method: "clefincode_chat.api.api_1_2_1.api.set_topic_subject",
            args: {
              chat_topic: me.chat_topic,
              new_subject: data.chat_topic_subject,
              chat_channel: chat_channel,
              last_active_sub_channel: me.last_active_sub_channel,
            },
            callback: function (r) {
              if (!r.exc) {
                me.send_rename_topic_message(
                  data.chat_topic_subject,
                  chat_channel
                );
                d.hide();
              }
            },
          });
        },
        primary_action_label: "Edit",
      });
      d.show();
    });

    if (
      this.profile.room_type != "Contributor" &&
      this.profile.is_removed != 1 && 
      this.profile.user_type != "website_user"
    ) {
      this.$chat_space.find(".topic-status").on("click", function () {
        const chat_channel =
          me.profile.room_type == "Contributor"
            ? me.profile.parent_channel
            : me.profile.room;
        let toggle_chat_topic_status =
          me.chat_topic_status && me.chat_topic_status == "private"
            ? "public"
            : "private";
        var d = new frappe.ui.Dialog({
          title: "Confirm Action",
          fields: [
            {
              label: "Are you sure you want to proceed?",
              fieldtype: "HTML",
              options: `Are you sure you want to set topic as ${toggle_chat_topic_status}?`,
            },
          ],
          primary_action_label: `Set as ${toggle_chat_topic_status}`,
          async primary_action() {
            frappe.call({
              method: "clefincode_chat.api.api_1_2_1.api.set_topic_status",
              args: {
                chat_topic: me.chat_topic,
                chat_topic_status: toggle_chat_topic_status,
                chat_channel: chat_channel,
                last_active_sub_channel: me.last_active_sub_channel,
              },
              callback: async function (r) {
                if (!r.exc) {
                  const content = `
                <div class="set-topic-status" data-template = "set_topic_status_template">
                <span class="sender-user" data-user="${me.profile.user_email}"></span><span> set topic as ${toggle_chat_topic_status}</span>
                </div>`;

                  const message_info = {
                    content: content,
                    user: me.profile.user,
                    room: me.profile.room,
                    email: me.profile.user_email,
                    message_type: "information",
                    send_date: get_time(
                      frappe.datetime.now_time(),
                      me.profile.time_zone
                    ),
                    message_template_type: "Set Topic Status",
                    sub_channel: me.last_active_sub_channel,
                    chat_topic: me.chat_topic,
                  };
                  await send_message(message_info);
                  d.hide();
                }
              },
            });
          },
        }).show();
      });
    }
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
    method: "clefincode_chat.api.api_1_3_3.api.get_messages",
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
    method: "clefincode_chat.api.api_1_2_1.api.get_topic_info",
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
    method: "clefincode_chat.api.api_1_2_1.api.create_chat_topic",
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
    method: "clefincode_chat.api.api_1_3_1.api.is_reference_doctype_Template_empty",
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