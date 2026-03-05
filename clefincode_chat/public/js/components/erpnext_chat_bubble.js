export default class ChatBubble {
  // the parent is the app object
  constructor(parent) {
    this.parent = parent;
    this.setup();
  }

  setup() {
    this.$chat_bubble = $(document.createElement("div"));
    let chat_icon = `<img draggable="false" title="Start Chat" src="/assets/clefincode_chat/icons/clefincode_chat.svg" width="50px" height="50px">`;
    this.open_title = this.parent.is_admin ? __("Show Chats") : chat_icon;
    this.closed_title = __("Close Chat");
    let bubble_visible="";
    if (this.parent.frappe_version == 16) {
      if (this.parent.is_desk) {
           if (frappe.router && frappe.get_route) {
          const route = frappe.get_route();        
          const safe_route = Array.isArray(route) ? route : [];
          const is_desk_root = safe_route.length === 0;
          bubble_visible = is_desk_root ? "d-none" : "";
        }  else {
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
              <img draggable="false" title="Start Chat" src="/assets/clefincode_chat/icons/close.svg"  width="25px" height="25px">
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
    
       if (this.parent.frappe_version == 16) {    
            if (this.parent.is_desk) {
              this.handle_version_visibility();
          
              // this.initDeskBubbleRightV16();   
              this.enableHorizontalDragV16();  
              
              return;
            
            }}

  }
  initDeskBubbleRightV16() {
              
              const savedX = localStorage.getItem("cc_bubble_x_v16");
              console.log(savedX);
              if (savedX && !Number.isNaN(parseFloat(savedX))) {
                this.$chat_bubble.css({
                  left: `${parseFloat(savedX)}px`,
                  right: "auto",
                  bottom: "24px",
                  top: "auto",
                });
                return;
              }

              
              this.$chat_bubble.css({
                right: "1%",
                left: "auto",
                bottom: "24px",
                top: "auto",
              });
            }

  enableHorizontalDragV16() {
            const $el = this.$chat_bubble;
            $el.css("touch-action", "none");

            let dragging = false;
            let startX = 0;
            let startLeft = 0;

            const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

            $el.on("pointerdown", (e) => {
              if (e.button !== undefined && e.button !== 0) return;

              dragging = true;
              this.drag_moved = false;

              const rect = $el[0].getBoundingClientRect();
              startLeft = rect.left;
              startX = e.clientX;

              try { $el[0].setPointerCapture(e.pointerId); } catch (_) {}
            });

            $(document).on("pointermove.cc_bubble_v16", (e) => {
              if (!dragging) return;

              const dx = e.clientX - startX;
              if (Math.abs(dx) > 5) this.drag_moved = true;

              const w = $el.outerWidth();
              const newLeft = clamp(startLeft + dx, 0, window.innerWidth - w);

              $el.css({
                left: `${newLeft}px`,
                right: "auto",
                bottom: "24px",
                top: "auto",
              });
            });

            $(document).on("pointerup.cc_bubble_v16 pointercancel.cc_bubble_v16", () => {
              if (!dragging) return;
              dragging = false;

              const rect = $el[0].getBoundingClientRect();
              localStorage.setItem("cc_bubble_x_v16", String(rect.left));
            });
    }

  disk_chat_icon(){
    if (this.parent.chat_list && this.parent.chat_list.is_open == true) {
      return;
    }
    this.parent.is_open = !this.parent.is_open;
    this.parent.show_chat_widget();
  }
  async handle_version_visibility() {

  if (this.parent.frappe_version == 16 ) {
    const path = window.location.pathname;
    const is_desk_root = path === "/desk";
   if (is_desk_root) {
      $("body").addClass("cc-chat-desk");
    } else {
      $("body").removeClass("cc-chat-desk");
    }
    // if (is_desk_root) {
    //   this.$chat_bubble.find(".chat-bubble").addClass("d-none");
    // } else {
    //   this.$chat_bubble.find(".chat-bubble").removeClass("d-none");
    // }

    // Handle SPA navigation in v16
    //   if (frappe.router) {
    //   frappe.router.on("change", () => {
    //     const route = frappe.get_route();
    //     const safe_route = Array.isArray(route) ? route : [];

    //     const is_desk_root =
    //         safe_route.length === 0 ||
    //         (safe_route.length === 1 && safe_route[0] === "");



    //     if (is_desk_root) {
    //       this.$chat_bubble.find(".chat-bubble").addClass("d-none");
    //     } else {
    //       this.$chat_bubble.find(".chat-bubble").removeClass("d-none");
    //     }
    //   });
    // }
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
          if (me.parent.frappe_version == 16 && me.drag_moved) {
          me.drag_moved = false;
          return;
        }
      $("#chat-bubble").hide();
      me.portal_chat_icon();
    });
  }
}
