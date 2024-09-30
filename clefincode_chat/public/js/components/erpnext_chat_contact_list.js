import ChatContact from "./erpnext_chat_contact";
import ChatList from "./erpnext_chat_list";
import ChatWindow from "./erpnext_chat_window";
import ChatSpace from "./erpnext_chat_space";
import {
  get_user_emails,
  get_user_names,
  check_if_room_admin,
  send_message,
  show_overlay,
  hide_overlay,
} from "./erpnext_chat_utils";

export default class ChatContactList {
  constructor(opts) {
    this.$wrapper = opts.$wrapper;
    this.profile = opts.profile;
    this.new_group = opts.new_group;
    this.add_member = opts.add_member;
    this.chat_info = opts.chat_info;
    if (this.chat_info) {
      this.chat_space = this.chat_info.chat_space;
    }
    this.selected_contacts = [];
    this.setup();
  }

  setup() {
    this.$chat_contact_list = $(document.createElement("div"));
    this.$chat_contact_list.addClass("chat-contact-list");
    this.setup_header();
    this.setup_search();
    this.fetch_and_setup_contacts();
  }

  setup_header() {
    let chat_list_header_html = "";
    if (this.new_group == 1) {
      chat_list_header_html = `
			<div class='chat-list-header'>
        <div class='d-flex'>
          <div class='back-to-chat-list' title='Back'>
            ${frappe.utils.icon("arrow-left", "lg")}
          </div>
          <h3 style="margin-left: 8px;">${__(
            "New group"
          )}<br><span class="add-participants">Add participants <span class="selected-contacts-number"></span></span></h3>
        </div>
        <div class='chat-list-icons'> 
          <div class="save-icon"></div>         
          <div class='close-chat-list' 
          title='Close'>
          ${frappe.utils.icon("close", "lg")}
          </div>
        </div>
			</div>
		`;
    } else if (this.add_member == 1) {
      chat_list_header_html = `
			<div class='chat-list-header'>
        <div class='d-flex'>
          <div class='back-to-chat-list' title='Back'>
            ${frappe.utils.icon("arrow-left", "lg")}
          </div>
          <h3 style="margin-left: 8px;">${__(
            "Select Contact"
          )}<br><span class="add-participants">Add participants <span class="selected-contacts-number"></span></span></h3>
        </div>
        <div class='chat-list-icons'> 
          <div class="save-icon"></div>          
        </div>        
			</div>
		`;
    } else {
      chat_list_header_html = `
			<div class='chat-list-header'>
        <div class='d-flex'>
          <div class='back-to-chat-list' title='Back'>
            ${frappe.utils.icon("arrow-left", "lg")}
          </div>
          <h3 style="margin-left: 8px;">${__(
            "Select Contact"
          )}<br><span class="select-contacts"></span></h3>
        </div>
        <div class='chat-list-icons'>          
          <div class='close-chat-list' 
          title='Close'>
          ${frappe.utils.icon("close", "lg")}
          </div>
        </div>
			</div>
		`;
    }

    this.$chat_contact_list.append(chat_list_header_html);
  }

  setup_search() {
    const chat_list_search_html = `
		<div class='chat-search'>
			<div class='input-group'>
				<input class='form-control chat-search-box'
				type='search' 
				placeholder='${__("Search contacts")}'
				>	
				<span class='search-icon'>
					${frappe.utils.icon("search", "sm")}
				</span>
			</div>
		</div>
		`;
    this.$chat_contact_list.append(chat_list_search_html);
  }

  async fetch_and_setup_contacts() {
    try {
      if (this.add_member == 1) {
        this.contacts = await get_contacts_for_adding_to_group(
          this.profile.user_email,
          this.chat_info.chat_space.chat_members,
          this.chat_info.chat_space.contributors
        );
      } else if(this.new_group == 1){
        this.contacts = await get_contacts_for_new_group(this.profile.user_email);
      }else{
        this.contacts = await get_contacts(this.profile.user_email);
      }
      if (this.contacts.length == 0) {
        this.setup_empty_contacts_container();
      } else {
        this.$chat_contact_list
          .find(".select-contacts")
          .html(this.contacts.length + " contacts");
        this.setup_contacts();
      }
      this.setup_events();
    } catch (error) {
      console.log(error);
    }
  }

