import ChatContact from "./erpnext_chat_contact";
import ChatList from "./erpnext_chat_list";
import ChatWindow from "./erpnext_chat_window";
import ChatSpace from "./erpnext_chat_space";
import { check_if_contact_has_chat } from "./erpnext_chat_contact";
import {
  get_user_emails,
  get_user_names,
  check_if_room_admin,
  send_message,
  show_overlay,
  hide_overlay,
} from "./erpnext_chat_utils";
let FRAPPE_MAJOR_VERSION = null;

async function initFrappeVersion() {
  if (FRAPPE_MAJOR_VERSION !== null) return;

  const r = await frappe.call({
    method: "clefincode_chat.api.api_1_3_1.api.get_frappe_major_version"
  });

  FRAPPE_MAJOR_VERSION = r.message;
}
export default class ChatContactList {
  constructor(opts) {
    this.$wrapper = opts.$wrapper;
    this.profile = opts.profile;
    if (FRAPPE_MAJOR_VERSION == 16) {this.new_group = opts.new_group || 0;} else{this.new_group = opts.new_group;}
    this.add_member = opts.add_member;
    this.chat_info = opts.chat_info;
    this.limit = 10;
    this.offset = 0;
    this.has_more = true;
    this.loading = false;
    this.contacts = [];
    this.chat_contacts = [];
    this.search_text = "";
    this.forward = opts.forward || 0;
    this.forward_payload = opts.forward_payload || null;
    this.chat_space_ref = opts.chat_space || null;
    if (this.chat_info) {
      this.chat_space = this.chat_info.chat_space;
    }
    this.selected_contacts = [];
    this.rooms = [];
    this.room_offset = 0;
    this.room_has_more = true;
    this.room_loading = false;
    this.room_limit = 10;
    this.forward_preview = (this.forward == 1); 
    this.preview_rooms_limit = 5;
    this.preview_contacts_limit = 5;

    this.show_all_rooms = false;
    this.show_all_contacts = false;
    
   
    if (FRAPPE_MAJOR_VERSION == 16) {this.ready = this.initialize();} else{  
        this.setup();
      }
  }
  inject_forward_select_styles() {
  if (this.forward != 1) return;

  if (document.getElementById("cc-forward-select-style")) return;

  $("head").append(`
    <style id="cc-forward-select-style">
      .chat-contact-list.forward-mode .chat-contact {
        position: relative;
      }
      .chat-contact-list.forward-mode .chat-contact.forward-selected-contact {
        background: rgba(119, 163, 8, 0.43);
      }
      .chat-contact-list.forward-mode .chat-contact.forward-selected-contact::after {
        content: "";
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        font-weight: 700;
        font-size: 14px;
        opacity: 0.85;
      }

      
      .chat-contact-list.forward-mode .chat-contact .chat-icons .icon {
        position: relative;
      }
      .chat-contact-list.forward-mode .chat-contact .chat-icons .icon.selected::after {
        content: "✓";
        position: absolute;
        right: -2px;
        bottom: -2px;
        width: 14px;
        height: 14px;
        line-height: 14px;
        text-align: center;
        font-size: 10px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 0 0 1px rgba(0,0,0,0.15);
      }

      .chat-contact-list.forward-mode .chat-contact .dropdown-menu .dropdown-item.selected {
        position: relative;
        background: rgba(0,0,0,0.06);
        font-weight: 600;
      }
      .chat-contact-list.forward-mode .chat-contact .dropdown-menu .dropdown-item.selected::after {
        content: "✓";
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        font-weight: 700;
        opacity: 0.9;
      }
    </style>
  `);
}
async on_search_change(value) {
this.search_text = value;

  this.offset = 0; this.has_more = true; this.loading = false;
  this.contacts = []; this.chat_contacts = [];

  this.room_offset = 0; this.room_has_more = true; this.room_loading = false;
  this.rooms = [];

  this.$chat_contacts_container.find(".chat-contact").remove();

  
  if (this.forward == 1) {
    if (this.show_all_rooms) return await this.open_all_rooms_view();
    if (this.show_all_contacts) return await this.open_all_contacts_view();
    return await this.load_forward_preview();
  }

  await this.load_next_page(true);
}

//   on_search_change(value) {
//   this.search_text = value;

//   this.offset = 0;
//   this.has_more = true;


//   this.contacts = [];
//   this.chat_contacts = [];

 
//   this.$chat_contacts_container
//     .find(".chat-contact")
//     .remove();


//   this.load_next_page(true);
// }



