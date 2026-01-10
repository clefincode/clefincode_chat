# Copyright (c) 2023, ClefinCode and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.model.naming import make_autoname

class ClefinCodeChatProfile(Document):
    def before_save(self):
        if self.is_guest == 1 or self.is_support == 1:
            self.token = frappe.generate_hash()  
        self.update_contact_from_details() 
    
    def before_insert(self):
        if self.is_guest == 1:
            self.name = make_autoname("Guest .######")
        elif self.is_support == 1:
            self.name = make_autoname("Support .######")
        else:
            if not self.contact:
                self.create_contact()
            self.name = self.contact
    def create_contact(self):

            # Create base Contact document
            frappe.flags.skip_profile_sync = True
            

            contact = frappe.get_doc({
                "doctype": "Contact",
                "first_name": self.full_name or "Unknown",
                "platform": None
            })
            contact.insert(ignore_permissions=True)

            # Map child table (contact_details) into Contact fields
            for detail in self.contact_details:

                info = detail.contact_info
                t = detail.type

                # Email + Chat → email_ids
                # Chat is treated like Email as requested
                if t in ["Email", "Chat"]:
                    contact.append("email_ids", {
                        "email_id": info,
                        "is_primary": detail.default
                    })

                elif t == "WhatsApp":
                        contact.append("phone_nos", {
                            "phone": info,
                            "is_primary": detail.default,
                            "phone_type": "Mobile"
                        })

                # WhatsApp + Social networks → social_contact table
                elif t in ["Instagram", "Messenger", "Telegram"]:
                        if has_field(contact, "social_contact"):
                            contact.append("social_contact", {
                                "platform": t,
                                "social_id": info,
                            })

                # If marked as default, set Contact.platform
                if detail.default:
                    contact.platform = t

            
            contact.save(ignore_permissions=True)

            # Link the created Contact back to the profile
            self.contact = contact.name
            frappe.flags.skip_profile_sync = False
    def update_contact_from_details(self):
        frappe.flags.skip_profile_sync = True
        if not self.contact:
            return

        contact = frappe.get_doc("Contact", self.contact)

        for detail in self.contact_details:
            info = detail.contact_info
            t = detail.type
            is_default = detail.default

            # Email + Chat
            if t in ["Email", "Chat"]:
                existing = next(
                    (e for e in contact.email_ids if e.email_id == info),
                    None
                )

                if existing:
                    existing.is_primary = is_default
                else:
                    contact.append("email_ids", {
                        "email_id": info,
                        "is_primary": is_default
                    })

            # WhatsApp (Phone)
            elif t == "WhatsApp":
                existing = next(
                    (p for p in contact.phone_nos if p.phone == info),
                    None
                )

                if existing:
                    existing.is_primary = is_default
                else:
                    contact.append("phone_nos", {
                        "phone": info,
                        "is_primary": is_default,
                        "phone_type": "Mobile"
                    })

            # Social platforms
            elif t in ["Instagram", "Messenger", "Telegram"]:
                if has_field(contact, "social_contact"):
                    existing = next(
                        (
                            s for s in contact.social_contact
                            if s.platform == t and s.social_id == info
                        ),
                        None
                    )

                    if existing:
                        existing.is_default = is_default
                    else:
                        contact.append("social_contact", {
                            "platform": t,
                            "social_id": info,
                            "is_default": is_default
                        })

            # Set platform if default
            if is_default:
                contact.platform = t

        contact.save(ignore_permissions=True)
        frappe.flags.skip_profile_sync = False


def has_field(doc, fieldname):
        return bool(doc.meta.get_field(fieldname))
