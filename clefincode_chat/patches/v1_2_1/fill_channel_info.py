import frappe

def execute():


    from frappe.custom.doctype.custom_field.custom_field import create_custom_field
    # Ensure 'channel_info' field on ClefinCode Chat Channel
    if not frappe.db.has_column("ClefinCode Chat Channel", "channel_info"):
        create_custom_field("ClefinCode Chat Channel", {
            "fieldname": "channel_info",
            "label": "Channel Info",
            "fieldtype": "Long Text",
        })

        frappe.reload_doctype("ClefinCode Chat Channel")


    for row in frappe.get_all(
            "ClefinCode Chat Channel",
            filters={"channel_info": ""},
            fields=["name"]
        ):
        doc = frappe.get_doc("ClefinCode Chat Channel", row.name)
        doc._build_channel_info()
        doc.db_update()
