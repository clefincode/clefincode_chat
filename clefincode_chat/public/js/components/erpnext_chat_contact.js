import ChatSpace from "./erpnext_chat_space";
import ChatWindow from "./erpnext_chat_window";
// import ConversationList from "./erpnext_conversation_list";
import {
  check_if_chat_window_open,
  is_email,
  is_phone_number,
} from "./erpnext_chat_utils";

export default class ChatContact {
  constructor(opts) {
    this.$wrapper = opts.$wrapper; //chat-container
    this.$chat_contacts_container = opts.$chat_contacts_container;
    this.profile = opts.profile;
    this.chat_contact_list = opts.chat_contact_list;
    this.number_of_mails = this.get_mails().length;
    this.number_of_numbers = this.get_phone_numbers().length;
    this.get_contact_details();
    this.setup();
  }

  get_contact_details() {
    const me = this;
    const check_icon = `<div class="check-icon" style="display:none"><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="15" height="15" viewBox="0 0 256 256" xml:space="preserve"><defs></defs><g style="stroke: none; stroke-width: 0; stroke-dasharray: none; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 10; fill: none; fill-rule: nonzero; opacity: 1;" transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)" ><path d="M 89.328 2.625 L 89.328 2.625 c -1.701 -2.859 -5.728 -3.151 -7.824 -0.568 L 46.532 45.173 c -0.856 1.055 -2.483 0.997 -3.262 -0.115 l -8.382 -11.97 c -2.852 -4.073 -8.789 -4.335 -11.989 -0.531 l 0 0 c -2.207 2.624 -2.374 6.403 -0.408 9.211 l 17.157 24.502 c 2.088 2.982 6.507 2.977 8.588 -0.011 l 4.925 -7.07 L 89.135 7.813 C 90.214 6.272 90.289 4.242 89.328 2.625 z" style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 10; fill: rgb(0,0,0); fill-rule: nonzero; opacity: 1;" transform=" matrix(1 0 0 1 0 0) " stroke-linecap="round" /></g></svg></div>`;
    if (this.profile.contact_details.length == 1) {
      me.profile.default_contact = this.profile.contact_details[0].contact_info;
      me.profile.default_platform = this.profile.contact_details[0].contact_type;
      me.get_default_platform_icon(this.profile.contact_details[0].contact_type, this.profile.contact_details[0].contact_info, check_icon)
    }
    this.no_default = 1;
    this.profile.contact_details.forEach((element) => {
      if (element.default == 1) {
        me.profile.default_contact = element.contact_info;
        me.profile.default_platform = element.contact_type;
        me.get_default_platform_icon(element.contact_type, element.contact_info, check_icon)        
        this.no_default = 0;
      }

      if (element.contact_type == "Chat") {
        me.profile.chat_contact = element.contact_info;
        me.chat_icon = `<div class="icon chat-icon" data-contact=${element.contact_info}><svg class="icon icon-lg"><use href="#icon-small-message"></use></svg>${check_icon}</div>`;
      } else if (element.contact_type == "WhatsApp") {
        me.profile.whatsapp_contact = element.contact_info;
        me.whatsapp_icon = `<div class="icon whatsapp-icon" data-contact=${element.contact_info}><img title="WhatsApp" src="/assets/clefincode_chat/icons/whatsapp.svg">${check_icon}</div>`;
      } else if (element.contact_type == "Email") {
        me.profile.mail_contact = element.contact_info;
        me.mail_icon = `<div class="icon mail-icon" data-contact=${element.contact_info}><svg version="1.1" id="Icons" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 32 32" style="enable-background:new 0 0 32 32;" xml:space="preserve"><g><g><path d="M16,16.8l13.8-9.2C29.2,5.5,27.3,4,25,4H7C4.7,4,2.8,5.5,2.2,7.6L16,16.8z"/></g><g><path d="M16.6,18.8C16.4,18.9,16.2,19,16,19s-0.4-0.1-0.6-0.2L2,9.9V23c0,2.8,2.2,5,5,5h18c2.8,0,5-2.2,5-5V9.9L16.6,18.8z"/></g></g></svg>${check_icon}</div>`;
      }
    });

    if (this.no_default == 1 && me.profile.contact_details.length > 1) {
      me.profile.default_contact = me.profile.contact_details[0].contact_info;
      me.profile.default_platform = me.profile.contact_details[0].contact_type;
      me.get_default_platform_icon(me.profile.contact_details[0].contact_type, me.profile.contact_details[0].contact_info, check_icon)
    }
  }

