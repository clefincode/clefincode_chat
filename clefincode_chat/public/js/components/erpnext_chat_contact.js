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
    this.$wrapper = opts.$wrapper; 
    this.$chat_contacts_container = opts.$chat_contacts_container;
    this.profile = opts.profile;
    this.chat_contact_list = opts.chat_contact_list;
    this.number_of_mails = this.get_mails().length;
    this.number_of_numbers = this.get_phone_numbers().length;
    this.get_contact_details();
    this.setup();
     window.open_manage_popup = this.open_manage_popup.bind(this);
  }
//---------------------------------------------

//---------------------------------------------

open_manage_popup() {
    const me = this;

    const d = new frappe.ui.Dialog({
        title: "Manage Contact Details",
        fields: [
            {
                fieldtype: "HTML",
                fieldname: "contacts_table_html"
            },
            {
                fieldtype: "Section Break"
            },
            {
                label: "Add New Row",
                fieldname: "add_row",
                fieldtype: "Button",
                click: () => me.add_new_row(d)
            }
        ],
        primary_action_label: "Save",
        primary_action: () => {
            me.save_all_contacts(d);
            d.hide();
        }
    });

    this.render_contacts_table(d);
    d.show();
}

//---------------------------------------------
// Render Contact Table
//---------------------------------------------

