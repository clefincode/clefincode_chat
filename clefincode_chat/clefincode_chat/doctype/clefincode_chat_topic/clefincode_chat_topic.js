// Copyright (c) 2023, Ahmad Kamaleddin and contributors
// For license information, please see license.txt

frappe.ui.form.on('ClefinCode Chat Topic', {
	after_save(frm) {
		const topicName = frm.doc.name;
		if (!topicName) return;

		$(".chat-space").each(function () {
			const chatSpace = $(this).data("chat-space-instance");
			if (chatSpace && chatSpace.refreshTopicColor) {
				chatSpace.refreshTopicColor(topicName);
			}
		});
	},

	refresh(frm) {
		if (frm.is_new()) return;

		frm.add_custom_button(__("Open Chat"), async () => {
			const openFn = window.CiCOpenTopicChatWindowFromContext;

			if (typeof openFn !== "function") {
				frappe.msgprint({
					title: __("Error"),
					message: __("Topic chat opener is not available."),
					indicator: "red"
				});
				return;
			}

			await openFn({
				chat_topic: frm.doc.name,
				chat_topic_subject: frm.doc.subject || frm.doc.name,
				topic_color: frm.doc.topic_color || null
			});
		});
	}
});
