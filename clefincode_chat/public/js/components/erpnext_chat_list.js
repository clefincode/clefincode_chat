import ChatRoom from "./erpnext_chat_room";
import ChatContactList from "./erpnext_chat_contact_list";
import ChatWindow from "./erpnext_chat_window";
import ChatSpace from "./erpnext_chat_space";
import { check_if_chat_window_open, get_time } from "./erpnext_chat_utils";

export default class ChatList {
  constructor(opts) {
    this.$wrapper = opts.$wrapper;
    this.user = opts.user;
    this.user_email = opts.user_email;
    this.is_admin = opts.is_admin;
    this.time_zone = opts.time_zone;
    this.is_pined = this.get_pin_cookie();
    this.is_open = 1;
    this.limit = 10;
    this.offset = 0;
    this.last_scroll_top = 0;
    this.num_of_results = 0;
    this.rest_of_results = 0;
    this.setup();
  }

  setup() {
    this.$chat_list = $(document.createElement("div")).addClass("chat-list");
    this.setup_header();
    this.fetch_and_setup_rooms();
    this.setup_socketio();
  }

  setup_header() {
    const chat_list_header_html = `
			<div class='chat-list-header'>
				<h3>${__("Chats")}</h3>
        <div class='chat-list-icons'> 
          <div class='new-chat' 
              title='New Chat'>
              ${frappe.utils.icon("add", "md")}
          </div>          
          <div class='close-chat-list' 
          title='Close'>
          ${frappe.utils.icon("close", "lg")}
          </div>
        </div>
			</div>
		`;
    this.$chat_list.append(chat_list_header_html);
  }

  async setup_search() {
    if (
      this.$chat_list.find(".chat-search") &&
      this.$chat_list.find(".chat-search").length > 0
    ) {
      return;
    }
    const chat_list_search_html = `
		<div class='chat-search'>
			<div class='input-group'>
				<input class='form-control chat-search-box'
				type='search' 
				placeholder='${__("Search conversations")}'>	
				<span class='search-icon'>
					${frappe.utils.icon("search", "sm")}
				</span>
			</div>
		</div>
		`;
    this.$chat_list.append(chat_list_search_html);
  }

  async fetch_and_setup_rooms() {
    try {
      if (this.controller) {
        this.controller.abort();
      }
      this.controller = new AbortController();
      const { signal } = this.controller;

      let results_info = await get_channels_list(
        this.user_email,
        this.limit,
        this.offset,
        { signal }
      );
      this.room_groups = results_info.results;
      this.num_of_results = results_info.num_of_results;
      if (this.num_of_results == 0) {
        const empty_chat_list_container = `
        <div class="empty-chat-list-container">
          <div>
            <img src="/assets/frappe/images/ui-states/list-empty-state.svg" alt="Generic Empty State" class="null-state" style="height:60px!important">
          </div>
          <div class="my-2">You don't have any conversation yet</div>
          <div class="btn btn-primary chat-list-primary-btn">+ Create your first conversation</div>
        </div>
        `;
        this.$chat_rooms_group_container = $(document.createElement("div"));
        this.$chat_rooms_group_container.addClass("chat-rooms-group-container");
        this.$chat_rooms_group_container.addClass("empty-container");
        this.$chat_rooms_group_container.append(empty_chat_list_container);
        this.$chat_list.append(this.$chat_rooms_group_container);
        this.setup_events();
        return;
      }
      await this.setup_rooms(signal);
      await this.render_messages(signal);
      this.setup_events();
    } catch (error) {
      console.log(error);
    } finally {
      this.controller = null;
    }
  }