render_contacts_table(dialog) {
    const me = this;

    let rows = "";
    this.profile.contact_details.forEach((cd, index) => {
        rows += `
            <tr data-index="${index}">
                <td>${cd.contact_type}</td>
                <td>${cd.contact_info}</td>
                <td><button class="btn btn-xs btn-secondary edit-row">Edit</button></td>
                <td><button class="btn btn-xs btn-danger delete-row">Delete</button></td>
            </tr>
        `;
    });

    const html = `
        <table class="table table-bordered">
            <thead>
                <tr>
                    <th>Type</th>
                    <th>Contact Info</th>
                    <th>Edit</th>
                    <th>Delete</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;

    dialog.fields_dict.contacts_table_html.$wrapper.html(html);
    this.bind_row_events(dialog);
}

//---------------------------------------------
// Bind Table Buttons (Edit/Delete)
//---------------------------------------------

bind_row_events(dialog) {
    const me = this;

    dialog.$wrapper.find(".edit-row").on("click", function () {
        const index = $(this).closest("tr").data("index");
        me.edit_row(dialog, index);
    });

    dialog.$wrapper.find(".delete-row").on("click", function () {
        const index = $(this).closest("tr").data("index");
        me.delete_row(dialog, index);
    });
}

//---------------------------------------------
// Edit Row Popup
//---------------------------------------------

edit_row(dialog, index) {
    const me = this;
    const row = me.profile.contact_details[index];

    const d = new frappe.ui.Dialog({
        title: "Edit Contact Row",
        fields: [
            {
                label: "Contact Type",
                fieldname: "contact_type",
                fieldtype: "Select",
                options: ["Email", "Chat", "WhatsApp", "Messenger", "Instagram", "Telegram"],
                default: row.contact_type
            },
            {
                label: "Contact Info",
                fieldname: "contact_info",
                fieldtype: "Data",
                default: row.contact_info
            }
        ],
        primary_action_label: "Update",
        primary_action(values) {
            row.contact_type = values.contact_type;
            row.contact_info = values.contact_info;

            d.hide();
            me.render_contacts_table(); 
            dialog.hide();
        }
    });

    d.show();
}

//---------------------------------------------
// Delete Row
//---------------------------------------------

delete_row(dialog, index) {
    this.profile.contact_details.splice(index, 1);
    this.render_contacts_table(dialog);
}

//---------------------------------------------
// Add New Row Popup
//---------------------------------------------

add_new_row(dialog) {
    const me = this;

    const d = new frappe.ui.Dialog({
        title: "Add New Contact Row",
        fields: [
            {
                label: "Contact Type",
                fieldname: "contact_type",
                fieldtype: "Select",
                options: ["Email", "Chat","Phone" ,"WhatsApp", "Messenger", "Instagram", "Telegram"]
            },
            {
                label: "Contact Info",
                fieldname: "contact_info",
                fieldtype: "Data"
            }
        ],
        primary_action_label: "Add",
        primary_action(values) {
            me.profile.contact_details.push(values);
            d.hide();
            me.render_contacts_table(dialog);
        }
    });

    d.show();
}

//---------------------------------------------
// Save All Contacts to Backend
//---------------------------------------------

save_all_contacts(dialog) {
    frappe.call({
        method: "clefincode_chat.api.api_1_3_1.api.update_profile_contacts",
        args: {
            profile_id: this.profile.profile_id,   // your correct ID field
            contact_details: this.profile.contact_details
        },
        callback: () => {
            frappe.show_alert("Contact details updated successfully");

            this.get_contact_details(); 
            //this.$chat_contact.remove();
            this.setup(); 

            dialog.hide();
              if (this.chat_contact_list) {
                this.chat_contact_list.fetch_and_setup_contacts();
            }
        }
    });
}

  get_contact_details() {
    const me = this;
    let has_default = false;
    
    this.profile.contact_details.forEach((element) => {
        if (element.contact_type == "Chat") {
            me.profile.chat_contact = element.contact_info;
            me.chat_icon = `<div class="icon chat-icon" data-contact=${element.contact_info}><svg class="icon icon-lg"><use href="#icon-small-message"></use></svg></div>`;
        } else if (element.contact_type == "WhatsApp") {
            me.profile.whatsapp_contact = element.contact_info;
            me.whatsapp_icon = `<div class="icon whatsapp-icon" data-contact=${element.contact_info}><img title="WhatsApp" src="/assets/clefincode_chat/icons/whatsapp.svg"></div>`;
        } else if (element.contact_type == "Instagram") {
            me.profile.instagram_contact = element.contact_info;
            me.instagram_icon = `<div class="icon instagram-icon" data-contact=${element.contact_info}><img title="Instagram" src="/assets/clefincode_chat/icons/instagram.svg"></div>`;
        } else if (element.contact_type == "Messenger") {
            me.profile.messenger_contact = element.contact_info;
            me.messenger_icon = `<div class="icon messenger-icon" data-contact=${element.contact_info}><img title="Messenger" src="/assets/clefincode_chat/icons/messenger.svg"></div>`;
        } else if (element.contact_type == "Telegram") {
            me.profile.telegram_contact = element.contact_info;
            me.telegram_icon = `<div class="icon telegram-icon" data-contact=${element.contact_info}><img title="Telegram" src="/assets/clefincode_chat/icons/telegram.svg"></div>`;
        } else if (element.contact_type == "Email") {
            me.profile.mail_contact = element.contact_info;
            me.mail_icon = `<div class="icon mail-icon" data-contact=${element.contact_info}>...</div>`;
        }

        if (element.default == 1) {
            me.profile.default_contact = element.contact_info;
            me.profile.default_platform = element.contact_type;
            has_default = true;
        }
    });

    // NOW call it after icons are created
    if (has_default) {
        me.get_default_platform_icon(me.profile.default_platform, me.profile.default_contact);
    } else if (this.profile.contact_details.length >= 1) {
        me.profile.default_contact = this.profile.contact_details[0].contact_info;
        me.profile.default_platform = this.profile.contact_details[0].contact_type;
        me.get_default_platform_icon(this.profile.contact_details[0].contact_type, this.profile.contact_details[0].contact_info);
    } else {
        me.profile.default_contact = me.profile.contact_details.contact_info;
        me.profile.default_platform = me.profile.contact_details.contact_type;
        me.get_default_platform_icon(me.profile.contact_details.contact_type, me.profile.contact_details.contact_info);
    }
}


  get_default_platform_icon(default_platform, contact_info){
    if (default_platform == "Chat") {
      this.profile.default_platform_icon = `<div class="icon chat-icon" data-contact=${contact_info}><svg class="icon icon-lg"><use href="#icon-small-message"></use></svg></div>`;
    } else if (default_platform == "WhatsApp") {
      this.profile.default_platform_icon = `<div class="icon whatsapp-icon" data-contact=${contact_info}><img title="WhatsApp" src="/assets/clefincode_chat/icons/whatsapp.svg"></div>`;      
    } else if (default_platform == "Email") {
      this.profile.default_platform_icon = `<div class="icon mail-icon" data-contact=${contact_info}><svg version="1.1" id="Icons" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 32 32" style="enable-background:new 0 0 32 32;" xml:space="preserve"><g><g><path d="M16,16.8l13.8-9.2C29.2,5.5,27.3,4,25,4H7C4.7,4,2.8,5.5,2.2,7.6L16,16.8z"/></g><g><path d="M16.6,18.8C16.4,18.9,16.2,19,16,19s-0.4-0.1-0.6-0.2L2,9.9V23c0,2.8,2.2,5,5,5h18c2.8,0,5-2.2,5-5V9.9L16.6,18.8z"/></g></g></svg></div>`;
    } else if (default_platform == "Messenger") {
      this.profile.default_platform_icon = `<div class="icon messenger-icon" data-contact=${contact_info}><img title="Messenger" src="/assets/clefincode_chat/icons/messenger.svg"></div>`;
    } else if (default_platform == "Instagram") {
      this.profile.default_platform_icon = `<div class="icon instagram-icon" data-contact=${contact_info}><img title="Instagram" src="/assets/clefincode_chat/icons/instagram.svg"></div>`;
    } else if (default_platform == "Telegram") {
      this.profile.default_platform_icon = `<div class="icon telegram-icon" data-contact=${contact_info}><img title="Telegram" src="/assets/clefincode_chat/icons/telegram.svg" style="scale:120%;"></div>`;
    } 
  }

  setup() {
    this.$chat_contact = $(document.createElement("div")).addClass("chat-contact");

    // Generate the avatar HTML
    const avatar_html = frappe.get_avatar("avatar-medium", this.profile.contact_name);
    
    let icons_html = `
    ${this.profile.default_platform_icon ? this.profile.default_platform_icon : ""}`;




    // Generate the info HTML for contact details
    let info_html = `
        <div class='contact-profile-info'>
            <div class='contact-name'>
                ${
                    this.profile.contact_name.length > 20
                        ? this.profile.contact_name.substring(0, 20) + "..."
                        : this.profile.contact_name
                }
            </div>
            <div class="chat-icons">
                ${icons_html}
                ${this.profile.contact_details.length > 1 ? this.get_contact_options() : "<div style='width:40px'></div>"}
            </div>
        </div>
    `;

    // Combine avatar and contact info HTML
    const innerhtml = avatar_html + info_html;

    // Add the combined HTML to the chat contact container
    this.$chat_contact.html(innerhtml);
    this.$chat_contacts_container.append(this.$chat_contact);

    // Set up events for this contact
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
        if (contact_details[i].contact_type != "Instagram" && contact_details[i].contact_type != "Messenger" && contact_details[i].contact_type != "Telegram"){
          html_options+=`<a class="dropdown-item ${contact_details[i].contact_type}" data-contact ="${contact_details[i].contact_info}"><div style="margin-right:6px">${this.get_icon(contact_details[i].contact_type)}</div> <div>${contact_details[i].contact_info}</div></a>`;
        }
      }
    }else{
      for(let option of contact_details){
        if(option.default != 1){
          html_options+=`<a class="dropdown-item ${option.contact_type}" data-contact ="${option.contact_info}"><div style="margin-right:6px">${this.get_icon(option.contact_type)}</div> <div>${option.contact_info}</div></a>`;
        }
        
      }
    }   
          const isUserContact = contact_details.some(cd => cd.contact_info === frappe.session.user);
      const isAdmin = frappe.session.user === "Administrator";
      const isSystemManager = frappe.user_roles.includes("System Manager");

      // Show Manage Contact if user owns contact OR is admin OR system manager
      if (isUserContact || isAdmin || isSystemManager) {
      console.log("Profile");
      console.log(this.profile);
      const user_contact = contact_details.find(cd => cd.contact_info === frappe.session.user);
      console.log(user_contact);

        html_options += `
            <div class="dropdown-divider"></div>
            <a class="dropdown-item manage-contact" id="manageContactBtn">
                <div style="margin-right:6px">⚙️</div>
                <div>Manage Contact</div>
            </a>
        `;
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
     this.$chat_contact.on("click", "#manageContactBtn", () => {
        const user_contact = me.profile.contact_details.find(cd => cd.contact_info === frappe.session.user);
        
        console.log("Current contact_details:", me.profile.contact_details);
        me.open_manage_popup(user_contact);
    });
  }

  click_on_contact(e) {
    const contact_element = $(e).closest(
        ".chat-icon, .Chat, .mail-icon, .Email, .whatsapp-icon, .WhatsApp, .instagram-icon, .Instagram, .messenger-icon, .Messenger, .telegram-icon, .Telegram, .chat-contact, .options-icon"
    );

    // If the element is the dropdown menu, return early
    if (contact_element.hasClass("options-icon")) {
        return;
    }

    // Handle based on contact type
    if (contact_element.length > 0) {
        if (contact_element.hasClass("chat-icon") || contact_element.hasClass("Chat")) {
            this.handle_chat_icon_click(contact_element);
        } else if (contact_element.hasClass("mail-icon") || contact_element.hasClass("Email")) {
            this.handle_mail_icon_click(contact_element);
        } else if (contact_element.hasClass("whatsapp-icon") || contact_element.hasClass("WhatsApp")) {
            this.handle_whatsapp_icon_click();
        } else if (contact_element.hasClass("instagram-icon") || contact_element.hasClass("Instagram")) {
            this.handle_instagram_icon_click(contact_element);
        } else if (contact_element.hasClass("chat-contact")) {
            this.handle_chat_contact_click();
        } else if (contact_element.hasClass("messenger-icon") || contact_element.hasClass("Messenger")) {
          this.handle_messenger_icon_click(contact_element);
        } else if (contact_element.hasClass("telegram-icon") || contact_element.hasClass("Telegram")) {
          this.handle_telegram_icon_click(contact_element);
        }     
    }


}


