import ChatSpace from "./erpnext_chat_space";
import ChatWindow from "./erpnext_chat_window";
import {
  get_date_from_now,
  get_time,
  get_avatar_html,
  mark_messsages_as_read,
  scroll_to_message,
  check_if_chat_window_open,
  get_profile_full_name,
} from "./erpnext_chat_utils";

export default class ChatRoom {
  constructor(opts) {
    this.$wrapper = opts.$wrapper;
    this.$chat_rooms_container = opts.$chat_rooms_container;
    this.profile = opts.element;
    this.setup();
  }

  async setup() {
    const chat_channel =
      this.profile.room_type == "Contributor"
        ? this.profile.parent_channel
        : this.profile.room;
    this.$chat_room = $(document.createElement("div"));
    this.$chat_room.addClass("chat-room");
    this.$chat_room.attr("data-room", chat_channel);
    this.$chat_room.attr("data-room-name", this.profile.room_name);
    this.avatar_html = get_avatar_html(
      this.profile.room_name,
      this.profile.room_type
    );
    let last_message = chat_channel
      ? await this.get_last_message_html(
          this.profile.last_message_media_type,
          this.profile.last_message,
          this.profile.last_message_voice_duration
        )
      : "";
    const info_html = `
			<div class='chat-profile-info'>
          <div class='chat-name' title = "${this.profile.room_name}">
          ${
            this.profile.room_name.length > 20
              ? this.profile.room_name.substring(0, 20) + "..."
              : this.profile.room_name
          }
					<div class='chat-latest' style='display: ${
            this.profile.user_unread_messages > 0 ? "flex" : "none"
          }'>
            ${
              this.profile.user_unread_messages > 0
                ? this.profile.user_unread_messages
                : ""
            }
          </div>
				</div>
				<div class='message-container'>${last_message}</div>
			</div>
		`;
    const date_html = `
			<div class='chat-date'>
				${get_date_from_now(this.profile.send_date, "room", this.profile.time_zone)}
			</div>
		`;
    let inner_html = "";

    inner_html += this.avatar_html + info_html + date_html;

    this.$chat_room.html(inner_html);
  }

