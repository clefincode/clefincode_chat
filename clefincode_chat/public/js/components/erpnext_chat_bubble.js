export default class ChatBubble {
  // the parent is the app object
  constructor(parent) {
    this.parent = parent;
    this.setup();
  }

  setup() {
    this.$chat_bubble = $(document.createElement("div"));
    let chat_icon = `<img title="Start Chat" src="/assets/clefincode_chat/icons/clefincode_chat.svg" width="50px" height="50px">`;
    this.open_title = this.parent.is_admin ? __("Show Chats") : chat_icon;
    this.closed_title = __("Close Chat");

    const bubble_visible = this.parent.is_desk === true ? "d-none" : "";
    this.open_inner_html = `
              <div class='p-3 chat-bubble ${bubble_visible}'>                  
                  <div>${this.open_title}</div>
              </div>
          `;
    this.closed_inner_html = `
          <div class='chat-bubble-closed chat-bubble ${bubble_visible}'>
              <span class='cross-icon'>
              <img title="Start Chat" src="/assets/clefincode_chat/icons/close.svg"  width="25px" height="25px">
              </span>
          </div>
          `;
    this.$chat_bubble
      .attr({
        title: "Start Chat",
        id: "chat-bubble",
      })
      .html(this.open_inner_html);
  }

  render() {
    this.parent.$chat_right_section.append(this.$chat_bubble);
    this.setup_events();
  }

  change_bubble() {
    if (this.parent.chat_list && this.parent.chat_list.is_open == true) {
      return;
    }
    this.parent.is_open = !this.parent.is_open;
    if (!this.parent.is_admin) {
      if (this.parent.is_open === false) {
        this.$chat_bubble
          .attr({ title: this.open_title })
          .html(this.open_inner_html);
        this.parent.hide_chat_widget();
      } else {
        this.$chat_bubble
          .attr({ title: this.closed_title })
          .html(this.closed_inner_html);
        this.parent.show_chat_widget();
      }
    } else {
      this.$chat_bubble
        .attr({ title: this.closed_title })
        .html(this.closed_inner_html);
      this.parent.show_chat_widget();
    }
  }

  setup_events() {
    const me = this;
    $("#chat-bubble, .chat-cross-button").on("click", () => {
      me.change_bubble();
    });
  }
}
