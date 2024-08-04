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
    this.user_type = opts.user_type;
    this.is_limited_user = opts.is_limited_user;
    
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
    let chat_list_header_html = ``;
    if(this.user_type == "system_user"){
      chat_list_header_html = `<div class='chat-list-header'>
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
    }else{
      chat_list_header_html = `<div class='chat-list-header'>
      <h3>${__("Chats")}</h3>
      <div class='chat-list-icons'> 
        <div class='support-icon' 
            title='Request Support' style="margin-right:6px">
            <svg height="18px" width="18px" version="1.1" id="_x32_" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" xml:space="preserve" fill="#2490ef"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <style type="text/css"> .st0{fill:#2490ef;} </style> <g> <path class="st0" d="M256,0C114.616,0,0,114.612,0,256s114.616,256,256,256s256-114.612,256-256S397.385,0,256,0z M207.678,378.794 c0-17.612,14.281-31.893,31.893-31.893c17.599,0,31.88,14.281,31.88,31.893c0,17.595-14.281,31.884-31.88,31.884 C221.959,410.678,207.678,396.389,207.678,378.794z M343.625,218.852c-3.596,9.793-8.802,18.289-14.695,25.356 c-11.847,14.148-25.888,22.718-37.442,29.041c-7.719,4.174-14.533,7.389-18.769,9.769c-2.905,1.604-4.479,2.95-5.256,3.826 c-0.768,0.926-1.029,1.306-1.496,2.826c-0.273,1.009-0.558,2.612-0.558,5.091c0,6.868,0,12.512,0,12.512 c0,6.472-5.248,11.728-11.723,11.728h-28.252c-6.475,0-11.732-5.256-11.732-11.728c0,0,0-5.645,0-12.512 c0-6.438,0.752-12.744,2.405-18.777c1.636-6.008,4.215-11.718,7.508-16.694c6.599-10.083,15.542-16.802,23.984-21.48 c7.401-4.074,14.723-7.455,21.516-11.281c6.789-3.793,12.843-7.91,17.302-12.372c2.988-2.975,5.31-6.05,7.087-9.52 c2.335-4.628,3.955-10.067,3.992-18.389c0.012-2.463-0.698-5.702-2.632-9.405c-1.926-3.686-5.066-7.694-9.264-11.29 c-8.45-7.248-20.843-12.545-35.054-12.521c-16.285,0.058-27.186,3.876-35.587,8.62c-8.36,4.776-11.029,9.595-11.029,9.595 c-4.268,3.718-10.603,3.85-15.025,0.314l-21.71-17.397c-2.719-2.173-4.322-5.438-4.396-8.926c-0.063-3.479,1.425-6.81,4.061-9.099 c0,0,6.765-10.43,22.451-19.38c15.62-8.992,36.322-15.488,61.236-15.429c20.215,0,38.839,5.562,54.268,14.661 c15.434,9.148,27.897,21.744,35.851,36.876c5.281,10.074,8.525,21.43,8.533,33.38C349.211,198.042,347.248,209.058,343.625,218.852 z"></path> </g> </g></svg>
        </div>          
        <div class='close-chat-list' 
        title='Close'>
        ${frappe.utils.icon("close", "lg")}
        </div>
      </div>
    </div>
  `;
    }
			
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
        let empty_chat_list_container = ``;
        if(this.user_type == "system_user"){
          empty_chat_list_container = `
          <div class="empty-chat-list-container">
            <div>
              <img src="/assets/frappe/images/ui-states/list-empty-state.svg" alt="Generic Empty State" class="null-state" style="height:60px!important">
            </div>
            <div class="my-2">You don't have any conversation yet</div>
            <div class="btn btn-primary chat-list-primary-btn">+ Create your first conversation</div>
          </div>
          `;
        }else{
          empty_chat_list_container = `
          <div class="empty-chat-list-container">
            <div>
              <img src="/assets/frappe/images/ui-states/list-empty-state.svg" alt="Generic Empty State" class="null-state" style="height:60px!important">
            </div>
            <div class="my-2">You don't have any conversation yet</div>
          </div>
          `;
        }        
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
        user_type: this.user_type,
        is_limited_user: this.is_limited_user,
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
        is_website_support_group: element.is_website_support_group
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
    this.chat_room_groups.forEach((room) => {
      if (!room[1].profile.room_name.toLowerCase().includes(query)) {
        room[1].$chat_room.hide();
      } else {
        room[1].$chat_room.show();
      }
    });
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
          user_type: me.user_type,
          is_limited_user: me.is_limited_user,
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
          user_type: me.user_type,
          is_limited_user: me.is_limited_user,
        },
        new_group: 0,
      });
      erpnext_chat_app.chat_contact_list.render();
    });

    $(".support-icon").on("click", async function () { 
      const room = await check_if_website_user_has_support_channel(me.user_email);
      let chat_window ;
      if(room){
        if (check_if_chat_window_open(room , "room")){
          $(".expand-chat-window[data-id|='"+room+"']").click();
          return
          }

        chat_window = new ChatWindow({
          profile: {
            room: room,
          },
        });
      }else{
        if (check_if_chat_window_open("ClefinCode Support" , "contact")){
          $(".expand-chat-window[data-id|='ClefinCode Support']").click();
          return
          }
          
        chat_window = new ChatWindow({
          profile: {
            contact:"ClefinCode Support",
          },
        });
      }
      

      let profile = {
        is_admin: me.is_admin,
        user: me.user,
        user_email: me.user_email,
        time_zone: me.time_zone,
        user_type: me.user_type,
        is_limited_user: me.is_limited_user,
        room: room,
        room_name: "ClefinCode Support",
        room_type: "Group",
        // contact: contact,
        is_first_message: 1,
        // platform: platform,
        is_website_support_group: 1
      };

      this.chat_space = new ChatSpace({
        $wrapper: chat_window.$chat_window,
        profile: profile,
      });

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

async function check_if_website_user_has_support_channel(website_user_email) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.chat_portal.check_if_website_user_has_support_channel",
    args: {
      website_user_email: website_user_email
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
