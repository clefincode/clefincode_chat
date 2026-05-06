# clefincode_chat/utils/whatsapp_notification.py

import frappe

# ---------------------------------------------------------------------------
# High level event map
# ---------------------------------------------------------------------------

HIGH_LEVEL_EVENT_MAP = {
    "New": ["after_insert"],
    "Save": ["on_update"],
    "Submit": ["on_submit"],
    "Cancel": ["on_cancel"],
    "Method": ["method"],
    "Custom": ["custom"],
}


# ---------------------------------------------------------------------------
# Notification runner
# ---------------------------------------------------------------------------

def run_server_script_for_doc_event(doc, event):
    if frappe.flags.in_install or frappe.flags.in_migrate or frappe.flags.in_uninstall:
        return

    _ensure_patch()

    notifications_map = get_notifications_map().get(doc.doctype, {})

    frappe.logger().debug(
        f"[WhatsApp Notification] Event={event}, DocType={doc.doctype}, Name={doc.name}"
    )

    # -------------------------------------------------------------------
    # Change detection entry point
    # -------------------------------------------------------------------
    if event == "on_change":
        detect_value_changes(doc, event)
        detect_child_table_row_added(doc, event)
        detect_child_table_row_updated(doc, event)
        detect_child_table_row_removed(doc, event)
        detect_child_table_changed(doc, event)
        detect_child_table_change_value(doc, event)

    # -------------------------------------------------------------------
    # Standard document events
    # -------------------------------------------------------------------
    for high_event, low_event_list in HIGH_LEVEL_EVENT_MAP.items():
        if event in low_event_list:
            for notif_name in notifications_map.get(high_event, []):
                if high_event == "Save" and doc.docstatus == 1:
                    continue

                frappe.get_doc("Clefincode Notification", notif_name).send_template_message(doc)

    # -------------------------------------------------------------------
    # Value Change
    # -------------------------------------------------------------------
    if event == "on_value_change":
        for notif_name in notifications_map.get("Value Change", []):
            frappe.get_doc("Clefincode Notification", notif_name).send_template_message(doc)

    # -------------------------------------------------------------------
    # Child Table Row Added
    # -------------------------------------------------------------------
    if event == "on_child_table_row_added":
        for notif_name in notifications_map.get("Child Table Row Added", []):
            frappe.get_doc("Clefincode Notification", notif_name).send_template_message(doc)

    # -------------------------------------------------------------------
    # Child Table Row Updated
    # -------------------------------------------------------------------
    if event == "on_child_table_row_updated":
        for notif_name in notifications_map.get("Child Table Row Updated", []):
            frappe.get_doc("Clefincode Notification", notif_name).send_template_message(doc)

    # -------------------------------------------------------------------
    # Child Table Row Removed
    # -------------------------------------------------------------------
    if event == "on_child_table_row_removed":
        for notif_name in notifications_map.get("Child Table Row Removed", []):
            frappe.get_doc("Clefincode Notification", notif_name).send_template_message(doc)

    # -------------------------------------------------------------------
    # Child Table Changed
    # -------------------------------------------------------------------
    if event == "on_child_table_changed":
        for notif_name in notifications_map.get("Child Table Changed", []):
            frappe.get_doc("Clefincode Notification", notif_name).send_template_message(doc)

    # -------------------------------------------------------------------
    # Child Table Change Value
    # -------------------------------------------------------------------
    if event == "on_child_table_change_value":
        for notif_name in notifications_map.get("Child Table Change Value", []):
            frappe.get_doc("Clefincode Notification", notif_name).send_template_message(doc)


# ---------------------------------------------------------------------------
# Notification map
# ---------------------------------------------------------------------------

def get_notifications_map():
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
            event_key = (notif.doctype_event or "").strip()

            notification_map \
                .setdefault(notif.reference_doctype, {}) \
                .setdefault(event_key, []) \
                .append(notif.name)

    frappe.cache().set_value("whatsapp_notification_map", notification_map)
    return notification_map


# ---------------------------------------------------------------------------
# Scheduler triggers
# ---------------------------------------------------------------------------

def trigger_whatsapp_notifications_all():
    trigger_whatsapp_notifications("All")