  async get_last_message_html(
    message_type,
    profile_last_message,
    voice_duration = ""
  ) {
    // const results = await get_last_message_type(
    //   this.profile.room_type,
    //   this.profile.user_email,
    //   room,
    //   this.profile.remove_date
    // );
    message_type = message_type ? message_type : "text";
    let last_message = "";
    let last_message_text = "";

    if (message_type == "text" || message_type == "document") {
      let last_message_after_update = await this.update_information_message(
        profile_last_message
      );

      if (isHTML(last_message_after_update)) {
        last_message_text = $(last_message_after_update).text().trim();
      } else {
        last_message_text = last_message_after_update
          ? last_message_after_update.trim()
          : ``;
      }

      if (message_type == "document") {
        last_message = `
        <span data-icon="status-document" style="margin-right:3px;">
          <svg viewBox="0 0 13 20" height="20" width="13" preserveAspectRatio="xMidYMid meet" version="1.1" x="0px" y="0px" enable-background="new 0 0 13 20"><path fill="currentColor" d="M10.2,3H2.5C1.7,3,1,3.7,1,4.5v10.1C1,15.3,1.7,16,2.5,16h7.7c0.8,0,1.5-0.7,1.5-1.5v-10 C11.6,3.7,11,3,10.2,3z M7.6,12.7H3.5v-1.3h4.1V12.7z M9.3,10H3.5V8.7h5.8V10z M9.3,7.3H3.5V6h5.8V7.3z"></path></svg>
        </span>`;
      }
      last_message +=
        "<span class='last-message'>" +
        this.sanitize_last_message(last_message_text) +
        "</span>";
    } else {
      if (message_type == "image") {
        last_message = `
          <span data-icon="status-image" style="margin-right:3px;">
            <svg viewBox="0 0 16 20" height="20" width="16" preserveAspectRatio="xMidYMid meet" version="1.1" x="0px" y="0px" enable-background="new 0 0 16 20"><path d="M13.822,4.668H7.14l-1.068-1.09C5.922,3.425,5.624,3.3,5.409,3.3H3.531 c-0.214,0-0.51,0.128-0.656,0.285L1.276,5.296C1.13,5.453,1.01,5.756,1.01,5.971v1.06c0,0.001-0.001,0.002-0.001,0.003v6.983 c0,0.646,0.524,1.17,1.17,1.17h11.643c0.646,0,1.17-0.524,1.17-1.17v-8.18C14.992,5.191,14.468,4.668,13.822,4.668z M7.84,13.298 c-1.875,0-3.395-1.52-3.395-3.396c0-1.875,1.52-3.395,3.395-3.395s3.396,1.52,3.396,3.395C11.236,11.778,9.716,13.298,7.84,13.298z  M7.84,7.511c-1.321,0-2.392,1.071-2.392,2.392s1.071,2.392,2.392,2.392s2.392-1.071,2.392-2.392S9.161,7.511,7.84,7.511z"></path></svg>
          </span>
        <span class='last-message'>Photo</span>`;
      } else if (message_type == "video") {
        last_message = `
          <span data-icon="status-video" style="margin-right:3px;">
            <svg viewBox="0 0 16 20" height="20" width="16" preserveAspectRatio="xMidYMid meet" version="1.1" x="0px" y="0px" enable-background="new 0 0 16 20"><path fill="currentColor" d="M15.243,5.868l-3.48,3.091v-2.27c0-0.657-0.532-1.189-1.189-1.189H1.945 c-0.657,0-1.189,0.532-1.189,1.189v7.138c0,0.657,0.532,1.189,1.189,1.189h8.629c0.657,0,1.189-0.532,1.189-1.189v-2.299l3.48,3.09 V5.868z"></path></svg>
          </span>
          <span class='last-message'>Video</span>
          `;
      } else if (message_type == "audio") {
        last_message = `
        <span data-icon="status-audio" style="margin-right:3px;">
          <svg viewBox="0 0 14 17" height="17" width="14" preserveAspectRatio="xMidYMid meet" version="1.1" id="_x39_7d25ebd-827b-4b31-aacf-70732ab74202" x="0px" y="0px" enable-background="new 0 0 14 17"><path fill="currentColor" d="M7,2.33C3.7,2.32,1.01,4.99,1,8.29C1,8.3,1,8.32,1,8.33V13c-0.02,1.09,0.85,1.98,1.94,2 c0.02,0,0.04,0,0.06,0h2V9.67H2.33V8.33c0-2.58,2.09-4.67,4.67-4.67s4.67,2.09,4.67,4.67v1.33H9v5.33h2c1.09,0.02,1.98-0.85,2-1.94 c0-0.02,0-0.04,0-0.06V8.33c0.01-3.3-2.66-5.99-5.96-6C7.03,2.33,7.01,2.33,7,2.33z"></path></svg>
        </span>
        <span class='last-message'>Audio</span>
        `;
      } else if (message_type == "voice clip") {
        // if ("error" in results.duration) {
        //   return;
        // }
        last_message =
          `
        <span data-icon="status-ptt" style="margin-right:3px;">
          <svg viewBox="0 0 12 20" height="20" width="12" preserveAspectRatio="xMidYMid meet" version="1.1" x="0px" y="0px" enable-background="new 0 0 12 20"><path fill="currentColor" d="M6,11.745c1.105,0,2-0.896,2-2V4.941c0-1.105-0.896-2-2-2s-2,0.896-2,2v4.803 C4,10.849,4.895,11.745,6,11.745z M9.495,9.744c0,1.927-1.568,3.495-3.495,3.495s-3.495-1.568-3.495-3.495H1.11 c0,2.458,1.828,4.477,4.192,4.819v2.495h1.395v-2.495c2.364-0.342,4.193-2.362,4.193-4.82H9.495V9.744z"></path></svg>
        </span>
        <span class='last-message'>` +
          voice_duration +
          `</span>
        `;
      }
    }
    return `<span style="display: flex;">${last_message}</span>`;
  }

  sanitize_last_message(message) {
    if (message) {
      if (message.length > 20) {
        message = message.substring(0, 20) + "...";
      }
    }
    return message;
  }

  set_last_message_after_search(keyword) {
    let last_message = this.profile.last_message;
    if (last_message) {
      if (last_message.length > 20) {
        if (this.profile.scroll_to_message != undefined && keyword != "") {
          let startIndex = last_message.indexOf(keyword);
          last_message = last_message.substring(startIndex, startIndex + 20);
          last_message =
            last_message.length >= 20 ? last_message + "..." : last_message;

          if (last_message.toLowerCase().includes(keyword.toLowerCase())) {
            this.$chat_room.find(".last-message").html(
              last_message.replace(
                new RegExp(keyword, "gi"),
                function (matched) {
                  return `<span style="color:crimson;font-weight:bold">${matched}</span>`;
                }
              )
            );
          }
        }
      } else {
        if (this.profile.scroll_to_message != undefined && keyword != "") {
          if (last_message.toLowerCase().includes(keyword.toLowerCase())) {
            this.$chat_room.find(".last-message").html(
              last_message.replace(
                new RegExp(keyword, "gi"),
                function (matched) {
                  return `<span style="color:crimson;font-weight:bold">${matched}</span>`;
                }
              )
            );
          }
        }
      }
    }
  }

  set_last_message(message, date) {
    // const sanitized_message = this.sanitize_last_message(message);
    this.$chat_room.find(".message-container").html(message);
    this.$chat_room.find(".chat-date").text(date);
  }

