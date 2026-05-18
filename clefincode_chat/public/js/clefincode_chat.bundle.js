import { ChatBubble, ChatPortalSpace, ChatList } from "./components";
import ChatContactList from "./components/erpnext_chat_contact_list";
import ChatWindow from "./components/erpnext_chat_window";
import ChatSpace from "./components/erpnext_chat_space";
import { check_if_chat_window_open } from "./components/erpnext_chat_utils";
import { open_topic_chat_window_from_context } from "./components/topic_open_helper";

window.CCChatContactList = ChatContactList;
window.CCChatWindow = ChatWindow;
window.CCChatSpace = ChatSpace;
window.CCCheckIfChatWindowOpen = check_if_chat_window_open;
window.CiCOpenTopicChatWindowFromContext = open_topic_chat_window_from_context;
window.CiCOpenTopicFromTimeline = async function (opts = {}) {
  const chat_topic = opts.chat_topic || opts.topic || opts.name;
  const message_name = opts.message_name || null;

  if (!chat_topic) {
    console.warn("[ClefinCode Chat] Missing chat_topic");
    return;
  }

  const r = await frappe.call({
    method: "clefincode_chat.api.api_1_3_4.api.get_topic_open_context",
    args: {
      chat_topic,
      message_name,
    },
  });

  const ctx = r.message || {};

  const canWrite = Boolean(ctx.can_write) && String(ctx.topic_status || "").toLowerCase() !== "closed";

  const app = window.erpnext_chat_app;

  const baseProfile = {
    is_admin: app?.res?.is_admin,
    user: app?.res?.user || frappe.session.user,
    user_email: app?.res?.user_email || frappe.session.user,
    time_zone: app?.res?.time_zone,
    user_type: app?.res?.user_type,
    is_limited_user: app?.res?.is_limited_user,
  };

  const chat_window = new ChatWindow({
    profile: {
      chat_topic: ctx.chat_topic || chat_topic,
    },
  });

  new ChatSpace({
    $wrapper: chat_window.$chat_window,

    profile: {
      ...baseProfile,

      room: ctx.can_write ? ctx.chat_channel : null,
      room_name: ctx.room_name || ctx.chat_topic_subject || "Topic",
      room_type: ctx.room_type || "Group",

      platform: ctx.platform || "Chat",
      is_removed: ctx.is_removed || 0,
      remove_date: ctx.remove_date || null,
    },

    chat_topic: ctx.chat_topic || chat_topic,
    chat_topic_channel: ctx.chat_channel,
    chat_topic_subject: ctx.chat_topic_subject,
    alternative_subject: ctx.chat_topic_subject,

    is_private_topic: ctx.is_private_topic || 0,

    topic_write_mode: canWrite,

    topic_read_only: String(ctx.topic_status || "").toLowerCase() === "closed" || !canWrite,
    topic_can_reopen: Boolean(ctx.can_reopen),
    chat_topic_status: ctx.topic_status,
    original_room_type: ctx.room_type || "Group",
    chat_status: ctx.chat_status,
  });

  if (message_name && window.CCChatSpaceInstances) {
    setTimeout(() => {
      window.CCChatSpaceInstances.forEach((cs) => {
        if (
          cs &&
          cs.chat_topic_space === chat_topic &&
          typeof cs.jumpToMessage === "function"
        ) {
          cs.jumpToMessage(message_name);
        }
      });
    }, 800);
  }
};

frappe.provide("frappe.ErpnextChat");
frappe.provide("frappe.ErpnextChat.settings");

frappe.ErpnextChat.ContactList = ChatContactList;

let FRAPPE_MAJOR_VERSION = null;

async function initFrappeVersion() {
  if (FRAPPE_MAJOR_VERSION !== null) return;

  const r = await frappe.call({
    method: "clefincode_chat.api.api_1_3_1.api.get_frappe_major_version",
  });

  FRAPPE_MAJOR_VERSION = r.message;
}

