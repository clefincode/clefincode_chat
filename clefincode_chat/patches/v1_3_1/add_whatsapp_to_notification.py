import frappe

def execute():
    meta = frappe.get_meta("Notification")
    field = [f for f in meta.fields if f.fieldname == "channel"]
    if field:
        options = field[0].options.split("\n")
        if "WhatsApp" not in options:
            options.append("WhatsApp")
            field[0].options = "\n".join(options)
            meta.save()
            frappe.clear_cache(doctype="Notification")
