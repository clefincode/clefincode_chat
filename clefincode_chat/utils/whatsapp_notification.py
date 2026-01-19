# clefincode_chat/utils/whatsapp_notification.py

import frappe

# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------

HIGH_LEVEL_EVENT_MAP = {
    "New": ["after_insert"],
    "Save": ["on_update"],
    "Submit": [ "on_submit"],
    "Cancel": ["on_cancel"],
   
    "Method": ["method"],
    "Custom": ["custom"],
}


# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------

def run_server_script_for_doc_event(doc, event):



    if frappe.flags.in_install or frappe.flags.in_migrate or frappe.flags.in_uninstall:
        return
    _ensure_patch()
   
    notifications_map = get_notifications_map().get(doc.doctype, {})

  
    frappe.logger().debug(f"[WhatsApp Notification] Event={event}, DocType={doc.doctype}, Name={doc.name}")
   

    
    # -------------------------------------------------------------------
    if event in ( "on_change"):#on_update", "on_update_after_submit",
    
        detect_value_changes(doc, event)
       
      

    
    # -------------------------------------------------------------------
    for high_event, low_event_list in HIGH_LEVEL_EVENT_MAP.items():
        if event in low_event_list:
            
            for notif_name in notifications_map.get(high_event, []):
                if high_event == "Save" and doc.docstatus == 1:
                     continue
                # enqueue_notification_send(notif_name, doc)
               
                frappe.get_doc("Clefincode Notification", notif_name).send_template_message(doc)
               
              

        # -------------------------------------------------------------------
    if event == "on_value_change":
        for notif_name in notifications_map.get("Value Change", []):
            frappe.get_doc("Clefincode Notification", notif_name).send_template_message(doc)
            # 
            #enqueue_notification_send(notif_name, doc)
            
           
           



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

# ---------------------------------------------------------------------------

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
 
    notify_list = frappe.get_list(
        "Clefincode Notification",
        filters={"event_frequency": event, "disabled": 0}
    )

    for entry in notify_list:
        frappe.get_doc("Clefincode Notification", entry.name).send_scheduled_message()


# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------

_ORIGINAL_DB_SET_VALUE = frappe.db.set_value
_patchexecuted = False


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
       # _patchexecuted = True





# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------

def detect_value_changes(doc, method=None):
    
 
   
    if not hasattr(doc, "_old_snapshot"):
        return
    

    old = doc._old_snapshot
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
        
        if  old_value is None:
            continue

        if old_value != new_value:
            run_server_script_for_doc_event(doc, "on_value_change")
            break
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