  setup_empty_contacts_container() {
    this.$chat_contact_list.find(".chat-search").remove();
    this.$chat_contacts_container = $(document.createElement("div"))
      .addClass("chat-contacts-container")
      .css({
        display: "flex",
        "justify-content": "center",
        "align-items": "center",
      });
    this.$chat_contacts_container.append(`<div>No Contacts</div>`);
    this.$chat_contact_list.append(this.$chat_contacts_container);
  }

  setup_contacts() {
    this.$chat_contacts_container = $(document.createElement("div")).addClass(
      "chat-contacts-container"
    );
    if (this.new_group == 0) {
      const new_group_html = `    
      <div class='chat-profile-info'>
          <div class='chat-name'>
            New group
          </div>
        </div>
      `;
      this.$chat_contacts_container.html(
        `<div class="new-group" style="align-items:center">${frappe.get_avatar(
          "avatar-medium",
          "G"
        )} ${new_group_html}</div>`
      );
    }

    this.chat_contacts = [];
    
    this.contacts.forEach((element) => {
      // if (this.new_group == 1 && !element.user_id) {
      //   return;
      // }

      let profile = {
        user: this.profile.user,
        user_email: this.profile.user_email,
        is_admin: this.profile.is_admin,
        time_zone: this.profile.time_zone,
        profile_id: element.profile_id,
        contact_name: element.full_name,
        contact_details: element.contact_details,
        add_member: this.add_member,
      };

      this.chat_contacts.push(
        new ChatContact({
          $wrapper: this.$wrapper,
          $chat_contacts_container: this.$chat_contacts_container,
          chat_contact_list: this,
          profile: profile,
        })
      );
    });
    this.copy_chat_contacts = this.chat_contacts;
    this.$chat_contact_list.append(this.$chat_contacts_container);
  }

  fitler_contacts(query) {
    if (query && query != "") {
      this.sort_list();
      for (const contact of this.chat_contacts) {
        const contact_name = contact.profile.contact_name
          ? contact.profile.contact_name.toLowerCase()
          : contact.profile.contact_name;
        const contact_email = contact.profile.contact_email
          ? contact.profile.contact_email.toLowerCase()
          : contact.profile.contact_email;
        const contact_phone = contact.profile.contact_phone
          ? contact.profile.contact_phone
          : null;

        if (
          contact_name.includes(query) ||
          (contact_email && contact_email.includes(query)) ||
          (contact_phone && contact_phone.includes(query))
        ) {
          contact.$chat_contact.show();
        } else {
          if (
            contact.$chat_contact.find(".chat-icon").hasClass("selected") ||
            contact.$chat_contact.find(".mail-icon").hasClass("selected")
          ) {
            contact.$chat_contact.show();
          } else {
            $(".chat-contacts-container .new-group").hide();
            contact.$chat_contact.hide();
          }
        }
      }
    } else {
      this.reset_filter();
    }
  }

  reset_filter() {
    $(".chat-contacts-container .new-group").show();
    this.copy_chat_contacts.forEach((contact) => {
      contact.$chat_contact.show();
      this.$chat_contacts_container.append(contact.$chat_contact);
    });
  }

  sort_list() {
    const me = this;
    this.chat_contacts.forEach((contact) => {
      if (
        contact.$chat_contact.find(".chat-icon").hasClass("selected") ||
        contact.$chat_contact.find(".mail-icon").hasClass("selected")
      ) {
        contact.$chat_contact.prependTo(me.$chat_contacts_container);
      } else {
        me.$chat_contacts_container.append(contact.$chat_contact);
      }
    });
  }

