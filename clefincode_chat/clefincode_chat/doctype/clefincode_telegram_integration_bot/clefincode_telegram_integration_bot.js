// Copyright (c) 2025, ClefinCode L.L.C-FZ and contributors
// For license information, please see license.txt

frappe.ui.form.on('ClefinCode Telegram Integration Bot', {
    refresh(frm) {
        frm.add_custom_button('Set Telegram Webhook', function() {
            frappe.call({
                method: 'clefincode_chat.webhook.set_telegram_webhook',
                args: {
                    integration_name: frm.doc.name
                },
                callback: function(r) {
                    frappe.msgprint('Telegram webhook registered successfully.');
                    frm.reload_doc();
                },
                error: function(err) {
                    frappe.msgprint('Telegram webhook setup failed.');
                    frm.reload_doc();
                }
            });
        });

        // frm.add_custom_button('Reset Webhook Flag', function() {
        //     frm.set_value('webhook_registered', 0);
        //     frm.set_value('last_webhook_status', 'Webhook flag reset manually.');
        //     frm.save();
        // });
    }
});