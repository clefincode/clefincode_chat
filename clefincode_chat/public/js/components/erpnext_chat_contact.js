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
      me.profile.default_platform =
        this.profile.contact_details[0].contact_type;
    }
    let no_default = 1;
    this.profile.contact_details.forEach((element) => {
      if (element.default == 1) {
        me.profile.default_contact = element.contact_info;
        me.profile.default_platform = element.contact_type;
        no_default = 0;
      }

      if (element.contact_type == "Chat") {
        me.profile.chat_contact = element.contact_info;
        me.chat_icon = `<div class="icon chat-icon" data-contact=${element.contact_info}><svg class="icon icon-lg"><use href="#icon-small-message"></use></svg>${check_icon}</div>`;
      } else if (element.contact_type == "WhatsApp") {
        me.profile.whatsapp_contact = element.contact_info;
        me.whatsapp_icon = `<div class="icon whatsapp-icon" data-contact=${element.contact_info}><svg height="25px" width="25px" version="1.1"  xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"  viewBox="0 0 512 512" xml:space="preserve"> <path style="fill:#EDEDED;" d="M0,512l35.31-128C12.359,344.276,0,300.138,0,254.234C0,114.759,114.759,0,255.117,0S512,114.759,512,254.234S395.476,512,255.117,512c-44.138,0-86.51-14.124-124.469-35.31L0,512z"/><path style="fill:#55CD6C;" d="M137.71,430.786l7.945,4.414c32.662,20.303,70.621,32.662,110.345,32.662c115.641,0,211.862-96.221,211.862-213.628S371.641,44.138,255.117,44.138S44.138,137.71,44.138,254.234c0,40.607,11.476,80.331,32.662,113.876l5.297,7.945l-20.303,74.152L137.71,430.786z"/><path style="fill:#FEFEFE;" d="M187.145,135.945l-16.772-0.883c-5.297,0-10.593,1.766-14.124,5.297c-7.945,7.062-21.186,20.303-24.717,37.959c-6.179,26.483,3.531,58.262,26.483,90.041s67.09,82.979,144.772,105.048c24.717,7.062,44.138,2.648,60.028-7.062c12.359-7.945,20.303-20.303,22.952-33.545l2.648-12.359c0.883-3.531-0.883-7.945-4.414-9.71l-55.614-25.6c-3.531-1.766-7.945-0.883-10.593,2.648l-22.069,28.248c-1.766,1.766-4.414,2.648-7.062,1.766c-15.007-5.297-65.324-26.483-92.69-79.448c-0.883-2.648-0.883-5.297,0.883-7.062l21.186-23.834c1.766-2.648,2.648-6.179,1.766-8.828l-25.6-57.379C193.324,138.593,190.676,135.945,187.145,135.945"/></svg>${check_icon}</div>`;
      } else if (element.contact_type == "Email") {
        me.profile.mail_contact = element.contact_info;
        me.mail_icon = `<div class="icon mail-icon" data-contact=${element.contact_info}><svg version="1.1" id="Icons" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 32 32" style="enable-background:new 0 0 32 32;" xml:space="preserve"><g><g><path d="M16,16.8l13.8-9.2C29.2,5.5,27.3,4,25,4H7C4.7,4,2.8,5.5,2.2,7.6L16,16.8z"/></g><g><path d="M16.6,18.8C16.4,18.9,16.2,19,16,19s-0.4-0.1-0.6-0.2L2,9.9V23c0,2.8,2.2,5,5,5h18c2.8,0,5-2.2,5-5V9.9L16.6,18.8z"/></g></g></svg>${check_icon}</div>`;
      }
    });

    if (no_default == 1 && me.profile.contact_details.length > 1) {
      me.profile.default_contact = me.profile.contact_details[0].contact_info;
      me.profile.default_platform = me.profile.contact_details[0].contact_type;
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
    const info_html = `
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
          ${
            this.chat_contact_list.add_member == 0 ||
            (this.chat_contact_list.new_group == 0 && this.mail_icon)
              ? this.mail_icon
              : ""
          }          
        </div>
      </div>				
		`;
    const innerhtml = avatar_html + info_html;
    this.$chat_contact.html(innerhtml);
    this.$chat_contacts_container.append(this.$chat_contact);
    this.setup_events();
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
    if ($(e).closest(".chat-icon").length > 0) {
      this.check_if_contact_has_chat(
        this.profile.user_email,
        $(e).closest(".chat-icon").data("contact"),
        "Chat"
      );
    } else if ($(e).closest(".mail-icon").length > 0) {
      this.composer = new frappe.views.CommunicationComposer({
        recipients: $(e).closest(".mail-icon").data("contact"),
        message: "",
        content_set: false,
        sender: this.profile.user_email,
      });
      setTimeout(() => {
        $(".btn-modal-close").on("click", (e) => {
          me.composer.dialog.hide();
          me.composer.clear_cache();
        });
      }, 200);
    } else if ($(e).closest(".options-icon").length > 0) {
    } else if ($(e).closest(".chat-contact").length > 0) {
      if (check_if_chat_window_open(this.profile.default_contact, "contact")) {
        return;
      } else if (this.profile.default_platform == "Email") {
        this.composer = new frappe.views.CommunicationComposer({
          recipients: this.profile.default_contact,
          message: "",
          sender: this.profile.user_email,
        });
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
    if ($(e).closest(".chat-icon").length > 0) {
      icon = $(e).closest(".chat-icon");
      platform = "Chat";
    } else if ($(e).closest(".mail-icon").length > 0) {
      icon = $(e).closest(".mail-icon");
      platform = "Email";
    } else if ($(e).closest(".whatsapp-icon").length > 0) {
      icon = $(e).closest(".whatsapp-icon");
      platform = "WhatsApp";
      $(e).closest(".whatsapp-icon").find(".check-icon").toggle();
    } else if ($(e).closest(".chat-contact").length > 0) {
      icon = $(e).closest(".chat-contact").find(".chat-icon");
      platform = "Chat";
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

  open_chat_space(contact, platform, room = null) {
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
        room_type: "Direct",
        contact: contact,
        is_first_message: 0,
        platform: platform,
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
        room_type: "Direct",
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
    const me = this;
    const room = await check_if_contact_has_chat(user_email, contact, platform);
    if (room.results.name) {
      this.open_chat_space(contact, platform, room.results.name);
    } else {
      this.open_chat_space(contact, platform);
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