  setup_events() {
    let me = this;
    setTimeout(() => {
      $(".new-group").on("click", function (e) {
        erpnext_chat_app.chat_contact_list = new ChatContactList({
          $wrapper: me.$wrapper,
          profile: {
            user: me.profile.user,
            user_email: me.profile.user_email,
            is_admin: me.profile.is_admin,
            time_zone: me.profile.time_zone,
            user_type: me.profile.user_type,
            is_limited_user: me.profile.is_limited_user,
          },
          new_group: 1,
        });
        erpnext_chat_app.chat_contact_list.render();
      });
    }, 500);

    this.$chat_contact_list.find(".chat-search-box").on("input", function (e) {
      if (me.search_timeout != undefined) {
        clearTimeout(me.search_timeout);
        me.search_timeout = undefined;
      }
      me.search_timeout = setTimeout(() => {
        me.fitler_contacts($(this).val().toLowerCase());
      }, 300);
    });

    this.$chat_contact_list
      .find(".back-to-chat-list")
      .on("click", function (e) {
        if (me.add_member == 1) {
          me.$wrapper.find(".chat-contact-list").remove();
          me.chat_info.add_member_list = null;
          me.$wrapper.find(".chat-info").show();
        } else {
          erpnext_chat_app.chat_list = new ChatList({
            $wrapper: me.$wrapper,
            user: me.profile.user,
            user_email: me.profile.user_email,
            is_admin: me.profile.is_admin,
            time_zone: me.profile.time_zone,
            user_type: me.profile.user_type,
            is_limited_user: me.profile.is_limited_user,
          });
          erpnext_chat_app.chat_list.render();
        }
      });

    this.$chat_contact_list.find(".save-icon").on("click", async function () {
      if (me.add_member == 1) {
        await add_group_member(
          me.selected_contacts,
          me.chat_space.profile.room,
          me.chat_space.last_active_sub_channel
        );

        me.chat_info.$chat_info
          .find(".participants")
          .html(me.chat_info.count_group_members(me.chat_space.chat_members));
        me.$wrapper.find(".chat-contact-list").remove();
        me.chat_info.add_member_list = null;
        me.$wrapper.find(".chat-info").show();

        const added_members_name = get_user_names(me.selected_contacts);
        const added_members_email = get_user_emails(me.selected_contacts);

        const content = `
        <div class="add-user" data-template="added_user_template">
          <span class="sender-user" data-user="${me.profile.user_email}"></span>
          <span> added </span>
          <span class="receiver-user" data-user="${added_members_email}"></span>
        </div>`;
        // me.chat_space.$chat_space_container.append(
        //   await me.chat_space.make_message({
        //     content: content,
        //     type: 'info-message',
        //     sender: me.user,
        //     message_template_type: "Add User"
        //   }
        // ));

        let chat_room;
        if (me.chat_space.profile.room_type == "Contributor") {
          chat_room = me.chat_space.profile.parent_channel;
        } else {
          chat_room = me.chat_space.profile.room;
        }

        const message_info = {
          content: content,
          user: me.profile.user,
          room: chat_room,
          email: me.profile.user_email,
          is_first_message: 0,
          sub_channel: me.chat_space.last_active_sub_channel,
          message_type: "information",
          message_template_type: "Add User",
          chat_topic: me.chat_space.chat_topic,
        };
        send_message(message_info);

        for (const member of me.selected_contacts) {
          var html = `
            <div class="d-flex flex-row justify-content-between align-items-center pb-2 pt-2 delete-member" delete-data="${member.email}">
            <div>
              <div >${member.name}</div>
              <div class="small">${member.platform}: ${member.email}</div>
            </div>`;
          const Check_if_admin = await check_if_room_admin(
            chat_room,
            me.profile.user_email
          );
          if (Check_if_admin) {
            html += `<div class="deletefromgroup" style="cursor: pointer;" id="${member.email}" data-name="${member.name}"><?xml version="1.0" encoding="iso-8859-1"?>
              <svg height="20px" width="20px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
                viewBox="0 0 496.158 496.158" xml:space="preserve">
              <path style="fill:#E04F5F;" d="M0,248.085C0,111.063,111.069,0.003,248.075,0.003c137.013,0,248.083,111.061,248.083,248.082
                c0,137.002-111.07,248.07-248.083,248.07C111.069,496.155,0,385.087,0,248.085z"/>
              <path style="fill:#FFFFFF;" d="M383.546,206.286H112.612c-3.976,0-7.199,3.225-7.199,7.2v69.187c0,3.976,3.224,7.199,7.199,7.199
                h270.934c3.976,0,7.199-3.224,7.199-7.199v-69.187C390.745,209.511,387.521,206.286,383.546,206.286z"/>
              </svg></div>
              </div>`;
            $(".list_present_members").append(html);
          } else {
            html += `</div>`;
            $(".list_present_members").append(html);
          }
        }
      } else {
        me.create_group();
      }
    });

    this.$chat_contact_list.find(".close-chat-list").on("click", function () {
      erpnext_chat_app.hide_chat_widget();
    });
  }

