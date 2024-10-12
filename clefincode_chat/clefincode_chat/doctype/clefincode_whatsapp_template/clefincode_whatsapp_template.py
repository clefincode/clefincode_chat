# Copyright (c) 2024, ClefinCode L.L.C-FZ and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from clefincode_chat.utils.utils import  get_access_token
from bs4 import BeautifulSoup
import requests


class ClefinCodeWhatsAppTemplate(Document):
	def before_insert(self):
		self.template_name = f"{self.whatsapp_business_account_id}_{self.meta_template_name}"
	
	def on_submit(self):
		self.post_whatsapp_template()
	
	def post_whatsapp_template(self):
		try:			
			access_token = get_access_token()
			api_base = "https://graph.facebook.com/v17.0"
			endpoint = f"{api_base}/{self.whatsapp_business_account_id}/message_templates"

			headers = {
				"Authorization": f"Bearer {access_token}",
				"Content-Type": "application/json",
			}
			
			data = {
				"name": self.meta_template_name,
				"category": self.category,
				"language": self.template_language,
				"components": [
					{
					"type": "BODY",
					"text": BeautifulSoup(self.body, 'html.parser').get_text()			
					},
					{
						"type": "BUTTONS",
						"buttons": [
							{
								"type": "QUICK_REPLY",
								"text": "Yes"
							},
							{
								"type": "QUICK_REPLY",
								"text": "No"
							}
						]
					}
				]
			}

			response = requests.post(endpoint, json=data, headers=headers)
			if response.ok:
				frappe.msgprint(f"WhatsApp message template <b><a href='/app/clefincode-whatsapp-template/{self.name}' target='_blank'>{self.meta_template_name}</a></b> has been created to proceed communication with the customer outside of the 24-hour window")	
				response_data = response.json()	
				self.whatsapp_template_id = response_data.get("id")
				self.template_status = response_data.get("status")
				self.save()
				frappe.db.commit()
			else:
				frappe.throw(response.text)
            
		except Exception as e:
			frappe.throw(str(e))