  get_default_platform_icon(default_platform, contact_info, check_icon){
    if (default_platform == "Chat") {
      this.profile.default_platform_icon = `<div class="icon chat-icon" data-contact=${contact_info}><svg class="icon icon-lg"><use href="#icon-small-message"></use></svg>${check_icon}</div>`;
    } else if (default_platform == "WhatsApp") {
      this.profile.default_platform_icon = `<div class="icon whatsapp-icon" data-contact=${contact_info}><img title="WhatsApp" src="/assets/clefincode_chat/icons/whatsapp.svg">${check_icon}</div>`;      
    } else if (default_platform == "Email") {
      this.profile.default_platform_icon = `<div class="icon mail-icon" data-contact=${contact_info}><svg version="1.1" id="Icons" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 32 32" style="enable-background:new 0 0 32 32;" xml:space="preserve"><g><g><path d="M16,16.8l13.8-9.2C29.2,5.5,27.3,4,25,4H7C4.7,4,2.8,5.5,2.2,7.6L16,16.8z"/></g><g><path d="M16.6,18.8C16.4,18.9,16.2,19,16,19s-0.4-0.1-0.6-0.2L2,9.9V23c0,2.8,2.2,5,5,5h18c2.8,0,5-2.2,5-5V9.9L16.6,18.8z"/></g></g></svg>${check_icon}</div>`;
    }
  }

  setup() {
    this.$chat_contact = $(document.createElement("div")).addClass(
      "chat-contact"
    );
    const avatar_html = frappe.get_avatar(
      "avatar-medium",
      this.profile.contact_name
    );
    let info_html = ``;
    if(this.chat_contact_list.new_group == 1 || this.chat_contact_list.add_member == 1){
      info_html = `
			<div class='contact-profile-info'>
				<div class='contact-name'>
					${
            this.profile.contact_name.length > 20
              ? this.profile.contact_name.substring(0, 20) + "..."
              : this.profile.contact_name
          } 	
          </div>
          <div class="chat-icons">
            ${this.chat_icon ? this.chat_icon : ""}
          </div>				
				</div>`;        
    }else{
      info_html = `
			<div class='contact-profile-info'>
				<div class='contact-name'>
					${
            this.profile.contact_name.length > 20
              ? this.profile.contact_name.substring(0, 20) + "..."
              : this.profile.contact_name
          } 					
				</div>
        <div class="chat-icons">
          ${this.profile.default_platform_icon ? this.profile.default_platform_icon : ""}
          ${this.profile.contact_details.length > 1 ? this.get_contact_options() : "<div style='width:40px'></div>"}                   
        </div>
      </div>				
		`;
    }
    
    const innerhtml = avatar_html + info_html;
    this.$chat_contact.html(innerhtml);
    this.$chat_contacts_container.append(this.$chat_contact);
    this.setup_events();
  }

  get_contact_options(){
    let html_options = `<div class="dropdown options-icon" style="font-size:24px; font-weight:bold">
    <div class="dropdown-toggle no-caret" type="button" id="dropdownMenuButton" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
      &#x22EE;
    </div>
    <div class="dropdown-menu" aria-labelledby="dropdownMenuButton">`;
    const contact_details = this.profile.contact_details;
    if(this.no_default == 1){
      for(let i = 1; i<contact_details.length; i++){
        html_options+=`<a class="dropdown-item ${contact_details[i].contact_type}" data-contact ="${contact_details[i].contact_info}"><div style="margin-right:6px">${this.get_icon(contact_details[i].contact_type)}</div> <div>${contact_details[i].contact_info}</div></a>`;
      }
    }else{
      for(let option of contact_details){
        if(option.default != 1){
          html_options+=`<a class="dropdown-item ${option.contact_type}" data-contact ="${option.contact_info}"><div style="margin-right:6px">${this.get_icon(option.contact_type)}</div> <div>${option.contact_info}</div></a>`;
        }
        
      }
    }   
  
    html_options += `</div></div>`;

    return html_options
  }

  setup_events() {
    const me = this;
    this.$chat_contact.on("click", (e) => {
      if (me.chat_contact_list.new_group == 0) {
        this.click_on_contact(e.target);
      } else {
        this.select_contact(e.target);
      }
    });
  }