  async setup_rooms(signal) {
    if (signal.aborted) {
      return;
    }
    if (
      this.$chat_rooms_group_container &&
      this.$chat_rooms_group_container.length > 0
    ) {
      this.$chat_rooms_group_container.remove();
    }
    this.$chat_rooms_group_container = $(document.createElement("div"));
    this.$chat_rooms_group_container.addClass("chat-rooms-group-container");

    await this.setup_search();
    this.chat_room_groups = [];
    this.room_groups.forEach((element) => {
      let profile = {
        user: this.user,
        user_email: this.user_email,
        is_admin: this.is_admin,
        time_zone: this.time_zone,
        room: element.room,
        parent_channel: element.parent_channel,
        room_name: element.room_name,
        room_type: element.type,
        last_message: element.last_message,
        send_date: element.send_date,
        contact: element.contact,
        last_message_number: element.last_message_number,
        user_unread_messages: element.user_unread_messages,
        is_removed: element.is_removed,
        remove_date: element.remove_date,
        last_message_media_type: element.last_message_media_type,
        last_message_voice_duration: element.last_message_voice_duration,
      };

      this.chat_room_groups.push([
        profile.room,
        new ChatRoom({
          $wrapper: this.$wrapper,
          $chat_rooms_container: this.$chat_rooms_group_container,
          element: profile,
        }),
      ]);
    });
    this.$chat_list.append(this.$chat_rooms_group_container);
  }

  async render_messages(signal = null) {
    if (signal.aborted || this.num_of_results == 0) {
      return;
    }
    this.$chat_rooms_group_container.empty();
    for (const element of this.chat_room_groups) {
      element[1].render("append");
    }
    // this.check_if_more_results();
  }

  fitler_rooms(query) {
    this.offset = 0;
    if (query && query != "") {
      this.filter_and_setup_rooms(query);
    } else {
      this.fetch_and_setup_rooms();
      this.setup_events();
    }
  }

  async filter_and_setup_rooms(query) {
    try {
      if (this.controller) {
        this.controller.abort();
      }
      this.controller = new AbortController();
      const { signal } = this.controller;
      this.chat_room_groups.forEach((room) => {
        if (!room[1].profile.room_name.toLowerCase().includes(query)) {
          room[1].$chat_room.hide();
        } else {
          room[1].$chat_room.show();
        }
      });
      // this.match_room_name = await search_in_rooms(this.user_email , query , { signal });
      // this.match_message_content = await search_in_message_content(this.user_email , query , { signal });
      // await this.setup_rooms_after_search(signal);
      // await this.render_messages_after_search(query , signal);
    } catch (error) {
      console.log(error);
      frappe.msgprint({
        title: __("Error"),
        message: __("Something went wrong. Please refresh and try again."),
      });
    } finally {
      this.controller = null;
    }
  }

  async setup_rooms_after_search(signal) {
    if (signal.aborted) {
      return;
    }
    this.$chat_rooms_group_container.remove();
    this.$chat_rooms_group_container = $(document.createElement("div"));
    this.$chat_rooms_group_container.addClass("chat-rooms-group-container");
    this.chat_rooms_after_search = [];

    this.match_room_name.forEach((element) => {
      if (element.type == "Direct" && element.room_name == "not_set") {
        if (element.creator_email == this.user_email) {
          element.room_name = element.contact_name;
        } else {
          element.room_name = element.contact_name;
        }
      } else if (element.type == "Group" && element.room_name == "not_set") {
        element.room_name = element.members.join(", ");
      }

      let profile = {
        user: this.user,
        user_email: this.user_email,
        is_admin: this.is_admin,
        room: element.room,
        room_name: element.room_name,
        room_type: element.type,
        last_message: element.last_message,
        last_message_number: element.last_message_number,
        last_message_read: element.last_message_read,
        send_date: element.send_date,
        user_unread_messages: element.user_unread_messages,
      };

      this.chat_rooms_after_search.push([
        profile.room,
        new ChatRoom({
          $wrapper: this.$wrapper,
          $chat_rooms_container: this.$chat_rooms_group_container,
          element: profile,
        }),
      ]);
    });

    this.match_message_content.forEach((element) => {
      if (element.type == "Direct" && element.room_name == "not_set") {
        if (element.creator_email == this.user_email) {
          element.room_name = element.contact_name;
        } else {
          element.room_name = element.creator_name;
        }
      } else if (element.type == "Group" && element.room_name == "not_set") {
        element.room_name = element.members.join(", ");
      }

      let profile = {
        user: this.user,
        user_email: this.user_email,
        is_admin: this.is_admin,
        room: element.room,
        room_name: element.room_name,
        room_type: element.type,
        last_message: element.last_message,
        last_message_number: element.last_message_number,
        last_message_read: element.last_message_read,
        send_date: element.send_date,
        user_unread_messages: element.user_unread_messages,
        scroll_to_message: element.message_name,
      };

      this.chat_rooms_after_search.push([
        profile.room,
        new ChatRoom({
          $wrapper: this.$wrapper,
          $chat_rooms_container: this.$chat_rooms_group_container,
          element: profile,
        }),
      ]);
    });

    this.$chat_list.append(this.$chat_rooms_group_container);
  }

