import frappe

def execute():

    for row in frappe.get_all(
            "ClefinCode Chat Channel",
            filters={"channel_info": ""},
            fields=["name"]
        ):
        doc = frappe.get_doc("ClefinCode Chat Channel", row.name)
        doc._build_channel_info()
        doc.db_update()