  render() {
    if (this.add_member == 1) {
      this.$wrapper.find(".chat-info").hide();
      this.$wrapper.find(".chat-space").hide();
      this.$wrapper.append(this.$chat_contact_list);
    } else {
      this.$wrapper.html(this.$chat_contact_list);
    }

    // this.setup_events();
  }

  async create_group() {
    show_overlay("");

    const room_info = await create_group(
      this.selected_contacts,
      this.profile.user_email
    );
    const room = room_info[0].room;
    const room_name = room_info[0].room_name;

    const chat_window = new ChatWindow({
      profile: {
        room: room,
      },
    });

    let profile = {
      is_admin: this.profile.is_admin,
      user: this.profile.user,
      user_email: this.profile.user_email,
      time_zone: this.profile.time_zone,
      room: room,
      room_name: room_name,
      room_type: "Group",
      is_first_message: 1,
    };

    this.chat_space = new ChatSpace({
      $wrapper: chat_window.$chat_window,
      profile: profile,
      new_group: 1,
    });

    setTimeout(() => {
      erpnext_chat_app.chat_list = new ChatList({
        $wrapper: this.$wrapper,
        user: this.profile.user,
        user_email: this.profile.user_email,
        is_admin: this.profile.is_admin,
        time_zone: this.profile.time_zone,
        user_type: this.profile.user_type,
        is_limited_user: this.profile.is_limited_user,
      });
      erpnext_chat_app.chat_list.render();
    }, 700);
    hide_overlay();
  }
} //END Class

async function get_contacts(user_email) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.get_contacts",
    args: {
      user_email: user_email,
    },
  });
  return await res.message.results[0].contacts;
}

async function get_contacts_for_new_group(user_email) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.get_contacts_for_new_group",
    args: {
      user_email: user_email,
    },
  });
  return await res.message.results[0].contacts;
}

export async function create_group(selected_contacts_list, user, creation_date = null) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.create_group",
    args: {
      selected_contacts_list: selected_contacts_list,
      user: user,
      creation_date: creation_date,
    },
    freeze: true,
  });
  return await res.message.results;
}

async function get_contacts_for_adding_to_group(
  user_email,
  existing_members,
  existing_contributors
) {
  const res = await frappe.call({
    method:
      "clefincode_chat.api.api_1_0_1.api.get_contacts_for_adding_to_group",
    args: {
      user_email: user_email,
      existing_members: existing_members,
      existing_contributors: existing_contributors,
    },
  });
  return await res.message.results[0].contacts;
}

export async function add_group_member(new_members, room, last_active_sub_channel) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.add_group_member",
    args: {
      new_members: new_members,
      room: room,
      last_active_sub_channel: last_active_sub_channel,
    },
    freeze: true,
  });
}
