import {
  check_if_chat_window_open,
  convertToUTC,
  get_chat_members,
  get_time,
  check_if_room_admin,
  send_message,
  check_if_contributor_active,
} from "./erpnext_chat_utils";
import ChatWindow from "./erpnext_chat_window";
import ChatSpace from "./erpnext_chat_space";
import ChatContactList from "./erpnext_chat_contact_list";
import { remove_chat_topic } from "./erpnext_chat_space";

export default class ChatInfo {
  constructor(opts) {
    this.chat_space = opts.chat_space;
    this.roomtype = this.chat_space.profile.room_type;
    this.roomname = this.chat_space.profile.room_name;
    this.contact = this.chat_space.profile.contact;
    this.room = this.chat_space.profile.room;
    this.sub_channels = this.chat_space.all_sub_channels_for_contributor;
    this.avatar = this.chat_space.avatar_html;
    this.user = this.chat_space.profile.user;
    this.user_email = this.chat_space.profile.user_email;
    this.is_admin = 0;
    this.setup();
  }

  setup() {
    this.$chat_info = $(document.createElement("div")).addClass("chat-info");
    this.setup_header();
    if (
      typeof this.chat_space.$wrapper.attr("data-room") != "undefined" ||
      this.roomtype == "Topic"
    ) {
      this.setup_body();
    } else {
      this.$chat_info.append(`<div class="p-4 chat-info-section mt-0">
    <div class="p-2 text-center avatar-info">
      ${this.avatar}
    </div>
    <div class="p-2 text-center roomname">
      <div>Contact</div>
      <div>${this.chat_space.$wrapper.attr("data-contact")}</div>
    </div>`);
      this.chat_space.$wrapper.append(this.$chat_info);
      this.$chat_info.find(".avatar-frame").css("font-size", "3.5em");

      const me = this;
      this.$chat_info.find(".exitMe").on("click", function () {
        me.chat_space.$wrapper.find(".chat-space").show();
        me.chat_space.$wrapper.find(".chat-info").remove();
      });
    }
  }

  setup_header() {
    var header = ``;
    header += `  <div class="infoheader p-4 d-flex  flex-row-reverse justify-content-end align-items-center">
  <span style="font-size:24px; margin-left: 8px;">`;
    if (this.roomtype == "Direct") {
      header += `Contact Info`;
    } else if (this.roomtype == "Group") {
      header += `Group Info`;
    } else if (this.roomtype == "Contributor") {
      header += `Contributor Info`;
    } else if (this.roomtype == "Guest") {
      header += `Guest Info`;
    } else if (this.roomtype == "Topic") {
      header += `Conversation Info`;
    }

    header += `</span><span class="exitMe">${frappe.utils.icon(
      "arrow-left",
      "lg"
    )}</span></div>`;
    this.$chat_info.append(header);
  }

  async setup_body() {
    var body = ``;
    body += `    
  <div class="p-4 chat-info-section mt-0">
    <div class="p-2 text-center avatar-info">
      ${this.avatar}
    </div>
    <div class="p-2 text-center roomname">`;
    if (this.roomtype == "Group") {
      body += `<span class="gname mr-1" name="gname">${this.roomname}</span>`;
      const checkemail = this.user_email;
      this.is_admin = await check_if_room_admin(this.room, checkemail);
      if (this.chat_space.profile.is_removed != 1) {
        if (this.is_admin == 1) {
          body += `<span class="edit" style="cursor:pointer;">${frappe.utils.icon(
            "edit",
            "md"
          )}</span>`;
        }
      }

      body += `
           
    <div class="p-2 text-center">
      Group: <span class="participants">${this.count_group_members(
        this.chat_space.chat_members
      )}</span> participants
    </div>
    `;
    } else if (this.roomtype == "Direct") {
      body += `<div>${this.roomname}</div>`;
      const useremail = this.user_email;
      const room_emails3 = this.chat_space.chat_members;
      $.each(room_emails3, function () {
        if (useremail != this.email) {
          body += `<div>${this.email}</div>`;
        }
      });
    } else if (this.roomtype == "Contributor") {
      body += `<div>@Contributor</div>`;
    }
    body += `</div></div>`;
    if (this.roomtype == "Topic") {
      body = ``;
    }

    await this.$chat_info.append(body);
    this.chat_space.$wrapper.append(this.$chat_info);
    this.$chat_info.find(".avatar-frame").css("font-size", "3.5em");
    await this.setup_sections();
    this.setup_events();
  }