  click_on_contact(e) {
    const me = this;
    const contact_element = $(e).closest(".chat-icon, .Chat, .mail-icon, .Email, .chat-contact, .whatsapp-icon, .WhatsApp, .options-icon");

    // If the element has the 'options-icon' class, return early
    if (contact_element.hasClass("options-icon")) {
        return;
    }

    if (contact_element.length > 0) {
        if (contact_element.hasClass("chat-icon") || contact_element.hasClass("Chat")) {
            this.handle_chat_icon_click(contact_element);
        } else if (contact_element.hasClass("mail-icon") || contact_element.hasClass("Email")) {
            this.handle_mail_icon_click(contact_element);
        } else if (contact_element.hasClass("whatsapp-icon") || contact_element.hasClass("WhatsApp")) {
            this.handle_whatsapp_icon_click();
        } else if (contact_element.hasClass("chat-contact")) {
            this.handle_chat_contact_click();
        }
    }
}

handle_chat_icon_click(contact_element) {
    this.check_if_contact_has_chat(
        this.profile.user_email,
        contact_element.data("contact"),
        "Chat"
    );
}

handle_mail_icon_click(contact_element) {
    const me = this;
    this.composer = new frappe.views.CommunicationComposer({
        recipients: contact_element.data("contact"),
        message: "",
        content_set: false,
        sender: this.profile.user_email,
    });

    setTimeout(() => {
        $(".btn-modal-close").on("click", () => {
            me.composer.dialog.hide();
            me.composer.clear_cache();
        });
    }, 200);
}

handle_whatsapp_icon_click() {
    const default_whatsapp_number = erpnext_chat_app.res.default_whatsapp_number;
    const default_whatsapp_type = erpnext_chat_app.res.default_whatsapp_type;

    if (!default_whatsapp_number) {
        frappe.throw("You don't have a WhatsApp number");
    } else {     
        if (check_if_chat_window_open(this.profile.default_contact, "contact")) {
            return;
        }
        this.check_if_contact_has_whatsapp_chat(
            default_whatsapp_number,
            default_whatsapp_type,
            this.profile.whatsapp_contact,
            "WhatsApp"
        );
    }
}

handle_chat_contact_click() {
    if (this.profile.default_platform === "WhatsApp") {
        this.handle_whatsapp_icon_click();
    } else if (this.profile.default_platform === "Email") {
        this.composer = new frappe.views.CommunicationComposer({
            recipients: this.profile.default_contact,
            message: "",
            sender: this.profile.user_email,
        });
    } else if (this.profile.default_platform === "Chat") {
        if (check_if_chat_window_open(this.profile.default_contact, "contact")) {
            return;
        }
        this.check_if_contact_has_chat(
            this.profile.user_email,
            this.profile.default_contact,
            this.profile.default_platform
        );
    }
}

  select_contact(e) {
    const me = this;
    let icon, platform;
    const contact_element = $(e).closest(".chat-icon, .Chat, .mail-icon, .Email, .chat-contact , .whatsapp-icon, .WhatsApp, .options-icon");
    if(contact_element.hasClass("options-icon")){
      return
    }else if (contact_element.length > 0) { 
      icon = contact_element;
      if (contact_element.hasClass("chat-icon") || contact_element.hasClass("Chat")) {        
        platform = "Chat";
      } else if (contact_element.hasClass("mail-icon") || contact_element.hasClass("Email")) {
        platform = "Email";
      } else if (contact_element.hasClass("whatsapp-icon") || contact_element.hasClass("WhatsApp")) {
        platform = "WhatsApp";        
      } 
      else if (contact_element.hasClass("chat-contact")) {
        platform = "Chat"; 
        icon = $(e).closest('.chat-contact').find('.chat-icon')     
      } 
    }

    if (icon && platform) {
      me.select_member(icon, platform);
      if (this.chat_contact_list.selected_contacts.length > 0) {
        this.chat_contact_list.$chat_contact_list
          .find(".selected-contacts-number")
          .html(this.get_selected_contacts_number());
        this.chat_contact_list.$chat_contact_list
          .find(".save-icon")
          .html(frappe.utils.icon("tick", "lg"));
      } else {
        this.chat_contact_list.$chat_contact_list
          .find(".selected-contacts-number")
          .html("");
        this.chat_contact_list.$chat_contact_list.find(".save-icon").html("");
      }
    }
  }

  add_contact_from_selected_contacts(platform, contact) {
    this.chat_contact_list.selected_contacts.push({
      profile_id: this.profile.profile_id,
      email: contact,
      name: this.profile.contact_name,
      platform: platform,
      platform_profile: platform == "WhatsApp" ? "ClefinCode WhatsApp Profile" : null,
      platform_gateway: platform == "WhatsApp" ? erpnext_chat_app.res.default_whatsapp_number : null
    });
  }

  remove_contact_from_selected_contacts(platform, contact) {
    let itemToRemove = {
      profile_id: this.profile.profile_id,
      email: contact,
      platform: platform,
    };
    this.chat_contact_list.selected_contacts =
      this.chat_contact_list.selected_contacts.filter((item) => {
        return !(
          item.profile_id === itemToRemove.profile_id &&
          item.email === itemToRemove.email &&
          item.platform === itemToRemove.platform
        );
      });
  }

