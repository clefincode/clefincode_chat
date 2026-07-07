# Copyright (c) 2024, ClefinCode L.L.C-FZ and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe import _
from frappe.utils import get_url_to_form
from bs4 import BeautifulSoup

class ClefinCodeWhatsAppProfile(Document):
    def before_validate(self):
        if self.type == "Personal":			
            get_whatsapp_numbers_for_profile(self.name , self.user)
        else:
            for user in self.authorized_users:
                get_whatsapp_numbers_for_profile(self.name, user.user)
    
    def after_insert(self):				
        self.create_whatsapp_template()
    
    def create_whatsapp_template(self):
        template_language =  "en"

        temp_doc = frappe.new_doc("ClefinCode WhatsApp Template")

        temp_doc.template_language = template_language
        temp_doc.body = self.template_content
        temp_doc.buttons = [
            {"type": "Custom", "button_text": "Yes"},
            {"type": "Custom", "button_text": "No"},
        ]

        existing_template = temp_doc.find_existing_same_content_language()

        if existing_template:

            self.message_template = existing_template.name
            self.db_set("message_template", existing_template.name)

            url = get_url_to_form(
                "ClefinCode WhatsApp Template",
                existing_template.name
            )

            frappe.msgprint(
                msg=_(
                    "An existing WhatsApp template was found: {0}.<br><br>"
                    "This template will be used for this profile instead of creating a new one."
                ).format(
                    f"<a href='{url}' target='_blank'><b>{existing_template.meta_template_name or existing_template.name}</b></a>"
                ),
                title=_("Existing WhatsApp Template Found"),
                indicator="orange"
            )

            return existing_template

        
        doc = frappe.get_doc({
            "doctype": "ClefinCode WhatsApp Template",
            "whatsapp_profile": self.name,
            "template_name": f"{self.business_account_id}_confirm_message",
            "meta_template_name": self.meta_template_name,
            "category": "Utility",
            "template_language": template_language,
            "body": self.template_content,
            "buttons": [
                {"type": "Custom", "button_text": "Yes"},
                {"type": "Custom", "button_text": "No"},
            ],
        }).insert(ignore_permissions=True)

        doc.submit()

        self.message_template = doc.name
        self.db_set("message_template", doc.name)

        return doc

def get_whatsapp_numbers_for_profile(doc_name, user):
    whatsapp_numbers_list = []
    
    personal_numbers = frappe.db.sql(f"""
    SELECT name AS number
    FROM `tabClefinCode WhatsApp Profile`
    WHERE type = 'Personal' AND user = '{user}' AND name <> '{doc_name}'   
    """, as_dict=True)

    if personal_numbers:
        for n in personal_numbers:
            whatsapp_numbers_list.append(n['number'])

    support_numbers = frappe.db.sql(f"""
    SELECT DISTINCT wp.name AS number
    FROM `tabClefinCode WhatsApp Profile` AS wp 
    INNER JOIN `tabAuthorized Users` users ON users.parent = wp.name 
    WHERE type = 'Support' AND users.user = '{user}' AND wp.name <> '{doc_name}'     
    """, as_dict=True)

    if support_numbers:
        for n in support_numbers:
            whatsapp_numbers_list.append(n['number'])
    
    if whatsapp_numbers_list and len(whatsapp_numbers_list) > 0:
        frappe.throw(f"The user <b>{user}</b> already has WhatsApp number {frappe.utils.get_link_to_form('ClefinCode WhatsApp Profile' , whatsapp_numbers_list[0])} ")