  render(mode) {
    if (mode == "append") {
      this.$chat_rooms_container.append(this.$chat_room);
    } else {
      this.$chat_rooms_container.prepend(this.$chat_room);
    }

    this.setup_events();
  }

  move_to_top() {
    $(this.$chat_room).prependTo(this.$chat_rooms_container);
  }

  setup_events() {
    const me = this;
    this.$chat_room.on("click", (e) => {
      me.click_on_chat_room();
      if (me.expand == 1) {
        me.expand = 0;
        return;
      }

      if (check_if_chat_window_open(me.profile.room, "room")) {
        $(".expand-chat-window[data-id|='" + me.profile.room + "']").click();
        return;
      }

      this.chat_window = new ChatWindow({
        profile: {
          room: me.profile.room,
        },
      });

      this.chat_space = new ChatSpace({
        $wrapper: this.chat_window.$chat_window,
        profile: this.profile,
        $chat_room: me.$chat_room,
      });
    });
  }

  click_on_chat_room() {
    if (this.profile.user_unread_messages <= 0) {
      return;
    }

    this.$chat_room.find(".chat-latest").hide();
    if (this.profile.room_type == "Contributor") {
      mark_messsages_as_read(
        this.profile.user_email,
        null,
        this.profile.parent_channel
      );
      frappe.ErpnextChat.settings.unread_rooms =
        frappe.ErpnextChat.settings.unread_rooms.filter(
          (item) => item != this.profile.parent_channel
        );
      frappe.ErpnextChat.settings.open_chat_space_rooms.push(
        this.profile.parent_channel
      );
    } else {
      mark_messsages_as_read(this.profile.user_email, this.profile.room);
      frappe.ErpnextChat.settings.unread_rooms =
        frappe.ErpnextChat.settings.unread_rooms.filter(
          (item) => item != this.profile.room
        );
      frappe.ErpnextChat.settings.open_chat_space_rooms.push(this.profile.room);
    }

    frappe.ErpnextChat.settings.unread_count -= 1;
    if (frappe.ErpnextChat.settings.unread_count <= 0) {
      $("#chat-notification-count").text("");
    } else {
      $("#chat-notification-count").text(
        frappe.ErpnextChat.settings.unread_count
      );
    }

    this.profile.user_unread_messages = 0;
  }

