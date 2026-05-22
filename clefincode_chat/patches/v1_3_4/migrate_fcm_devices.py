import frappe
from frappe.utils import now_datetime


def execute():
    frappe.flags.skip_migrate_fcm_devices_contact_sync = True

    try:
        frappe.reload_doc(
            "clefincode_chat",
            "doctype",
            "clefincode_chat_profile_fcm_device"
        )

        frappe.reload_doc(
            "clefincode_chat",
            "doctype",
            "clefincode_chat_profile"
        )

        profiles = frappe.get_all(
            "ClefinCode Chat Profile",
            fields=["name", "registration_token", "platform"]
        )

        for profile in profiles:
            if not profile.registration_token:
                continue

            doc = frappe.get_doc("ClefinCode Chat Profile", profile.name)

            already_exists = any(
                row.registration_token == profile.registration_token
                for row in (doc.get("fcm_devices") or [])
            )

            if already_exists:
                continue

            doc.append("fcm_devices", {
                "device_id": "legacy",
                "registration_token": profile.registration_token,
                "platform": profile.platform or "",
                "app_version": "",
                "device_name": "",
                "is_active": 1,
                "last_seen": now_datetime()
            })

            doc.save(ignore_permissions=True)

        frappe.db.commit()

    finally:
        frappe.flags.skip_migrate_fcm_devices_contact_sync = False