  async initialize() {
    if (FRAPPE_MAJOR_VERSION == 16) {
    await initFrappeVersion();  
    await this.setup();
    return true          }    
    else return;
  }


  async setup() {
    this.$chat_contact_list = $(document.createElement("div"));
    this.$chat_contact_list.addClass("chat-contact-list");
    
  if (this.forward == 1) this.$chat_contact_list.addClass("forward-mode");

  
  this.inject_forward_select_styles();
    this.setup_header();
    this.setup_search();
    if (FRAPPE_MAJOR_VERSION == 16) {
    await this.fetch_and_setup_contacts();}
    else {this.fetch_and_setup_contacts();}

  }
  
  async load_next_rooms_page(is_first = false) {
  if (this.forward != 1) return;
  if (!this.room_has_more || this.room_loading) return;

  this.room_loading = true;

  try {
    const data = await get_channels_list_for_forward(
      this.profile.user_email,
      this.room_limit,
      this.room_offset,
      this.search_text
    );

    const new_rooms = data.results || [];
    if (is_first && !this.$chat_contacts_container.find(".forward-open-channels-title").length) {
      // this.$chat_contacts_container.append(
      //   `<div class="small text-muted px-2 pt-2 forward-open-channels-title">Open channels</div>`
      // );
    }
    // pagination
    this.room_offset += new_rooms.length;
    const total = data.num_of_results || 0;
    this.room_has_more = this.room_offset < total;

    this.rooms.push(...new_rooms);

    // render rooms
    new_rooms.forEach((r) => {
      const title = r.room_name || r.contact || r.room;
      const subtitle = `${r.type || ""}${r.platform ? " • " + r.platform : ""}`.trim();

      const $row = $(`
        <div class="chat-contact forward-room-target" data-room="${r.room}">
          <div class="contact-profile-info" style="width:100%">
            <div class="contact-name">${frappe.utils.escape_html(title)}</div>
            <div class="small text-muted">${frappe.utils.escape_html(subtitle)}</div>
          </div>
        </div>
      `);

      // click select/unselect
      $row.on("click", () => this.toggle_room_target(r, $row));

      this.$chat_contacts_container.append($row);
    });

  } catch (e) {
    console.log(e);
  } finally {
    this.room_loading = false;
  }
}
toggle_room_target(roomObj, $row) {
  // selected target shape:
  // { type:"room", room:"...", name:"...", platform:"...", room_type:"Direct/Group" ... }

  const room = roomObj.room;

  const exists = this.selected_contacts.some(x => x.type === "room" && x.room === room);

  if (exists) {
    this.selected_contacts = this.selected_contacts.filter(
      x => !(x.type === "room" && x.room === room)
    );
    $row.removeClass("forward-selected-contact");
  } else {
    this.selected_contacts.push({
      type: "room",
      room,
      name: roomObj.room_name || roomObj.contact || room,
      platform: roomObj.platform || null,
      room_type: roomObj.type || null
    });
    $row.addClass("forward-selected-contact");
  }

  this.update_selected_counter();
  this.$chat_contact_list.find(".save-icon").html(
    this.selected_contacts.length ? frappe.utils.icon("tick", "lg") : ""
  );
}




