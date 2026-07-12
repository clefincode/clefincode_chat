// Copyright (c) 2020, Frappe Technologies Pvt. Ltd. and Contributors
// MIT License. See license.txt
import BaseTimeline from "./base_timeline";
import { get_version_timeline_content } from "./version_timeline_content_builder";
import { open_topic_chat_window_from_context } from "../../../components/topic_open_helper";

function buildTopicWindowKey({
  source = "base",
  chatChannel = "",
  chatTopic = "",
  fromDate = "",
  toDate = "",
  firstMessageName = "",
} = {}) {
  const parts = [
    "topic-window",
    source,
    chatChannel,
    chatTopic,
  ];

  if (source === "timeline") {
    parts.push(
      fromDate || "",
      toDate || "",
      firstMessageName || ""
    );
  }

  return parts
    .map((value) =>
      encodeURIComponent(String(value || "").trim())
    )
    .join("::");
}

function findTopicWindowInstance(windowKey) {
  if (!windowKey) {
    return null;
  }

  const instances = window.CCChatSpaceInstances || [];

  return (
    instances.find((instance) => {
      if (!instance) {
        return false;
      }

      const instanceKey =
        instance.topic_window_key ||
        instance.profile?.topic_window_key ||
        instance.$wrapper?.attr?.(
          "data-topic-window-key"
        ) ||
        "";

      return String(instanceKey) === String(windowKey);
    }) || null
  );
}

function showTopicWindowInstance(instance) {
  if (!instance?.$wrapper?.length) {
    return;
  }

  const $window = instance.$wrapper.closest(".chat-window");

  if (!$window.length) {
    return;
  }

  const $expandButton = $window.find(
    ".expand-chat-window"
  );

  if ($expandButton.length) {
    $expandButton.trigger("click");
  }

  $window.show();
}

class FormTimeline extends BaseTimeline {
  make() {
    super.make();
    this.setup_timeline_actions();
    this.render_timeline_items();
    this.setup_activity_toggle();
  }

  refresh() {
    super.refresh();
    this.frm.trigger("timeline_refresh");
    this.setup_document_email_link();
    this.setup_topic_click_event();
  }

  setup_timeline_actions() {
    this.add_action_button(
      __("New Email"),
      () => this.compose_mail(),
      "mail",
      "btn-secondary-dark"
    );
    this.setup_new_event_button();
  }

  setup_new_event_button() {
    if (this.frm.meta.allow_events_in_timeline) {
      let create_event = () => {
        const args = {
          doc: this.frm.doc,
          frm: this.frm,
          recipients: this.get_recipient(),
          txt: frappe.markdown(this.frm.comment_box.get_value()),
        };
        return new frappe.views.InteractionComposer(args);
      };
      this.add_action_button(__("New Event"), create_event, "calendar");
    }
  }

  setup_activity_toggle() {
    let doc_info = this.doc_info || this.frm.get_docinfo();
    let has_communications = () => {
      let communications = doc_info.communications;
      let comments = doc_info.comments;
      return (communications || []).length || (comments || []).length;
    };
    let me = this;
    if (has_communications()) {
      this.timeline_wrapper
        .prepend(
          `
				<div class="timeline-item activity-toggle">
					<div class="timeline-dot"></div>
					<div class="timeline-content flex align-center">
						<h4>${__("Activity")}</h4>
						<nav class="nav nav-pills flex-row">
							<a class="flex-sm-fill text-sm-center nav-link" data-only-communication="true">${__(
                "Communication"
              )}</a>
							<a class="flex-sm-fill text-sm-center nav-link active">${__("All")}</a>
						</nav>
					</div>
				</div>
			`
        )
        .find("a")
        .on("click", function (e) {
          e.preventDefault();
          me.only_communication = $(this).data().onlyCommunication;
          me.render_timeline_items();
          $(this).tab("show");
        });
    }
  }