def trigger_whatsapp_notifications_hourly():
    trigger_whatsapp_notifications("Hourly")


def trigger_whatsapp_notifications_daily():
    trigger_whatsapp_notifications("Daily")


def trigger_whatsapp_notifications_weekly():
    trigger_whatsapp_notifications("Weekly")


def trigger_whatsapp_notifications_monthly():
    trigger_whatsapp_notifications("Monthly")


def trigger_whatsapp_notifications_yearly():
    trigger_whatsapp_notifications("Yearly")


def trigger_whatsapp_notifications_hourly_long():
    trigger_whatsapp_notifications("Hourly Long")


def trigger_whatsapp_notifications_daily_long():
    trigger_whatsapp_notifications("Daily Long")


def trigger_whatsapp_notifications_weekly_long():
    trigger_whatsapp_notifications("Weekly Long")


def trigger_whatsapp_notifications_monthly_long():
    trigger_whatsapp_notifications("Monthly Long")


def trigger_whatsapp_notifications(event):
    notify_list = frappe.get_list(
        "Clefincode Notification",
        filters={"event_frequency": event, "disabled": 0}
    )

    for entry in notify_list:
        frappe.get_doc("Clefincode Notification", entry.name).send_scheduled_message()


# ---------------------------------------------------------------------------
# Snapshot capture
# ---------------------------------------------------------------------------

def capture_old_snapshot(doc, method=None):
    if doc.is_new():
        return

    try:
        old_doc = frappe.get_doc(doc.doctype, doc.name)
        doc._old_snapshot = old_doc.as_dict()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Value Change Snapshot Error")


# ---------------------------------------------------------------------------
# DB patch for frappe.db.set_value
# ---------------------------------------------------------------------------

_ORIGINAL_DB_SET_VALUE = frappe.db.set_value


def _patch_db_set_value_for_value_change():
    def wrapped_set_value(doctype, name, field=None, val=None, *args, **kwargs):
        if isinstance(field, dict):
            values_dict = field
        else:
            values_dict = {field: val}

        fields = list(values_dict.keys())

        notifications_map = get_notifications_map() or {}
        doctype_map = notifications_map.get(doctype, {})

        vc_notifications = doctype_map.get("Value Change", [])

        if not vc_notifications:
            return _ORIGINAL_DB_SET_VALUE(doctype, name, field, val, *args, **kwargs)

        try:
            old_values = frappe.db.get_value(doctype, name, fields, as_dict=True) or {}
        except Exception:
            old_values = {}

        result = _ORIGINAL_DB_SET_VALUE(doctype, name, field, val, *args, **kwargs)

        changed_fields = []
        for f in fields:
            if old_values.get(f) != values_dict.get(f):
                changed_fields.append(f)

        if not changed_fields:
            return result

        try:
            doc = frappe.get_doc(doctype, name)
            doc._old_snapshot = old_values or {}
            doc.run_method("on_change")
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Error in Value Change DB Patch")

        return result

    frappe.db.set_value = wrapped_set_value


def _ensure_patch():
    _patch_db_set_value_for_value_change()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_child_rows_map(rows):
    return {
        row.get("name"): row
        for row in (rows or [])
        if row.get("name")
    }


def normalize_child_row(row):
    if not row:
        return {}

    data = dict(row)

    for key in (
        "doctype",
        "parent",
        "parentfield",
        "parenttype",
        "idx",
        "owner",
        "creation",
        "modified",
        "modified_by",
    ):
        data.pop(key, None)

    return data


# ---------------------------------------------------------------------------
# Detect Value Change
# ---------------------------------------------------------------------------

def detect_value_changes(doc, method=None):
    if not hasattr(doc, "_old_snapshot"):
        return

    old = doc._old_snapshot or {}
    new = doc.as_dict()

    notifications_map = get_notifications_map().get(doc.doctype, {})
    vc_notifications = notifications_map.get("Value Change", [])

    for notif_name in vc_notifications:
        notif = frappe.get_doc("Clefincode Notification", notif_name)
        field = getattr(notif, "value_changed", None)

        if not field:
            continue

        old_value = old.get(field)
        new_value = new.get(field)

        if old_value != new_value:
            run_server_script_for_doc_event(doc, "on_value_change")
            break


