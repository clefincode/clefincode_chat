console.log("topic_button.js loaded");

(function () {
	if (window.__cc_topic_picker_patch_applied) return;
	window.__cc_topic_picker_patch_applied = true;

	const original_refresh = frappe.ui.form.Form.prototype.refresh;

	frappe.ui.form.Form.prototype.refresh = function (...args) {
		const result = original_refresh.apply(this, args);

		setTimeout(() => {
			try {
				add_topic_chat_button(this);
			} catch (e) {
				console.error("topic button error:", e);
			}
		}, 1000);

		return result;
	};

	function get_action_buttons_container(frm) {
		if (frm.timeline && frm.timeline.timeline_actions_wrapper) {
			return frm.timeline.timeline_actions_wrapper.find(".action-buttons");
		}
		return $(frm.page.wrapper).find(".timeline-actions .action-buttons").first();
	}

	function get_chat_profile() {
		return {
			user: frappe.session.user_fullname || frappe.session.user,
			user_email: frappe.session.user,
			is_admin: frappe.user.has_role("System Manager"),
			time_zone: frappe.boot.time_zone?.system || frappe.boot.time_zone?.user || "UTC",
			user_type: frappe.boot.user?.user_type,
			is_limited_user: frappe.boot.user?.is_limited_user
		};
	}

	function add_topic_chat_button(frm) {
		if (!frm || !frm.page || !frm.doc) return;
		if (frappe.session.user === "Administrator") return;

		const container = get_action_buttons_container(frm);
		if (!container.length) return;

		container.find(".custom-topic-chat-btn").remove();

		const btn = $(`
			<button type="button" class="btn btn-xs btn-secondary-dark action-btn custom-topic-chat-btn">
				<span>${__("Open Topic")}</span>
			</button>
		`);

		btn.on("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			open_forward_like_picker(frm);
		});

		container.append(btn);
	}

	async function open_forward_like_picker(frm) {
		if (!window.CCChatContactList) {
			frappe.msgprint({
				title: __("Error"),
				message: __("CCChatContactList is not available"),
				indicator: "red"
			});
			return;
		}

		const d = new frappe.ui.Dialog({
			title: __("Link Topic to Chat"),
			size: "large",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "picker_html"
				}
			],
			primary_action_label: __("Close"),
			primary_action() {
				d.hide();
			}
		});

		d.show();

		const $mount = $('<div class="cc-topic-picker-mount"></div>');
		d.fields_dict.picker_html.$wrapper.empty().append($mount);

		const contactList = new window.CCChatContactList({
			$wrapper: $mount,
			profile: get_chat_profile(),
			topic_picker: 1,
			on_select: async (target) => {
				await link_doc_to_selected_target(frm, target);
				d.hide();
			},
			on_cancel: () => {
				d.hide();
			}
		});

		if (contactList.ready) {
			await contactList.ready;
		}

		contactList.forward_message = async function () {
			if (!this.selected_contacts || !this.selected_contacts.length) {
				frappe.msgprint({
					title: __("Selection Required"),
					message: __("Select one chat or contact first."),
					indicator: "orange"
				});
				return;
			}

			if (this.selected_contacts.length > 1) {
				frappe.msgprint({
					title: __("Only one target allowed"),
					message: __("Please select only one chat or contact."),
					indicator: "orange"
				});
				return;
			}

			try {
				const target = this.selected_contacts[0];
				await link_doc_to_selected_target(frm, target);
				d.hide();
			} catch (e) {
				console.error("Linking failed:", e);
				frappe.msgprint({
					title: __("Error"),
					message: e.message || __("Failed to link document to chat"),
					indicator: "red"
				});
			}
		};

		contactList.render();

		d.$wrapper.on("hidden.bs.modal", function () {
			$mount.empty();
		});
	}
})();