  async setup_sections() {
    const me = this;
    const media_links_docs_section = `  
  <div class="p-4 chat-info-section openMedia"  style="cursor: pointer;">Media, links and docs</div>
  <div class=" chat-media" 
  style="position: absolute;
  top: 0;
  width: 100%;
  height: 100%;
 
  display:none;">
    <div class="p-4 medeiaheader closeMedia" style="cursor: pointer; border-bottom: 2px solid #f0f2f5;display: flex;align-items: center;" > <span class="back-to-chat-info" >${frappe.utils.icon(
      "arrow-left",
      "lg"
    )}</span> <span style="margin-left:8px;font-size:16px;">${
      this.roomname
    }</span></div>
    <div class="p-4 chat-info-section chat-media-tabs mt-0 d-flex flex-row"> 
      <span  class="infobutton openmediaTab active">Media</span>
      <span  class="infobutton openlinksTab">Links</span>
      <span  class="infobutton opendocsTab">Docs</span>
    </div>
    <div class="p-4 chat-info-section mediatab" style=" overflow: scroll;height: 420px;">
      <div id="mediatabcontainer" class="mediatabcontainer">
      </div>
    </div>
    <div class="p-4 chat-info-section linkstab" style="display:none;overflow: scroll;height: 420px;">
      <div id="linkstabcontainer" class="linkstabcontainer">
      </div>
    </div>
    <div class="p-4 chat-info-section docstab" style="display:none;overflow: scroll;height: 420px;">
      <div id="docstabcontainer" class="docstabcontainer">
      </div>
    </div>
  </div> `;

    const refernce_doctypes_section = this.render_refernce_doctypes_section();

    if (this.roomtype == "Group") {
      let group_sections = ``;
      const room1 = await get_room_creator(this.room);
      group_sections += `<div class="p-4 chat-info-section" >Group created by `;

      if (this.user_email == room1[0].channel_creator) {
        group_sections += `you`;
      } else {
        group_sections += `${room1[0].channel_creator_name}`;
      }

      group_sections += ` ,on ${room1[0].creation_date} at ${room1[0].creation_time}</div>`;
      group_sections += media_links_docs_section;

      var room_emails = await get_chat_members(this.room);
      if (room_emails.length > 0) {
        group_sections += `<div class="p-4 chat-info-section members-section"><div class="pb-2 font-weight-bold">Members</div>`;
      }
      const checkemail = this.user_email;
      if (this.chat_space.profile.is_removed != 1) {
        if (this.is_admin == 1) {
          group_sections += `
        <div class="add_members-button d-flex flex-row justify-content-between">
          <div class="add_members">${frappe.utils.icon(
            "assign",
            "md"
          )} Add members</div>
          <div class="close_members_lis">${frappe.utils.icon(
            "close",
            "md"
          )}</div>
       </div>
       <input type="text" placeholder="Search.." class="myInput filter-members" >
        <div class="list_members">
        </div>
        `;
        }
      }

      group_sections += `<div class="list_present_members">`;
      $.each(room_emails, function () {
        if (this.is_admin == 1) {
          group_sections += `
        <div class="d-flex flex-row justify-content-between align-items-center pb-2 pt-2 delete-member" delete-data="${this.email}">
        <div >
          <div >${this.name} (Admin)</div>
          <div class="small">${this.email}</div>
        </div>
        `;
        } else {
          group_sections += `
        <div class="d-flex flex-row justify-content-between align-items-center pb-2 pt-2 delete-member" delete-data="${this.email}">
        <div >
          <div >${this.name}</div>
          <div class="small">${this.platform}: ${this.email}</div>
        </div>
        `;
        }

        if (me.chat_space.profile.is_removed != 1) {
          if (me.is_admin == 1) {
            group_sections += `<div class="deletefromgroup" style="cursor: pointer;${
              me.user_email == this.email ? "display:none" : "display:block"
            }" id="${this.email}" data-name="${
              this.name
            }"><?xml version="1.0" encoding="iso-8859-1"?>
          <svg height="20px" width="20px" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" 
             viewBox="0 0 496.158 496.158" xml:space="preserve">
          <path style="fill:#E04F5F;" d="M0,248.085C0,111.063,111.069,0.003,248.075,0.003c137.013,0,248.083,111.061,248.083,248.082
            c0,137.002-111.07,248.07-248.083,248.07C111.069,496.155,0,385.087,0,248.085z"/>
          <path style="fill:#FFFFFF;" d="M383.546,206.286H112.612c-3.976,0-7.199,3.225-7.199,7.2v69.187c0,3.976,3.224,7.199,7.199,7.199
            h270.934c3.976,0,7.199-3.224,7.199-7.199v-69.187C390.745,209.511,387.521,206.286,383.546,206.286z"/>
          </svg></div>`;
          }
        }

        group_sections += `</div>`;
      });

      group_sections += `</div></div>`;
      if (this.chat_space.profile.is_removed != 1) {
        if (typeof this.chat_space.contributors != "undefined") {
          const con = this.chat_space.contributors;
          if (con.length > 0) {
            group_sections += `<div class="p-4 chat-info-section contributor-section">`;
            group_sections += `<div class="pb-2 font-weight-bold">On going contributors</div>`;
            if (room_emails.some((e) => e.email === checkemail)) {
              $.each(con, function () {
                group_sections += `
              <div class="d-flex flex-row justify-content-between align-items-center pb-2">
                <div >
                  <div >${this.name}</div>
                  <div class="small">${this.email}</div>
                </div>
                <div class="delete-contributor" c-email="${
                  this.email
                }" style="cursor: pointer;">${frappe.utils.icon(
                  "close",
                  "md"
                )}</div>
              </div>`;
              });
            } else {
              $.each(con, function () {
                group_sections += `
              <div class="d-flex flex-row justify-content-between">
              <div >
                <div >${this.name}</div>
                <div class="small">${this.email}</div>
              </div>
              </div>`;
              });
            }

            group_sections += `</div>`;
          }
        }
        group_sections += refernce_doctypes_section;
        group_sections += `<div class="p-4 chat-info-section exit-group d-flex" >
      <div style="display: flex;flex: none;justify-content: center;margin-right: 16px; color:#ea0038;">
        <svg viewBox="0 0 24 24" height="24" width="24" preserveAspectRatio="xMidYMid meet" class="" version="1.1" x="0px" y="0px" enable-background="new 0 0 24 24" xml:space="preserve"><path fill="currentColor" d="M16.6,8.1l1.2-1.2l5.1,5.1l-5.1,5.1l-1.2-1.2l3-3H8.7v-1.8h10.9L16.6,8.1z M3.8,19.9h9.1 c1,0,1.8-0.8,1.8-1.8v-1.4h-1.8v1.4H3.8V5.8h9.1v1.4h1.8V5.8c0-1-0.8-1.8-1.8-1.8H3.8C2.8,4,2,4.8,2,5.8v12.4 C2,19.1,2.8,19.9,3.8,19.9z"></path></svg>
      </div>
      <div style="box-sizing: border-box;
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      height: 100%;
      overflow: hidden;padding-right: 30px; color:#ea0038;">Exit group</div>
      </div>
      `;
      }

      this.$chat_info.append(group_sections);
    } else if (this.roomtype == "Contributor") {
      let contributor_sections = ``;
      contributor_sections += media_links_docs_section;
      var room_emails = this.chat_space.chat_members;
      if (room_emails.length > 0) {
        contributor_sections += `<div class="p-4 chat-info-section members-section"><div class="pb-2 font-weight-bold">Members</div><div>`;
      }

      $.each(room_emails, function () {
        contributor_sections += `
      <div class="d-flex flex-row justify-content-between align-items-center pb-2" >
      <div >
        <div >${this.name}</div>
        <div class="small">${this.email}</div>
      </div>
      `;
        contributor_sections += `</div>`;
      });
      contributor_sections += `</div></div>`;

      const checkemail2 = this.user_email;
      var room_emails4 = this.chat_space.chat_members;
      if (typeof this.chat_space.contributors != "undefined") {
        const con = this.chat_space.contributors;
        if (con.length > 0) {
          contributor_sections += `<div class="p-4 chat-info-section"  >`;
          contributor_sections += `<div class="pb-2 font-weight-bold">On going contributors</div>`;
          if (room_emails4.some((e) => e.email === checkemail2)) {
            $.each(con, function () {
              contributor_sections += `
            <div class="d-flex flex-row justify-content-between align-items-center pb-2">
              <div >
                <div >${this.name}</div>
                <div class="small">${this.email}</div>
              </div>
              <div class="delete-contributor" c-email="${
                this.email
              }" style="cursor: pointer;">${frappe.utils.icon(
                "close",
                "md"
              )}</div>
            </div>`;
            });
          } else {
            $.each(con, function () {
              contributor_sections += `
            <div class="d-flex flex-row justify-content-between">
            <div >
              <div >${this.name}</div>
              <div class="small">${this.email}</div>
            </div>
            </div>`;
            });
          }
          contributor_sections += `</div>`;
        }
        contributor_sections += refernce_doctypes_section;
        let is_active_contributor = await check_if_contributor_active(
          this.chat_space.last_active_sub_channel,
          this.user_email
        );

        if (is_active_contributor == 1) {
          contributor_sections += `<div style="cursor:pointer" class="p-4 chat-info-section leave-conversation d-flex" >
        <div style="display: flex;flex: none;justify-content: center;margin-right: 16px; color:#ea0038;">
          <svg viewBox="0 0 24 24" height="24" width="24" preserveAspectRatio="xMidYMid meet" class="" version="1.1" x="0px" y="0px" enable-background="new 0 0 24 24" xml:space="preserve"><path fill="currentColor" d="M16.6,8.1l1.2-1.2l5.1,5.1l-5.1,5.1l-1.2-1.2l3-3H8.7v-1.8h10.9L16.6,8.1z M3.8,19.9h9.1 c1,0,1.8-0.8,1.8-1.8v-1.4h-1.8v1.4H3.8V5.8h9.1v1.4h1.8V5.8c0-1-0.8-1.8-1.8-1.8H3.8C2.8,4,2,4.8,2,5.8v12.4 C2,19.1,2.8,19.9,3.8,19.9z"></path></svg>
        </div>
        <div style="box-sizing: border-box;
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        height: 100%;
        overflow: hidden;padding-right: 30px; color:#ea0038;">Leave Conversation</div>
        </div>`;
        }
      }
      this.$chat_info.append(contributor_sections);
    } else if (this.roomtype == "Direct") {
      let direct_chat_sections = ``;
      direct_chat_sections += media_links_docs_section;

      const room_emails1 = this.chat_space.chat_members;
      const group_emails = [];

      $.each(room_emails1, function () {
        group_emails.push(this.email);
      });
      const groups_in_common = await get_room_in_common(
        group_emails[0],
        group_emails[1]
      );
      if (groups_in_common.length > 0) {
        direct_chat_sections += `
      <div class="p-4 chat-info-section"  >
        <div class="font-weight-bold">${groups_in_common.length} groups in common</div>
      `;
        $.each(groups_in_common, function () {
          direct_chat_sections += `
        <div class="common-group" data-channel="${this.name}" 
        data-channel-name="${this.channel_name}" 
        style="cursor: pointer;">${this.channel_name}</div>
        `;
        });
        direct_chat_sections += `</div>`;
      }

      const checkemail2 = this.user_email;
      var room_emails4 = this.chat_space.chat_members;
      if (typeof this.chat_space.contributors != "undefined") {
        const con = this.chat_space.contributors;
        if (con.length > 0) {
          direct_chat_sections += `<div class="p-4 chat-info-section"  >`;
          direct_chat_sections += `<div class="pb-2 font-weight-bold">On going contributors</div>`;
          if (room_emails4.some((e) => e.email === checkemail2)) {
            $.each(con, function () {
              direct_chat_sections += `
            <div class="d-flex flex-row justify-content-between align-items-center pb-2">
              <div >
                <div >${this.name}</div>
                <div class="small">${this.email}</div>
              </div>
              <div class="delete-contributor" c-email="${
                this.email
              }" style="cursor: pointer;">${frappe.utils.icon(
                "close",
                "md"
              )}</div>
            </div>`;
            });
          } else {
            $.each(con, function () {
              direct_chat_sections += `
            <div class="d-flex flex-row justify-content-between">
            <div >
              <div >${this.name}</div>
              <div class="small">${this.email}</div>
            </div>
            </div>`;
            });
          }
          direct_chat_sections += `</div>`;
        }
      }
      direct_chat_sections += refernce_doctypes_section;
      this.$chat_info.append(direct_chat_sections);
    } else if (this.roomtype == "Topic") {
      let topic_title_section = ``;
      topic_title_section += `<div class="p-4 chat-info-section"><div class="pb-2 font-weight-bold">Topic Subject</div>`;
      topic_title_section += this.chat_space.chat_topic_space_subject
        ? this.chat_space.chat_topic_space_subject.replace(/"/g, "")
        : this.chat_space.alternative_subject;
      this.$chat_info.append(topic_title_section);

      let member_section = ``;
      let chat_members = await get_chat_members(
        this.chat_space.chat_topic_channel
      );
      member_section += `<div class="p-4 chat-info-section members-section"><div class="pb-2 font-weight-bold">Members</div>`;
      chat_members.map((member) => {
        member_section += `
      <div class="d-flex flex-row justify-content-between pb-2">
        <div>
          <div>${member.name == frappe.session.user ? "You" : member.name}</div>
          <div class="small">${member.email}</div>
        </div>
      </div>`;
      });
      this.$chat_info.append(member_section);

      let topic_contributors = await get_topic_contributors(
        this.chat_space.chat_topic_space
      );
      if (topic_contributors.length > 0) {
        let contributors_section = ``;
        contributors_section += `<div class="p-4 chat-info-section"><div class="pb-2 font-weight-bold">Contributors</div>`;
        topic_contributors.map((c) => {
          contributors_section += `
        <div class="d-flex flex-row justify-content-between pb-2">
          <div>
            <div>${c.email == frappe.session.user ? "You" : c.name}</div>
            <div class="small">${c.email}</div>
          </div>
        </div>`;
        });
        this.$chat_info.append(contributors_section);
      }
    }
  }

  setup_events() {
    const me = this;
    var channel;
    if (me.roomtype == "Contributor") {
      channel = me.sub_channels;
    } else {
      channel = me.room;
    }

    this.$chat_info.find(".exitMe").on("click", function () {
      me.chat_space.$wrapper.find(".chat-space").show();
      me.chat_space.get_topic_info(channel);
      me.chat_space.$wrapper.find(".chat-info").remove();
    });

    this.$chat_info.find(".back-to-chat-info").on("click", function () {
      me.chat_space.$wrapper.find(".chat-info").show();
    });

    this.$chat_info.find(".edit").on("click", function () {
      var d = new frappe.ui.Dialog({
        title: "Edit Group Name",
        fields: [
          {
            label: "New Group Name",
            fieldname: "new_group_name",
            fieldtype: "Data",
            length: 50,
            reqd: 1,
          },
        ],
        primary_action: async function () {
          var data = d.get_values();
          const newname = data.new_group_name;
          me.chat_space.profile.room_name = newname;
          me.$chat_info
            .closest(".chat-window[data-room='" + me.room + "']")
            .find(".gname")
            .text(newname);

          await frappe.call({
            method: "clefincode_chat.api.api_1_0_1.api.set_group_name",
            args: {
              room: me.room,
              newname: newname,
              last_active_sub_channel: me.chat_space.last_active_sub_channel,
            },
            callback: function (r) {
              if (!r.exc) {
                const content = `<div class="rename-group" data-template="rename_group_template">
              <span class="sender-user" data-user="${me.user_email}"></span><span> changed the subject to "${newname}" </span>
              </div>`;

                const message_info = {
                  content: content,
                  user: me.user,
                  room: me.room,
                  email: me.user_email,
                  send_date: convertToUTC(
                    frappe.datetime.now_datetime(),
                    me.chat_space.profile.time_zone
                  ),
                  is_first_message: 0,
                  sub_channel: me.chat_space.last_active_sub_channel,
                  message_type: "information",
                  message_template_type: "Rename Group",
                  chat_topic: me.chat_space.chat_topic,
                };
                send_message(message_info);
                d.hide();
              }
            },
          });
        },
        primary_action_label: "Edit",
      });
      d.show();
    });

    this.$chat_info.find(".leave-conversation").on("click", function () {
      frappe.confirm(
        "Are you sure you want to leave this conversation?",
        async () => {
          const content = `<div class="user-left" data-template="user_left_template">
      <span class="sender-user" data-user="${me.user_email}"></span><span> left </span>
      </div>`;

          const message_info = {
            content: content,
            user: me.user,
            room: me.chat_space.profile.parent_channel,
            email: me.user_email,
            sub_channel: me.chat_space.last_active_sub_channel,
            message_type: "information",
            message_template_type: "User Left",
            send_date: convertToUTC(
              frappe.datetime.now_datetime(),
              me.chat_space.profile.time_zone
            ),
            chat_topic: me.chat_space.chat_topic,
          };

          await send_message(message_info);

          let empty_contributor_list = 1;
          me.chat_space.contributors = me.chat_space.contributors.filter(
            (user) => user.email !== me.user_email
          );
          if (me.chat_space.contributors.length > 0) {
            empty_contributor_list = 0;
          }

          const params = {
            parent_channel: me.chat_space.profile.parent_channel,
            user: me.user,
            user_email: me.user_email,
            creation_date: convertToUTC(
              frappe.datetime.now_datetime(),
              me.chat_space.profile.time_zone
            ),
            last_active_sub_channel: me.chat_space.last_active_sub_channel,
            user_to_remove: me.user_email,
            empty_contributor_list: empty_contributor_list,
          };
          leave_contributor(params);
          this.remove();
        }
      );
    });

    this.$chat_info.find(".exit-group").on("click", function () {
      frappe.confirm("Are you sure you want to exit this group?", async () => {
        const only_room_admin = await get_room_admins(me.room, me.user_email);
        const are_members = await is_member(
          me.room,
          me.chat_space.last_active_sub_channel
        );

        if (only_room_admin) {
          if (!are_members) {
            // Remove all contributors
            const last_active_sub_channel =
              me.chat_space.last_active_sub_channel;
            if (me.chat_space.contributors) {
              let emailList = me.chat_space.contributors.map(
                (user) => user.email
              );
              let emailListJson = JSON.stringify(emailList);

              let content = `
              <div class="remove-contributors" data-template="remove_contributors_template">
              <span class="sender-user" data-user="${me.user_email}"></span><span> removed all contributers</span>
              </div>`;

              const message_info = {
                content: content,
                user: me.user,
                room: channel,
                email: me.user_email,
                send_date: convertToUTC(
                  frappe.datetime.now_datetime(),
                  me.chat_space.profile.time_zone
                ),
                is_first_message: 0,
                sub_channel: me.chat_space.last_active_sub_channel,
                message_type: "information",
                message_template_type: "Remove Contributors",
              };
              await send_message(message_info);
              await disable_contributors(
                me.room,
                me.chat_space.last_active_sub_channel,
                emailListJson
              );
            }

            const content = `<div class="user-left" data-template="user_left_template">
            <span class="sender-user" data-user="${me.user_email}"></span><span> left </span>
            </div>`;
            const message_info = {
              content: content,
              user: me.user,
              room: me.chat_space.profile.room,
              email: me.user_email,
              send_date: convertToUTC(
                frappe.datetime.now_datetime(),
                me.chat_space.profile.time_zone
              ),
              is_first_message: 0,
              sub_channel: last_active_sub_channel,
              message_type: "information",
              message_template_type: "User Left",
            };
            await send_message(message_info);
            const res3 = await remove_group_member(
              me.user_email,
              me.room,
              me.chat_space.last_active_sub_channel
            );

            me.$chat_info.find(".add_members-button").remove();
            me.$chat_info
              .find(".delete-member[delete-data='" + me.user_email + "']")
              .remove();
            me.$chat_info.find(".delete-contributor").remove();
            me.$chat_info.find(".deletefromgroup").remove();
            me.$chat_info.find(".exit-group").remove();
            me.$chat_info.find(".contributor-section").remove();
            me.$chat_info
              .find(".participants")
              .html(me.count_group_members(me.chat_space.chat_members));
            me.$chat_info.find(".members-section").parent().remove();
            me.chat_space.profile.is_removed = 1;
            me.chat_space.$chat_actions.html(
              `<div class='text-center'>You can't send messages to this group because you're no longer a participant. </div>`
            );
          } else {
            var new_chat_members = $.grep(
              me.chat_space.chat_members,
              function (e) {
                return e.email != me.user_email;
              }
            );
            let d = new frappe.ui.Dialog({
              title: "Chose an admin for this group",
              fields: [
                {
                  label: "User",
                  fieldname: "user",
                  fieldtype: "Select",
                  options: new_chat_members.map(
                    (row) => row.name + ":" + row.email
                  ),
                  reqd: 1,
                },
              ],
              size: "small", // small, large, extra-large
              primary_action_label: "Submit",
              async primary_action(values) {
                const content = `<div class="user-left" data-template="user_left_template">
            <span class="sender-user" data-user="${me.user_email}"></span><span> left </span>
            </div>`;

                //  me.chat_space.$chat_space_container.append(
                //   await me.chat_space.make_message({
                //     content: content,
                //     type: 'info-message',
                //     sender: me.user,
                //     message_template_type: "User Left"
                //   }));

                let chat_room;
                if (me.chat_space.profile.room_type == "Contributor") {
                  chat_room = me.chat_space.profile.parent_channel;
                } else {
                  chat_room = me.chat_space.profile.room;
                }

                const message_info = {
                  content: content,
                  user: me.user,
                  room: chat_room,
                  email: me.user_email,
                  send_date: convertToUTC(
                    frappe.datetime.now_datetime(),
                    me.chat_space.profile.time_zone
                  ),
                  is_first_message: 0,
                  sub_channel: me.chat_space.last_active_sub_channel,
                  message_type: "information",
                  message_template_type: "User Left",
                  chat_topic: me.chat_space.chat_topic,
                };
                await send_message(message_info);

                var arr = values["user"].split(":");
                var new_admin_email = arr[arr.length - 1];

                me.is_admin = 0;

                const res33 = await remove_group_member_and_assign_new_admin(
                  me.user_email,
                  me.room,
                  new_admin_email,
                  me.chat_space.last_active_sub_channel
                );

                const new_admin_message = `<div class="set-user-admin" data-template="set_user_admin_template">
                  <span> You're now an admin</span>
                  <span class="receiver-user" data-user="${new_admin_email}"></span>
                </div>`;

                const admin_message_info = {
                  content: new_admin_message,
                  user: me.user,
                  room: chat_room,
                  email: me.user_email,
                  send_date: convertToUTC(
                    frappe.datetime.now_datetime(),
                    me.chat_space.profile.time_zone
                  ),
                  is_first_message: 0,
                  sub_channel: me.chat_space.last_active_sub_channel,
                  message_type: "information",
                  message_template_type: "Set Admin",
                  only_receive_by: new_admin_email,
                  chat_topic: me.chat_space.chat_topic,
                };
                send_message(admin_message_info);

                me.$chat_info.find(".edit").remove();
                me.$chat_info.find(".add_members-button").remove();
                me.$chat_info
                  .find(".delete-member[delete-data='" + me.user_email + "']")
                  .remove();
                me.$chat_info.find(".delete-contributor").remove();
                me.$chat_info.find(".deletefromgroup").remove();
                me.$chat_info.find(".exit-group").remove();
                me.$chat_info.find(".contributor-section").remove();
                me.$chat_info
                  .find(".participants")
                  .html(me.count_group_members(me.chat_space.chat_members));
                me.chat_space.$chat_actions.html(
                  `<div class='text-center'>You can't send messages to this group because you're no longer a participant. </div>`
                );
                d.hide();
              },
            });

            d.show();
          }
        } else {
          const content = `<div class="user-left" data-template="user_left_template">
          <span class="sender-user" data-user="${me.user_email}"></span><span> left </span>
            </div>`;

          //  me.chat_space.$chat_space_container.append(
          //   await me.chat_space.make_message({
          //     content: content,
          //     type: 'info-message',
          //     sender: me.user,
          //     message_template_type: "User Left"
          //   }));

          let chat_room;
          if (me.chat_space.profile.room_type == "Contributor") {
            chat_room = me.chat_space.profile.parent_channel;
          } else {
            chat_room = me.chat_space.profile.room;
          }

          const message_info = {
            content: content,
            user: me.user,
            room: chat_room,
            email: me.user_email,
            send_date: convertToUTC(
              frappe.datetime.now_datetime(),
              me.chat_space.profile.time_zone
            ),
            is_first_message: 0,
            sub_channel: me.chat_space.last_active_sub_channel,
            message_type: "information",
            message_template_type: "User Left",
            chat_topic: me.chat_space.chat_topic,
          };
          await send_message(message_info);

          const res3 = await remove_group_member(
            me.user_email,
            me.room,
            me.chat_space.last_active_sub_channel
          );

          me.$chat_info.find(".add_members-button").remove();
          me.$chat_info
            .find(".delete-member[delete-data='" + me.user_email + "']")
            .remove();
          me.$chat_info.find(".delete-contributor").remove();
          me.$chat_info.find(".deletefromgroup").remove();
          me.$chat_info.find(".exit-group").remove();
          me.$chat_info.find(".contributor-section").remove();
          me.$chat_info
            .find(".participants")
            .html(me.count_group_members(me.chat_space.chat_members));
          me.chat_space.profile.is_removed = 1;
          me.chat_space.$chat_actions.html(
            `<div class='text-center'>You can't send messages to this group because you're no longer a participant. </div>`
          );
        }
      });
    });

    $(document).on("click", function (event) {
      var $target = $(event.target);
      if ($target.closest(me.$chat_info.find(".deletefromgroup")).length) {
        var $this = $target.closest(me.$chat_info.find(".deletefromgroup"));
        frappe.confirm(
          "Are you sure you want to delete this member?",
          async () => {
            var id = $this.attr("id");

            let content = `
              <div class="remove-user" data-template="remove_user_template">
              <span class="sender-user" data-user="${
                me.user_email
              }"></span><span> removed </span><span class="receiver-user" data-user="${$this.attr(
              "id"
            )}"></span>
              </div>`;

            // me.chat_space.$chat_space_container.append(
            // await me.chat_space.make_message({
            //   content: content,
            //   type: 'info-message',
            //   sender: me.user,
            //   message_template_type: "Remove User"
            // }));

            let chat_room;
            if (me.chat_space.profile.room_type == "Contributor") {
              chat_room = me.chat_space.profile.parent_channel;
            } else {
              chat_room = me.chat_space.profile.room;
            }

            const message_info = {
              content: content,
              user: me.user,
              room: chat_room,
              email: me.user_email,
              send_date: convertToUTC(
                frappe.datetime.now_datetime(),
                me.chat_space.profile.time_zone
              ),
              is_first_message: 0,
              sub_channel: me.chat_space.last_active_sub_channel,
              message_type: "information",
              message_template_type: "Remove User",
              chat_topic: me.chat_space.chat_topic,
            };
            await send_message(message_info);
            const res3 = await remove_group_member(
              id,
              me.room,
              me.chat_space.last_active_sub_channel
            );

            me.$chat_info
              .find(".delete-member[delete-data='" + id + "']")
              .remove();
            me.$chat_info
              .find(".participants")
              .html(me.count_group_members(me.chat_space.chat_members));
          }
        );
      }
    });

    this.$chat_info.find(".openMedia").on("click", function () {
      me.$chat_info.find(".chat-media").css("display", "block");
      me.$chat_info.scrollTop("0");
      me.$chat_info.css("overflow", "hidden");
      me.$chat_info.css("height", "574px");
      me.$chat_info.find(".openmediaTab").click();
    });

    this.$chat_info.find(".closeMedia").on("click", function () {
      me.$chat_info.find(".chat-media").css("display", "none");
      me.$chat_info.css("overflow", "auto");
      me.$chat_info.css("height", "100%");
    });

    this.$chat_info.find(".delete-contributor").on("click", function () {
      const email = $(this).attr("c-email");
      me.chat_space.$chat_actions
        .find(".tag-blot[data-email='" + email + "'] .remove-tag")
        .click();

      $(this).parent().remove();
    });

    this.$chat_info.find(".remove-document").on("click", async function () {
      const reference_doctype = $(this).data("docname");
      const chat_channel =
        me.chat_space.profile.room_type == "Contributor"
          ? me.chat_space.profile.parent_channel
          : me.chat_space.profile.room;
      if (me.chat_space.reference_doctypes.length == 1) {
        var d = new frappe.ui.Dialog({
          title: "Confirm Action",
          fields: [
            {
              label: "Are you sure you want to proceed?",
              fieldtype: "HTML",
              options:
                "Removing this document will leave the topic empty. Do you wish to retain the topic in the chat with no content, or would you prefer to remove the entire topic from the chat?",
            },
          ],
          primary_action_label: "Remove",
          async primary_action() {
            let chat_topic_subject = "";
            if (me.chat_space.chat_topic_subject) {
              chat_topic_subject = me.chat_space.chat_topic_subject;
            } else {
              chat_topic_subject = me.chat_space.reference_doctypes[0].docname;
            }
            await remove_chat_topic(
              me.chat_space.chat_topic,
              chat_channel,
              me.chat_space.last_active_sub_channel
            );
            me.chat_space.send_remove_topic_message(
              chat_channel,
              chat_topic_subject
            );
            me.$chat_info.find(".reference-doctypes-section").remove();
            d.hide();
          },
          secondary_action_label: "Keep Empty",
          async secondary_action() {
            if (!me.chat_space.chat_topic_subject) {
              var dd = new frappe.ui.Dialog({
                title: "Set Topic Subject",
                fields: [
                  {
                    label: "New Subject",
                    fieldname: "chat_topic_subject",
                    fieldtype: "Data",
                    length: 25,
                    reqd: 1,
                  },
                ],
                primary_action: function () {
                  var data = dd.get_values();
                  frappe.call({
                    method:
                      "clefincode_chat.api.api_1_0_1.api.set_topic_subject",
                    args: {
                      chat_topic: me.chat_space.chat_topic,
                      new_subject: data.chat_topic_subject,
                      chat_channel: chat_channel,
                      last_active_sub_channel:
                        me.chat_space.last_active_sub_channel,
                    },
                    callback: async function (r) {
                      if (!r.exc) {
                        await me.chat_space.send_rename_topic_message(
                          data.chat_topic_subject,
                          chat_channel
                        );
                        remove_reference_doctype(
                          me.chat_space.chat_topic,
                          reference_doctype,
                          chat_channel,
                          me.chat_space.last_active_sub_channel
                        );
                        await me.send_remove_document_message(
                          reference_doctype,
                          chat_channel
                        );
                        $(this).parent().remove();
                        me.$chat_info
                          .find(".reference-doctypes-section")
                          .remove();
                        d.hide();
                        dd.hide();
                      }
                    },
                  });
                },
                primary_action_label: "Edit",
              }).show();
            } else {
              remove_reference_doctype(
                me.chat_space.chat_topic,
                reference_doctype,
                chat_channel,
                me.chat_space.last_active_sub_channel
              );
              await me.send_remove_document_message(
                reference_doctype,
                chat_channel
              );
              $(this).parent().remove();
              me.$chat_info.find(".reference-doctypes-section").remove();
              d.hide();
            }
          },
        }).show();
      } else {
        remove_reference_doctype(
          me.chat_space.chat_topic,
          reference_doctype,
          chat_channel,
          me.chat_space.last_active_sub_channel
        );
        await me.send_remove_document_message(reference_doctype, chat_channel);
        $(this).parent().remove();
      }
    });

    this.$chat_info.find(".openmediaTab").on("click", async function () {
      me.$chat_info.find(".infobutton").removeClass("active");
      $(this).addClass("active");
      me.$chat_info.find(".linkstab").css("display", "none");
      me.$chat_info.find(".docstab").css("display", "none");
      me.$chat_info.find(".mediatab").css("display", "block");

      const res = await get_media(
        channel,
        me.user_email,
        me.chat_space.profile.remove_date
      );
      if (res.length == 0) {
        me.$chat_info.find("#mediatabcontainer").html("No Media");
      } else {
        me.$chat_info.find("#mediatabcontainer").html("");
        $.each(res, function () {
          me.$chat_info.find("#mediatabcontainer").append(this.content);
        });
      }
    });

    this.$chat_info.find(".openlinksTab").on("click", async function () {
      me.$chat_info.find(".infobutton").removeClass("active");
      $(this).addClass("active");
      me.$chat_info.find(".mediatab").css("display", "none");
      me.$chat_info.find(".docstab").css("display", "none");
      me.$chat_info.find(".linkstab").css("display", "block");
      const res = await get_links(
        channel,
        me.useremail,
        me.chat_space.profile.remove_date
      );
      if (res.length == 0) {
        me.$chat_info.find("#linkstabcontainer").html("No Links");
      } else {
        me.$chat_info.find("#linkstabcontainer").html("");
        $.each(res, function () {
          const div = $(document.createElement("div")).addClass("linksrow");
          div.append(this.content);
          me.$chat_info.find("#linkstabcontainer").append(div);
        });
      }
    });

    this.$chat_info.find(".opendocsTab").on("click", async function () {
      me.$chat_info.find(".infobutton").removeClass("active");
      $(this).addClass("active");
      me.$chat_info.find(".mediatab").css("display", "none");
      me.$chat_info.find(".linkstab").css("display", "none");
      me.$chat_info.find(".docstab").css("display", "block");
      const res = await get_docs(
        channel,
        me.user_email,
        me.chat_space.profile.remove_date
      );
      if (res.length == 0) {
        me.$chat_info.find("#docstabcontainer").html("No Docs");
      } else {
        me.$chat_info.find("#docstabcontainer").html("");
        $.each(res, function () {
          me.$chat_info.find("#docstabcontainer").append(this.content);
        });
      }
    });

    this.$chat_info.find(".common-group").on("click", function (e) {
      const channel = $(e.target).attr("data-channel");
      const channel_name = $(e.target).attr("data-channel-name");
      me.open_chat_space(channel, channel_name);
    });

    this.$chat_info.find(".add_members").on("click", function () {
      me.add_member_list = new ChatContactList({
        $wrapper: me.chat_space.$wrapper,
        profile: me.chat_space.profile,
        chat_info: me,
        add_member: 1,
      });
      me.add_member_list.render();
    });

    this.$chat_info.find(".close_members_lis").on("click", function () {
      const list_of_members = me.$chat_info.find(".list_members");
      list_of_members.html("");
      $(this).css("visibility", "hidden");
      me.$chat_info.find(".filter-members").css("display", "none");
      me.$chat_info.find(".filter-members").val("");
    });

    this.$chat_info.find(".filter-members").on("keyup", function () {
      var input, filter, members_to_add, i, txtValue;
      input = $(this);
      filter = $(this).val().toUpperCase();

      members_to_add = me.$chat_info.find(".add_this_member");
      for (i = 0; i < members_to_add.length; i++) {
        txtValue = members_to_add[i].textContent || members_to_add[i].innerText;

        if (txtValue.toUpperCase().indexOf(filter) > -1) {
          members_to_add[i].style.display = "";
        } else {
          members_to_add[i].style.display = "none";
        }
      }
    });
  } // end of setup_events

  open_chat_space(channel, channel_name) {
    if (check_if_chat_window_open(channel, "room")) {
      $(".expand-chat-window[data-id|='" + channel + "']").click();
      return;
    }

    let chat_window = new ChatWindow({
      profile: {
        room: channel,
      },
    });

    let profile = {
      is_admin: true,
      user: this.user,
      user_email: frappe.session.user,
      room: channel,
      room_name: channel_name,
      room_type: "Group",
      is_first_message: 0,
      platform: "Chat",
    };

    new ChatSpace({
      $wrapper: chat_window.$chat_window,
      profile: profile,
    });
  }

  count_group_members(members) {
    const uniqueProfileIds = new Set();

    for (const member of members) {
      uniqueProfileIds.add(member.profile_id);
    }

    return uniqueProfileIds.size;
  }

  render_topic_section() {
    if (this.chat_space.chat_topic) {
      const topic_section = `
      <div class="p-4 chat-info-section topic-section">
        <div class="pb-2 font-weight-bold">Related Topic</div>
        
      </div>
    `;
    }
  }

  render_refernce_doctypes_section() {
    if (this.chat_space.reference_doctypes.length > 0) {
      const create_refernce_doctype = (doctype, show_delete) => `
      <div class="d-flex flex-row justify-content-between pb-2">
        <div>
          <div>${doctype.doctype}</div>
          <div class="small">${doctype.docname}</div>
        </div>
        ${
          show_delete
            ? `<div class="remove-document" data-docname ="${
                doctype.docname
              }" style="cursor: pointer;">${frappe.utils.icon(
                "delete-active",
                "md"
              )}</div>`
            : ""
        }
      </div>
      `;

