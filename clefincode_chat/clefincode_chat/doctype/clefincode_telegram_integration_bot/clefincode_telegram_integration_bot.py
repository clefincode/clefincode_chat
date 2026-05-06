import frappe
from frappe.model.document import Document


class ClefinCodeTelegramIntegrationBot(Document):
    def on_update(self):
        if not self.access_token:
            self.db_set("webhook_registered", 0, update_modified=False)
            self.db_set("last_webhook_status", "Access token is missing.", update_modified=False)
            return

        if self.webhook_registered:
            return

        try:
            from clefincode_chat.webhook import set_telegram_webhook
            set_telegram_webhook(self.name)

            self.db_set("webhook_registered", 1, update_modified=False)
            self.db_set("last_webhook_status", "Webhook registered successfully.", update_modified=False)

        except Exception as e:
            frappe.log_error(frappe.get_traceback(), "Telegram Webhook Setup Error")
            self.db_set("webhook_registered", 0, update_modified=False)
            self.db_set("last_webhook_status", str(e), update_modified=False)
            frappe.msgprint(f"Telegram webhook setup failed: {str(e)}")