# ---------------------------------------------------------------------------
# Queue helpers
# ---------------------------------------------------------------------------

def enqueue_notification_send(notification_name, doc):
    frappe.enqueue(
        method="clefincode_chat.utils.whatsapp_notification._execute_notification_send",
        queue="long",
        timeout=300,
        is_async=True,
        notification_name=notification_name,
        doc_doctype=doc.doctype,
        doc_name=doc.name,
    )


def _execute_notification_send(notification_name, doc_doctype, doc_name):
    try:
        notif = frappe.get_doc("Clefincode Notification", notification_name)
        doc = frappe.get_doc(doc_doctype, doc_name)
        notif.send_template_message(doc)
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            "WhatsApp Notification Queue Error"
        )


# ---------------------------------------------------------------------------
# Detect Child Table Row Added
# ---------------------------------------------------------------------------

def detect_child_table_row_added(doc, method=None):
    if not hasattr(doc, "_old_snapshot"):
        return

    old = doc._old_snapshot or {}
    new = doc.as_dict()

    notifications_map = get_notifications_map().get(doc.doctype, {})
    row_notifications = notifications_map.get("Child Table Row Added", [])

    if not row_notifications:
        return

    sent_rows = getattr(doc, "_sent_child_row_notifications", set())

    for notif_name in row_notifications:
        notif = frappe.get_doc("Clefincode Notification", notif_name)
        table_field = getattr(notif, "child_table_field", None)

        if not table_field:
            continue

        old_rows = old.get(table_field) or []
        new_rows = new.get(table_field) or []

        old_names = {r.get("name") for r in old_rows if r.get("name")}
        added_rows = [r for r in new_rows if r.get("name") and r.get("name") not in old_names]

        if not added_rows:
            continue

        for row in added_rows:
            row_key = f"{notif_name}:{table_field}:{row.get('name')}"

            if row_key in sent_rows:
                continue

            sent_rows.add(row_key)
            doc._sent_child_row_notifications = sent_rows

            doc._added_child_row = row
            doc._added_child_table_field = table_field

            run_server_script_for_doc_event(doc, "on_child_table_row_added")
            break


# ---------------------------------------------------------------------------
# Detect Child Table Row Updated
# ---------------------------------------------------------------------------

def detect_child_table_row_updated(doc, method=None):
    if not hasattr(doc, "_old_snapshot"):
        return

    old = doc._old_snapshot or {}
    new = doc.as_dict()

    notifications_map = get_notifications_map().get(doc.doctype, {})
    row_notifications = notifications_map.get("Child Table Row Updated", [])

    if not row_notifications:
        return

    sent_rows = getattr(doc, "_sent_child_row_updated_notifications", set())

    for notif_name in row_notifications:
        notif = frappe.get_doc("Clefincode Notification", notif_name)
        table_field = getattr(notif, "child_table_field", None)

        if not table_field:
            continue

        old_map = get_child_rows_map(old.get(table_field) or [])
        new_map = get_child_rows_map(new.get(table_field) or [])

        updated_rows = []
        for row_name, new_row in new_map.items():
            old_row = old_map.get(row_name)
            if not old_row:
                continue

            if normalize_child_row(old_row) != normalize_child_row(new_row):
                updated_rows.append(new_row)

        if not updated_rows:
            continue

        for row in updated_rows:
            row_key = f"{notif_name}:{table_field}:{row.get('name')}"

            if row_key in sent_rows:
                continue

            sent_rows.add(row_key)
            doc._sent_child_row_updated_notifications = sent_rows

            doc._updated_child_row = row
            doc._updated_child_table_field = table_field

            run_server_script_for_doc_event(doc, "on_child_table_row_updated")
            break


# ---------------------------------------------------------------------------
# Detect Child Table Row Removed
# ---------------------------------------------------------------------------