  setup_document_email_link() {
    let doc_info = this.doc_info || this.frm.get_docinfo();

    this.document_email_link_wrapper &&
      this.document_email_link_wrapper.remove();

    if (doc_info.document_email) {
      const link = `<a class="document-email-link">${doc_info.document_email}</a>`;
      const message = __("Add to this activity by mailing to {0}", [
        link.bold(),
      ]);

      this.document_email_link_wrapper = $(`
				<div class="timeline-item">
					<div class="timeline-dot"></div>
					<div class="timeline-content">
						<span>${message}</span>
					</div>
				</div>
			`);
      this.timeline_actions_wrapper.append(this.document_email_link_wrapper);

      this.document_email_link_wrapper
        .find(".document-email-link")
        .on("click", (e) => {
          let text = $(e.target).text();
          frappe.utils.copy_to_clipboard(text);
        });
    }
  }

setup_topic_click_event() {
  this.timeline_items_wrapper
    .off("click.cc-chat-topic", ".topic-link, .topic-card")
    .on("click.cc-chat-topic", ".topic-link, .topic-card", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const $el = $(e.currentTarget);
      const $timeline_item = $el.closest(".timeline-item");

      const chat_topic =
        $el.data("topic") ||
        $el.data("chat-topic") ||
        $timeline_item.data("name");

        const chat_channel = $el.data("chat-channel");
      const first_message_name = $el.data("first-message");
      const from_date = $el.data("from-date");
      const to_date = $el.data("to-date");
      const grouping_condition_met = Boolean($el.data("grouping-condition"));

      if (!chat_topic || !chat_channel) {

        frappe.msgprint({
          title: __("Error"),
          message: __("No chat channel found for this topic."),
          indicator: "red",
        });
        return;
      }

      await this.open_filtered_topic_chat_from_timeline({
        chat_topic,
        chat_channel,
        first_message_name,
        from_date,
        to_date,
        grouping_condition_met,
      });
    });
}

