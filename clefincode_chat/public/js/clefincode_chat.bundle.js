import {
  ChatBubble,
  ChatPortalSpace,
  ChatList
} from "./components";

frappe.provide("frappe.ErpnextChat");
frappe.provide("frappe.ErpnextChat.settings");

frappe.ErpnextChat = class {
  constructor() {
    this.setup_app();
  }

  async setup_app() {
    const token = localStorage.getItem("guest_token") || "";
    const res = await get_settings(token);
    this.res = res;
    this.is_desk = "desk" in frappe;

    if (res.user == "Administrator") return;

    if (res.user == "Guest") 
    {
      if(!res.enable_portal_support) return ;        
      await this.create_chatbot();
      
    }
    else await this.create_app();

    frappe.socketio.init(res.socketio_port);

    if (this.res.is_admin) {
      frappe.ErpnextChat.settings = {};
      frappe.ErpnextChat.settings.unread_count = 0;
      frappe.ErpnextChat.settings.unread_rooms = [];
      frappe.ErpnextChat.settings.open_chat_space_rooms = [];

      const calculate_unread_messages_per_rooms =
        await calculate_unread_messages(this.res.user_email);
      frappe.ErpnextChat.settings.unread_count =
        calculate_unread_messages_per_rooms.unread_messages;
      frappe.ErpnextChat.settings.unread_rooms =
        calculate_unread_messages_per_rooms.unread_rooms;
      if (frappe.ErpnextChat.settings.unread_count > 0) {
        $("#chat-notification-count").text(
          frappe.ErpnextChat.settings.unread_count
        );
      } else {
        $("#chat-notification-count").text("");
      }
      this.setup_socketio();
      this.setup_socketio_mobile();
    } else if (res.is_verified) {
      this.chatbot_space = new ChatPortalSpace({
        $wrapper: this.$chat_container,
        chat_bubble: this.chat_bubble,
        profile: {
          is_verified: 1,
          token: token,
          user: res.user,
          user_email: res.user_email,
          room: res.channel,
          chat_support_title: res.chat_support_title,
        },
      });
      this.chatbot_space.render();
    } else {
      this.chatbot_space = new ChatPortalSpace({
        $wrapper: this.$chat_container,
        chat_bubble: this.chat_bubble,
        profile: {
          is_verified: 0,
          token: token,
          user: res.user,
          user_email: res.user_email,
          // chat_support_title: res.chat_support_title,
          // welcome_message: res.welcome_message,
        },
      });
      this.chatbot_space.render();
    }
  }

  async create_app() {
    this.$app_element = $(document.createElement("div")).addClass("chat-app");

    this.$chat_right_section = $(document.createElement("div")).addClass(
      "chat_right_section"
    );

    this.$chat_left_section = $(document.createElement("div"))
      .addClass("chat_left_section")
      .hide();

    this.$app_element.append(this.$chat_left_section);
    this.$app_element.append(this.$chat_right_section);
    this.$chat_bottom = $(document.createElement("div")).addClass(
      "chat_bottom"
    );
    this.$app_element.append(this.$chat_bottom);
    this.$app_element.append(`
    <script>
    const me = this;
    var expand_me =function(parameter,attr,room_type, room, parent_channel, chat_topic) {
        if(attr=='data-room'){
            const chat_list_obj = erpnext_chat_app.chat_list
            if(chat_list_obj){
                const chat_room_item = chat_list_obj.chat_room_groups.find((element) => { return element[0] === parameter; });
                if(chat_room_item){
                    chat_room_item[1].expand = 1;            
                    chat_room_item[1].$chat_room.click();
                }
            }else{
                if(room_type == 'Contributor'){
                    frappe.call({
                        method:
                          "clefincode_chat.api.api_1_0_1.api.mark_messsages_as_read",
                        args: {
                          user: me.user_email ,
                          channel: null,
                          parent_channel: parent_channel
                        }
                      });

                    frappe.ErpnextChat.settings.unread_rooms = frappe.ErpnextChat.settings.unread_rooms.filter(item => item != parent_channel);
                    frappe.ErpnextChat.settings.open_chat_space_rooms.push(parent_channel)
                  } else{
                    frappe.call({
                        method:
                          "clefincode_chat.api.api_1_0_1.api.mark_messsages_as_read",
                        args: {
                          user: me.user_email ,
                          channel: room,
                        }
                      });
                    frappe.ErpnextChat.settings.unread_rooms = frappe.ErpnextChat.settings.unread_rooms.filter(item => item != room);
                    frappe.ErpnextChat.settings.open_chat_space_rooms.push(room)
                  }
              
                  frappe.ErpnextChat.settings.unread_count -= 1;
                  if(frappe.ErpnextChat.settings.unread_count <= 0){
                    $('#chat-notification-count').text('');
                  }else{
                    $('#chat-notification-count').text(frappe.ErpnextChat.settings.unread_count);
                }
            }  
            $(".chat-window[data-room|='"+parameter+"']").css("display", "block");
            $(".minimized-chat[data-id|='"+parameter+"']").remove();
        }else if(attr=='data-topic'){
            $(".chat-window[data-topic|='"+parameter+"']").css("display", "block");
            $(".minimized-chat[data-id|='"+parameter+"']").remove();
        }
        else{
          $(".chat-window[data-contact|='"+parameter+"']").css("display", "block");
          $(".minimized-chat[data-id|='"+parameter+"']").remove();
        }
        var screen_width = $("body").outerWidth()
        var right_width = $(".chat_right_section").outerWidth()
        var left_width = $(".chat_left_section").outerWidth()
        if((right_width+left_width)>screen_width){
          $( ".chat-window" ).each(function(index) {
            if(attr=='data-room'){
                
                if ($(this).is("[data-room~='"+parameter+"']")){}
                else{
                    if($(this).css('display') == 'none'){
        
                    }
                    else{
                    $(".collapse-chat-window")[index].click();
                    return false;
                    }
                }
            }else if(attr=='data-topic'){
                $(".collapse-chat-window")[index].click();
                return false;
            }else{
            
                if ($(this).is("[data-contact~='"+parameter+"']")){}
                else{
                    if($(this).css('display') == 'none'){}
                    else{
                        $(".collapse-chat-window")[index].click();
                        return false;
                    }
                }
            }

          });
        }
      }
    
      var closeMe = function(parameter,attr) {

        if(attr=='data-room'){
          $(".chat-window[data-room|='"+parameter+"']").remove();
        }else if(attr=='data-topic'){
            $(".chat-window[data-topic|='"+parameter+"']").remove();
        }else{
          $(".chat-window[data-contact|='"+parameter+"']").remove();
        }
        $(".minimized-chat[data-id|='"+parameter+"']").remove();
      }
    </script>`);

    this.$chat_container = $(document.createElement("div")).addClass(
      "chat-container"
    );
    $("body").append(this.$app_element);
    this.is_open = false;

    this.$chat_element = $(document.createElement("div"))
      .addClass("chat-element")
      .hide();

    this.$chat_element.append(
      `<span class="chat-cross-button">${frappe.utils.icon(
        "close",
        "lg"
      )}</span>`
    );
    this.$chat_element.append(this.$chat_container);
    this.$chat_element.appendTo(this.$chat_right_section);

    this.chat_bubble = new ChatBubble(this);
    this.chat_bubble.render();

    const navbar_icon_html = `
        <li class='nav-item dropdown dropdown-notifications 
        dropdown-mobile chat-navbar-icon' title="Show Chats" >
          <img title="Show Chats" src="/assets/clefincode_chat/icons/clefincode_chat.svg" width="25px" height="25px">
        <span class="badge" id="chat-notification-count"></span>
        </li>
    `;

    if (this.is_desk === true) {
      $("header.navbar > .container > .navbar-collapse > ul").prepend(
        navbar_icon_html
      );
    }
    this.setup_events();
  }

  async create_chatbot() {
    this.$app_element = $(document.createElement("div")).addClass("chat-app");
    this.$chat_right_section = $(document.createElement("div")).addClass(
      "chat_right_section"
    );

    this.$chat_element = $(document.createElement("div"))
      .addClass("chat-element")
      .hide();
    this.$chat_container = $(document.createElement("div")).addClass(
      "chat-container"
    );
    this.$chat_element.append(this.$chat_container);

    this.$chat_right_section.append(this.$chat_element);
    this.$app_element.append(this.$chat_right_section);
    $("body").append(this.$app_element);

    this.is_open = false;

    this.chat_bubble = new ChatBubble(this);
    this.chat_bubble.render();

    this.setup_events();
  }

  show_chat_widget() {
    this.is_open = true;
    this.$chat_element.fadeIn(250);
    if (
      this.$chat_element.find(".chatbot-container") &&
      this.$chat_element.find(".chatbot-container").length == 1
    ) {
      this.$chat_element.find(".chatbot-container").animate(
        {
          scrollTop: this.$chat_element
            .find(".chatbot-container")
            .prop("scrollHeight"),
        },
        "fast"
      );
    }
    if (this.res.is_admin) {
      this.chat_list = new ChatList({
        $wrapper: this.$chat_container,
        user: this.res.user,
        user_email: this.res.user_email,
        is_admin: this.res.is_admin,
        time_zone: this.res.time_zone,
        user_type: this.res.user_type,
        is_limited_user: this.res.is_limited_user
      });
      this.chat_list.render();
    }
  }

  hide_chat_widget() {
    this.is_open = false;
    this.$chat_element.fadeOut(300);
    if (this.res.is_admin) {
      this.chat_list.is_open = 0;
      this.chat_list.$chat_list.remove();
      this.chat_list = undefined;
    }
  }

  should_close(e) {
    const chat_app = $(".chat-app");
    const navbar = $(".navbar");
    const modal = $(".modal");
    return (
      !chat_app.is(e.target) &&
      chat_app.has(e.target).length === 0 &&
      !navbar.is(e.target) &&
      navbar.has(e.target).length === 0 &&
      !modal.is(e.target) &&
      modal.has(e.target).length === 0
    );
  }

  setup_events() {
    const me = this;
    $(".chat-navbar-icon").on("click", function () {
      me.chat_bubble.disk_chat_icon();
    });
  }

  setup_socketio() {
    const updateUnreadCount = () => {
      frappe.ErpnextChat.settings.unread_count += 1;
      $("#chat-notification-count").text(
        frappe.ErpnextChat.settings.unread_count
      );
    };

    const addUnreadRoom = (room) => {
      if (!frappe.ErpnextChat.settings.unread_rooms.includes(room)) {
        frappe.ErpnextChat.settings.unread_rooms.push(room);
      }
    };

    const playChatNotificationSound = () => {
      // this statment don't work on portal
      // frappe.utils.play_sound("chat-notification");

      // Alternative way for playing the notification sound.
      const audio = new Audio('/assets/clefincode_chat/sounds/chat-notification.mp3');
      audio.play().catch(error => {
          console.error('Error playing sound:', error);
      });
    };

    frappe.realtime.on("new_chat_notification", function (res) {
      if (res.sender_email === frappe.session.user) {
        return;
      }

      const isContributor = res.room_type === "Contributor";
      const channel = isContributor ? res.parent_channel : res.room;
      if (
        !frappe.ErpnextChat.settings.open_chat_space_rooms.includes(channel) &&
        $(".chat-navbar-icon") &&
        $(".chat-navbar-icon").css("display") != "none"
      ) {
        playChatNotificationSound();
        if (!frappe.ErpnextChat.settings.unread_rooms.includes(channel)) {
          updateUnreadCount();
          addUnreadRoom(channel);
        }
      }
    });
  }

  setup_socketio_mobile() {
    frappe.realtime.on("receive_message", function (res) {
      var obj = [{ key: "receive_message", data: [JSON.stringify(res)] }];
      console.log(JSON.stringify(obj));
    });

    // This is a way to print data on browser console (only for testing)
    frappe.realtime.on("console", function (res) {
      console.log(res);
    });
  }
}; //End ErpnextChat Class

async function get_settings(token) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.get_settings",
    args: {
      token: token,
    },
  });
  return await res.message;
}

async function calculate_unread_messages(user) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.calculate_unread_messages",
    args: {
      user: user,
    },
  });
  return await res.message;
}

$(function () {
  window.erpnext_chat_app = new frappe.ErpnextChat();
});