async function ensure_room_from_target(target) {
	if (target.type === "room") {
		return target.room || target.name;
	}

	const contact_email =
		target.email ||
		target.user_email ||
		target.contact ||
		target.name;

	if (!contact_email) {
		throw new Error("Selected contact has no email");
	}

	const check = await frappe.call({
		method: "clefincode_chat.api.api_1_3_4.api.check_if_contact_has_chat",
		args: {
			user_email: frappe.session.user,
			contact: contact_email,
			platform: "Chat"
		}
	});
	console.log(check);

	const existing_room =
		check.message?.results?.name &&
		check.message.results.name !== frappe.session.user
			? check.message.results.name
			: null;

	if (existing_room) {
		return existing_room;
	}

	const users = JSON.stringify([
		{ email: frappe.session.user, platform: "Chat" },
		{ email: contact_email, platform: "Chat" }
	]);

	const created = await frappe.call({
		method: "clefincode_chat.api.api_1_3_4.api.create_channel",
		args: {
			channel_name: target.full_name || target.name || contact_email,
			users,
			type: "Direct",
			last_message: "",
			creator_email: frappe.session.user,
			creator: frappe.session.user_fullname || frappe.session.user
		}
	});

	const room =
		created.message?.results?.[0]?.room ||
		created.message?.room ||
		created.message?.name;

	if (!room) {
		throw new Error("Could not create direct chat room");
	}

	return room;
}

async function link_current_doc_to_room(frm, room) {
	const topicInfo = await frappe.call({
		method: "clefincode_chat.api.api_1_3_4.api.get_topic_info",
		args: {
			chat_channel: room
		}
	});

	const topicRow = topicInfo.message?.results?.[0] || null;
	const existing_topic = topicRow?.chat_topic || null;

	const current_ref = build_current_doc_reference(frm);
	const mention_doctypes = JSON.stringify([current_ref]);

	if (!existing_topic) {
		const createdTopic = await frappe.call({
			method: "clefincode_chat.api.api_1_3_4.api.create_chat_topic_with_message",
			args: {
				mention_doctypes,
				chat_channel: room,
				user_email: frappe.session.user,
				user_name: frappe.session.user_fullname || frappe.session.user
			}
		});

		const createdRow = createdTopic.message?.results?.[0] || createdTopic.message || {};

		const new_chat_topic =
			createdRow.chat_topic ||
			createdRow.name ||
			null;

		if (!new_chat_topic) {
			throw new Error("Topic was created but chat_topic was not returned");
		}

		const new_chat_topic_subject =
			createdRow.chat_topic_subject ||
			createdRow.subject ||
			new_chat_topic;

		return {
			room,
			chat_topic: new_chat_topic,
			chat_topic_subject: new_chat_topic_subject,
			mode: "created"
		};
	}

	const refs = get_topic_references(topicRow);

	const same_doc_exists = refs.some((ref) => {
		return ref.doctype === frm.doctype && ref.docname === frm.doc.name;
	});

	if (same_doc_exists) {
		const existing_subject =
			topicRow?.chat_topic_subject ||
			topicRow?.subject ||
			existing_topic;

		return {
			room,
			chat_topic: existing_topic,
			chat_topic_subject: existing_subject,
			mode: "already_linked"
		};
	}

	const selectedTopic = await pick_topic_for_room(room, {
		showTopActions: true,
		compact: true,
		frm
	});

	if (!selectedTopic) {
		return {
			room,
			chat_topic: existing_topic,
			mode: "cancelled"
		};
	}

	const selectedTopicName = selectedTopic.chat_topic || selectedTopic.name;

	if (!selectedTopicName) {
		throw new Error("Selected topic has no name");
	}

	await frappe.call({
	method: "clefincode_chat.api.api_1_3_4.api.add_reference_doctype",
	args: {
		mention_doctypes,
		chat_topic: selectedTopicName
	}
});

	return {
		room,
		chat_topic: selectedTopicName,
		chat_topic_subject:
			selectedTopic.chat_topic_subject ||
			selectedTopic.subject ||
			selectedTopicName,
		mode: selectedTopic.mode === "created" ? "created" : "attached"
	};
}

