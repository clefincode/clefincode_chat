# Copyright (c) 2024, ClefinCode L.L.C-FZ and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

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
		doc = frappe.get_doc({
			"doctype" : "ClefinCode WhatsApp Template",
			"whatsapp_profile": self.name,
			"template_name": f"{self.business_account_id}_confirm_message",
			"meta_template_name": self.meta_template_name,
			"category": "Utility",
			"body": self.template_content,
			"buttons": [{"type" : "Custom" , "button_text" : "Yes" }, {"type" : "Custom" , "button_text" : "No" } ],
		}).insert(ignore_permissions = True)
		doc.submit()
		self.message_template = doc.name
		self.save()

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

