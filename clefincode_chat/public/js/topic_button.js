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

	function get_email_button(frm) {
		const wrapper = $(frm.page.wrapper);

		return wrapper.find("button").filter(function () {
			const txt = $(this).text().trim();
			return (
				txt.includes("New Email") ||
				txt.includes("Email") 
				
			);
		}).first();
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

		const wrapper = $(frm.page.wrapper);
		const email_btn = get_email_button(frm);

		if (!email_btn.length) return;

		wrapper.find(".custom-topic-chat-btn").remove();

		const btn = $(`
			<button type="button" class="btn btn-xs btn-secondary-dark action-btn custom-topic-chat-btn">
				
				<span>${__("Link to Chat")}</span>
			</button>
		`);

		btn.on("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			open_forward_like_picker(frm);
		});

		email_btn.after(btn);
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
		method: "clefincode_chat.api.api_1_3_3.api.check_if_contact_has_chat",
		args: {
			user_email: frappe.session.user,
			contact: contact_email,
			platform: "Chat"
		}
	});


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
		method: "clefincode_chat.api.api_1_3_3.api.create_channel",
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
		method: "clefincode_chat.api.api_1_3_3.api.get_topic_info",
		args: {
			chat_channel: room
		}
	});

	const topicRow = topicInfo.message?.results?.[0] || null;
	const existing_topic = topicRow?.chat_topic || null;

	const current_ref = {
		doctype: frm.doctype,
		docname: frm.doc.name
	};

	const mention_doctypes = JSON.stringify([current_ref]);

	
	if (!existing_topic) {
		const createdTopic = await frappe.call({
			method: "clefincode_chat.api.api_1_3_3.api.create_chat_topic_with_message",
			args: {
				mention_doctypes,
				chat_channel: room,
				user_email: frappe.session.user,
				user_name: frappe.session.user_fullname || frappe.session.user
			}
		});

		return {
			room,
			chat_topic:
				createdTopic.message?.results?.[0]?.name ||
				createdTopic.message?.name ||
				null,
			mode: "created"
		};
	}

	const refs = get_topic_references(topicRow);
	

	const same_doc_exists = refs.some((ref) => {
		return ref.doctype === frm.doctype && ref.docname === frm.doc.name;
	});

	
	if (same_doc_exists) {
		return {
			room,
			chat_topic: existing_topic,
			mode: "already_linked"
		};
	}

	
	if (refs.length > 0) {
		const action = await ask_topic_conflict_action(refs);

		if (action === "cancel") {
			return {
				room,
				chat_topic: existing_topic,
				mode: "cancelled"
			};
		}

		if (action === "append") {
				await frappe.call({
					method: "clefincode_chat.api.api_1_3_3.api.add_reference_doctype_with_message",
					args: {
						mention_doctypes,
						chat_topic: existing_topic,
						chat_channel: room,
						user_email: frappe.session.user,
						user_name: frappe.session.user_fullname || frappe.session.user
					}
				});

				return {
					room,
					chat_topic: existing_topic,
					mode: "attached"
				};
			}

		if (action === "replace") {
				const replaced = await replace_topic_references(existing_topic, room, current_ref);

				return {
					room,
					chat_topic: replaced.chat_topic || existing_topic,
					old_chat_topic: replaced.old_chat_topic || existing_topic,
					mode: "replaced"
				};
			}
	}

	// fallback
	await frappe.call({
		method: "clefincode_chat.api.api_1_3_3.api.add_reference_doctype",
		args: {
			mention_doctypes,
			chat_topic: existing_topic
		}
	});

	return {
		room,
		chat_topic: existing_topic,
		mode: "attached"
	};
}
async function link_doc_to_selected_target(frm, target) {
	console.log("Selected target object:", target);

	const room = await ensure_room_from_target(target);
	const result = await link_current_doc_to_room(frm, room);

	if (result.mode === "cancelled") {
		return result;
	}

	const messages = {
			created: __("Document linked and new chat topic created"),
			attached: __("Document added to existing chat topic"),
			already_linked: __("This document is already linked. Opening chat only."),
			replaced: __("Old topic closed and a new topic was created for this document")
		};

	frappe.msgprint({
		title: __("Success"),
		message: messages[result.mode] || __("Done"),
		indicator: "green"
	});

	

	return result;
}
function extract_topic_references(topicRow) {
	

	if (!topicRow) return [];


	if (Array.isArray(topicRow.reference_doctypes)) {
		return topicRow.reference_doctypes.map(ref => ({
			doctype: ref.doctype || ref.reference_doctype,
			docname: ref.docname || ref.reference_name
		})).filter(ref => ref.doctype && ref.docname);
	}

	if (topicRow.mention_doctypes) {
		try {
			const parsed = JSON.parse(topicRow.mention_doctypes);
			if (Array.isArray(parsed)) {
				return parsed.map(ref => ({
					doctype: ref.doctype,
					docname: ref.docname
				})).filter(ref => ref.doctype && ref.docname);
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

function ask_topic_conflict_action(existing_refs) {
	return new Promise((resolve) => {
		let settled = false;

		const finish = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		const refs_text = existing_refs
			.map(ref => `${frappe.utils.escape_html(ref.doctype)} / ${frappe.utils.escape_html(ref.docname)}`)
			.join("<br>");

		const d = new frappe.ui.Dialog({
			title: __("Chat already linked"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "message",
					options: `
						<div style="padding: 8px 0;">
							<div style="margin-bottom: 8px;">
								${__("This chat already has another topic/document:")}
							</div>
							<div class="text-muted">${refs_text}</div>
							<div style="margin-top: 12px;">
								${__("Choose what you want to do")}
							</div>
						</div>
					`
				}
			],
			primary_action_label: __("Add Current Topic"),
			primary_action() {
				finish("append");
				d.hide();
			}
		});

		d.show();

		const $replace_btn = $(`
			<button class="btn btn-secondary btn-sm" style="margin-right: 8px;">
				${__("Close and Start New")}
			</button>
		`);

	
		const $cancel_btn = $(`
			<button class="btn btn-default btn-sm">
				${__("Cancel")}
			</button>
		`);

		$replace_btn.on("click", () => {
			finish("replace");
			d.hide();
		});

		$cancel_btn.on("click", () => {
			finish("cancel");
			d.hide();
		});

	
		const $footer = d.$wrapper.find(".modal-footer");
						$footer.append($replace_btn);
						$footer.append($cancel_btn);

		
		d.$wrapper.on("hidden.bs.modal", () => {
			finish("cancel");
		});
	});
}
async function replace_topic_references(chat_topic, chat_channel, current_ref) {
	const r = await frappe.call({
		method: "clefincode_chat.api.api_1_3_3.api.replace_topic_references",
		args: {
			chat_topic,
			chat_channel,
			user_email: frappe.session.user,
			user_name: frappe.session.user_fullname || frappe.session.user,
			mention_doctypes: JSON.stringify([
				{
					doctype: current_ref.doctype,
					docname: current_ref.docname
				}
			])
		}
	});

	return r.message?.results?.[0] || r.message || {};
}
function get_topic_references(topicRow) {
	console.log(topicRow);
	if (!topicRow) return [];


	if (Array.isArray(topicRow.reference_doctypes)) {
		console.log("dsds");
		return topicRow.reference_doctypes.map((r) => ({
			doctype: r.doctype,
			docname: r.docname,
		
		})).filter(r => r.doctype && r.docname);
	}


	if (typeof topicRow.reference_doctypes === "string" && topicRow.reference_doctypes.trim()) {
		try {
			const parsed = JSON.parse(topicRow.reference_doctypes);
			if (Array.isArray(parsed)) {
				return parsed.map((r) => ({
					doctype: r.doctype_link,
					docname: r.docname,
					active: cint(r.active || 0)
				})).filter(r => r.doctype && r.docname);
			}
		} catch (e) {
			console.warn("Failed to parse references", e);
		}
	}

	return [];
}

function cint(value) {
	return parseInt(value || 0, 10);
}