async function link_doc_to_selected_target(frm, target) {
	console.log("Selected target object:", target);

	const room = await ensure_room_from_target(target);
	const result = await link_current_doc_to_room(frm, room);

	if (result.mode === "cancelled") {
		return result;
	}

	ensure_chat_widget_open();

	const messages = {
		created: __("Document linked and new chat topic created"),
		attached: __("Document added to existing chat topic"),
		already_linked: __("This document is already linked"),
		replaced: __("Old topic closed and a new topic was created for this document")
	};

	open_chat_room({
		is_admin: frappe.user.has_role("System Manager"),
		user: frappe.session.user_fullname || frappe.session.user,
		user_email: frappe.session.user,
		time_zone: frappe.boot.time_zone?.system || frappe.boot.time_zone?.user || "UTC",
		user_type: frappe.boot.user?.user_type,
		is_limited_user: frappe.boot.user?.is_limited_user,
		room: result.room,
		room_name:
			result.chat_topic_subject ||
			target.room_name ||
			target.channel_name ||
			target.full_name ||
			target.name ||
			result.room,
		room_type: target.type === "contact" ? "Direct" : (target.room_type || "Group"),
		contact: target.type === "contact" ? (target.name || target.email) : null,
		is_first_message: 0,
		platform: target.raw?.platform || "Chat",
		chat_topic: result.chat_topic || null,
		chat_topic_subject: result.chat_topic_subject || null
	});

	frappe.show_alert({
		message: messages[result.mode] || __("Done"),
		indicator: "green"
	});

	return result;
}

function get_topic_references(topicRow) {
	console.log(topicRow);

	if (!topicRow) return [];

	if (Array.isArray(topicRow.reference_doctypes)) {
		return topicRow.reference_doctypes.map((r) => ({
			doctype: r.doctype,
			docname: r.docname
		})).filter(r => r.doctype && r.docname);
	}

	if (typeof topicRow.reference_doctypes === "string" && topicRow.reference_doctypes.trim()) {
		try {
			const parsed = JSON.parse(topicRow.reference_doctypes);
			if (Array.isArray(parsed)) {
				return parsed.map((r) => ({
					doctype: r.doctype_link || r.doctype,
					docname: r.docname,
					active: cint(r.active || 0)
				})).filter(r => r.doctype && r.docname);
			}
		} catch (e) {
			console.warn("Failed to parse references", e);
		}
	}

	if (topicRow.mention_doctypes) {
		try {
			const parsed = JSON.parse(topicRow.mention_doctypes);
			if (Array.isArray(parsed)) {
				return parsed.map((r) => ({
					doctype: r.doctype,
					docname: r.docname
				})).filter(r => r.doctype && r.docname);
			}
		} catch (e) {
			console.warn("Could not parse mention_doctypes", e);
		}
	}

	if (topicRow.reference_doctype && topicRow.reference_name) {
		return [{
			doctype: topicRow.reference_doctype,
			docname: topicRow.reference_name
		}];
	}

	return [];
}

function cint(value) {
	return parseInt(value || 0, 10);
}

function build_current_doc_reference(frm) {
	const doctypeSlug = frappe.router?.slug
		? frappe.router.slug(frm.doctype)
		: frm.doctype.replace(/\s+/g, "-").toLowerCase();

	const route = `/app/${doctypeSlug}/${encodeURIComponent(frm.doc.name)}`;
	const absolute_url = `${window.location.origin}${route}`;

	return {
		doctype: frm.doctype,
		docname: frm.doc.name,

		// Keep old names for backend compatibility
		reference_doctype: frm.doctype,
		reference_name: frm.doc.name,

		// Link fields
		route,
		link: route,
		reference_link: route,
		url: absolute_url,

		// Display fields
		label: `${frm.doctype} / ${frm.doc.name}`,
		title: frm.doc.title || frm.doc.subject || frm.doc.name
	};
}

async function replace_topic_references(chat_topic, chat_channel, current_ref) {
	const r = await frappe.call({
		method: "clefincode_chat.api.api_1_3_4.api.replace_topic_references",
		args: {
			chat_topic,
			chat_channel,
			user_email: frappe.session.user,
			user_name: frappe.session.user_fullname || frappe.session.user,
			mention_doctypes: JSON.stringify([current_ref])
		}
	});

	return r.message?.results?.[0] || r.message || {};
}