  async render_messages_after_search(query, signal) {
    if (signal.aborted) {
      return;
    }
    this.$chat_rooms_group_container.empty();
    for (const element of this.chat_rooms_after_search) {
      if (element[1].$chat_room && element[1].$chat_room.length != 0) {
        element[1].render("append");
        element[1].set_last_message_after_search(query);
      } else {
        this.$chat_rooms_group_container.append(element[1].$chat_contact);

        element[1].$chat_contact.on("click", (e) => {
          const me = element[1];
          if ($(e.target).closest(".chat-icon").length > 0) {
            if (
              check_if_chat_window_open(me.profile.contact_email, "contact")
            ) {
              return;
            }
            me.chat_window = new ChatWindow({
              profile: {
                contact: me.profile.contact_email,
              },
            });

            let profile = {
              is_admin: me.profile.is_admin,
              user: me.profile.user,
              user_email: me.profile.user_email,
              time_zone: me.profile.time_zone,
              room: null,
              room_name: me.profile.contact_name,
              room_type: "Direct",
              contact_name: me.profile.contact_name,
              contact_email: me.profile.contact_email,
              is_first_message: 1,
            };
            me.chat_space = new ChatSpace({
              $wrapper: me.chat_window.$chat_window,
              profile: profile,
            });
          }
        });
      }
    }
  }

  setup_events() {
    const me = this;
    $(".chat-list .chat-search-box").on("input", function (e) {
      if (me.search_timeout != undefined) {
        clearTimeout(me.search_timeout);
        me.search_timeout = undefined;
      }
      me.search_timeout = setTimeout(() => {
        me.fitler_rooms($(this).val().toLowerCase());
        // frappe.msgprint("Under construction");
        // $('.chat-list .chat-search-box').val('')
      }, 300);
    });

    $(".thumbtack-icon").on("click", () => {
      if (me.hasOwnProperty("is_pined") && typeof me.is_pined == "boolean") {
        me.is_pined = !me.is_pined;
      } else me.is_pined = true;
      document.cookie = "is_pined=" + me.is_pined;
      if (me.is_pined == true) {
        $(".pin").addClass("hidden");
        $(".rotate-thumbtack-icon").removeClass("hidden");
      } else {
        $(".pin").removeClass("hidden");
        $(".rotate-thumbtack-icon").addClass("hidden");
      }
    });

    $(".chat-list-primary-btn").on("click", function () {
      me.is_open = 0;
      erpnext_chat_app.chat_contact_list = new ChatContactList({
        $wrapper: me.$wrapper,
        profile: {
          user: me.user,
          user_email: me.user_email,
          is_admin: me.is_admin,
          time_zone: me.time_zone,
        },
        new_group: 0,
      });
      erpnext_chat_app.chat_contact_list.render();
    });

    $(".new-chat").on("click", function () {
      me.is_open = 0;
      erpnext_chat_app.chat_contact_list = new ChatContactList({
        $wrapper: me.$wrapper,
        profile: {
          user: me.user,
          user_email: me.user_email,
          is_admin: me.is_admin,
          time_zone: me.time_zone,
        },
        new_group: 0,
      });
      erpnext_chat_app.chat_contact_list.render();
    });

    setTimeout(() => {
      $(".chat-rooms-group-container").on("scroll", function () {
        if (me.rest_of_results > 0) {
          if (me.loading_timout) {
            clearTimeout(me.loading_timout);
            me.loading_timout = undefined;
          }
          me.loading_timout = setTimeout(() => {
            let scroll_top = $(this).scrollTop();
            if (scroll_top > me.last_scroll_top) {
              if (
                scroll_top + $(this).innerHeight() >=
                $(this)[0].scrollHeight - 20
              ) {
                me.get_and_loading_more_contents();
              }
            }
            me.last_scroll_top = scroll_top;
          }, 300);
        } else {
          $(".loading-more").remove();
        }
      });
    }, 1000);

    $(".close-chat-list").on("click", function () {
      erpnext_chat_app.hide_chat_widget();
      frappe.realtime.off("update_room");
      frappe.realtime.off("add_group_member");
      frappe.realtime.off("remove_group_member");
    });
  }

