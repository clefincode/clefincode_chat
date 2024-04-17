import {
  get_current_time,
  convertToUTC,
  contains_arabic,
  get_date_from_now,
  is_date_change,
  get_time,
  get_t,
  scroll_to_bottom,
  get_current_datetime,
} from "./erpnext_chat_utils";
export default class ChatbotSpace {
  constructor(opts) {
    this.$wrapper = opts.$wrapper; // chat container
    this.profile = opts.profile;
    this.chat_bubble = opts.chat_bubble;
    this.is_first_message = 1;
    this.setup();
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
              ${this.profile.chat_support_title}
              <div class='online-circle' style="background:#28a745"></div>
              </div>
          </div>    
  
          <span class='close-chat-window' >${frappe.utils.icon(
            "close",
            "lg"
          )}</span>
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
            <div class="message-bubble">${this.profile.welcome_message}</div>            
          </div>
          `;
      this.$chatbot_container.append(init_message);
    } else {
      this.profile.respondent_user = await get_respondent_user(
        this.profile.room
      );
      const res = await get_messages(this.profile.room);
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
    this.$chatbot_space.find(".close-chat-window").on("click", function () {
      me.chat_bubble.change_bubble();
    });

    this.$chatbot_action.find(".message-send-button").on("click", function () {
      me.handle_send_message();
    });

    this.$chatbot_action.find(".type-message").keyup(function (e) {
      if (e.which === 13) {
        e.preventDefault();
        if (!e.shiftKey) {
          me.handle_send_message();
        }
      }
    });
  }

  setup_socket() {
    const me = this;
    frappe.realtime.on(me.profile.room, function (res) {
      me.receive_message(res, get_t(res.send_date));
    });
  }

  render() {
    this.$wrapper.append(this.$chatbot_space);
  }

  async receive_message(res, time) {
    let chat_type = "sender-message";

    if (res.sender_email == this.profile.user_email) {
      chat_type = "recipient-message";
    }

    this.$chatbot_container.append(
      await this.make_message({
        content: res.content,
        time: time,
        type: chat_type,
        sender: res.user,
        message_name: res.message_name,
        message_template_type: res.message_template_type,
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
      const date_line_html = this.make_date_line_html(element.send_date);
      this.prevMessage = element;
      this.message_html += date_line_html;

      let message_type = "sender-message";

      if (element.sender_email === this.profile.user_email) {
        message_type = "recipient-message";
      }

      const message_content = await this.make_message({
        content: element.content,
        time: get_t(element.send_date),
        type: message_type,
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
    const { content, time, type } = params;
    const $recipient_element = $(document.createElement("div")).addClass(type);

    const $message_element = $(document.createElement("div")).addClass(
      "message-bubble"
    );

    let $sanitized_content = __($("<div>").html(content));

    $message_element.append($sanitized_content);
    $recipient_element.append($message_element);
    // $recipient_element.append(`<div class='message-time'>${time}</div>`);

    return $recipient_element;
  } //END make_message

  async handle_send_message() {
    if (this.$chatbot_space.find(".type-message").val().length == 0) {
      return;
    }

    let content = this.$chatbot_space.find(".type-message").val();
    this.is_link = null;

    this.$chatbot_container.append(
      await this.make_message({
        content: content,
        time: get_current_time(),
        type: "recipient-message",
      })
    );
    scroll_to_bottom(this.$chatbot_container);

    this.$chatbot_action.find(".type-message").val("");
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
        content: content,
        room: this.profile.room,
        sender: this.profile.user,
        sender_email: this.profile.user_email,
        send_date: get_current_datetime(),
        respondent_user: this.profile.respondent_user,
      };
      await send_message(guest_message_info);
      scroll_to_bottom(this.$chatbot_container);
    }
  } //End handle_send_message

  // check_if_content_has_link(message_content) {
  //   const me = this;
  //   const parser = new DOMParser();
  //   const doc = parser.parseFromString(message_content, 'text/html');

  //   const paragraphs = doc.querySelectorAll('p');

  //   paragraphs.forEach((p) => {
  //     const urlRegex = /((https?:\/\/|www\.|(?<![\w-])[\w-]+\.)[-\w.]+(:\d+)?(\/([\w/_.-]*(\?\S+)?)?)?)/gi;
  //     Array.from(p.childNodes).forEach((node) => {
  //       if (node.nodeType === Node.TEXT_NODE) {
  //         const replacedText = node.textContent.replace(urlRegex, function(matched) {
  //           me.is_link = 1;
  //           return '<a href="' + matched + '" target="_blank" style="color:#027eb5">' + matched + '</a>';
  //         });
  //         const fragment = document.createRange().createContextualFragment(replacedText);
  //         p.replaceChild(fragment, node);
  //       }
  //     });
  //   });
  //   return doc.body.innerHTML;
  // }
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
  const { content, room, sender, sender_email, send_date, respondent_user } =
    params;
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.chat_portal.send",
    args: {
      content: content,
      room: room,
      sender: sender,
      sender_email: sender_email,
      send_date: send_date,
      respondent_user: respondent_user,
    },
  });
  return await res.message;
}

async function get_messages(room) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.chat_portal.get_messages",
    args: {
      room: room,
    },
  });
  return await res.message;
}

async function get_respondent_user(room) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.chat_portal.get_respondent_user",
    args: {
      room: room,
    },
  });
  return await res.message;
}