async open_filtered_topic_chat_from_timeline(ctx) {
    let topicContext = {};

  try {
    const response = await frappe.call({
      method:
        "clefincode_chat.api.api_1_3_4.api.get_topic_open_context",
      args: {
        chat_topic: ctx.chat_topic
      }
    });

    topicContext = response.message || {};
  } catch (error) {
    console.error(
      "[Timeline] Failed to load topic access context",
      error
    );

    frappe.msgprint({
      title: __("Error"),
      message: __("Unable to verify topic access."),
      indicator: "red"
    });

    return;
  }

  const isPrivateTopic =
  Number(topicContext.is_private_topic || 0) === 1;
  const room = ctx.chat_channel;
  const topicKey = ctx.chat_topic;
  const chatChannel = ctx.chat_channel;
  const topicSubject = ctx.chat_topic_subject || ctx.chat_topic;

  const topicWindowKey = buildTopicWindowKey({
    source: "timeline",
    chatChannel: ctx.chat_channel,
    chatTopic: ctx.chat_topic,
    fromDate: ctx.from_date,
    toDate: ctx.to_date,
    firstMessageName: ctx.first_message_name,
  });

  const timeline_filter_context = {
    chat_topic: ctx.chat_topic,
    from_date: ctx.from_date,
    to_date: ctx.to_date,
    first_message_name: ctx.first_message_name,
    grouping_condition_met: ctx.grouping_condition_met,
  };

  if (!ctx.first_message_name) {
    frappe.msgprint({
      title: __("No Messages"),
      message: __("No message found for this topic time range."),
      indicator: "orange",
    });
    return;
  }

  const existingTimelineWindow =
    findTopicWindowInstance(topicWindowKey);

  if (existingTimelineWindow) {
    showTopicWindowInstance(
      existingTimelineWindow
    );

    if (existingTimelineWindow.ready) {
      await existingTimelineWindow.ready;
    }

    existingTimelineWindow.timeline_filter_context =
      timeline_filter_context;

    existingTimelineWindow.messages_offset = 0;

    if (
      ctx.first_message_name &&
      typeof existingTimelineWindow.jumpToMessage ===
        "function"
    ) {
      await existingTimelineWindow.jumpToMessage(
        ctx.first_message_name,
        50,
        0
      );
    }

    existingTimelineWindow
      .checkAndShowTopicInactiveNotice?.();

    return;
  }

  const chat_window =
    new window.CCChatWindow({
      profile: {
        topic: topicWindowKey,
        chat_topic: ctx.chat_topic,
        topic_window_key: topicWindowKey,
        topic_window_source: "timeline",
      },
    });

  chat_window.$chat_window
    .attr( "data-topic-window-key", topicWindowKey )
    .attr( "data-topic-source", "timeline")
    .attr("data-topic", ctx.chat_topic)
    .attr("data-chat-channel", ctx.chat_channel)
    .attr("data-from-date", ctx.from_date || "" )
    .attr( "data-to-date", ctx.to_date || "" )
    .attr( "data-first-message", ctx.first_message_name || "" )
    .data("topic-window-key", topicWindowKey )
    .data( "topic", ctx.chat_topic );

  const topicChatSpace =
    new window.CCChatSpace({
      $wrapper:
        chat_window.$chat_window,

      profile: {
        is_admin: true,
        user: frappe.session.user,
        user_email:
          frappe.session.user_email ||
          frappe.session.user,

        room: ctx.chat_channel,
        room_type: "Topic",
        room_name: ctx.chat_topic_subject || ctx.chat_topic,

        chat_topic: ctx.chat_topic,
        chat_topic_subject: ctx.chat_topic_subject || ctx.chat_topic,

        topic_window_key:topicWindowKey,
        topic_window_source:"timeline",

        platform: "Chat",
      },

      chat_topic: ctx.chat_topic,
      chat_topic_channel: ctx.chat_channel,
      chat_topic_subject: ctx.chat_topic_subject || ctx.chat_topic,
      alternative_subject: ctx.chat_topic_subject || ctx.chat_topic,

      topic_window_key:topicWindowKey,
      topic_window_source:"timeline",
      is_private_topic: isPrivateTopic ? 1 : 0,

      is_topic_window: true,
      topic_write_mode: true,
      topic_read_only: true,
      topic_can_reopen: false,

      initial_message_to_scroll: ctx.first_message_name,

      timeline_filter_context,
    });

  window.CCChatSpaceInstances = window.CCChatSpaceInstances || [];

  if (!window.CCChatSpaceInstances.includes( topicChatSpace)) {
    window.CCChatSpaceInstances.push(topicChatSpace);
  }
}
  render_timeline_items() {
  super.render_timeline_items();
  this.set_document_info();
  frappe.utils.bind_actions_with_object(this.timeline_items_wrapper, this);
  this.setup_topic_click_event();
}

  set_document_info() {
    // TODO: handle creation via automation
    const creation = comment_when(this.frm.doc.creation);
    let creation_message = frappe.utils.is_current_user(this.frm.doc.owner)
      ? __("You created this {0}", [creation], "Form timeline")
      : __(
          "{0} created this {1}",
          [this.get_user_link(this.frm.doc.owner), creation],
          "Form timeline"
        );

    const modified = comment_when(this.frm.doc.modified);
    let modified_message = frappe.utils.is_current_user(
      this.frm.doc.modified_by
    )
      ? __("You edited this {0}", [modified], "Form timeline")
      : __(
          "{0} edited this {1}",
          [this.get_user_link(this.frm.doc.modified_by), modified],
          "Form timeline"
        );

    if (this.frm.doc.route && cint(frappe.boot.website_tracking_enabled)) {
      let route = this.frm.doc.route;
      frappe.utils.get_page_view_count(route).then((res) => {
        let page_view_count_message = __(
          "{0} Page views",
          [res.message],
          "Form timeline"
        );
        this.add_timeline_item(
          {
            content: `${creation_message} • ${modified_message} • 	${page_view_count_message}`,
            hide_timestamp: true,
          },
          true
        );
      });
    } else {
      this.add_timeline_item(
        {
          content: `${creation_message} • ${modified_message}`,
          hide_timestamp: true,
        },
        true
      );
    }
  }

  prepare_timeline_contents() {
    this.timeline_items.push(...this.get_communication_timeline_contents());
    this.timeline_items.push(...this.get_chat_topics_timeline_contents());
    this.timeline_items.push(...this.get_auto_messages_timeline_contents());
    this.timeline_items.push(...this.get_comment_timeline_contents());
    if (!this.only_communication) {
      this.timeline_items.push(...this.get_view_timeline_contents());
      this.timeline_items.push(...this.get_energy_point_timeline_contents());
      this.timeline_items.push(...this.get_version_timeline_contents());
      this.timeline_items.push(...this.get_share_timeline_contents());
      this.timeline_items.push(...this.get_workflow_timeline_contents());
      this.timeline_items.push(...this.get_like_timeline_contents());
      this.timeline_items.push(...this.get_custom_timeline_contents());
      this.timeline_items.push(...this.get_assignment_timeline_contents());
      this.timeline_items.push(...this.get_attachment_timeline_contents());
      this.timeline_items.push(...this.get_info_timeline_contents());
      this.timeline_items.push(...this.get_milestone_timeline_contents());
    }
  }

  get_user_link(user) {
    const user_display_text = (frappe.user_info(user).fullname || "").bold();
    return frappe.utils.get_form_link("User", user, true, user_display_text);
  }

  get_view_timeline_contents() {
    let view_timeline_contents = [];
    (this.doc_info.views || []).forEach((view) => {
      const view_time = comment_when(view.creation);
      let view_message = frappe.utils.is_current_user(view.owner)
        ? __("You viewed this {0}", [view_time], "Form timeline")
        : __(
            "{0} viewed this {1}",
            [this.get_user_link(view.owner), view_time],
            "Form timeline"
          );

      view_timeline_contents.push({
        creation: view.creation,
        content: view_message,
        hide_timestamp: true,
      });
    });
    return view_timeline_contents;
  }

  get_communication_timeline_contents() {
    let communication_timeline_contents = [];
    let icon_set = {
      Email: "mail",
      Phone: "call",
      Meeting: "calendar",
      Other: "dot-horizontal",
    };
    (this.doc_info.communications || []).forEach((communication) => {
      let medium = communication.communication_medium;
      communication_timeline_contents.push({
        icon: icon_set[medium],
        icon_size: "sm",
        creation: communication.creation,
        is_card: true,
        content: this.get_communication_timeline_content(communication),
        doctype: "Communication",
        id: `communication-${communication.name}`,
        name: communication.name,
      });
    });
    return communication_timeline_contents;
  }

  get_chat_topics_timeline_contents() {
  let chat_topics_timeline_contents = [];

  const getPeriodLabel = (topic) => {
    const start = topic.period_display_start;
    const end = topic.period_display_end;
    if (!start && !end) return "";
    if (start && end && start !== end) {
      return `${start} to ${end}`;
    }
    return start || end;
  };

  (this.doc_info.chat_topics || []).forEach((topic) => {
    const periodText = getPeriodLabel(topic);

    const periodLabel = periodText
      ? ` <span class="text-muted">· ${periodText}</span>`
      : "";

    const messageCount = parseInt(topic.message_count || 0, 10) || 0;
    const countLabel = messageCount
      ? ` <span class="text-muted">· ${messageCount} ${
          messageCount === 1 ? __("message") : __("messages")
        }</span>`
      : "";

    chat_topics_timeline_contents.push({
      icon: "tag",
      icon_size: "md",
      creation: topic.first_message_date || topic.creation,
      is_card: true,
      content: `${topic.subject}${periodLabel}${countLabel}`,
      doctype: "ClefinCode Chat Topic",
      id: `chat-topic-${topic.name}-${topic.period_bucket || "no-messages"}`,
      name: topic.name,
      topic_status: topic.topic_status,

      chat_topic: topic.name,
      period_bucket: topic.period_bucket,
      first_message_name: topic.first_message_name,
      first_message_date: topic.first_message_date,
      last_message_date: topic.last_message_date,
      message_count: messageCount,
    });
  });

  return chat_topics_timeline_contents;
  }

  get_communication_timeline_content(doc, allow_reply = true) {
    doc._url = frappe.utils.get_form_link("Communication", doc.name);
    this.set_communication_doc_status(doc);
    if (doc.attachments && typeof doc.attachments === "string") {
      doc.attachments = JSON.parse(doc.attachments);
    }
    doc.owner = doc.sender;
    doc.user_full_name = doc.sender_full_name;
    doc.content = frappe.dom.remove_script_and_style(doc.content);
    let communication_content = $(
      frappe.render_template("timeline_message_box", { doc })
    );
    if (allow_reply) {
      this.setup_reply(communication_content, doc);
    }
    return communication_content;
  }

  set_communication_doc_status(doc) {
    let indicator_color = "red";
    if (in_list(["Sent", "Clicked"], doc.delivery_status)) {
      indicator_color = "green";
    } else if (doc.delivery_status === "Sending") {
      indicator_color = "orange";
    } else if (in_list(["Opened", "Read"], doc.delivery_status)) {
      indicator_color = "blue";
    } else if (doc.delivery_status == "Error") {
      indicator_color = "red";
    }
    doc._doc_status = doc.delivery_status;
    doc._doc_status_indicator = indicator_color;
  }

  get_auto_messages_timeline_contents() {
    let auto_messages_timeline_contents = [];
    (this.doc_info.automated_messages || []).forEach((message) => {
      auto_messages_timeline_contents.push({
        icon: "notification",
        icon_size: "sm",
        creation: message.creation,
        is_card: true,
        content: this.get_communication_timeline_content(message, false),
        doctype: "Communication",
        name: message.name,
      });
    });
    return auto_messages_timeline_contents;
  }

  get_comment_timeline_contents() {
    let comment_timeline_contents = [];
    (this.doc_info.comments || []).forEach((comment) => {
      comment_timeline_contents.push(this.get_comment_timeline_item(comment));
    });
    return comment_timeline_contents;
  }

  get_comment_timeline_item(comment) {
    return {
      icon: "small-message",
      creation: comment.creation,
      is_card: true,
      doctype: "Comment",
      id: `comment-${comment.name}`,
      name: comment.name,
      content: this.get_comment_timeline_content(comment),
    };
  }

  get_comment_timeline_content(doc) {
    doc.content = frappe.dom.remove_script_and_style(doc.content);
    const comment_content = $(
      frappe.render_template("timeline_message_box", { doc })
    );
    this.setup_comment_actions(comment_content, doc);
    return comment_content;
  }

  get_version_timeline_contents() {
    let version_timeline_contents = [];
    (this.doc_info.versions || []).forEach((version) => {
      const contents = get_version_timeline_content(version, this.frm);
      contents.forEach((content) => {
        version_timeline_contents.push({
          creation: version.creation,
          content: content,
        });
      });
    });
    return version_timeline_contents;
  }

  get_share_timeline_contents() {
    let share_timeline_contents = [];
    (this.doc_info.share_logs || []).forEach((share_log) => {
      share_timeline_contents.push({
        creation: share_log.creation,
        content: share_log.content,
      });
    });
    return share_timeline_contents;
  }

  get_assignment_timeline_contents() {
    let assignment_timeline_contents = [];
    (this.doc_info.assignment_logs || []).forEach((assignment_log) => {
      assignment_timeline_contents.push({
        creation: assignment_log.creation,
        content: assignment_log.content,
      });
    });
    return assignment_timeline_contents;
  }

  get_info_timeline_contents() {
    let info_timeline_contents = [];
    (this.doc_info.info_logs || []).forEach((info_log) => {
      info_timeline_contents.push({
        creation: info_log.creation,
        content: `${this.get_user_link(info_log.owner)} ${info_log.content}`,
      });
    });
    return info_timeline_contents;
  }

  get_attachment_timeline_contents() {
    let attachment_timeline_contents = [];
    (this.doc_info.attachment_logs || []).forEach((attachment_log) => {
      let is_file_upload = attachment_log.comment_type == "Attachment";
      attachment_timeline_contents.push({
        icon: is_file_upload ? "upload" : "delete",
        icon_size: "sm",
        creation: attachment_log.creation,
        content: `${this.get_user_link(attachment_log.owner)} ${
          attachment_log.content
        }`,
      });
    });
    return attachment_timeline_contents;
  }

  get_milestone_timeline_contents() {
    let milestone_timeline_contents = [];
    (this.doc_info.milestones || []).forEach((milestone_log) => {
      milestone_timeline_contents.push({
        icon: "milestone",
        creation: milestone_log.creation,
        content: __("{0} changed {1} to {2}", [
          this.get_user_link(milestone_log.owner),
          frappe.meta.get_label(this.frm.doctype, milestone_log.track_field),
          milestone_log.value.bold(),
        ]),
      });
    });
    return milestone_timeline_contents;
  }

  get_like_timeline_contents() {
    let like_timeline_contents = [];
    (this.doc_info.like_logs || []).forEach((like_log) => {
      like_timeline_contents.push({
        icon: "heart",
        icon_size: "sm",
        creation: like_log.creation,
        content: __("{0} Liked", [this.get_user_link(like_log.owner)]),
        title: "Like",
      });
    });
    return like_timeline_contents;
  }

  get_workflow_timeline_contents() {
    let workflow_timeline_contents = [];
    (this.doc_info.workflow_logs || []).forEach((workflow_log) => {
      workflow_timeline_contents.push({
        icon: "branch",
        icon_size: "sm",
        creation: workflow_log.creation,
        content: `${this.get_user_link(workflow_log.owner)} ${__(
          workflow_log.content
        )}`,
        title: "Workflow",
      });
    });
    return workflow_timeline_contents;
  }

  get_custom_timeline_contents() {
    let custom_timeline_contents = [];
    (this.doc_info.additional_timeline_content || []).forEach((custom_item) => {
      custom_timeline_contents.push({
        icon: custom_item.icon,
        icon_size: "sm",
        is_card: custom_item.is_card,
        creation: custom_item.creation,
        content:
          custom_item.content ||
          frappe.render_template(
            custom_item.template,
            custom_item.template_data
          ),
      });
    });
    return custom_timeline_contents;
  }

  get_energy_point_timeline_contents() {
    let energy_point_timeline_contents = [];
    (this.doc_info.energy_point_logs || []).forEach((log) => {
      let timeline_badge = `
			<div class="timeline-badge ${
        log.points > 0 ? "appreciation" : "criticism"
      } bold">
				${log.points}
			</div>`;

      energy_point_timeline_contents.push({
        timeline_badge: timeline_badge,
        creation: log.creation,
        content: frappe.energy_points.format_form_log(log),
      });
    });
    return energy_point_timeline_contents;
  }

  setup_reply(communication_box, communication_doc) {
    let actions = communication_box.find(".custom-actions");
    let reply = $(
      `<a class="action-btn reply">${frappe.utils.icon("reply", "md")}</a>`
    ).click(() => {
      this.compose_mail(communication_doc);
    });
    let reply_all = $(
      `<a class="action-btn reply-all">${frappe.utils.icon(
        "reply-all",
        "md"
      )}</a>`
    ).click(() => {
      this.compose_mail(communication_doc, true);
    });
    actions.append(reply);
    actions.append(reply_all);
  }

  compose_mail(communication_doc = null, reply_all = false) {
    const args = {
      doc: this.frm.doc,
      frm: this.frm,
      recipients:
        communication_doc &&
        communication_doc.sender != frappe.session.user_email
          ? communication_doc.sender
          : this.get_recipient(),
      is_a_reply: Boolean(communication_doc),
      title: communication_doc ? __("Reply") : null,
      last_email: communication_doc,
      subject: communication_doc && communication_doc.subject,
    };

    if (communication_doc && reply_all) {
      args.cc = communication_doc.cc;
      args.bcc = communication_doc.bcc;
    }

    if (this.frm.doctype === "Communication") {
      args.message = "";
      args.last_email = this.frm.doc;
      args.recipients = this.frm.doc.sender;
      args.subject = __("Re: {0}", [this.frm.doc.subject]);
    } else {
      const comment_value = frappe.markdown(this.frm.comment_box.get_value());
      args.message = strip_html(comment_value) ? comment_value : "";
    }

    new frappe.views.CommunicationComposer(args);
  }

  get_recipient() {
    if (this.frm.email_field) {
      return this.frm.doc[this.frm.email_field];
    } else {
      return this.frm.doc.email_id || this.frm.doc.email || "";
    }
  }

  setup_comment_actions(comment_wrapper, doc) {
    let edit_wrapper = $(`<div class="comment-edit-box">`).hide();
    let edit_box = this.make_editable(edit_wrapper);
    let content_wrapper = comment_wrapper.find(".content");
    let more_actions_wrapper = comment_wrapper.find(".more-actions");
    if (
      frappe.model.can_delete("Comment") &&
      (frappe.session.user == doc.owner ||
        frappe.user.has_role("System Manager"))
    ) {
      const delete_option = $(`
				<li>
					<a class="dropdown-item">
						${__("Delete")}
					</a>
				</li>
			`).click(() => this.delete_comment(doc.name));
      more_actions_wrapper.find(".dropdown-menu").append(delete_option);
    }

    let dismiss_button = $(`
			<button class="btn btn-link action-btn">
				${__("Dismiss")}
			</button>
		`).click(() => edit_button.toggle_edit_mode());
    dismiss_button.hide();

    edit_box.set_value(doc.content);

    edit_box.on_submit = (value) => {
      content_wrapper.empty();
      content_wrapper.append(value);
      edit_button.prop("disabled", true);
      edit_box.quill.enable(false);

      doc.content = value;
      this.update_comment(doc.name, value)
        .then(edit_button.toggle_edit_mode)
        .finally(() => {
          edit_button.prop("disabled", false);
          edit_box.quill.enable(true);
        });
    };

    content_wrapper.after(edit_wrapper);

    let edit_button = $();
    let current_user = frappe.session.user;
    if (["Administrator", doc.owner].includes(current_user)) {
      edit_button = $(
        `<button class="btn btn-link action-btn">${__("Edit")}</a>`
      ).click(() => {
        edit_button.edit_mode
          ? edit_box.submit()
          : edit_button.toggle_edit_mode();
      });
    }

    edit_button.toggle_edit_mode = () => {
      edit_button.edit_mode = !edit_button.edit_mode;
      edit_button.text(edit_button.edit_mode ? __("Save") : __("Edit"));
      more_actions_wrapper.toggle(!edit_button.edit_mode);
      dismiss_button.toggle(edit_button.edit_mode);
      edit_wrapper.toggle(edit_button.edit_mode);
      content_wrapper.toggle(!edit_button.edit_mode);
    };
    let actions_wrapper = comment_wrapper.find(".custom-actions");
    actions_wrapper.append(edit_button);
    actions_wrapper.append(dismiss_button);
  }

  make_editable(container) {
    return frappe.ui.form.make_control({
      parent: container,
      df: {
        fieldtype: "Comment",
        fieldname: "comment",
        label: "Comment",
      },
      enable_mentions: true,
      render_input: true,
      only_input: true,
      no_wrapper: true,
    });
  }

  update_comment(name, content) {
    return frappe
      .xcall("frappe.desk.form.utils.update_comment", { name, content })
      .then(() => {
        frappe.utils.play_sound("click");
      });
  }

  get_last_email(from_recipient) {
    let last_email = null;
    let communications = this.frm.get_docinfo().communications || [];
    let email = this.get_recipient();
    // REDESIGN TODO: What is this? Check again
    communications
      .sort((a, b) => (a.creation > b.creation ? -1 : 1))
      .forEach((c) => {
        if (
          c.communication_type === "Communication" &&
          c.communication_medium === "Email"
        ) {
          if (from_recipient) {
            if (c.sender.indexOf(email) !== -1) {
              last_email = c;
              return false;
            }
          } else {
            last_email = c;
            return false;
          }
        }
      });

    return last_email;
  }

  delete_comment(comment_name) {
    frappe.confirm(__("Delete comment?"), () => {
      return frappe
        .xcall("frappe.client.delete", {
          doctype: "Comment",
          name: comment_name,
        })
        .then(() => {
          frappe.utils.play_sound("delete");
        });
    });
  }

  copy_link(ev) {
    let doc_link = frappe.urllib.get_full_url(
      frappe.utils.get_form_link(this.frm.doctype, this.frm.docname)
    );
    let element_id = $(ev.currentTarget)
      .closest(".timeline-content")
      .attr("id");
    frappe.utils.copy_to_clipboard(`${doc_link}#${element_id}`);
  }
}

export default FormTimeline;