  setup_socketio() {
    const me = this;
    frappe.realtime.on("update_room", async function (res) {
      if (res.realtime_type == "send_message") {
        const setCommonFields = () => {
          res.is_admin = true;
          res.user = me.user;
          res.user_email = me.user_email;
          res.contact = res.sender_email;
        };

        const findChatRoomItem = () => {
          return me.chat_room_groups.find((element) => {
            return res.room_type === "Contributor"
              ? element[1].profile.parent_channel === res.parent_channel
              : element[1].profile.room === res.room;
          });
        };

        if (me.is_open === 1) {
          if (
            res.room_type === "Direct" &&
            me.user_email === res.sender_email
          ) {
            res.room_name = res.contact_name;
          }

          if (!me.chat_room_groups) {
            setCommonFields();
            me.append_room_in_empty_chat_list(res);
            return;
          }

          let chat_room_item = findChatRoomItem();

          if (!chat_room_item) {
            setCommonFields();
            me.create_new_room(res);
            return;
          }

          const channel =
            res.room_type === "Contributor" ? res.parent_channel : res.room;

          // update existing channel
          if (res.sender_email !== frappe.session.user) {
            if (
              !frappe.ErpnextChat.settings.open_chat_space_rooms.includes(
                channel
              )
            ) {
              let unread_messages =
                chat_room_item[1].profile.user_unread_messages;
              if (unread_messages >= 0) {
                chat_room_item[1].profile.user_unread_messages =
                  unread_messages + 1;
                chat_room_item[1].$chat_room
                  .find(".chat-latest")
                  .css("display", "flex");
                chat_room_item[1].$chat_room
                  .find(".chat-latest")
                  .html(chat_room_item[1].profile.user_unread_messages);
              }
            }
          }
          // const chat_channel = chat_room_item[1].profile.room_type == "Contributor" ? chat_room_item[1].profile.parent_channel: chat_room_item[1].profile.room
          let [last_message_media_type, last_message_voice_duration] =
            await get_last_message_type(
              res.room_type,
              me.user_email,
              channel,
              null
            );
          let sanitized_last_message =
            await chat_room_item[1].get_last_message_html(
              last_message_media_type,
              res.content,
              last_message_voice_duration
            );
          chat_room_item[1].set_last_message(
            sanitized_last_message,
            get_time(res.send_date, me.time_zone)
          );
          chat_room_item[1].move_to_top();
        }
      } else if (res.realtime_type == "rename_group") {
        const findChatRoomItem = () => {
          return me.chat_room_groups.find((element) => {
            return element[1].profile.room === res.room;
          });
        };

        let chat_room_item = findChatRoomItem();
        if (chat_room_item) {
          chat_room_item[1].$chat_room
            .find(".chat-name")
            .text(
              res.new_group_name.length > 20
                ? res.new_group_name.substring(0, 20) + "..."
                : res.new_group_name
            );
        }
      }
    });

    frappe.realtime.on("add_group_member", function (res) {
      if (res.added_user_email.some((user) => user.email === me.user_email)) {
        const chat_room = me.chat_room_groups.find((element) => {
          return element[1].profile.room === res.channel;
        });
        if (chat_room) {
          chat_room[1].profile.is_removed = 0;
          chat_room[1].profile.remove_date = null;
        }
      }
    });

    frappe.realtime.on("remove_group_member", function (res) {
      if (res.removed_user_email == me.user_email) {
        const chat_room = me.chat_room_groups.find((element) => {
          return element[1].profile.room === res.channel;
        });
        if (chat_room) {
          chat_room[1].profile.is_removed = 1;
          chat_room[1].profile.remove_date = res.remove_date;
        }
      }
    });
  }