      const show_delete = this.chat_space.chat_members.some(
        (e) => e.email === this.user_email
      );
      const refernces_doctypes = this.chat_space.reference_doctypes
        .map((doctype) => create_refernce_doctype(doctype, show_delete))
        .join("");

      const refernce_doctypes_section = `
      <div class="p-4 chat-info-section reference-doctypes-section">
        <div class="pb-2 font-weight-bold">References Doctypes</div>
        ${refernces_doctypes}
      </div>
      `;
      return refernce_doctypes_section;
    } else {
      return ``;
    }
  }

  async send_remove_document_message(docname, chat_channel) {
    const mention_msg_info = `
    <div class="remove-doctype" data-template = "remove_doctype_template">
    <span class="sender-user" data-user="${this.user_email}"></span><span> removed ${docname} </span>
    </div>`;

    const message_info = {
      content: mention_msg_info,
      user: this.user,
      room: chat_channel,
      email: this.user_email,
      message_type: "information",
      send_date: get_time(
        frappe.datetime.now_time(),
        this.chat_space.profile.time_zone
      ),
      message_template_type: "Remove Doctype",
      sub_channel: this.chat_space.last_active_sub_channel,
      chat_topic: this.chat_space.chat_topic,
    };

    await send_message(message_info);
  }
} // END Class