handle_instagram_icon_click(contact_element) {
  const contact = contact_element.data("contact");
  const platform = "Instagram";

  this.check_if_contact_has_chat(this.profile.user_email, contact, platform);
}


handle_messenger_icon_click(contact_element) {
  const contact = contact_element.data("contact");
  const platform = "Messenger";

  this.check_if_contact_has_chat(this.profile.user_email, contact, platform);
}


handle_telegram_icon_click(contact_element) {
  const contact = contact_element.data("contact");
  const platform = "Telegram";

  this.check_if_contact_has_chat(this.profile.user_email, contact, platform);
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
   console.log("erpnext_chat_app")
    console.log(erpnext_chat_app)
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
  const contact = this.profile.default_contact;
  const platform = this.profile.default_platform;
  if (platform === "WhatsApp") {
        const default_whatsapp_number = erpnext_chat_app.res.default_whatsapp_number;

        if (!default_whatsapp_number) {
            frappe.throw("You don't have a WhatsApp number");
            return; 
        }
    }


  if (!contact || !platform) {
      frappe.msgprint(__("No contact details available."));
      return;
  }

  this.check_if_contact_has_chat(this.profile.user_email, contact, platform);
}


  select_contact(e) {
    const me = this;
    let icon, platform;
    const contact_element = $(e).closest(".chat-icon, .Chat, .mail-icon, .Email, .whatsapp-icon, .WhatsApp, .instagram-icon, .Instagram, .messenger-icon, .Messenger, .telegram-icon, .Telegram, .chat-contact,.options-icon");
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
      } else if ($(e).hasClass("instagram-icon") || contact_element.hasClass("Instagram")) {
        platform = "Instagram";
      } else if (contact_element.hasClass("messenger-icon") || contact_element.hasClass("Messenger")) {
        platform = "Messenger";
      } else if (contact_element.hasClass("telegram-icon") || contact_element.hasClass("Telegram")) {
        platform = "Telegram";
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
    if (platform == "WhatsApp") {
      this.chat_contact_list.selected_contacts.push({
        profile_id: this.profile.profile_id,
        email: contact,
        name: this.profile.contact_name,
        platform: platform,
        platform_profile: platform == "WhatsApp" ? "ClefinCode WhatsApp Profile" : null,
        platform_gateway: platform == "WhatsApp" ? erpnext_chat_app.res.default_whatsapp_number : null
      });
    }
    
    else if (platform == "Instagram") {
      this.chat_contact_list.selected_contacts.push({
        profile_id: this.profile.profile_id,
        email: contact,
        name: this.profile.contact_name,
        platform: platform,
        platform_profile: platform == "Instagram" ? "ClefinCode Instagram Profile" : null,
        platform_gateway: platform == "Instagram" ? erpnext_chat_app.res.default_instagram_profile : null
      });
    }
    else if (platform == "Messenger") {
      this.chat_contact_list.selected_contacts.push({
        profile_id: this.profile.profile_id,
        email: contact,
        name: this.profile.contact_name,
        platform: platform,
        platform_profile: platform == "Messenger" ? "ClefinCode Facebook Messenger Profile" : null,
        platform_gateway: platform == "Messenger" ? erpnext_chat_app.res.default_messenger_profile : null
      });
    }
    else if (platform == "Telegram") {
      this.chat_contact_list.selected_contacts.push({
        profile_id: this.profile.profile_id,
        email: contact,
        name: this.profile.contact_name,
        platform: platform,
        platform_profile: platform == "Telegram" ? "ClefinCode Telegram Profile" : null,
        platform_gateway: platform == "Telegram" ? erpnext_chat_app.res.default_telegram_profile : null
      });
    }
    else {
      this.chat_contact_list.selected_contacts.push({
        profile_id: this.profile.profile_id,
        email: contact,
        name: this.profile.contact_name,
        platform: platform,
      });
    }
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

  open_chat_space(contact, platform, room = null, room_type = "Direct", new_member = null, room_status) {
    this.chat_status = room_status;
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
        chat_status: this.chat_status
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
    const room_type = "Direct"
    const new_member = null
    if (room.results.name) {
      this.open_chat_space(contact, platform, room.results.name, room_type, new_member, room.results.chat_status);
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

get_icon(contact_type) {
  if (contact_type == "Chat") {
      return this.chat_icon;
  } else if (contact_type == "WhatsApp") {
      return this.whatsapp_icon;
  } else if (contact_type == "Instagram") {
      return this.instagram_icon;
  } else if (contact_type == "Email") {
      return this.mail_icon;
  } else if (contact_type == "Messenger") {
      return this.messenger_icon;
  } else if (contact_type == "Telegram") {
    return this.telegram_icon;
}
}

} // END Class

export async function check_if_contact_has_chat(user_email, contact, platform) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_2_1.api.check_if_contact_has_chat",
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
    method: "clefincode_chat.api.api_1_2_1.api.check_if_contact_has_whatsapp_chat",
    args: {
      default_whatsapp_number: default_whatsapp_number,
      default_whatsapp_type: default_whatsapp_type,
      contact: contact,
      platform: platform,
      user_email: user_email
    },
  });
  return await res.message.results[0];
};

