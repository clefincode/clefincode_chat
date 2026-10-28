# Copyright (c) 2023, ClefinCode and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.model.naming import make_autoname


class ClefinCodeChatProfile(Document):
    def before_insert(self):
        if self.is_guest == 1:
            self.name = make_autoname("Guest .######")
        elif self.is_support == 1:
            self.name = make_autoname("Support .######")
        else:
            if not self.contact:
                self.create_contact()
            self.name = self.contact

    def validate(self):
        # Deleted profiles are permanent tombstones, not reusable identities.
        if self.get("is_deleted") and self.contact:
            frappe.throw("A deleted Chat Profile cannot be linked to a Contact.")

    def before_save(self):
        # Never re-create a Contact or restore old identifiers on a tombstone.
        if self.get("is_deleted"):
            return

        if self.is_guest == 1 or self.is_support == 1:
            self.token = frappe.generate_hash()

        if getattr(frappe.flags, "skip_migrate_fcm_devices_contact_sync", False):
            return

        self.update_contact_from_details()

    def create_contact(self):
        previous_flag = getattr(frappe.flags, "skip_profile_sync", False)
        frappe.flags.skip_profile_sync = True
        try:
            contact = frappe.get_doc({
                "doctype": "Contact",
                "first_name": self.full_name or "Unknown",
                "platform": None,
            })
            contact.insert(ignore_permissions=True)

            for detail in self.contact_details:
                info = detail.contact_info
                contact_type = detail.type

                if contact_type in ("Email", "Chat"):
                    contact.append("email_ids", {
                        "email_id": info,
                        "is_primary": detail.default,
                    })
                elif contact_type == "WhatsApp":
                    contact.append("phone_nos", {
                        "phone": info,
                        "is_primary": detail.default,
                        "phone_type": "Mobile",
                    })
                elif contact_type in ("Instagram", "Messenger", "Telegram"):
                    if has_field(contact, "social_contact"):
                        contact.append("social_contact", {
                            "platform": contact_type,
                            "social_id": info,
                        })

                if detail.default:
                    contact.platform = contact_type

            contact.save(ignore_permissions=True)
            self.contact = contact.name
        finally:
            frappe.flags.skip_profile_sync = previous_flag

    def update_contact_from_details(self):
        if not self.contact:
            return

        previous_flag = getattr(frappe.flags, "skip_profile_sync", False)
        frappe.flags.skip_profile_sync = True
        try:
            contact = frappe.get_doc("Contact", self.contact)

            for detail in self.contact_details:
                info = detail.contact_info
                contact_type = detail.type
                is_default = detail.default

                if contact_type in ("Email", "Chat"):
                    existing = next(
                        (email for email in contact.email_ids if email.email_id == info),
                        None,
                    )
                    if existing:
                        existing.is_primary = is_default
                    else:
                        contact.append("email_ids", {
                            "email_id": info,
                            "is_primary": is_default,
                        })

                elif contact_type == "WhatsApp":
                    existing = next(
                        (phone for phone in contact.phone_nos if phone.phone == info),
                        None,
                    )
                    if existing:
                        existing.is_primary = is_default
                    else:
                        contact.append("phone_nos", {
                            "phone": info,
                            "is_primary": is_default,
                            "phone_type": "Mobile",
                        })

                elif contact_type in ("Instagram", "Messenger", "Telegram"):
                    if has_field(contact, "social_contact"):
                        existing = next(
                            (
                                social for social in contact.social_contact
                                if social.platform == contact_type and social.social_id == info
                            ),
                            None,
                        )
                        if existing:
                            existing.is_default = is_default
                        else:
                            contact.append("social_contact", {
                                "platform": contact_type,
                                "social_id": info,
                                "is_default": is_default,
                            })

                if is_default:
                    contact.platform = "Chat" if contact_type == "Email" else contact_type

            contact.save(ignore_permissions=True)
        finally:
            frappe.flags.skip_profile_sync = previous_flag


def has_field(doc, fieldname):
        return bool(doc.meta.get_field(fieldname))