  async update_information_message(last_message_html) {
    let $content = $("<div>").html(last_message_html);

    if (
      $content.find(".create-group").data("template") == "create_group_template"
    ) {
      if (
        $content.find(".sender-user").attr("data-user") ==
        this.profile.user_email
      ) {
        $content.find(".sender-user").html("You");
      } else {
        const sender_name = await get_profile_full_name(
          $content.find(".sender-user").attr("data-user")
        );
        $content.find(".sender-user").html(sender_name);
      }
      return $content.children("div").first().prop("outerHTML");
    }
    // ==============================================================
    else if (
      $content.find(".add-user").data("template") == "added_user_template"
    ) {
      const receiver_email = $content
        .find(".receiver-user")
        .attr("data-user")
        .split(", ");
      if (
        $content.find(".sender-user").attr("data-user") ==
        this.profile.user_email
      ) {
        $content.find(".sender-user").html("You");
      } else {
        const sender_name = await get_profile_full_name(
          $content.find(".sender-user").attr("data-user")
        );
        $content.find(".sender-user").html(sender_name);
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
        $content.find(".receiver-user").html(usernames.join(", "));
      } else {
        let usernames = [];
        usernames = await Promise.all(
          receiver_email.map(async (email) => {
            return await get_profile_full_name(email.trim());
          })
        );
        $content.find(".receiver-user").html(usernames.join(", "));
      }

      return $content.children("div").first().prop("outerHTML");
    }
    // ===============================================================
    else if (
      $content.find(".remove-user").data("template") == "remove_user_template"
    ) {
      if (
        $content.find(".sender-user").attr("data-user") ==
        this.profile.user_email
      ) {
        $content.find(".sender-user").html("You");
      } else {
        const sender_name = await get_profile_full_name(
          $content.find(".sender-user").attr("data-user")
        );
        $content.find(".sender-user").html(sender_name);
      }

      if (
        $content.find(".receiver-user").attr("data-user") ==
        this.profile.user_email
      ) {
        $content.find(".receiver-user").html("You");
      } else {
        const sender_name = await get_profile_full_name(
          $content.find(".receiver-user").attr("data-user")
        );
        $content.find(".receiver-user").html(sender_name);
      }

      return $content.children("div").first().prop("outerHTML");
    }
    // ===============================================================
    else if (
      $content.find(".user-left").data("template") == "user_left_template"
    ) {
      if (
        $content.find(".sender-user").attr("data-user") ==
        this.profile.user_email
      ) {
        $content.find(".sender-user").html("You");
      } else {
        const sender_name = await get_profile_full_name(
          $content.find(".sender-user").attr("data-user")
        );
        $content.find(".sender-user").html(sender_name);
      }
      return $content.children("div").first().prop("outerHTML");
    }
    // ===============================================================
    else if (
      $content.find(".rename-group").data("template") == "rename_group_template"
    ) {
      if (
        $content.find(".sender-user").attr("data-user") ==
        this.profile.user_email
      ) {
        $content.find(".sender-user").html("You");
      } else {
        const sender_name = await get_profile_full_name(
          $content.find(".sender-user").attr("data-user")
        );
        $content.find(".sender-user").html(sender_name);
      }
      return $content.children("div").first().prop("outerHTML");
    }
    // ===============================================================
    else if (
      $content.find(".set-topic").data("template") == "set_topic_template"
    ) {
      if (
        $content.find(".sender-user").attr("data-user") ==
        this.profile.user_email
      ) {
        $content.find(".sender-user").html("You");
      } else {
        const sender_name = await get_profile_full_name(
          $content.find(".sender-user").attr("data-user")
        );
        $content.find(".sender-user").html(sender_name);
      }
      return $content.children("div").first().prop("outerHTML");
    }
    // ===============================================================
    else if (
      $content.find(".add-doctype").data("template") == "add_doctype_template"
    ) {
      if (
        $content.find(".sender-user").attr("data-user") ==
        this.profile.user_email
      ) {
        $content.find(".sender-user").html("You");
      } else {
        const sender_name = await get_profile_full_name(
          $content.find(".sender-user").attr("data-user")
        );
        $content.find(".sender-user").html(sender_name);
      }
      return $content.children("div").first().prop("outerHTML");
    }
    // ===============================================================
    else if (
      $content.find(".remove-topic").data("template") == "remove_topic_template"
    ) {
      if (
        $content.find(".sender-user").attr("data-user") ==
        this.profile.user_email
      ) {
        $content.find(".sender-user").html("You");
      } else {
        const sender_name = await get_profile_full_name(
          $content.find(".sender-user").attr("data-user")
        );
        $content.find(".sender-user").html(sender_name);
      }
      return $content.children("div").first().prop("outerHTML");
    }
    // ===============================================================
    else if (
      $content.find(".remove-doctype").data("template") ==
      "remove_doctype_template"
    ) {
      if (
        $content.find(".sender-user").attr("data-user") ==
        this.profile.user_email
      ) {
        $content.find(".sender-user").html("You");
      } else {
        const sender_name = await get_profile_full_name(
          $content.find(".sender-user").attr("data-user")
        );
        $content.find(".sender-user").html(sender_name);
      }
      return $content.children("div").first().prop("outerHTML");
    }
    // ===============================================================
    else if (
      $content.find(".rename-topic").data("template") == "rename_topic_template"
    ) {
      if (
        $content.find(".sender-user").attr("data-user") ==
        this.profile.user_email
      ) {
        $content.find(".sender-user").html("You");
      } else {
        const sender_name = await get_profile_full_name(
          $content.find(".sender-user").attr("data-user")
        );
        $content.find(".sender-user").html(sender_name);
      }
      return $content.children("div").first().prop("outerHTML");
    }
    // ===============================================================
    else if (
      $content.find(".set-topic-status").data("template") ==
      "set_topic_status_template"
    ) {
      if (
        $content.find(".sender-user").attr("data-user") ==
        this.profile.user_email
      ) {
        $content.find(".sender-user").html("You");
      } else {
        const sender_name = await get_profile_full_name(
          $content.find(".sender-user").attr("data-user")
        );
        $content.find(".sender-user").html(sender_name);
      }
      return $content.children("div").first().prop("outerHTML");
    }
    // ===============================================================
    else if (
      $content.find(".remove-contributors").data("template") ==
      "remove_contributors_template"
    ) {
      if (
        $content.find(".sender-user").attr("data-user") ==
        this.profile.user_email
      ) {
        $content.find(".sender-user").html("You");
      } else {
        const sender_name = await get_profile_full_name(
          $content.find(".sender-user").attr("data-user")
        );
        $content.find(".sender-user").html(sender_name);
      }
      return $content.children("div").first().prop("outerHTML");
    }
    // ===============================================================
    else {
      return last_message_html;
    }
  }
}

async function get_last_message_type(
  room_type,
  user_email,
  channel,
  remove_date
) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.get_last_message_type",
    args: {
      room_type: room_type,
      user_email: user_email,
      channel: channel,
      remove_date: remove_date,
    },
  });
  return await res.message;
}

function isHTML(content) {
  var htmlPattern = /<[^>]*>/;
  return htmlPattern.test(content);
}
