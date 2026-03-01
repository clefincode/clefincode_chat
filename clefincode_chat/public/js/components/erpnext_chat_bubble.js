let FRAPPE_MAJOR_VERSION = null;

async function initFrappeVersion() {
  if (FRAPPE_MAJOR_VERSION !== null) return;

  const r = await frappe.call({
    method: "clefincode_chat.api.api_1_3_1.api.get_frappe_major_version"
  });

  FRAPPE_MAJOR_VERSION = r.message;
}
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
    let bubble_visible;
    if (FRAPPE_MAJOR_VERSION == 16) {
      if (this.parent.is_desk) {
        if (frappe.router && frappe.get_route) {
          const route = frappe.get_route();
          const is_desk_root = route.length === 0;
          bubble_visible = is_desk_root ? "d-none" : "";
        } else {
          // fallback for v15
          bubble_visible = this.parent.is_desk === true ? "d-none" : "";
        }
      }

    } else {
      bubble_visible = this.parent.is_desk === true ? "d-none" : "";
    }

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
    if (FRAPPE_MAJOR_VERSION == 16) {this.handle_version_visibility();}
  }

  disk_chat_icon(){
    if (this.parent.chat_list && this.parent.chat_list.is_open == true) {
      return;
    }
    this.parent.is_open = !this.parent.is_open;
    this.parent.show_chat_widget();
  }
  async handle_version_visibility() {
  await initFrappeVersion();

  if (FRAPPE_MAJOR_VERSION == 16 ) {
    const path = window.location.pathname;
    const is_desk_root = path === "/desk";

    if (is_desk_root) {
      this.$chat_bubble.find(".chat-bubble").addClass("d-none");
    } else {
      this.$chat_bubble.find(".chat-bubble").removeClass("d-none");
    }

    // Handle SPA navigation in v16
    if (frappe.router) {
      frappe.router.on("change", () => {
        const route = frappe.get_route() || [];
        const is_desk_root = route.length === 1 && route[0] === "";



        if (is_desk_root) {
          this.$chat_bubble.find(".chat-bubble").addClass("d-none");
        } else {
          this.$chat_bubble.find(".chat-bubble").removeClass("d-none");
        }
      });
    }
  }
}

  portal_chat_icon() {
    if(this.parent.res.user_type != "guest" && this.parent.is_open){
      return
    }

    this.parent.is_open = !this.parent.is_open;
    if (this.parent.res.user_type == "guest") {
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
    }else{
      this.parent.show_chat_widget();
    }
  }

  setup_events() {
    const me = this;
    $("#chat-bubble, .chat-cross-button").on("click", () => {
      me.portal_chat_icon();
    });
  }
}