frappe.ErpnextChat = class {
  constructor() {
    this.boot();
  }

  async boot() {
    await initFrappeVersion();
    this.frappe_version = FRAPPE_MAJOR_VERSION;

    if (this.frappe_version == 16) {
      $("body").addClass("cc-frappe-v16");
    }

    await this.setup_app();
  }

  apply_webview_layout(enable) {
    if (enable) {
      $("body").addClass("cc-chat-webview");
      this.$chat_left_section?.show();
    } else {
      $("body").removeClass("cc-chat-webview");
    }
  }

  async setup_app() {
    const token = localStorage.getItem("guest_token") || "";
    const res = await get_settings(token);
    this.res = res;
    this.is_desk = "desk" in frappe;

    if (res.user == "Administrator") return;

    if (res.user == "Guest") {
      if (!res.enable_portal_support) return;

      await this.create_chatbot();

      frappe.socketio.init(res.socketio_port);
      this.enable_socket_reconnect(res.socketio_port);
      this.setup_socketio_mobile();

      if (this.res.channel) {
        const calculate_unread_messages_guest =
          await calculate_unread_messages_forGuest(this.res.channel);

        if (calculate_unread_messages_guest.unread_messages > 0) {
          $("#chat-notification-count").text(
            calculate_unread_messages_guest.unread_messages
          );
        }
      }
    } else {
      await this.create_app();
    }

    if (typeof frappe.get_route === "function") {
      this.is_webview = frappe.get_route()[0] === "clefinchat";
    } else {
      this.is_webview = false;
    }

    frappe.socketio.init(res.socketio_port);
    this.enable_socket_reconnect(res.socketio_port);

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

      if (this.is_webview) {
        this.show_chat_widget();
      }

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

    this.$empty_state = $(`
      <div class="chat-empty-state">
        <div class="empty-content">
          <div class="empty-icon">💬</div>
          <h3>Select a chat</h3>
          <p>Choose a conversation from the left to start messaging</p>
        </div>
      </div>
    `);

    this.$chat_left_section.append(this.$empty_state);

    this.$app_element.append(this.$chat_left_section);
    this.$app_element.append(this.$chat_right_section);

    this.$chat_bottom = $(document.createElement("div")).addClass(
      "chat_bottom"
    );

    this.$app_element.append(this.$chat_bottom);

    this.$app_element.append(`
      <script>
        const me = this;

        var expand_me = function(parameter, attr, room_type, room, parent_channel, chat_topic) {
          if (attr == 'data-room') {
            const chat_list_obj = erpnext_chat_app.chat_list;

            if (chat_list_obj) {
              const chat_room_item = chat_list_obj.chat_room_groups.find((element) => {
                return element[0] === parameter;
              });

              if (chat_room_item) {
                chat_room_item[1].expand = 1;
                chat_room_item[1].$chat_room.click();
              }
            } else {
              if (room_type == 'Contributor') {
                frappe.call({
                  method: "clefincode_chat.api.api_1_2_1.api.mark_messsages_as_read",
                  args: {
                    user: frappe.session.user,
                    channel: null,
                    parent_channel: parent_channel
                  }
                });

                frappe.ErpnextChat.settings.unread_rooms =
                  frappe.ErpnextChat.settings.unread_rooms.filter(item => item != parent_channel);

                frappe.ErpnextChat.settings.open_chat_space_rooms.push(parent_channel);
              } else {
                frappe.call({
                  method: "clefincode_chat.api.api_1_2_1.api.mark_messsages_as_read",
                  args: {
                    user: frappe.session.user,
                    channel: room
                  }
                });

                frappe.ErpnextChat.settings.unread_rooms =
                  frappe.ErpnextChat.settings.unread_rooms.filter(item => item != room);

                frappe.ErpnextChat.settings.open_chat_space_rooms.push(room);
              }

              frappe.ErpnextChat.settings.unread_count -= 1;

              if (frappe.ErpnextChat.settings.unread_count <= 0) {
                $('#chat-notification-count').text('');
              } else {
                $('#chat-notification-count').text(frappe.ErpnextChat.settings.unread_count);
              }
            }

            $(".chat-window[data-room|='" + parameter + "']").css("display", "block");
            $(".minimized-chat[data-id|='" + parameter + "']").remove();
          } else if (attr == 'data-topic') {
            $(".chat-window[data-topic|='" + parameter + "']").css("display", "block");
            $(".minimized-chat[data-id|='" + parameter + "']").remove();
          } else {
            $(".chat-window[data-contact|='" + parameter + "']").css("display", "block");
            $(".minimized-chat[data-id|='" + parameter + "']").remove();
          }

          var screen_width = $("body").outerWidth();
          var right_width = $(".chat_right_section").outerWidth();
          var left_width = $(".chat_left_section").outerWidth();

          if ((right_width + left_width) > screen_width) {
            $(".chat-window").each(function(index) {
              if (attr == 'data-room') {
                if ($(this).is("[data-room~='" + parameter + "']")) {
                } else {
                  if ($(this).css('display') == 'none') {
                  } else {
                    $(".collapse-chat-window")[index].click();
                    return false;
                  }
                }
              } else if (attr == 'data-topic') {
                $(".collapse-chat-window")[index].click();
                return false;
              } else {
                if ($(this).is("[data-contact~='" + parameter + "']")) {
                } else {
                  if ($(this).css('display') == 'none') {
                  } else {
                    $(".collapse-chat-window")[index].click();
                    return false;
                  }
                }
              }
            });
          }

          if ($(".chat-window:visible").length > 0) {
            $(".chat-empty-state").hide();
          }
        };

        var closeMe = function(parameter, attr) {
          if (attr == 'data-room') {
            $(".chat-window[data-room|='" + parameter + "']").remove();
          } else if (attr == 'data-topic') {
            $(".chat-window[data-topic|='" + parameter + "']").remove();
          } else {
            $(".chat-window[data-contact|='" + parameter + "']").remove();
          }

          $(".minimized-chat[data-id|='" + parameter + "']").remove();

          if ($(".chat-window:visible").length === 0) {
            $(".chat-empty-state").show();
          }
        };
      </script>
    `);

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

    $("#chat-bubble").append(
      '<span class="badge" id="chat-notification-count"></span>'
    );

    let navbar_icon_html;

    if (FRAPPE_MAJOR_VERSION == 16) {
      $(".chat-navbar-icon").remove();
    } else {
      navbar_icon_html = `
        <li class='nav-item dropdown dropdown-notifications dropdown-mobile chat-navbar-icon' title="Show Chats">
          <img title="Show Chats" src="/assets/clefincode_chat/icons/clefincode_chat.svg" width="25px" height="25px">
          <span class="badge" id="chat-notification-count"></span>
        </li>
      `;
    }

    if (this.is_desk === true) {
      if (FRAPPE_MAJOR_VERSION == 16) {
        // Frappe v16 navbar icon is disabled here.
      } else {
        $("header.navbar > .container > .navbar-collapse > ul").prepend(
          navbar_icon_html
        );
      }
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

    $(".chat-bubble").append(
      '<span class="badge" id="chat-notification-count"></span>'
    );

    this.setup_events();
  }

  async show_chat_widget() {
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

    if (this.res.user === "Guest" && !this.res.channel) {
      const updated_res = await get_settings(
        localStorage.getItem("guest_token") || ""
      );

      this.res.channel = updated_res.channel;
    }

    if (!this.res.is_admin && this.res.channel && this.res.user === "Guest") {
      frappe.call({
        method:
          "clefincode_chat.api.api_1_2_1.api.mark_messsages_as_read_for_guest",
        args: {
          token: localStorage.getItem("guest_token"),
          channel: this.res.channel,
        },
      });
    }

    if (this.res.is_admin) {
      this.chat_list = new ChatList({
        $wrapper: this.$chat_container,
        user: this.res.user,
        user_email: this.res.user_email,
        is_admin: this.res.is_admin,
        time_zone: this.res.time_zone,
        user_type: this.res.user_type,
        is_limited_user: this.res.is_limited_user,
      });

      if (this.is_webview) {
        this.apply_webview_layout(true);
      }

      this.chat_list.render();
    }
  }

  hide_chat_widget() {
    if (this.is_webview) {
      this.apply_webview_layout(false);
    }

    this.is_open = false;

    this.$chat_element.fadeOut(300);

    if (!this.res.is_admin && this.res.channel && this.res.user === "Guest") {
      frappe.call({
        method:
          "clefincode_chat.api.api_1_2_1.api.mark_messsages_as_read_for_guest",
        args: {
          token: localStorage.getItem("guest_token"),
          channel: this.res.channel,
        },
      });
    }

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

  enable_socket_reconnect(port) {
    if (frappe.ErpnextChat._socket_reconnect_guard_installed) return;

    frappe.ErpnextChat._socket_reconnect_guard_installed = true;

    const getSocket = () => {
      return frappe.realtime?.socket || frappe.socketio?.socket;
    };

    const configureManager = () => {
      const socket = getSocket();

      if (!socket || !socket.io) return;

      const manager = socket.io;

      if (typeof manager.reconnection === "function") {
        manager.reconnection(true);
      }

      if (typeof manager.reconnectionAttempts === "function") {
        manager.reconnectionAttempts(Infinity);
      }

      if (typeof manager.reconnectionDelay === "function") {
        manager.reconnectionDelay(1000);
      }

      if (typeof manager.reconnectionDelayMax === "function") {
        manager.reconnectionDelayMax(10000);
      }

      if (manager.opts) {
        manager.opts.reconnection = true;
        manager.opts.reconnectionAttempts = Infinity;
        manager.opts.reconnectionDelay = 1000;
        manager.opts.reconnectionDelayMax = 10000;
        manager.opts.timeout = 20000;
      }
    };

    const reconnectNow = () => {
      const socket = getSocket();

      if (!socket) return;
      if (navigator.onLine === false) return;

      configureManager();

      if (!socket.connected) {
        try {
          socket.connect();
        } catch (e) {
          console.error("[ClefinCode Chat] socket reconnect failed:", e);
        }
      }
    };

    configureManager();

    const socket = getSocket();

    if (socket) {
      socket.on("connect", () => {
        console.log("[ClefinCode Chat] socket connected");
      });

      socket.on("disconnect", (reason) => {
        console.warn("[ClefinCode Chat] socket disconnected:", reason);

        if (
          reason === "io server disconnect" ||
          reason === "io client disconnect" ||
          reason === "transport close" ||
          reason === "ping timeout"
        ) {
          setTimeout(reconnectNow, 1000);
        }
      });

      socket.on("connect_error", (err) => {
        console.warn(
          "[ClefinCode Chat] socket connect_error:",
          err?.message || err
        );
      });

      if (socket.io) {
        socket.io.on("reconnect", () => {
          console.log("[ClefinCode Chat] socket manager reconnected");
        });

        socket.io.on("reconnect_failed", () => {
          console.warn("[ClefinCode Chat] reconnect failed, retrying manually");
          setTimeout(reconnectNow, 3000);
        });
      }
    }

    window.addEventListener("online", reconnectNow);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        reconnectNow();
      }
    });

    setInterval(reconnectNow, 30000);
  }

  setup_events() {
    if (FRAPPE_MAJOR_VERSION == 16) {
      const me = this;

      $(document).on("click", ".chat-navbar-icon", function () {
        $("#chat-bubble").fadeOut(150);

        if (me.chat_bubble) {
          me.chat_bubble.disk_chat_icon();
        }
      });
    } else {
      const me = this;

      $(".chat-navbar-icon").on("click", function () {
        $("#chat-bubble").fadeOut(150);
        me.chat_bubble.disk_chat_icon();
      });
    }
  }

  setup_socketio() {
    const me = this;

    const restoreSubscriptions = () => {
      console.log("[ClefinCode Chat] socket connected/reconnected, restoring subscriptions...");

      if (me.chat_list && typeof me.chat_list.re_subscribe === "function") {
        me.chat_list.re_subscribe();
      }

      if (window.CCChatSpaceInstances) {
        window.CCChatSpaceInstances.forEach((cs) => {
          if (cs && typeof cs.re_subscribe_channels === "function") {
            cs.re_subscribe_channels();
          }
        });
      }

      if (
        me.chatbot_space &&
        typeof me.chatbot_space.re_subscribe === "function"
      ) {
        me.chatbot_space.re_subscribe();
      }
    };

    const socket = frappe.realtime?.socket || frappe.socketio?.socket;

    if (socket) {
      socket.on("disconnect", (reason) => {
        console.log("[ClefinCode Chat] Socket disconnected:", reason);
      });

      socket.on("connect", restoreSubscriptions);

      if (socket.io) {
        socket.io.on("reconnect", restoreSubscriptions);
      }
    }

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
      const audio = new Audio(
        "/assets/clefincode_chat/sounds/new-chat-notification.mp3"
      );

      audio.play().catch((error) => {
        console.error("Error playing sound:", error);
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
    const me = this;

    const restoreGuestSubscriptions = () => {
      console.log("[ClefinCode Chat Mobile] socket connected/reconnected");

      if (
        me.chatbot_space &&
        typeof me.chatbot_space.re_subscribe === "function"
      ) {
        me.chatbot_space.re_subscribe();
      }
    };

    const socket = frappe.realtime?.socket || frappe.socketio?.socket;

    if (socket) {
      socket.on("disconnect", (reason) => {
        console.log("[ClefinCode Chat Mobile] Socket disconnected:", reason);
      });

      socket.on("connect", restoreGuestSubscriptions);

      if (socket.io) {
        socket.io.on("reconnect", restoreGuestSubscriptions);
      }
    }

    frappe.realtime.on("receive_message", function (res) {
      var obj = [{ key: "receive_message", data: [JSON.stringify(res)] }];
    });

    frappe.realtime.on("guest_unread_update", async () => {
      if (!this.is_open) {
        const audio = new Audio(
          "/assets/clefincode_chat/sounds/new-chat-notification.mp3"
        );

        audio.play().catch((error) => {
          console.error("Error playing sound:", error);
        });

        if ($("#chat-notification-count").length === 0) {
          $(".chat-bubble").append(
            '<span class="badge" id="chat-notification-count"></span>'
          );
        }

        if (this.res.user === "Guest") {
          try {
            if (!this.res.channel) {
              const token = localStorage.getItem("guest_token") || "";
              const res = await get_settings(token);
              this.res = res;
            }

            if (this.res.channel) {
              const result = await calculate_unread_messages_forGuest(
                this.res.channel
              );

              $("#chat-notification-count").text(
                result.unread_messages || ""
              );
            } else {
              console.warn(
                "No channel found for guest after re-fetching settings."
              );
            }
          } catch (error) {
            console.error("Error calculating guest unread messages:", error);
          }
        }
      }
    });
  }
};

frappe.ErpnextChat.ContactList = ChatContactList;
window.CCChatContactList = ChatContactList;

async function get_settings(token) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_2_1.api.get_settings",
    args: {
      token: token,
    },
  });

  return await res.message;
}

async function calculate_unread_messages(user) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_2_1.api.calculate_unread_messages",
    args: {
      user: user,
    },
  });

  return await res.message;
}

async function calculate_unread_messages_forGuest(channel) {
  const res = await frappe.call({
    type: "GET",
    method:
      "clefincode_chat.api.api_1_2_1.api.calculate_unread_messages_for_guest",
    args: {
      channel: channel,
      token: localStorage.getItem("guest_token") || "",
    },
  });

  return await res.message;
}

$(document).on("click", ".cc-chat-topic-link", function (e) {
  e.preventDefault();

  window.CiCOpenTopicFromTimeline({
    chat_topic: $(this).data("chat-topic"),
    message_name: $(this).data("message-name"),
  });
});

$(function () {
  window.erpnext_chat_app = new frappe.ErpnextChat();
});