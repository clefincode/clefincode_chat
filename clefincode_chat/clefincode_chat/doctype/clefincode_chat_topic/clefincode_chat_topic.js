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
	}
});