async function get_room_creator(room) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.get_room_creator",
    args: {
      room: room,
    },
  });
  return await res.message;
}

async function get_room_in_common(email1, email2) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.get_room_in_common",
    args: {
      email1: email1,
      email2: email2,
    },
  });
  return await res.message.results[0].results;
}

async function get_links(channel, useremail, remove_date) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.get_chat_links",
    args: {
      channel: channel,
      useremail: useremail,
      remove_date: remove_date,
    },
  });
  return await res.message.results[0].results;
}

async function get_media(channel, useremail, remove_date) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.get_chat_media",
    args: {
      channel: channel,
      useremail: useremail,
      remove_date: remove_date,
    },
  });
  return await res.message.results[0].results;
}

async function get_docs(channel, useremail, remove_date) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.get_chat_docs",
    args: {
      channel: channel,
      useremail: useremail,
      remove_date: remove_date,
    },
  });
  return await res.message.results[0].results;
}

async function remove_group_member(email, room, last_active_sub_channel) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.remove_group_member",
    args: {
      email: email,
      room: room,
      last_active_sub_channel: last_active_sub_channel,
    },
  });
  // return await res.message;
}

async function remove_group_member_and_assign_new_admin(
  email,
  room,
  new_admin_email,
  last_active_sub_channel
) {
  const res = await frappe.call({
    method:
      "clefincode_chat.api.api_1_0_1.api.remove_group_member_and_assign_new_admin",
    args: {
      email: email,
      room: room,
      new_admin_email: new_admin_email,
      last_active_sub_channel: last_active_sub_channel,
    },
  });
  // return await res.message;
}