function ensure_chat_widget_open() {
	const app = window.erpnext_chat_app;
	if (!app) return false;

	if (typeof app.show_chat_widget === "function") {
		app.show_chat_widget();
		return true;
	}

	if (app.$chat_element?.length) {
		app.$chat_element.show();
	}

	if (app.$chat_bubble?.length) {
		app.$chat_bubble.hide();
	}

	return true;
}

async function pick_topic_for_room(room, opts = {}) {
	if (!window.CCOpenChannelTopicPicker) {
		frappe.msgprint({
			title: __("Error"),
			message: __("Topic picker is not available."),
			indicator: "red"
		});
		return null;
	}

	let externalResolve;

	const externalAction = new Promise((resolve) => {
		externalResolve = resolve;
	});

	const pickerPromise = window.CCOpenChannelTopicPicker({
		chatChannel: room,
		topicStatus: "Open",
		title: __("Select Topic"),
		selectLabel: __("Select"),
		showAddNew: false
	});

	if (opts.showTopActions || opts.compact) {
		decorate_open_topic_picker_dialog(externalResolve, opts, {
			chatChannel: room,
			frm: opts.frm || null
		});
	}

	return await Promise.race([pickerPromise, externalAction]);
}

async function prompt_create_new_topic_from_picker({
	chatChannel,
	frm = null,
	afterCreate,
	parentModal = null
}) {
	if (!chatChannel) {
		frappe.msgprint({
			title: __("Error"),
			message: __("No chat channel provided."),
			indicator: "red"
		});
		return;
	}

	const currentDoctype = frm?.doctype || "";
	const currentDocname = frm?.doc?.name || "";

	if (!currentDoctype || !currentDocname) {
		frappe.msgprint({
			title: __("Missing document"),
			message: __("Could not detect the current document."),
			indicator: "red"
		});
		return;
	}

	const createDialog = new frappe.ui.Dialog({
		title: __("Add New Topic"),
		fields: [
			{
				label: __("Subject"),
				fieldname: "subject",
				fieldtype: "Data"
			},
			{
				label: __("DocType"),
				fieldname: "reference_doctype",
				fieldtype: "Data",
				default: currentDoctype,
				read_only: 1
			},
			{
				label: __("Document"),
				fieldname: "reference_docname",
				fieldtype: "Data",
				default: currentDocname,
				read_only: 1
			}
		],
		primary_action_label: __("Create"),
		primary_action: async (values) => {
			try {
				const subject = (values.subject || "").trim();

				const referenceDoctype = currentDoctype;
				const referenceDocname = currentDocname;

				const finalSubject = subject || `${referenceDoctype}:${referenceDocname}`;

				const mention_doctypes = JSON.stringify([
					{
						doctype: referenceDoctype,
						docname: referenceDocname
					}
				]);

				const r = await frappe.call({
					method: "clefincode_chat.api.api_1_3_4.api.create_chat_topic",
					args: {
						mention_doctypes,
						chat_channel: chatChannel,
						subject: finalSubject
					}
				});

				const created = r.message?.results?.[0] || r.message || {};
				const topicName = created.chat_topic || created.name;

				if (!topicName) {
					throw new Error("Topic name missing after creation");
				}

				const topicSubject =
					created.chat_topic_subject ||
					created.subject ||
					finalSubject;

				const topicColor =
					created.topic_color ||
					created.chat_topic_color ||
					created.color ||
					null;

				const createdTopic = {
					name: topicName,
					chat_topic: topicName,
					subject: topicSubject,
					chat_topic_subject: topicSubject,
					topic_color: topicColor,
					color: topicColor,
					reference_doctype: referenceDoctype,
					reference_docname: referenceDocname,
					mode: "created"
				};

				createDialog.hide();

				if (parentModal) {
					parentModal.modal("hide");
				}

				if (typeof afterCreate === "function") {
					await afterCreate(createdTopic);
				}
			} catch (e) {
				console.error("Failed to create topic", e);
				frappe.msgprint({
					title: __("Error"),
					message: __("Failed to create topic"),
					indicator: "red"
				});
			}
		}
	});

	createDialog.show();
}