  setup_header() {
    let chat_list_header_html = "";
    if (this.forward == 1) {
  chat_list_header_html = `
    <div class='chat-list-header'>
      <div class='d-flex'>
        <div class='back-to-chat-list' title='Back'>
          ${frappe.utils.icon("arrow-left", "lg")}
        </div>
        <h3 style="margin-left: 8px;">
          ${__("Forward message")}
          <br>
          <span class="add-participants">
            ${__("Select recipients")} <span class="selected-contacts-number"></span>
          </span>
        </h3>
      </div>
      <div class='chat-list-icons'>
        <div class="save-icon"></div>
        <div class='close-chat-list' title='Close'>
          ${frappe.utils.icon("close", "lg")}
        </div>
      </div>
    </div>
  `;
}else if (this.new_group == 1) {
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

  // Error new group
  async fetch_and_setup_contacts() {
    try {
      if (this.add_member == 1) {
        this.contacts = await get_contacts_for_adding_to_group(
          this.profile.user_email,
          this.chat_info.chat_space.chat_members,
          this.chat_info.chat_space.contributors
        );
         this.setup_contacts(); 
      this.setup_events();
      return;
      } else if(this.new_group == 1){
        this.contacts = await get_contacts_for_new_group(this.profile.user_email);
           this.setup_contacts();
      this.setup_events();
      return;
      }
     
      this.setup_contacts_container_once();  
         if (this.forward == 1) {
        await this.load_forward_preview();      // ✅ 5 rooms + 5 contacts + see more
      } else {
        await this.load_next_page(true);
      }
        
    this.setup_events();
   if (this.forward != 1) this.setup_scroll_event();
    } catch (error) {
      console.log(error);
    }
  }

async load_forward_preview() {
  this.$chat_contacts_container.empty();

  this.$chat_contacts_container.append(`
    <div class="px-2 pt-2 small text-muted forward-open-channels-title">Open channels</div>
  `);

 
  this.room_offset = 0;
  this.room_limit = this.preview_rooms_limit;
  this.room_has_more = true;
  this.room_loading = false;
  this.rooms = [];
  await this.load_next_rooms_page(true);
    this.$chat_contacts_container.append(`
    <div class="forward-see-more-line forward-see-more-rooms" role="button" tabindex="0">
      <span>See more</span>
    </div>
  `);

  if (!this.room_has_more) {
    this.$chat_contacts_container.find(".forward-see-more-rooms").addClass("d-none");
  }

 // ===== CONTACTS =====
  this.$chat_contacts_container.append(`
    <div class="px-2 pt-3 small text-muted forward-contacts-title">Contacts</div>
  `);

  
  this.offset = 0;
  this.limit = this.preview_contacts_limit; // 5
  this.has_more = true;
  this.loading = false;
  this.contacts = [];
  this.chat_contacts = [];
  await this.load_next_page(true);

  // 
  this.$chat_contacts_container.append(`
    <div class="forward-see-more-line forward-see-more-contacts" role="button" tabindex="0">
      <span>See more</span>
    </div>
  `);


  if (!this.has_more) {
    this.$chat_contacts_container.find(".forward-see-more-contacts").addClass("d-none");
  }


  this.bind_forward_see_more();
}
bind_forward_see_more() {
  const me = this;

  this.$chat_contacts_container.off("click.forwardSeeMoreRooms");
  this.$chat_contacts_container.on("click.forwardSeeMoreRooms", ".forward-see-more-rooms", async function () {
    await me.open_all_rooms_view();
  });

  this.$chat_contacts_container.off("click.forwardSeeMoreContacts");
  this.$chat_contacts_container.on("click.forwardSeeMoreContacts", ".forward-see-more-contacts", async function () {
    await me.open_all_contacts_view();
  });
}

async fill_view_with_more_rooms() {
  while (this.room_has_more && !this.room_loading) {
    const container = this.$chat_contacts_container[0];
    if (!container || container.scrollHeight > container.clientHeight + 20) {
      break; 
    }
    await this.load_next_rooms_page();
  }
}

async fill_view_with_more_contacts() {
  while (this.has_more && !this.loading) {
    const container = this.$chat_contacts_container[0];
    if (!container || container.scrollHeight > container.clientHeight + 20) {
      break;
    }
    await this.load_next_page();
  }
}

async open_all_rooms_view() {
  this.show_all_rooms = true;
  this.show_all_contacts = false;

  this.$chat_contacts_container.empty();

  this.$chat_contacts_container.append(`
    <div class="d-flex justify-content-between align-items-center px-2 pt-2">
      <div class="small text-muted">Open channels</div>
      <div class="small text-secondary forward-back-preview" style="cursor:pointer;">Back</div>
    </div>
  `);

  this.room_offset = 0;
  this.room_limit = 10;
  this.room_has_more = true;
  this.room_loading = false;
  this.rooms = [];

  await this.load_next_rooms_page(true);

  this.bind_forward_back_to_preview();
  this.setup_scroll_event(); 
}async open_all_rooms_view() {
  this.show_all_rooms = true;
  this.show_all_contacts = false;
  this.$chat_contacts_container.empty();
  this.$chat_contacts_container.append(`
    <div class="d-flex justify-content-between align-items-center px-2 pt-2">
      <div class="small text-muted">Open channels</div>
      <div class="small text-secondary forward-back-preview" style="cursor:pointer;">Back</div>
    </div>
  `);

  this.room_offset = 0;
  this.room_limit = 10;
  this.room_has_more = true;
  this.room_loading = false;
  this.rooms = [];

  await this.load_next_rooms_page(true);


  await this.fill_view_with_more_rooms();

  this.bind_forward_back_to_preview();
  this.setup_scroll_event();
}

async open_all_contacts_view() {
  this.show_all_rooms = false;
  this.show_all_contacts = true;
  this.$chat_contacts_container.empty();
  this.$chat_contacts_container.append(`
    <div class="d-flex justify-content-between align-items-center px-2 pt-2">
      <div class="small text-muted">Contacts</div>
      <div class="small text-secondary forward-back-preview" style="cursor:pointer;">Back</div>
    </div>
  `);

  this.offset = 0;
  this.limit = 10;
  this.has_more = true;
  this.loading = false;
  this.contacts = [];
  this.chat_contacts = [];

  await this.load_next_page(true);

 
  await this.fill_view_with_more_contacts();

  this.bind_forward_back_to_preview();
  this.setup_scroll_event();
}
async open_all_contacts_view() {
  this.show_all_rooms = false;
  this.show_all_contacts = true;

  this.$chat_contacts_container.empty();

  this.$chat_contacts_container.append(`
    <div class="d-flex justify-content-between align-items-center px-2 pt-2">
      <div class="small text-muted">Contacts</div>
      <div class="small text-secondary forward-back-preview" style="cursor:pointer;">Back</div>
    </div>
  `);

  this.offset = 0;
  this.limit = 10;
  this.has_more = true;
  this.loading = false;

  this.contacts = [];
  this.chat_contacts = [];

  await this.load_next_page(true);

  this.bind_forward_back_to_preview();
  this.setup_scroll_event();
}
bind_forward_back_to_preview() {
  const me = this;

  this.$chat_contacts_container.off("click.forwardBackPreview");
  this.$chat_contacts_container.on("click.forwardBackPreview", ".forward-back-preview", async function () {
    me.show_all_rooms = false;
    me.show_all_contacts = false;

    await me.load_forward_preview();
  });
}

setup_contacts_container_once() {
  this.$chat_contacts_container = $(document.createElement("div"))
    .addClass("chat-contacts-container");

  
  if (!this.forward && can_create_dt("ClefinCode Chat Profile")) {
    this.$chat_contacts_container.append(`
      <div class="new-contact">
        ${frappe.get_avatar("avatar-medium", "C")}
        <div>New Contact</div>
      </div>
    `);
  }

  if (!this.forward && this.new_group == 0) {
    this.$chat_contacts_container.append(`
      <div class="new-group">
        ${frappe.get_avatar("avatar-medium","G")}
        <div>New group</div>
      </div>
    `);
  }

  this.$chat_contact_list.append(this.$chat_contacts_container);
}
async load_next_page(is_first = false) {
  if (!this.has_more || this.loading) return;

  this.loading = true;

  try {
    const data = await get_contacts(
          this.profile.user_email,
          this.limit,
          this.offset,
          this.search_text
        );
    const new_contacts = data.contacts || [];

    this.offset = data.next_offset;
    this.has_more = data.has_more;

    if (is_first && this.forward == 1 && !this.$chat_contacts_container.find(".forward-contacts-title").length) {
      // this.$chat_contacts_container.append(
      //   `<div class="small text-muted px-2 pt-2 forward-contacts-title">Contacts</div>`
      // );
    }
    this.contacts.push(...new_contacts);

    new_contacts.forEach((element) => {
      const profile = {
        user: this.profile.user,
        user_email: this.profile.user_email,
        is_admin: this.profile.is_admin,
        time_zone: this.profile.time_zone,
        profile_id: element.profile_id,
        contact_name: element.full_name,
        contact_details: element.contact_details,
        add_member: this.add_member,
      };

      const cc = new ChatContact({
        $wrapper: this.$wrapper,
        $chat_contacts_container: this.$chat_contacts_container,
        chat_contact_list: this,
        profile,
      });

      this.chat_contacts.push(cc);
    });

    
    if (is_first) {
      this.$chat_contact_list.find(".select-contacts")
        .html(`${data.total} contacts`);
    }

  } catch (e) {
    console.log(e);
  } finally {
    this.loading = false;
  }
}
setup_scroll_event() {
  const me = this;

  this.$chat_contacts_container.off("scroll.forwardScroll");
  this.$chat_contacts_container.on("scroll.forwardScroll", function () {
    const el = this;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 120;
    if (!nearBottom) return;

    if (me.forward == 1 && !me.show_all_rooms && !me.show_all_contacts) return;

  
    if (me.forward == 1 && me.show_all_rooms) {
      me.load_next_rooms_page();
      return;
    }

    if (me.forward == 1 && me.show_all_contacts) {
      me.load_next_page();
      return;
    }

    if (me.forward != 1) me.load_next_page();
  });
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

  // New Contact button
  if (can_create_dt("ClefinCode Chat Profile")){
  this.$chat_contacts_container.append(`
      <div class="new-contact" style="
          display:flex;
          align-items:center;
          cursor:pointer;
          padding:10px;
      ">
          ${frappe.get_avatar("avatar-medium", "C")}
          <div class="chat-profile-info" style="margin-left:10px;">
              <div class="chat-name">New Contact</div>
          </div>
      </div>
  `);
  }
  // New Group button (only when not already inside "new_group" mode)
  if (this.new_group == 0) {
    const new_group_html = `    
      <div class='chat-profile-info'>
          <div class='chat-name'>
            New group
          </div>
        </div>
      `;
      this.$chat_contacts_container.append(
        `<div class="new-group" style="display:flex; align-items:center; cursor:pointer; padding:10px;">
          ${frappe.get_avatar("avatar-medium","G")} 
          ${new_group_html}
       </div>`
      );
    }

    this.chat_contacts = [];

    this.contacts.forEach((element) => {
      let profile = {
        user: this.profile.user,
        user_email: this.profile.user_email,
        is_admin: this.profile.is_admin,
        time_zone: this.profile.time_zone,
        profile_id: element.profile_id,
        contact_name:
          element.full_name ||
          element.user_id ||
          element.profile_id ||
          "Unknown",
        contact_details: element.contact_details || [],
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

  async setup_events() {
    let me = this;
    setTimeout(() => {
      if (FRAPPE_MAJOR_VERSION == 16) {
      let me = this;

      $(document).off("click.newgroup");

      $(document).on("click.newgroup", ".new-group", async function (e) {
        e.stopPropagation();

        const contactList = new ChatContactList({
          $wrapper: me.$wrapper,
          profile: me.profile,
          new_group: 1,
        });

        await contactList.ready;      // ⏳ wait for initialize()
        contactList.render();         // 🎯 render once

        erpnext_chat_app.chat_contact_list = contactList;
      });

      }
      else {
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
      }
    }, 500);

    // this.$chat_contact_list.find(".chat-search-box").on("input", function (e) {
    //   if (me.search_timeout != undefined) {
    //     clearTimeout(me.search_timeout);
    //     me.search_timeout = undefined;
    //   }
    //   me.search_timeout = setTimeout(() => {
    //     me.fitler_contacts($(this).val().toLowerCase());
    //   }, 300);
    // });
    this.$chat_contact_list.find(".chat-search-box").on("input", function (e) {
        if (me.search_timeout) {
          clearTimeout(me.search_timeout);
        }

        me.search_timeout = setTimeout(() => {
          me.on_search_change($(this).val().toLowerCase());
        }, 300);
      });

if (FRAPPE_MAJOR_VERSION == 16) {
    $(document).off("click.backtolist");
    $(document).on("click.backtolist", ".back-to-chat-list", function (e) {
      e.stopPropagation();
      me.$wrapper.find(".chat-contact-list").remove();
      erpnext_chat_app.chat_contact_list = null;
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
    });}
    else{
      this.$chat_contact_list
      .find(".back-to-chat-list")
      .on("click", function (e) {
         if (me.forward == 1) {
            me.back_to_chat_space();
            return;
          }
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
    }

    this.$chat_contact_list.find(".save-icon").on("click", async function () {
      if (me.forward == 1) {
          await me.forward_message();
          return;
        }
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

      console.log("bbbbbbbbbb")
      if (me.forward == 1) {
      me.back_to_chat_space();
      return;
    }
      erpnext_chat_app.hide_chat_widget();
    });
    $(document).on("click", ".new-contact", () => {
      frappe.new_doc("ClefinCode Chat Profile");
    });
  }

render() {
  if (FRAPPE_MAJOR_VERSION == 16) {
  let $view = this.$wrapper.find(".chat-view");

  if (!$view.length) {
    $view = $("<div class='chat-view'></div>");
    this.$wrapper.append($view);
  }

  $view.empty().append(this.$chat_contact_list);}
  else{
      if (this.add_member == 1 || this.forward == 1) {
      this.$wrapper.find(".chat-info").hide();
      this.$wrapper.find(".chat-space").hide();
      this.$wrapper.append(this.$chat_contact_list);
    } else {
      this.$wrapper.html(this.$chat_contact_list);
    }

    // this.setup_events();
  }
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

    if (FRAPPE_MAJOR_VERSION !== 16) {
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
    }
    hide_overlay();
  }
  update_selected_counter() {
  const n = this.selected_contacts.length || 0;
  this.$chat_contact_list
    .find(".selected-contacts-number")
    .text(n ? `(${n})` : "");
}

back_to_chat_space() {
  this.$wrapper.find(".chat-contact-list").remove();
  this.$wrapper.find(".chat-space").show();
  this.$wrapper.find(".chat-info").show();
}

get_platform_profile_and_gateway(platform) {
  const res = window.erpnext_chat_app?.res || {};

  if (platform === "WhatsApp") {
    return { platform_profile: "ClefinCode WhatsApp Profile", platform_gateway: res.default_whatsapp_number };
  }
  if (platform === "Instagram") {
    return { platform_profile: "ClefinCode Instagram Profile", platform_gateway: res.default_instagram_profile };
  }
  if (platform === "Messenger") {
    return { platform_profile: "ClefinCode Facebook Messenger Profile", platform_gateway: res.default_messenger_profile };
  }
  if (platform === "Telegram") {
    return { platform_profile: "ClefinCode Telegram Profile", platform_gateway: res.default_telegram_profile };
  }
  return { platform_profile: null, platform_gateway: null }; // Chat
}

async create_direct_channel_for_forward(contact, platform, last_message_preview = "") {
  const { platform_profile, platform_gateway } = this.get_platform_profile_and_gateway(platform);

  const users = [
    { email: this.profile.user_email, name: this.profile.user_email, platform: "Chat" },
    {
      email: contact.email,
      name: contact.name || contact.email,
      platform: platform || "Chat",
      ...(platform_profile ? { platform_profile } : {}),
      ...(platform_gateway ? { platform_gateway } : {}),
    },
  ];

  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_2_1.api.create_channel",
    args: {
      channel_name: "",
      users,
      type: "Direct",
      last_message: last_message_preview,
      creator_email: this.profile.user_email,
      creator: this.profile.user
    },
  });

  return res.message?.results?.[0]?.room || null;
}

async ensure_room_for_forward(contact) {
  const platform = contact.platform || "Chat";

  
  const roomRes = await check_if_contact_has_chat(this.profile.user_email, contact.email, platform);
 
  if (roomRes?.results?.name) return roomRes.results.name;
 

 
  const preview = this.forward_payload?.content
    ? $("<div>").html(this.forward_payload.content).text().trim().slice(0, 60)
    : "";

  return await this.create_direct_channel_for_forward(contact, platform, preview);
}

async forward_message() {
  if (!this.selected_contacts || this.selected_contacts.length === 0) {
    frappe.msgprint(__("Please select at least one recipient."));
    return;
  }

  if (!this.forward_payload?.content) {
    frappe.msgprint(__("No message content to forward."));
    return;
  }

  show_overlay(__("Forwarding..."));

  try {
  
    // const forwarded_header = `
    //   <div class="forwarded-label" style="font-size:11px;opacity:.7;margin-bottom:4px;">
    //     ↪ ${__("Forwarded")}
    //   </div>
    // `;

    const p = this.forward_payload || {};
const forwarded_content = p.content;


for (const t of this.selected_contacts) {
  let room = null;

  if (t.type === "room" && t.room) {
    room = t.room;                // ✅ existing room
  } else {
    room = await this.ensure_room_for_forward(t); // ✅ contact flow
  }

  if (!room) continue;

  const message_info = {
    content: forwarded_content,
    user: this.profile.user,
    room: room,
    email: this.profile.user_email,
    is_first_message: 0,
    is_forwarded: 1,
    forwarded_from: p.source_message_name || p.message_name || "",
    is_link: p.is_link || 0,
    is_media: p.is_media || 0,
    is_document: p.is_document || 0,
    is_voice_clip: p.is_voice_clip || 0,
    is_screenshot: p.is_screenshot || 0,
    attachment: p.attachment || null,
    file_id: p.file_id || null,
    message_type: "",
  };

  await send_message(message_info);
}


    frappe.show_alert({ message: __("Forwarded successfully"), indicator: "green" });
    this.back_to_chat_space();
  } catch (e) {
    console.log(e);
    frappe.msgprint(__("Forward failed. Check console logs."));
  } finally {
    hide_overlay();
  }
}
} //END Class
function can_create_dt(doctype) {
  const list = frappe?.boot?.user?.can_create;
  return Array.isArray(list) && list.includes(doctype);
}
async function get_contacts(user_email, limit = 10, offset = 0, search_text = "") {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_3_3.api.get_contacts_for_website",
    args: { user_email, limit, offset, search_text  },
  });
  return res.message.results[0]; // {contacts, total, has_more, next_offset}
}

async function get_contacts_for_new_group(user_email) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_2_1.api.get_contacts_for_new_group",
    args: {
      user_email: user_email,
    },
  });
  return await res.message.results[0].contacts;
}
async function get_channels_list_for_forward(email, limit, offset, query = "") {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_3_3.api.get_channels_list",
    args: {
      user_email: email,
      limit,
      offset,
      ...(query ? { query } : {})
    },
  });
  return await res.message; // {results, num_of_results}
}
export async function create_group(selected_contacts_list, user, creation_date = null) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_2_1.api.create_group",
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
      "clefincode_chat.api.api_1_2_1.api.get_contacts_for_adding_to_group",
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
    method: "clefincode_chat.api.api_1_2_1.api.add_group_member",
    args: {
      new_members: new_members,
      room: room,
      last_active_sub_channel: last_active_sub_channel,
    },
    freeze: true,
  });
}
function safeIncludes(haystack, needle) {
  if (Array.isArray(haystack)) return haystack.includes(needle);
  if (typeof haystack === "string") return haystack.includes(needle);
  return false;
}