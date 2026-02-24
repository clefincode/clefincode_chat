import {
  get_current_time,
  get_date_from_now,
  is_date_change,
  get_t,
  scroll_to_bottom,
  get_current_datetime,
} from "./erpnext_chat_utils";

export default class ChatPortalSpace {
  constructor(opts) {
    this.$wrapper = opts.$wrapper; // chat container
    this.profile = opts.profile;
    this.chat_bubble = opts.chat_bubble;
    this.is_first_message = 1;
    this.setup();
    this.messageCache = new Map();

    this.reply_to_message_name = null;
    this.pendingReplies = [];

    this.searchResults = [];
    this.currentSearchIndex = -1;
    this.searchQuery = null;

    this.$emojiMenu = null;
    this.longPress = {
      timer: null,
      startX: 0,
      startY: 0,
      fired: false,
      targetMessage: null,
    };
  }
handlePortalMessageEdit(res) {
  const messageName = res.message_name;
  const newHtml = res.content || "";
  const original = res.original_content || null;

  const $msg = this.$chatbot_container.find(`#msg-${messageName}`);
  if (!$msg.length) return;

  const $bubble = $msg.find(".message-bubble");
  if (!$bubble.length) return;

  const $actions = $bubble.find(".message-actions").detach();
  const $edited = $bubble.find(".edited-label").detach();
  const $reply = $bubble.find(".reply-link").detach();       
  const $forwarded = $bubble.find(".forwarded-label").detach(); 


  $bubble.find("p").remove();
  $bubble.contents().filter((_, n) => n.nodeType === 3).remove(); // text nodes
  


  if ($forwarded.length) $bubble.prepend($forwarded);
  if ($reply.length) $bubble.prepend($reply);

  $bubble.append(newHtml);

 
  $bubble.find(".edited-label").remove();
  $bubble.append(`
    <div class="edited-label" style="font-size:11px;opacity:0.6;margin-top:4px;">
      Edited
    </div>
  `);

 
  if ($actions.length) $bubble.append($actions);

 
  const cached = this.messageCache.get(messageName) || {};
  cached.content = newHtml;
  cached.original_content = original;
  cached.is_edited = 1;
  this.messageCache.set(messageName, cached);
}
  parseReactionsFromReactionsJson(reactions_json) {
  try {
    if (!reactions_json) return { reactions: [], emoji_counts: {} };

    const parsed = typeof reactions_json === "string"
      ? JSON.parse(reactions_json)
      : reactions_json;

    const root = Array.isArray(parsed) ? (parsed[0] || {}) : parsed;
    const reactions = root.reactions || [];
    const emoji_counts = root.emoji_summary?.emoji_details || {};

    return { reactions, emoji_counts };
  } catch (e) {
    return { reactions: [], emoji_counts: {} };
  }
}

getReactionsForDialog(messageName) {

  const cached = this.messageCache.get(messageName) || {};
  if (cached.reactions_json) {
    return this.parseReactionsFromReactionsJson(cached.reactions_json);
  }

  
  const $msg = this.$chatbot_container.find(`#msg-${messageName}`);
  const attr = $msg.attr("data-reactions");
  if (attr) return this.parseReactionsFromReactionsJson(attr);

  return { reactions: [], emoji_counts: {} };
}

renderReactionsFromJson(messageName, reactions_json) {
  const { reactions, emoji_counts } = this.parseReactionsFromReactionsJson(reactions_json);

  
  this.renderReactions(messageName, { data: { reactions, emoji_counts } });

 
  const $msg = this.$chatbot_container.find(`#msg-${messageName}`);
  if ($msg.length) {
    $msg.attr("data-reactions",
      typeof reactions_json === "string" ? reactions_json : JSON.stringify(reactions_json)
    );
  }

  
  const cached = this.messageCache.get(messageName) || {};
  cached.reactions_json =
    typeof reactions_json === "string" ? reactions_json : JSON.stringify(reactions_json);
  this.messageCache.set(messageName, cached);
}
  openLocalReactionsDialog(reactions) {

  reactions.sort((a, b) => 
    (b.send_date || "").localeCompare(a.send_date || "")
  );

  const rows = reactions.map(r => {

    const rendered = (window.emojione && emojione.toImage)
      ? emojione.toImage(r.emoji)
      : r.emoji;

    return `
      <div style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        padding:8px 0;
        border-bottom:1px solid #eee;
      ">
        <div style="font-weight:600;">
          ${frappe.utils.escape_html(r.emoji_sender)}
        </div>
        <div style="font-size:18px;">
          ${rendered}
        </div>
      </div>
    `;
  }).join("");

  const d = new frappe.ui.Dialog({
    title: "Reactions",
    size: "small",
    fields: [
      {
        fieldtype: "HTML",
        options: `
          <div style="max-height:350px; overflow:auto;">
            ${rows}
          </div>
        `
      }
    ],
    primary_action_label: "Close",
    primary_action() {
      d.hide();
    }
  });

  d.show();
}
portalEditPrompt({ title = "Edit Message", defaultText = "", onSave }) {
  const id = "edit_" + Math.random().toString(36).slice(2);

  frappe.msgprint({
    title,
    message: `
      <div>
        <textarea id="${id}" class="form-control"
          style="min-height:160px; white-space:pre-wrap;"
        >${frappe.utils.escape_html(defaultText || "")}</textarea>

        <div style="margin-top:10px; display:flex; justify-content:flex-end; gap:8px;">
          <button type="button" class="btn btn-primary" id="${id}_save">Save</button>
        </div>
      </div>
    `
  });

  const clickNs = `click.${id}`;

  const handler = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const $btn = $("#" + id + "_save");
    const $ta = $("#" + id);

    if (!$btn.length || !$ta.length) return; 

    try {
      $btn.prop("disabled", true);
      const val = $ta.val();
      await onSave(val);

      const $modal = $btn.closest(".modal");
      if ($modal.length) $modal.modal("hide");
    } catch (err) {
      console.error(err);
      frappe.msgprint("Failed to save changes.");
    } finally {
      $btn.prop("disabled", false);


      $(document).off(clickNs, "#" + id + "_save");
    }
  };