function decorate_open_topic_picker_dialog(resolve, opts = {}, context = {}) {
	let tries = 0;
	const maxTries = 80;

	const timer = setInterval(() => {
		tries += 1;

		const $modal = $(".modal.show").filter(function () {
			return $(this).find(".modal-title").text().trim() === __("Select Topic");
		}).last();

		if (!$modal.length) {
			if (tries >= maxTries) {
				clearInterval(timer);
			}
			return;
		}

		clearInterval(timer);

		$modal.addClass("cc-open-topic-picker-modal");

		if (opts.compact) {
			$modal.find(".modal-dialog").css({
				"max-width": "560px",
				"width": "560px"
			});
		}

		if ($modal.find(".cc-topic-picker-top-actions").length) {
			return;
		}

		const $topActions = $(`
			<div class="cc-topic-picker-top-actions" style="
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 12px;
				padding: 10px 16px 0;
			">
				<div class="cc-topic-picker-left-actions" style="
					display: flex;
					align-items: center;
					gap: 8px;
				">
					<button type="button" class="btn btn-primary btn-sm cc-topic-picker-create-new">
						${__("Create New Topic")}
					</button>
				</div>

				<div class="cc-topic-picker-right-actions" style="
					display: flex;
					align-items: center;
					gap: 8px;
				">
					<button type="button" class="btn btn-default btn-sm cc-topic-picker-cancel">
						${__("Cancel")}
					</button>
				</div>
			</div>
		`);

		$modal.find(".modal-header").after($topActions);

		$topActions.find(".cc-topic-picker-cancel").on("click", () => {
			resolve(null);
			$modal.modal("hide");
		});

		$topActions.find(".cc-topic-picker-create-new").on("click", async () => {
			await prompt_create_new_topic_from_picker({
				chatChannel: context.chatChannel,
				frm: context.frm,
				parentModal: $modal,
				afterCreate: async (createdTopic) => {
					resolve(createdTopic);
				}
			});
		});

		$modal.one("hidden.bs.modal", () => {
			resolve(null);
		});
	}, 50);
}

function open_chat_room(profile, chat_status = null) {
	const app = window.erpnext_chat_app;

	if (!app || !window.CCChatWindow || !window.CCChatSpace || !window.CCCheckIfChatWindowOpen) {
		console.warn("Chat open dependencies are missing");
		return;
	}

	if (app.$chat_element?.length) {
		app.$chat_element.show();
	}

	const topicKey = profile.chat_topic || null;

	if (topicKey && window.CCCheckIfChatWindowOpen(topicKey, "topic")) {
		$(".expand-chat-window[data-id='" + topicKey + "']").click();
		return;
	}

	if (!topicKey && window.CCCheckIfChatWindowOpen(profile.room, "room")) {
		$(".expand-chat-window[data-id='" + profile.room + "']").click();
		return;
	}

	const chat_window = new window.CCChatWindow({
		profile: topicKey
			? { topic: topicKey }
			: { room: profile.room }
	});

	if (topicKey) {
		chat_window.$chat_window
			.attr("data-topic", topicKey)
			.data("topic", topicKey);
	}

	if (app.$chat_element?.length) {
		app.$chat_element.show();
	}

	const topicSubject =
		profile.chat_topic_subject ||
		profile.subject ||
		profile.room_name ||
		topicKey;

	if (topicKey) {
		profile.room_type = "Topic";
		profile.chat_topic = topicKey;
		profile.chat_topic_subject = topicSubject;
		profile.room_name = topicSubject;
	}

	const chatSpaceOpts = {
		$wrapper: chat_window.$chat_window,
		profile: profile,
		chat_status: chat_status
	};

	if (topicKey) {
		chatSpaceOpts.chat_topic = topicKey;
		chatSpaceOpts.chat_topic_channel = profile.room;
		chatSpaceOpts.chat_topic_subject = topicSubject;
		chatSpaceOpts.alternative_subject = topicSubject;
		chatSpaceOpts.topic_write_mode = true;
		chatSpaceOpts.is_topic_window = true;
	}

	new window.CCChatSpace(chatSpaceOpts);
}