// Copyright (c) 2023, Ahmad Kamaleddin and contributors
// For license information, please see license.txt

frappe.ui.form.on("ClefinCode Chat Topic", {
    after_save(frm) {
        const topicName = frm.doc.name;
        if (!topicName) return;

        if (window.CC_AI_DEBUG === true) {
            console.info("[CC AI][topic.saved]", {
                chat_topic: topicName,
                chat_channel: frm.doc.chat_channel,
                is_private: Boolean(frm.doc.is_private),
            });
        }
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
                    indicator: "red",
                });
                return;
            }

            const context = {
                chat_topic: frm.doc.name,
                chat_topic_subject: frm.doc.subject || frm.doc.name,
                topic_color: frm.doc.topic_color || null,
            };
            if (window.CC_AI_DEBUG === true) {
                console.info("[CC AI][topic.open.input]", {
                    ...context,
                    chat_channel: frm.doc.chat_channel,
                });
            }
            try {
                const response = await openFn(context);
                if (window.CC_AI_DEBUG === true) {
                    console.info("[CC AI][topic.open.output]", {
                        chat_topic: context.chat_topic,
                        result: response === undefined ? "completed" : response,
                    });
                }
            } catch (error) {
                console.error("[CC AI][topic.open.error]", error);
                frappe.msgprint({
                    title: __("Error"),
                    message: __("Failed to open topic chat."),
                    indicator: "red",
                });
            }
        });
    },
});