  async append_room_in_empty_chat_list(res) {
    if (
      this.$chat_rooms_group_container &&
      this.$chat_rooms_group_container.length > 0
    ) {
      this.$chat_rooms_group_container.removeClass("empty-container");
      this.$chat_rooms_group_container.remove();
    }
    this.$chat_rooms_group_container = $(document.createElement("div"));
    this.$chat_rooms_group_container.addClass("chat-rooms-group-container");

    await this.setup_search();
    this.$chat_list.append(this.$chat_rooms_group_container);

    this.chat_room_groups = [];
    this.create_new_room(res);
  }

  async get_and_loading_more_contents() {
    let results = await get_room_groups(
      this.user_email,
      this.limit,
      this.offset
    );
    this.more_contents = results.results;
    $(".loading-more").remove();
    await this.render_new_content(this.more_contents);
  }

  async render_new_content() {
    this.new_chat_room_groups = [];
    this.more_contents.forEach((element) => {
      let profile = {
        user: this.user,
        user_email: this.user_email,
        is_admin: this.is_admin,
        room: element.room,
        room_type: element.type,
        last_message: element.last_message,
        send_date: element.send_date,
      };

      profile.room_name = element.room_name;
      profile.last_message_number = element.last_message_number;
      profile.user_unread_messages = element.user_unread_messages;

      this.new_chat_room_groups.push([
        profile.room,
        new ChatRoom({
          $wrapper: this.$wrapper,
          $chat_rooms_container: this.$chat_rooms_group_container,
          element: profile,
        }),
      ]);
    });

    for (const element of this.new_chat_room_groups) {
      element[1].render("append");
    }
    this.check_if_more_results();
  }

  check_if_more_results() {
    this.rest_of_results = this.num_of_results - (this.offset + this.limit);
    if (this.rest_of_results > this.limit) {
      this.$chat_rooms_group_container.append(
        `<div class="loading-more">Loading more...</div>`
      );
    }
    this.offset += this.limit;
  }

  get_pin_cookie() {
    let s = "is_pined=";
    let decodedCookie = decodeURIComponent(document.cookie);
    let ca = decodedCookie.split(";");
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) == " ") {
        c = c.substring(1);
      }
      if (c.indexOf(s) == 0) {
        return c.substring(s.length, c.length);
      }
    }
    return false;
  }

  render() {
    this.$wrapper.html(this.$chat_list);
    // this.setup_events();
  }

  create_new_room(profile) {
    if (profile.sender_email != this.user_email) {
      profile.user_unread_messages = 1;
    }
    this.chat_room_groups.unshift([
      profile.room,
      new ChatRoom({
        $wrapper: this.$wrapper,
        $chat_rooms_container: this.$chat_rooms_group_container,
        element: profile,
      }),
    ]);
    this.chat_room_groups[0][1].render("prepend");
  }

  move_room_to_top(chat_room_item) {
    this.chat_room_groups = [
      chat_room_item,
      ...this.chat_room_groups.filter((item) => item !== chat_room_item),
    ];
  }
} // END Class

async function get_channels_list(email, limit, offset) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.get_channels_list",
    args: {
      user_email: email,
      limit: limit,
      offset: offset,
    },
  });
  return await res.message;
}

async function get_last_message_type(
  room_type,
  user_email,
  channel,
  remove_date
) {
  const res = await frappe.call({
    type: "GET",
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

async function search_in_rooms(email, query) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.search_in_rooms",
    args: {
      user: email,
      query: query,
    },
  });
  return await res.message;
}

async function search_in_message_content(email, query) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.search_in_message_content",
    args: {
      user: email,
      query: query,
    },
  });
  return await res.message;
}
