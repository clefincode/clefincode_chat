"""Run on each event."""
import frappe
from frappe.core.doctype.server_script.server_script_utils import EVENT_MAP

# Extend Frappe's standard events with our custom one
CUSTOM_EVENT_MAP = {
    "on_value_change": "Value Change",   # Must match your DocType "doctype_event" option
    **EVENT_MAP
}

def run_server_script_for_doc_event(doc, event):
    """Run on each event."""
    if event not in CUSTOM_EVENT_MAP:
        return

    if frappe.flags.in_install or frappe.flags.in_migrate or frappe.flags.in_uninstall:
        return

    # --- CUSTOM EVENT HANDLER: on_value_change ---
    if event == "validate" and not doc.is_new():
        try:
            old_doc = frappe.get_doc(doc.doctype, doc.name)

            # Fetch notifications mapped for this DocType and "Value Change" event
            vc_notifications = get_notifications_map().get(doc.doctype, {}).get("Value Change", [])

            for notif_name in vc_notifications:
                notif = frappe.get_doc("Clefincode Notification", notif_name)

                # The tracked field is stored here:
                tracked_field = notif.value_changed

                if not tracked_field:
                    continue

                old_value = old_doc.get(tracked_field)
                new_value = doc.get(tracked_field)

                # Only trigger if this exact field changed
                if old_value != new_value:
                    run_server_script_for_doc_event(doc, "on_value_change")
                    break

        except Exception:
            frappe.log_error(frappe.get_traceback(), "Error checking value change event")

    # Run notifications for the current event
    event_key = CUSTOM_EVENT_MAP[event]
    notifications = get_notifications_map().get(doc.doctype, {}).get(event_key, [])

    for notification_name in notifications:
        frappe.get_doc("Clefincode Notification", notification_name).send_template_message(doc)


def get_notifications_map():
    """Build mapping of Doctype → Event → [Notifications]."""
    if frappe.flags.in_patch and not frappe.db.table_exists("Clefincode Notification"):
        return {}

    notification_map = {}
    notifications = frappe.get_all(
        "Clefincode Notification",
        fields=("name", "reference_doctype", "doctype_event", "notification_type"),
        filters={"disabled": 0},
    )

    for notif in notifications:
        if notif.notification_type == "DocType Event":
            notification_map \
                .setdefault(notif.reference_doctype, {}) \
                .setdefault(notif.doctype_event, []) \
                .append(notif.name)

    frappe.cache().set_value("whatsapp_notification_map", notification_map)
    return notification_map


# Scheduled Task Triggers
def trigger_whatsapp_notifications_all(): trigger_whatsapp_notifications("All")
def trigger_whatsapp_notifications_hourly(): trigger_whatsapp_notifications("Hourly")
def trigger_whatsapp_notifications_daily(): trigger_whatsapp_notifications("Daily")
def trigger_whatsapp_notifications_weekly(): trigger_whatsapp_notifications("Weekly")
def trigger_whatsapp_notifications_monthly(): trigger_whatsapp_notifications("Monthly")
def trigger_whatsapp_notifications_yearly(): trigger_whatsapp_notifications("Yearly")
def trigger_whatsapp_notifications_hourly_long(): trigger_whatsapp_notifications("Hourly Long")
def trigger_whatsapp_notifications_daily_long(): trigger_whatsapp_notifications("Daily Long")
def trigger_whatsapp_notifications_weekly_long(): trigger_whatsapp_notifications("Weekly Long")
def trigger_whatsapp_notifications_monthly_long(): trigger_whatsapp_notifications("Monthly Long")


def trigger_whatsapp_notifications(event):
    """Run scheduled frequency-based notifications."""
    notify_list = frappe.get_list(
        "Clefincode Notification",
        filters={"event_frequency": event, "disabled": 0}
    )

    for entry in notify_list:
        frappe.get_doc("Clefincode Notification", entry.name).send_scheduled_message()