def detect_child_table_row_removed(doc, method=None):
    if not hasattr(doc, "_old_snapshot"):
        return

    old = doc._old_snapshot or {}
    new = doc.as_dict()

    notifications_map = get_notifications_map().get(doc.doctype, {})
    row_notifications = notifications_map.get("Child Table Row Removed", [])

    if not row_notifications:
        return

    sent_rows = getattr(doc, "_sent_child_row_removed_notifications", set())

    for notif_name in row_notifications:
        notif = frappe.get_doc("Clefincode Notification", notif_name)
        table_field = getattr(notif, "child_table_field", None)

        if not table_field:
            continue

        old_map = get_child_rows_map(old.get(table_field) or [])
        new_map = get_child_rows_map(new.get(table_field) or [])

        removed_rows = [old_row for row_name, old_row in old_map.items() if row_name not in new_map]

        if not removed_rows:
            continue

        for row in removed_rows:
            row_key = f"{notif_name}:{table_field}:{row.get('name')}"

            if row_key in sent_rows:
                continue

            sent_rows.add(row_key)
            doc._sent_child_row_removed_notifications = sent_rows

            doc._removed_child_row = row
            doc._removed_child_table_field = table_field

            run_server_script_for_doc_event(doc, "on_child_table_row_removed")
            break


# ---------------------------------------------------------------------------
# Detect Child Table Changed
# ---------------------------------------------------------------------------

def detect_child_table_changed(doc, method=None):
    if not hasattr(doc, "_old_snapshot"):
        return

    old = doc._old_snapshot or {}
    new = doc.as_dict()

    notifications_map = get_notifications_map().get(doc.doctype, {})
    row_notifications = notifications_map.get("Child Table Changed", [])

    if not row_notifications:
        return

    sent_tables = getattr(doc, "_sent_child_table_changed_notifications", set())

    for notif_name in row_notifications:
        notif = frappe.get_doc("Clefincode Notification", notif_name)
        table_field = getattr(notif, "child_table_field", None)

        if not table_field:
            continue

        old_map = get_child_rows_map(old.get(table_field) or [])
        new_map = get_child_rows_map(new.get(table_field) or [])

        old_names = set(old_map.keys())
        new_names = set(new_map.keys())

        changed = False

        if old_names != new_names:
            changed = True
        else:
            for row_name in new_names:
                if normalize_child_row(old_map.get(row_name)) != normalize_child_row(new_map.get(row_name)):
                    changed = True
                    break

        if not changed:
            continue

        table_key = f"{notif_name}:{table_field}"

        if table_key in sent_tables:
            continue

        sent_tables.add(table_key)
        doc._sent_child_table_changed_notifications = sent_tables
        doc._changed_child_table_field = table_field

        run_server_script_for_doc_event(doc, "on_child_table_changed")


# ---------------------------------------------------------------------------
# Detect Child Table Change Value
# ---------------------------------------------------------------------------

def detect_child_table_change_value(doc, method=None):
    if not hasattr(doc, "_old_snapshot"):
        return

    old = doc._old_snapshot or {}
    new = doc.as_dict()

    notifications_map = get_notifications_map().get(doc.doctype, {})
    row_notifications = notifications_map.get("Child Table Change Value", [])

    if not row_notifications:
        return

    sent_rows = getattr(doc, "_sent_child_table_change_value_notifications", set())

    for notif_name in row_notifications:
        notif = frappe.get_doc("Clefincode Notification", notif_name)
        table_field = getattr(notif, "child_table_field", None)
        fieldname = getattr(notif, "value_changed", None)

        if not table_field or not fieldname:
            continue

        old_map = get_child_rows_map(old.get(table_field) or [])
        new_map = get_child_rows_map(new.get(table_field) or [])

        for row_name, new_row in new_map.items():
            old_row = old_map.get(row_name)
            if not old_row:
                continue

            old_value = old_row.get(fieldname)
            new_value = new_row.get(fieldname)

            if old_value == new_value:
                continue

            row_key = f"{notif_name}:{table_field}:{fieldname}:{row_name}"

            if row_key in sent_rows:
                continue

            sent_rows.add(row_key)
            doc._sent_child_table_change_value_notifications = sent_rows

            doc._changed_child_row = new_row
            doc._changed_child_table_field = table_field
            doc._changed_child_field = fieldname
            doc._old_child_value = old_value
            doc._new_child_value = new_value

            run_server_script_for_doc_event(doc, "on_child_table_change_value")
            break
    