  $(document).off(clickNs, "#" + id + "_save");
  $(document).on(clickNs, "#" + id + "_save", handler);


  setTimeout(() => {
    const $ta = $("#" + id);
    if ($ta.length) $ta.trigger("focus");
  }, 0);
}
htmlToPlainText(html) {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<\/?p>/gi, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

plainTextToParagraphs(text) {
  const safe = frappe.utils.escape_html(text || "");
  return safe
    .split("\n")
    .map(line => `<p>${line}</p>`)
    .join("");
}
clearSearchHighlights() {
  this.$chatbot_container.find(".search-highlight").each(function () {
    $(this).replaceWith($(this).text());
  });
}
renderReactions(messageName, payload) {
  const $msg = this.$chatbot_container.find(`#msg-${messageName}`);

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
async fetchAndRenderReactions(messageName) {
  try {
   // const payload = await this.getReactions(messageName);
 
    const cached = this.messageCache.get(messageName) || {};
    cached.reactions_payload = payload;
    this.messageCache.set(messageName, cached);

    this.renderReactions(messageName, payload);
  } catch (e) {
    console.warn("Failed to load reactions", messageName, e);
  }
}
async hydrateReactionsForMessages(messages_list = []) {
  const names = messages_list.map(m => m.message_name).filter(Boolean);
  await Promise.all(names.map(n => this.fetchAndRenderReactions(n)));
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
    const me = this;
    await this.saveReaction(messageName, emoji);
    //await this.fetchAndRenderReactions(messageName);
  
      const cached = me.messageCache.get(messageName) || {};
      const current = me.parseReactionsFromReactionsJson(cached.reactions_json);

      const sender = me.profile.user_email || "Guest";

      const reactions = (current.reactions || []).filter(r => r.emoji_sender !== sender);
      reactions.push({
        emoji_sender: sender,
        emoji,
        send_date: get_current_datetime ? get_current_datetime() : ""
      });

      // rebuild summary
      const emoji_details = {};
      reactions.forEach(r => {
        emoji_details[r.emoji] = (emoji_details[r.emoji] || 0) + 1;
      });

      const newJsonObj = [{
        reactions,
        emoji_summary: {
          total_emojis: reactions.length,
          emoji_details
        }
      }];

      me.renderReactionsFromJson(messageName, JSON.stringify(newJsonObj));
        } finally {
          this.closeEmojiMenu();
        }
});




  $(document).off("pointerdown.emojiMenu").on("pointerdown.emojiMenu", (e) => {
    if (!$(e.target).closest(".emoji-menu").length) this.closeEmojiMenu();
  });

  this.$emojiMenu = $menu;
}
async saveReaction(messageName, emoji) {
  return frappe.call({
    method: "clefincode_chat.api.api_1_3_3.chat_portal.add_or_update_reaction",
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
// async openReactionsDialog(messageName, initialEmoji = null) {
//   const { reactions, emoji_counts } = this.getReactionsForDialog(messageName);

//   const items = (reactions || []).map(r => ({
//     emoji: r.emoji,
//     sender: r.emoji_sender || r.sender || "",
//     send_date: r.send_date || ""
//   }));

//   if (!items.length) {
//     frappe.msgprint("No reactions yet.");
//     return;
//   }


//   const emojis = Object.keys(emoji_counts || {});
//   const hasInitial = initialEmoji && emojis.includes(initialEmoji);

//   let currentFilter = hasInitial ? initialEmoji : null; // null = All

//   const renderEmoji = (emo) =>
//     (window.emojione && emojione.toImage) ? emojione.toImage(emo) : emo;

//   const uniqueEmails = [...new Set(items.map(x => x.sender).filter(Boolean))];
//   const nameMap = {};
//   await Promise.all(uniqueEmails.map(async (email) => {
//     try {
//       nameMap[email] = (email === this.profile.user_email)
//         ? "You"
//         : (await get_profile_full_name(email) || email);
//     } catch {
//       nameMap[email] = email;
//     }
//   }));


//   const filtersHtml = `
//     <div class="rx-filters" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
//       <button type="button" class="rx-filter btn btn-sm ${currentFilter ? "btn-default" : "btn-primary"}" data-emoji="">
//         All <b>${items.length}</b>
//       </button>

//       ${emojis.map(emo => `
//         <button type="button" class="rx-filter btn btn-sm ${currentFilter === emo ? "btn-primary" : "btn-default"}" data-emoji="${frappe.utils.escape_html(String(emo))}">
//           ${renderEmoji(emo)} <b>${emoji_counts[emo] ?? 0}</b>
//         </button>
//       `).join("")}
//     </div>
//   `;

//   const d = new frappe.ui.Dialog({
//     title: "Reactions",
//     size: "small",
//     fields: [
//       {
//         fieldtype: "HTML",
//         fieldname: "rx_body",
//         options: `
//           ${filtersHtml}
//           <div class="rx-list" style="max-height:360px; overflow:auto; padding-right:6px;"></div>
//         `
//       }
//     ],
//     primary_action_label: "Close",
//     primary_action() { d.hide(); }
//   });

//   const renderList = () => {
//     const filtered = currentFilter
//       ? items.filter(x => x.emoji === currentFilter)
//       : items;

//     filtered.sort((a, b) => (b.send_date || "").localeCompare(a.send_date || ""));

//     const rows = filtered.map(x => {
//       const displayName = frappe.utils.escape_html(nameMap[x.sender] || x.sender || "");
//       const when = frappe.utils.escape_html(x.send_date || "");
//       return `
//         <div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #eee;">
//           <div style="width:28px; text-align:center; font-size:18px;">${renderEmoji(x.emoji)}</div>
//           <div style="flex:1; min-width:0;">
//             <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${displayName}</div>
//             ${when ? `<div style="font-size:11px; opacity:.7;">${when}</div>` : ``}
//           </div>
//         </div>
//       `;
//     }).join("");

//     d.$wrapper.find(".rx-list").html(rows || `<div style="opacity:.7;">No reactions</div>`);
//   };

//   d.show();
//   renderList();

//   d.$wrapper.on("click", ".rx-filter", (e) => {
//     const emo = $(e.currentTarget).data("emoji");
//     currentFilter = emo ? String(emo) : null;

//     d.$wrapper.find(".rx-filter").removeClass("btn-primary").addClass("btn-default");
//     $(e.currentTarget).removeClass("btn-default").addClass("btn-primary");

//     renderList();
//   });
// }
openReactionsDialog(messageName, initialEmoji = null) {
  const { reactions, emoji_counts } = this.getReactionsForDialog(messageName);

  const items = (reactions || []).map(r => ({
    emoji: r.emoji,
    sender: r.emoji_sender || r.sender || "",
    send_date: r.send_date || ""
  }));

  if (!items.length) {
    frappe.msgprint("No reactions yet.");
    return;
  }

  const renderEmoji = (emo) =>
    (window.emojione && emojione.toImage) ? emojione.toImage(emo) : emo;

  
  let filtered = items;
  if (initialEmoji) filtered = items.filter(x => x.emoji === initialEmoji);

  filtered.sort((a, b) => (b.send_date || "").localeCompare(a.send_date || ""));
 

  const rows = filtered.map(x => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #eee;">
      <div style="width:28px;text-align:center;font-size:18px;">${renderEmoji(x.emoji)}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${frappe.utils.escape_html(firstNameFromEmail(x.sender) || "")}
        </div>
        ${x.send_date ? `<div style="font-size:11px;opacity:.7;">${frappe.utils.escape_html(x.send_date)}</div>` : ``}
      </div>
    </div>
  `).join("");

  const summary = Object.keys(emoji_counts || {}).map(emo => `
    <span style="display:inline-flex;align-items:center;gap:6px;margin-right:10px;">
      ${renderEmoji(emo)} <b>${emoji_counts[emo] || 0}</b>
    </span>
  `).join("");

  frappe.msgprint({
    title: "Reactions",
    message: `
      <div style="margin-bottom:10px;">${summary || ""}</div>
      <div style="max-height:360px;overflow:auto;padding-right:6px;">${rows}</div>
    `
  });
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
closeEmojiMenu() {
  if (this.$emojiMenu && this.$emojiMenu.length) {
    this.$emojiMenu.remove();
  }
  this.$emojiMenu = null;
  $(document).off("pointerdown.emojiMenu");
}
performSearchLocal(query) {
  this.clearSearchHighlights();
  this.searchQuery = query;

  const q = query.toLowerCase();
  const matches = [];
  const regex = new RegExp(`(${query})`, "gi");

  const me = this;

  this.$chatbot_container.find("[data-message-name]").each(function () {
    const $msg = $(this);
    const name = $msg.data("message-name");
    const $bubble = $msg.find(".message-bubble").first();

    const originalHtml = $bubble.html();
    const plainText = $bubble.text().toLowerCase();

    if (name && plainText.includes(q)) {
      matches.push(name);

      const highlighted = originalHtml.replace(
        regex,
        '<span class="search-highlight">$1</span>'
      );

      $bubble.html(highlighted);
    }
  });

  this.searchResults = matches;
  this.currentSearchIndex = -1;

  this.$chatbot_space
    .find(".search-count")
    .text(matches.length ? `0 / ${matches.length}` : "0");

  if (matches.length) this.goToNextResult();
}
goToNextResult() {
  if (!this.searchResults.length) return;
  this.currentSearchIndex = (this.currentSearchIndex + 1) % this.searchResults.length;
  this.navigateToSearchResult();
}

goToPreviousResult() {
  if (!this.searchResults.length) return;
  this.currentSearchIndex = (this.currentSearchIndex - 1 + this.searchResults.length) % this.searchResults.length;
  this.navigateToSearchResult();
}

navigateToSearchResult() {
  const name = this.searchResults[this.currentSearchIndex];
  const $msg = this.$chatbot_container.find(`#msg-${name}`);
  if (!$msg.length) return;

  this.$chatbot_container.find(".search-highlight-active")
    .removeClass("search-highlight-active");

 
  $msg.find(".search-highlight").first()
    .addClass("search-highlight-active");

  $msg[0].scrollIntoView({ behavior: "smooth", block: "center" });

  this.$chatbot_space
    .find(".search-count")
    .text(`${this.currentSearchIndex + 1} / ${this.searchResults.length}`);
}
stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return (div.textContent || div.innerText || "").trim();
}

async makeReplySnippet(replyMsgName, maxLen = 80) {
  const original = this.messageCache.get(replyMsgName);
  console.log(replyMsgName);
//   for (const [key, value] of this.messageCache.entries()) {
//   console.log("Message:", key, value);
// }
  if (!original) return { sender: "", text: "↩ Reply to message" };

  let text = original.is_deleted ? "This message was deleted" : this.stripHtml(original.content);
  if (!text) text = "[Attachment]";
  if (text.length > maxLen) text = text.slice(0, maxLen) + "…";
  return { sender: original.sender || "", text };
}
  async setup() {
    this.$chatbot_space = $(document.createElement("div")).addClass(
      "chatbot-space"
    );
    this.setup_header();
    await this.setup_container();
    await this.setup_actions();
    this.setup_events();
    this.setup_socket();
  }

  setup_header() {
  const header_html = `
    <div class='chat-header'>
        <div class='chat-profile-info'>
            <div class='chat-profile-name'>
              ${erpnext_chat_app.res.chat_support_title}
              <div class='online-circle' style="background:#28a745"></div>
            </div>
        </div>    

        <div style="display:flex; align-items:center; gap:10px;">
          <span class="toggle-search" style="cursor:pointer;">
            ${frappe.utils.icon("search", "md")}
          </span>

          <span class='close-chat-window'>
            ${frappe.utils.icon("close", "lg")}
          </span>
        </div>
    </div>

    <div class="chat-search" style="display:none; padding:6px 10px;">
      <input type="text" class="chat-search-input form-control" placeholder="Search… (Enter)" />
      <div style="display:flex; gap:6px; margin-top:6px; align-items:center;">
        <button type="button" class="search-prev btn btn-default btn-sm">‹</button>
        <button type="button" class="search-next btn btn-default btn-sm">›</button>
        <span class="search-count" style="opacity:.7;">0</span>
        <button type="button" class="search-clear btn btn-default btn-sm" style="margin-left:auto;">Clear</button>
      </div>
    </div>
  `;

  this.$chatbot_space.append(header_html);
}
  async setup_container() {
    this.$chatbot_container = $(document.createElement("div")).addClass(
      "chatbot-container"
    );
    this.$chatbot_space.append(this.$chatbot_container);
    if (this.profile.is_verified == 0) {
      const date_line = `
        <div class='date-line'>
            <div class="for_line">
              <span class="left-line"></span>
              <span class="between-lines">
                Today
              </span>
              <span class="right-line"></span>
            </div>
        </div>`;
      this.$chatbot_container.append(date_line);
      const init_message = `
          <div class="sender-message">
            <div class="message-bubble">${erpnext_chat_app.res.welcome_message}</div>            
          </div>
          `;
      this.$chatbot_container.append(init_message);
    } else {
      this.profile.respondent_user = await get_respondent_user(
        this.profile.room
      );
      const res = await get_messages(this.profile.room);
      console.log(res);
      await this.setup_messages(res);
    }
  }

  async setup_actions() {
    this.$chatbot_action = $(document.createElement("div")).addClass(
      "chat-space-actions"
    );
    const chat_actions_html = `
        <div class="message-section">         
            <input class='form-control type-message' 
            type='search' 
            placeholder='${__("Type here")}'>
            <span class='message-send-button'>
                <svg xmlns="http://www.w3.org/2000/svg" width="1.1rem" height="1.1rem" viewBox="0 0 24 24">
                    <path d="M24 0l-6 22-8.129-7.239 7.802-8.234-10.458 7.227-7.215-1.754 24-12zm-15 16.668v7.332l3.258-4.431-3.258-2.901z"/>
                </svg>
            </span>
        </div>
        `;
    this.$chatbot_action.html(chat_actions_html);
    this.$chatbot_space.append(this.$chatbot_action);
  }

  setup_events() {
    const me = this;
    me.$chatbot_space.off(".portal");
    me.$chatbot_container.off(".portal");
    $(document).off(".portal");
    this.$chatbot_space.find(".close-chat-window").on("click", function () {
      me.chat_bubble.portal_chat_icon();
    });

    this.$chatbot_action.find(".message-send-button").on("click", function () {
      me.handle_send_message();
    });
    //-----------edit----------
    me.$chatbot_container.on("click.portal", ".edit-btn", function (e) {
  e.stopPropagation();

  const $wrap = $(this).closest("[data-message-name]");
  const messageName = $wrap.data("message-name");
  if (!messageName) return;

  const cached = me.messageCache.get(messageName) || {};
  if (Number(cached.is_deleted || 0) === 1) return;


  const isEditedBefore = Number(cached.is_edited || 0) === 1;
  if (isEditedBefore) {
    frappe.msgprint("Editing is not allowed because it was edited before.");
    return;
  }


  if ((cached.sender_email || "") !== (me.profile.user_email || "")) return;

  const currentText = me.htmlToPlainText(cached.content || "");

  me.portalEditPrompt({
    title: "Edit Message",
    defaultText: currentText,
    onSave: async (text) => {
      const formattedContent = me.plainTextToParagraphs(text);

      await frappe.call({
        method: "clefincode_chat.api.api_1_3_3.chat_portal.edit_guest_chat_message", //
        args: {
          message_name: messageName,
          new_content: formattedContent
        }
      });

      const $bubble = $wrap.find(".message-bubble");
      const $actions = $bubble.find(".message-actions").detach();

      $bubble.find("p").remove();
      $bubble.find(".edited-label").remove();

      $bubble.append(formattedContent);
      $bubble.append(`
        <div class="edited-label" style="font-size:11px;opacity:0.6;margin-top:4px;">
          Edited
        </div>
      `);

      if ($actions.length) $bubble.append($actions);

      cached.content = formattedContent;
      cached.is_edited = 1;
      me.messageCache.set(messageName, cached);
    }
  });
});
    //-------------------------
// me.$chatbot_container.on("click.portal", ".reaction-chip", function (e) {
//   e.stopPropagation();

//   const $message = $(this).closest("[data-message-name]");
//   console.log($message);
//   const reactionsData = $message.attr("data-reactions");

//   if (!reactionsData) {
//     frappe.msgprint("No reactions");
//     return;
//   }

//   try {
//     let parsed = JSON.parse(reactionsData);

   
//     if (typeof parsed === "string") {
//       parsed = JSON.parse(parsed);
//     }

//     const container = Array.isArray(parsed) ? parsed[0] : parsed;
//     const reactions = container?.reactions || [];

//     if (!reactions.length) {
//       frappe.msgprint("No reactions");
//       return;
//     }

//     me.openLocalReactionsDialog(reactions);

//   } catch (err) {
//     console.warn("Invalid reactions_json", err);
//     frappe.msgprint("No reactions");
//   }
// });
me.$chatbot_container.on("click.portal", ".message-reactions, .message-reactions .reaction-chip", async function (e) {
  e.stopPropagation();

  const messageName = $(this).closest("[data-message-name]").data("message-name");
  if (!messageName) return;

  await me.openReactionsDialog(messageName, null);
});
//--------------------------------


    this.$chatbot_action.find(".type-message").keyup(function (e) {
      if (e.which === 13) {
        e.preventDefault();
        if (!e.shiftKey) {
          me.handle_send_message();
        }
      }
    });
  
me.$chatbot_container.on("click.portal", ".message-bubble", function (e) {
  e.stopPropagation();


  me.$chatbot_container.find(".message-actions").css("display", "none");

  $(this).find(".message-actions").css("display", "flex");
});

$(document).on("click.portal", function () {
  me.$chatbot_container.find(".message-actions").css("display", "none");
});
const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 12;

me.$chatbot_container.on("pointerdown.portal", ".message-bubble", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;

  me.longPress.fired = false;
  me.longPress.targetMessage = $(e.currentTarget).closest("[data-message-name]").data("message-name");
  me.longPress.startX = e.clientX;
  me.longPress.startY = e.clientY;

  clearTimeout(me.longPress.timer);
  me.longPress.timer = setTimeout(() => {
    me.longPress.fired = true;
    me.openEmojiMenu({ $bubble: $(e.currentTarget), messageName: me.longPress.targetMessage });
  }, LONG_PRESS_MS);
});

me.$chatbot_container.on("pointermove.portal", ".message-bubble", (e) => {
  if (!me.longPress.timer) return;
  const dx = Math.abs(e.clientX - me.longPress.startX);
  const dy = Math.abs(e.clientY - me.longPress.startY);
  if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
    clearTimeout(me.longPress.timer);
    me.longPress.timer = null;
  }
});

me.$chatbot_container.on("pointerup.portal pointercancel.portal", ".message-bubble", () => {
  clearTimeout(me.longPress.timer);
  me.longPress.timer = null;
});
// ✅ Reply

this.$chatbot_container.on("click", ".reply-btn", async function (e) {
  e.stopPropagation();

  const $wrapper = $(this).closest("[data-message-name]");
  const messageName = $wrapper.data("message-name");
  me.reply_to_message_name = messageName;

  const snippet = await me.makeReplySnippet(messageName, 120);
  const text = snippet?.text || "[Attachment]";

  let $host = me.$chatbot_space.children(".reply-preview-host");
  if (!$host.length) {
    $host = $('<div class="reply-preview-host"></div>');
    me.$chatbot_space.find(".chat-space-actions").before($host);
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

me.$chatbot_space.on("click.portal", ".cancel-reply", function () {
  me.reply_to_message_name = null;
  me.$chatbot_space.find(".reply-preview-host").remove();
});

// ✅ Jump to replied message
me.$chatbot_container.on("click.portal", ".reply-link", function () {
  const target = $(this).data("jump");
  const $msg = me.$chatbot_container.find(`#msg-${target}`);
  if ($msg.length) $msg[0].scrollIntoView({ behavior: "smooth", block: "center" });
}); 
// Toggle search bar
me.$chatbot_space.on("click.portal", ".toggle-search", function () {
  const $search = me.$chatbot_space.find(".chat-search");

  $search.slideToggle(150, function () {
    if ($search.is(":visible")) {
      $search.find(".chat-search-input").focus();
    } else {
     
      me.clearSearchHighlights();
      me.searchResults = [];
      me.currentSearchIndex = -1;
      me.searchQuery = null;
      me.$chatbot_space.find(".search-count").text("0");
      me.$chatbot_space.find(".chat-search-input").val("");
    }
  });
});

me.$chatbot_container.on("click.portal", ".delete-btn", async function (e) {
  e.stopPropagation();

  const $wrap = $(this).closest("[data-message-name]");
  const messageName = $wrap.data("message-name");

  frappe.confirm("Delete this message?", async () => {
     await frappe.call({
        method: "clefincode_chat.api.api_1_3_3.chat_portal.delete_guest_chat_message",
        args: {
      message_name: messageName,
   
          },
       
      });
  
    $wrap.find(".message-bubble").html(`<div style="font-style:italic; opacity:0.6;">This message was deleted</div>`);
    const cached = me.messageCache.get(messageName) || {};
    cached.is_deleted = 1;
    cached.content = "";
    me.messageCache.set(messageName, cached);
  });
});
me.$chatbot_space.on("keyup.portal", ".chat-search-input", async function (e) {
  if (e.key === "Enter") {
    const q = $(this).val().trim();
    if (!q) return;
    me.performSearchLocal(q);
  }
});

me.$chatbot_space.on("click.portal", ".search-next", () => me.goToNextResult());
me.$chatbot_space.on("click.portal", ".search-prev", () => me.goToPreviousResult());

me.$chatbot_space.on("click.portal", ".search-clear", () => {
  me.clearSearchHighlights();
  me.searchResults = [];
  me.currentSearchIndex = -1;
  me.searchQuery = null;
  me.$chatbot_space.find(".search-count").text("0");
  me.$chatbot_space.find(".chat-search-input").val("");
});
}

 setup_socket() {
  const me = this;
  console.log("me.profile.room");
  console.log(me.profile.room);
  frappe.realtime.on(me.profile.room, function (res) {
    if (res.realtime_type == "send_message") {
      me.receive_message(res, get_t(res.send_date));
      return;
    }

    else if(res.realtime_type == "reactions_message") {      
      const messageName = res.message_name;
      if (!messageName) return;

      
      me.renderReactions(messageName, {
        data: { reactions: res.reactions || [], emoji_counts: res.emoji_counts || {} }
      });

     
      const reactions_json = JSON.stringify([{
        reactions: res.reactions || [],
        emoji_summary: {
          total_emojis: Object.values(res.emoji_counts || {}).reduce((a,b)=>a+(b||0), 0),
          emoji_details: res.emoji_counts || {}
        }
      }]);

      const cached = me.messageCache.get(messageName) || {};
      cached.reactions_json = reactions_json;
      me.messageCache.set(messageName, cached);

      const $msg = me.$chatbot_container.find(`#msg-${messageName}`);
      if ($msg.length) $msg.attr("data-reactions", reactions_json);
    }    else if (res.realtime_type === "edit_message") {
  
  me.handlePortalMessageEdit(res);
}
  });
}

  render() {
    this.$wrapper.append(this.$chatbot_space);
  }

  async receive_message(res, time) {
   
    if (res.message_name && this.$chatbot_container.find(`#msg-${res.message_name}`).length) {
    return;
  }
    let chat_type = "sender-message";

    if (res.sender_email == this.profile.user_email) {
      chat_type = "recipient-message";
    }
    
    this.messageCache.set(res.message_name, {
            sender: res.sender,
            sender_email: res.sender_email,
            content: res.content,               
            is_screenshot: res.is_screenshot || 0,    
            reply_to_message:res.reply_to_message ,
            reply_preview_type: res.reply_preview_type,
            reply_preview_text: res.reply_preview_text,
            reply_preview_sender: res.reply_preview_sender,
            reply_preview_file_url: res.reply_preview_file_url,
            is_deleted:res.is_deleted,
            is_edited: res.is_edited ,
    
            
          });
    this.$chatbot_container.append(
      await this.make_message({
        content: res.content,
        time: time,
        type: chat_type,
        sender: res.user,
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
      })
    );
    scroll_to_bottom(this.$chatbot_container);

    this.prevMessage = res;
  }

  async setup_messages(messages_list) {
    await this.make_messages_html(messages_list);
    this.$chatbot_container.html(this.message_html);
    this.$chatbot_space.append(this.$chatbot_container);
  }

  async make_messages_html(messages_list) {
    this.prevMessage = {};
    this.message_html = "";
    for (const element of messages_list) {
      this.messageCache.set(element.message_name, {
        sender: element.sender,
        sender_email: element.sender_email,
        content: element.content,
        is_deleted: element.is_deleted || 0,
        reactions_json: element.reactions_json || null,
        is_edited:element.is_edited ||0,
        reply_preview_text:element.reply_preview_text || null,
        reply_to_message: element.reply_to_message || null,
        reply_preview_type: element.reply_preview_type,
       
        reply_preview_sender: element.reply_preview_sender,
        reply_preview_file_url: element.reply_preview_file_url,

      });
      const date_line_html = this.make_date_line_html(element.send_date);
      this.prevMessage = element;
      this.message_html += date_line_html;

      let message_type = "sender-message";

      if (element.sender_email === this.profile.user_email) {
        message_type = "recipient-message";
      }
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
        time: get_t(element.send_date),
        type: message_type,
        message_name: element.message_name,
        sender_email: element.sender_email,
        is_deleted: element.is_deleted || 0,
        is_edited: element.is_edited || 0,
        reply_to_message: element.reply_to_message || null,
        reply_preview: reply_preview || null,
        reactions_json: element.reactions_json || null,

      });
      this.message_html += message_content.prop("outerHTML");
    }

   
  }

  make_date_line_html(dateObj) {
    let result = `
              <div class='date-line'>
                  <div class="for_line">
                    <span class="left-line"></span>
                    <span class="between-lines">
                      ${get_date_from_now(
                        dateObj,
                        "space",
                        this.profile.time_zone
                      )}
                    </span>
                    <span class="right-line"></span>
                  </div>
              </div>
          `;
    if ($.isEmptyObject(this.prevMessage)) {
      return result;
    } else if (
      is_date_change(
        dateObj,
        this.prevMessage.send_date,
        this.profile.time_zone
      )
    ) {
      return result;
    } else {
      return "";
    }
  }

 async make_message(params) {
  const {
  content,
  time,
  type,
  message_name = "",
  sender_email = "",
  is_deleted = 0,
  is_edited = 0,
  reply_to_message = null,
  reply_preview = null,
  reactions_json = null,
  } = params;

  const $recipient_element = $(document.createElement("div"))
    .addClass(type)
    .attr("data-message-name", message_name)
    .attr("id", message_name ? `msg-${message_name}` : "");

  const $message_element = $(document.createElement("div"))
    .addClass("message-bubble")
    .css("position", "relative");


  let $sanitized_content = __($("<div>").html(content));

  if (is_deleted) {
    $sanitized_content = $(`
      <div style="font-style:italic; opacity:0.6;">This message was deleted</div>
    `);
  }

  $message_element.append($sanitized_content);
  const isDark = document.documentElement.dataset.themeMode === "dark";
  const deleteIcon = isDark
  ? "/assets/clefincode_chat/icons/delete.png"
  : "/assets/clefincode_chat/icons/delete.svg";
  //  actions (Reply / Forward / Delete)
   const isMine = sender_email === this.profile.user_email;
 const $actions = $(`
  <div class="message-actions" style="
    display:none;
    margin-top:6px;
    gap:12px;
    font-size:12px;
    color:#6c757d;
    cursor:pointer;
  ">
    ${isMine && !is_deleted ? `
      <span class="edit-btn">${frappe.utils.icon("edit", "sm")} Edit</span>
    ` : ``}
    <span class="reply-btn">${frappe.utils.icon("reply","sm")} Reply</span>
    <span class="delete-btn">
      <img src="${deleteIcon}" width="14" height="14" style="margin-left:8px;"> Delete
    </span>
  </div>
`);

  if (!is_deleted) $message_element.append($actions);
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
   


if (!isMine) $actions.find(".delete-btn").remove();

  
  const $reactions = $(`<div class="message-reactions"></div>`);
  $recipient_element.append($message_element);
  $recipient_element.append($reactions);

if (reactions_json) {
  try {
    const parsed = typeof reactions_json === "string"
      ? JSON.parse(reactions_json)
      : reactions_json;

    const data = parsed[0] || {};
    const reactions = data.reactions || [];
    const emojiSummary = data.emoji_summary?.emoji_details || {};

    if (Object.keys(emojiSummary).length) {

      const byEmojiSenders = {};

      reactions.forEach(r => {
        if (!byEmojiSenders[r.emoji]) {
          byEmojiSenders[r.emoji] = [];
        }
        byEmojiSenders[r.emoji].push(r.emoji_sender);
      });

      const html = Object.keys(emojiSummary).map(emo => {

        const count = emojiSummary[emo];
        const users = (byEmojiSenders[emo] || []).join("\n");

        const rendered = (window.emojione && emojione.toImage)
          ? emojione.toImage(emo)
          : emo;

        return `
          <span class="reaction-chip"
                data-emoji="${frappe.utils.escape_html(emo)}"
                title="${frappe.utils.escape_html(users)}">
            ${rendered}
            <b class="reaction-count">${count}</b>
          </span>
        `;
      }).join("");

      $reactions.html(html);
    }

  } catch (e) {
    console.warn("Invalid reactions_json", e);
  }
}
$recipient_element.attr(
  "data-reactions",
  typeof reactions_json === "string"
    ? reactions_json
    : JSON.stringify(reactions_json || [])
);
  if (reply_to_message && !is_deleted ) {

  let original = this.messageCache.get(reply_to_message);
    console.log("original");
    console.log(original);
  // if (!original) {
  //     const msg = await this.fetch_single_message(reply_to_message);
  //     if (msg) {
  //       original = {
  //         sender: msg.sender,
  //         content: msg.content,
  //         is_deleted: msg.is_deleted || 0,
          
  //       };
  //       this.messageCache.set(reply_to_message, original);
  //     } else {
  //       original = { is_deleted: 1 };  
  //     }
  //   }
      const p = reply_preview || {};
  const previewSender = (p.sender || "").trim();
  let previewText = (p.text || "").trim();
  const previewType = (p.type || "").trim(); // text/image/video/document/voice
  const thumbUrl = p.file_url || null;

  const senderLabel = previewSender ? frappe.utils.escape_html(previewSender) : "…";
  
    if (original && original.is_deleted === 1) {
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

  return $recipient_element;
} //END make_message

  async handle_send_message() {
    if (this.$chatbot_space.find(".type-message").val().length == 0) {
      return;
    }
     let res=null;
    let content = this.$chatbot_space.find(".type-message").val();
    
    let localReplyPreview = null;
    if (this.reply_to_message_name) {
  const snip = await this.makeReplySnippet(this.reply_to_message_name, 120);
  const safeText = frappe.utils.escape_html(snip.text || "");
   localReplyPreview = {
    type: "text",
    text: snip.text,
    sender: snip.sender,
    original_message_name: this.reply_to_message_name,
  };
  // content = `
  //   <div class="reply-link" data-jump="${this.reply_to_message_name}" style="
  //     border-left:3px solid #0d6efd;background:#f1f3f5;
  //     padding:6px 8px;margin-bottom:6px;border-radius:6px;cursor:pointer;font-size:12px;
  //   ">
  //     <div style="font-weight:600;">${frappe.utils.escape_html(snip.sender || "")}</div>
  //     <div style="opacity:.85;">${safeText}</div>
  //   </div>
  //   <div>${frappe.utils.escape_html(this.$chatbot_space.find(".type-message").val())}</div>
  // `;
}
    this.is_link = null;
   

    
    // const text_content = content

    if (this.is_first_message == 1 && this.profile.is_verified == 0) {
      this.is_first_message = 0;
      const results = await create_guest_profile_and_channel(
        content,
        this.profile.user,
        this.profile.user_email,
        get_current_datetime()
      );
      localStorage.setItem("guest_token", results.token);
      this.profile.token = results.token;
      this.profile.room = results.room;
      this.profile.respondent_user = results.respondent_user;
      this.setup_socket();
    } else {
   
      const guest_message_info = {
        content: content && content.length == 1 ? content.prop("outerHTML") : content,
        room: this.profile.room,
        sender: this.profile.user,
        sender_email: this.profile.user_email,
        send_date: get_current_datetime(),
        respondent_user: this.profile.respondent_user,
        reply_to_message_name:this.reply_to_message_name,
      };
      res=await send_message(guest_message_info);
      console.log(res);
      this.reply_to_message_name = null;
      this.$chatbot_space.find(".reply-preview-host").remove();
      scroll_to_bottom(this.$chatbot_container); 
      }
       this.messageCache.set(res.message_name, {
            sender: res.sender,
            content: res.content,
            sender_email: res.sender_email,               
            is_screenshot: res.is_screenshot || 0,    
            reply_to_message:res.reply_to_message ,
            reply_preview_type: res.reply_preview_type,
            reply_preview_text: res.reply_preview_text,
            reply_preview_sender: res.reply_preview_sender,
            reply_preview_file_url: res.reply_preview_file_url,
            is_deleted:res.is_deleted,
            is_edited: res.is_edited ,
    
            
          });
    this.$chatbot_container.append(
      await this.make_message({
        content: res.content,
        sender_email: res.sender_email,
        type: "recipient-message",
        sender: res.user,
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
      })
    );
    scroll_to_bottom(this.$chatbot_container);

    this.$chatbot_action.find(".type-message").val("");    
  } //End handle_send_message

} // END Class

async function create_guest_profile_and_channel(
  content,
  sender,
  sender_email,
  creation_date
) {
  const res = await frappe.call({
    method:
      "clefincode_chat.api.api_1_0_1.chat_portal.create_guest_profile_and_channel",
    args: {
      content: content,
      sender: sender,
      sender_email: sender_email,
      creation_date: creation_date,
    },
  });
  return await res.message.results[0];
}

async function send_message(params) {
  const { content, room, sender, sender_email, send_date, respondent_user,reply_to_message_name } =
    params;
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_3.chat_portal.send",
    args: {
      content: content,
      room: room,
      sender: sender,
      sender_email: sender_email,
      send_date: send_date,
      respondent_user: respondent_user,
      reply_to_message_name:reply_to_message_name
    },
  });
  return await res.message;
}

async function get_messages(room) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_3.chat_portal.get_messages",
    args: {
      room: room,
    },
  });
  return await res.message;
}

async function get_respondent_user(room) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_3_3.chat_portal.get_respondent_user",
    args: {
      room: room,
    },
  });
  return await res.message;
}
function firstNameFromEmail(email) {
  if (!email) return "";
  const local = String(email).split("@")[0] || "";
  const first = local.split(/[._-]/)[0] || local;
  
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}