async function get_room_admins(room, email) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.get_room_admins",
    args: {
      room: room,
      email: email,
    },
  });
  return await res.message;
}

async function is_member(room) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.are_members",
    args: {
      room: room,
    },
  });
  return await res.message;
}
async function disable_contributors(
  parent_channel,
  last_active_sub_channel,
  user_to_remove_list
) {
  const res = await frappe.call({
    type: "GET",
    method: "clefincode_chat.api.api_1_0_1.api.disable_contributors",
    args: {
      parent_channel: parent_channel,
      last_active_sub_channel: last_active_sub_channel,
      user_to_remove_list: user_to_remove_list,
    },
  });
  return await res.message.results[0].channel;
}

async function leave_contributor(params) {
  const {
    parent_channel,
    user,
    user_email,
    creation_date,
    last_active_sub_channel,
    user_to_remove = null,
    empty_contributor_list = 0,
    freeze = false,
  } = params;
  await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.leave_contributor",
    args: {
      parent_channel: parent_channel,
      user: user,
      user_email: user_email,
      creation_date: creation_date,
      last_active_sub_channel: last_active_sub_channel,
      user_to_remove: user_to_remove,
      empty_contributor_list: empty_contributor_list,
    },
  });
}

async function remove_reference_doctype(
  chat_topic,
  reference_doctype,
  chat_channel,
  last_active_sub_channel
) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.remove_reference_doctype",
    args: {
      chat_topic: chat_topic,
      reference_doctype: reference_doctype,
      chat_channel: chat_channel,
      last_active_sub_channel: last_active_sub_channel,
    },
  });
  return await res.message;
}

async function get_topic_contributors(chat_topic) {
  const res = await frappe.call({
    method: "clefincode_chat.api.api_1_0_1.api.get_topic_contributors",
    args: {
      chat_topic: chat_topic,
    },
  });
  return await res.message;
}