  select_member(element, platform) {
    element.find(".check-icon").toggle();
    if (element.hasClass("selected")) {
      element.removeClass("selected");
      this.remove_contact_from_selected_contacts(
        platform,
        element.data("contact")
      );
    } else {
      element.addClass("selected");
      this.add_contact_from_selected_contacts(
        platform,
        element.data("contact")
      );
    }
  }

  get_selected_contacts_number() {
    let uniqueEmails = new Set();

    this.chat_contact_list.selected_contacts.forEach((item) => {
      uniqueEmails.add(item.profile_id);
    });

    return uniqueEmails.size;
  }

  move_to_top() {
    $(this.$chat_contact).prependTo(this.$chat_contacts_container);
  }

  get_mails() {
    const me = this;
    let user_email_list = [];
    this.profile.contact_details.forEach((element) => {
      if (is_email(element.contact_info) && element.contact_type != "Chat") {
        user_email_list.push(element.contact_info);
      }
    });
    return user_email_list;
  }

  get_phone_numbers() {
    let user_phone_list = [];
    this.profile.contact_details.forEach((element) => {
      if (element.contact_type == "WhatsApp") {
        user_phone_list.push(element.contact_info);
      }
    });
    return user_phone_list;
  }

  open_chat_space(contact, platform, room = null, room_type = "Direct", new_member = null) {
    if (room) {
      if (check_if_chat_window_open(room, "room")) {
        $(".expand-chat-window[data-id|='" + contact + "']").click();
        return;
      }

      this.chat_window = new ChatWindow({
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
        room_name: this.profile.contact_name,
        room_type: room_type,
        contact: contact,
        is_first_message: 0,
        platform: platform,
        new_member: new_member
      };

      this.chat_space = new ChatSpace({
        $wrapper: this.chat_window.$chat_window,
        profile: profile,
      });
    } else {
      if (check_if_chat_window_open(contact, "contact")) {
        $(".expand-chat-window[data-id|='" + contact + "']").click();
        return;
      }

      this.chat_window = new ChatWindow({
        profile: {
          contact: contact,
        },
      });

      let profile = {
        is_admin: this.profile.is_admin,
        user: this.profile.user,
        user_email: this.profile.user_email,
        time_zone: this.profile.time_zone,
        room: null,
        room_name: this.profile.contact_name,
        room_type: room_type,
        contact: contact,
        is_first_message: 1,
        platform: platform,
      };

      this.chat_space = new ChatSpace({
        $wrapper: this.chat_window.$chat_window,
        profile: profile,
      });
    }
  }
  
  async check_if_contact_has_chat(user_email, contact, platform) {
    const room = await check_if_contact_has_chat(user_email, contact, platform);
    if (room.results.name) {
      this.open_chat_space(contact, platform, room.results.name);
    } else {
      this.open_chat_space(contact, platform);
    }
  }

  async check_if_contact_has_whatsapp_chat(default_whatsapp_number, default_whatsapp_type, contact, platform) {
    const room_info = await check_if_contact_has_whatsapp_chat(default_whatsapp_number, default_whatsapp_type, contact, platform, this.profile.user_email);
    
    const room_type = default_whatsapp_type === "Support" ? "Group" : "Direct";

    if (room_info && room_info.room) {
      // Open chat space with a user flag for Support type when user doesn't exist
      const user_flag = default_whatsapp_type === "Support" && !room_info.user_exists ? 1 : 0;
      this.open_chat_space(contact, platform, room_info.room, room_type, user_flag);
    } else {
      // Open chat space without room info
      this.open_chat_space(contact, platform, null, room_type);
    }
}

get_icon(contact_type){
  if(contact_type == 'Chat'){
    return this.chat_icon
  }else if(contact_type == 'WhatsApp'){
    return this.whatsapp_icon
  }else if(contact_type == 'Email'){
    return this.mail_icon
  }
}
} // END Class

export async function check_if_contact_has_chat(user_email, contact, platform) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.check_if_contact_has_chat",
    args: {
      user_email: user_email,
      contact: contact,
      platform: platform,
    },
  });
  return await res.message;
}

export async function check_if_contact_has_whatsapp_chat(default_whatsapp_number, default_whatsapp_type, contact, platform, user_email) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.check_if_contact_has_whatsapp_chat",
    args: {
      default_whatsapp_number: default_whatsapp_number,
      default_whatsapp_type: default_whatsapp_type,
      contact: contact,
      platform: platform,
      user_email: user_email
    },
  });
  return await res.message.results[0];
}
