# Copyright (c) 2025, ClefinCode L.L.C-FZ and contributors
# For license information, please see license.txt
import frappe
from frappe.model.document import Document

from bs4 import BeautifulSoup
import re
import requests
from requests.auth import HTTPBasicAuth
import json
from clefincode_chat.utils.utils import get_access_token, get_auth_token_twillio
from frappe import enqueue

from time import time

class TwilioTemplate(Document):
    def on_submit(self):
        self.post_whatsapp_template_twilio()

    def post_whatsapp_template_twilio(self):
        try:
            import re
            # read Twilio creds from Integration doctype
            doc = frappe.get_doc("ClefinCode Twilio Integration")
            
            account_sid = doc.get("account_sid")
            auth_token = get_auth_token_twillio()
            if not account_sid or not auth_token:
                frappe.throw("Twilio credentials not configured in ClefinCode WhatsApp Integration")

            # prepare content payload
            # use safe name for twilio approval (lowercase underscores)
            types = {}
            # body=BeautifulSoup(self.body, 'html.parser').get_text(separator='\n') if self.body else ""
            html = self.body

            # Convert <p><br/></p> into a single newline **before BeautifulSoup parses it**
            html = re.sub(r"<p>\s*(<br\s*/?>)\s*</p>", "\n", html, flags=re.I)

            soup = BeautifulSoup(html, "html.parser")

            # Add ONE newline before each paragraph/div manually
            for tag in soup.find_all(["p", "div"]):
                tag.insert_before("\n")

            text = soup.get_text(strip=False)

           
           

            # Clean leading newline if needed
            body = text.lstrip("\n")
            # body = "\n".join(body.split('\n'))
            if self.template_type == 'twilio/text':
                types['twilio/text'] = {'body': body}

            elif self.template_type == 'twilio/media':
                media = [ self.media_url] if self.media_url else []
                types['twilio/media'] = {'body': body, 'media': media}

            elif self.template_type == 'twilio/location':
                types['twilio/location'] = {'latitude': self.latitude, 'longitude': self.longitude, 'label': self.label}

            elif self.template_type == 'twilio/quick-reply':
                actions = []
                for b in self.actions:
                    action = {'id': b.id, 'title': b.title}
                    actions.append(action)
                types['twilio/quick-reply'] = {'body': self.body, 'actions': actions}

            elif self.template_type == 'twilio/call-to-action':
                actions = []
                for b in self.call_to_action:
                    action = {'type': b.type_of_action, 'title': b.button_text}
                    if b.type_of_action == 'URL':
                        action['url'] = b.website_url
                    elif b.type_of_action == 'PHONE_NUMBER':
                        action['phone'] = b.phone_number
                    elif b.type_of_action == 'COPY_CODE':
                        action['text'] = b.copy_code_text  # Adjust as per docs
                    actions.append(action)
                types['twilio/call-to-action'] = {'body': BeautifulSoup(self.body, 'html.parser').get_text(separator='\n'), 'actions': actions}

            elif self.template_type == 'twilio/card':
                # Assuming single card for card types
                actions = []
                for b in self.call_to_action:
                    action = {'type': b.type_of_action, 'title': b.button_text}
                    if b.type_of_action == 'URL':
                        action['url'] = b.website_url
                    elif b.type_of_action == 'PHONE_NUMBER':
                        action['phone'] = b.phone_number
                    elif b.type_of_action == 'COPY_CODE':
                        action['text'] = b.copy_code_text  # Adjust as per docs
                    actions.append(action)
                types['twilio/card'] = {'title': BeautifulSoup(self.body, 'html.parser').get_text(separator='\n'),"subtitle":self.subtitle, 'actions': actions}
            elif self.template_type =='whatsapp/card':
                # Assuming single card for card types
                actions = []
                for b in self.call_to_action:
                    action = {'type': b.type_of_action, 'title': b.button_text}
                    if b.type_of_action == 'URL':
                        action['url'] = b.website_url
                    elif b.type_of_action == 'PHONE_NUMBER':
                        action['phone'] = b.phone_number
                    elif b.type_of_action == 'COPY_CODE':
                        action['text'] = b.copy_code_text  # Adjust as per docs
                    actions.append(action)
                types['whatsapp/card'] = {'body': BeautifulSoup(self.body, 'html.parser').get_text(separator='\n'),"header_text":self.header_text,"footer":self.footer, 'actions': actions}


            elif self.template_type == 'twilio/carousel':
                types['twilio/carousel'] = {'body':body,'cards': self.get_cards_data()}
            elif self.template_type == 'twilio/list-picker':
                 items = []
                 for b in self.items:
                    item = {'item': b.item, 'description': b.description, 'id':b.id}
                    items.append(item)
                 types['twilio/list-picker'] = {'body': BeautifulSoup(self.body, 'html.parser').get_text(separator='\n'), 'items': items, "button": "Select a destination"}
            elif self.template_type == 'whatsapp/authentication':
                actions = []
                for b in self.call_to_action:
                    action = {'type': b.type_of_action, 'title': b.button_text}
                    if b.type_of_action == 'COPY_CODE':
                        action['copy_code_text'] = b.button_text  # Adjust as per docs
                    actions.append(action)
                types['whatsapp/authentication'] = {"add_security_recommendation": True,"code_expiration_minutes": "30", 'actions': actions}
            elif self.template_type == 'twilio/pay':
                 country= frappe.get_doc("Country", self.country_code)
                 pix={
                     "type": self.pix_type,
                    "code": self.code,
                    "key": self.key,
                    "key_type": self.key_type
                 }
                 items_list = []
                 for b in self.items:
                    item = {
                        'label': str(b.label),
                        'quantity': str(b.quantity),
                        'id': str(b.id),
                        'amount': "{:.2f}".format(float(b.amount))  # تحويل الرقم إلى نص بصيغة 2 decimal
                    }
                    items_list.append(item)

                # تحويل المصفوفة إلى JSON string
                 items_string = json.dumps(items_list)
                
                 types['twilio/pay'] = {'payment_id':self.payment_id,'body':body,
                                             'currency_code':self.currency_code,
                                             'merchant_name':self.merchant_name,
                                             'country_code':country.code.upper(),
                                             'pix':pix,
                                             'items':items_string,
                                             'subtotal_amount':str(self.subtotal_amount),
                                             'total_amount':str(self.total_amount),
                                             'order_expiration':self.order_expiration,
                                             'order_expiration_description':self.order_expiration_description                                   
                                                                                          }
                
                

            # Add for other types...

            variables = {}#{str(var.variable_key): var.example for var in self.variables}
            for var in self.variables:
                key = (var.variable_key or "").strip()
                value=var.default 
                variables[key]=value
                
            payload = {
                'friendly_name': self.friendly_name,
                'language': self.language,
                'variables': variables,
                'types': types
            }
            frappe.log_error("twillio template",payload)

            # 1) create content
            frappe.log_error("template submit",payload)
            create_url = "https://content.twilio.com/v1/Content"
            try:
                create_resp = requests.post(create_url, json=payload, auth=HTTPBasicAuth(account_sid, auth_token), timeout=30)
            except requests.exceptions.RequestException as re:
            # network-level error
               frappe.log_error(frappe.get_traceback(), "twilio_network_error")
               frappe.throw("HHHH",f"Network error when contacting Twilio: {re}")
            
            try:
                create_data = create_resp.json()
                
            except ValueError:
                create_data = {"raw": create_resp.text}

            if create_resp.status_code >= 400:
                frappe.log_error( "twilio_create_content_error",create_resp.text)
              #  frappe.throw(f"Twilio create content failed: {create_resp.status_code} - {create_resp.text}")
            frappe.log_error("post",create_data)
            content_sid = create_data.get("sid")
            
            if not content_sid:
                frappe.throw(f"No content SID returned from Twilio: {create_data}")
           
            # save content sid as whatsapp_template_id
            frappe.db.set_value("Twilio Template", self.name, 
                    "whatsapp_template_id", str(content_sid)
                    
                )
            
            frappe.db.commit()
            frappe.db.commit()
            frappe.log_error("debug_after_save", {
                "name": self.name,
                "id": self.whatsapp_template_id,
                "status": self.template_status
            })

            # 2) submit approval for whatsapp (name must be lowercase+underscores)
            approve_url = f"https://content.twilio.com/v1/Content/{content_sid}/ApprovalRequests/whatsapp"
            approve_payload = {"name": self.friendly_name, "category": (self.category or "UTILITY").upper()}

            approve_resp = requests.post(approve_url, json=approve_payload, auth=HTTPBasicAuth(account_sid, auth_token), timeout=30)
            try:
                approve_data = approve_resp.json()
            except ValueError:
                approve_data = {"raw": approve_resp.text}

            if approve_resp.status_code >= 400:
                frappe.log_error("twilio_approval_error",approve_resp.text)
                # Twilio may reject because WABA not linked — show message and set status REJECTED
                self.template_status = "REJECTED"
                
                frappe.db.set_value(self.doctype, self.name, {
                    
                    "template_status": "REJECTED"
                })
                
                frappe.db.commit()
               # frappe.throw(f"Twilio approval failed: {approve_resp.status_code} - {approve_resp.text}")
            else:
                url = f"https://content.twilio.com/v1/Content/{content_sid}/ApprovalRequests"
                resp = requests.get(url, auth=HTTPBasicAuth(account_sid, auth_token), timeout=20)

                try:
                    resp_json = resp.json()
                    frappe.log_error("template status",resp_json)
                except ValueError:
                    resp_json = {"raw": resp.text}

                if resp.status_code >= 400:
                    return {"status": "error", "http_status": resp.status_code, "response": resp_json}

                whatsapp_res = resp_json.get("whatsapp")
                twilio_status = (whatsapp_res.get("status")).strip().lower()

                _status_map = {
                    "received": "PENDING",
                    "pending": "PENDING",
                    "approved": "APPROVED",
                    "rejected": "REJECTED",
                    "failed": "REJECTED"
                }
                frappe.log_error("template twilio_status",twilio_status)
                mapped_status = _status_map.get(twilio_status, "PENDING")
                frappe.log_error("template mapped_status",mapped_status)

                # success: store approval response (status may be 'received' or 'pending')
                frappe.db.set_value(self.doctype, self.name, "template_status", mapped_status)
                frappe.db.commit()
                
                frappe.msgprint(
                    f"Template created in Twilio (sid: {content_sid}) and submitted for WhatsApp approval (status: {self.template_status})"
                )
                enqueue(
                        method="clefincode_chat.utils.utils.check_twilio_template_status",
                        queue='long',
                        job_name=f"Check Twilio Template Status - {self.name}",
                        timeout=300,
                        is_async=True,
                        now=False,
                       
                        enqueue_after=180  # delay in seconds
                    )

        except Exception as e:
            frappe.log_error("post_whatsapp_template_twilio",frappe.get_traceback())
       #     frappe.throw(str(e))
    def get_cards_data(self):
        cards = []

        
        for card_link in self.cards:
            card_doc = frappe.get_doc("Template Card Carousel", card_link.card)

            # --- actions ---
            actions = []
            for action_row in card_doc.actions:
                action = {
                    "type": action_row.button_type or "",
                    "title": action_row.title or ""
                }

            
                if action_row.button_type == "URL":
                    action["url"] = action_row.url or ""
                elif action_row.button_type == "PHONE_NUMBER":
                    action["phone"] = action_row.phone or ""
                elif action_row.button_type == "QUICK_REPLY":
                    action["id"] = action_row.id or ""
                elif action_row.button_type == "COPY_CODE":
                    action["text"] = action_row.copy_code_text or ""

                actions.append(action)

        
            card = {
                "title": card_doc.title or "",
                "body": card_doc.body or "",
                "media": card_doc.media or "",   
                "actions": actions
            }

            cards.append(card)

        
        return cards
# Phone Number
# Visit Website
# Voice Call
# Voice Call Request
# Coupon Code
@frappe.whitelist()
def check_status(docname):
    try:
        frappe.log_error(f"🔍 Checking status for template: {docname}")

        # Load the document
        template = frappe.get_doc("Twilio Template", docname)

        sid = template.whatsapp_template_id
        if not sid:
            return " No WhatsApp Template ID found."

        # Get Twilio credentials
        integration_doc = frappe.get_doc("ClefinCode Twilio Integration")
        account_sid = integration_doc.get("account_sid")
        auth_token = get_auth_token_twillio()

        if not account_sid or not auth_token:
            frappe.throw(" Twilio credentials not found in ClefinCode WhatsApp Integration")

        # Call Twilio API
        url = f"https://content.twilio.com/v1/Content/{sid}/ApprovalRequests"
        resp = requests.get(url, auth=HTTPBasicAuth(account_sid, auth_token), timeout=30)

        try:
            data = resp.json()
        except Exception:
            frappe.log_error(resp.text, "Twilio JSON Parse Error")
            return " Failed to parse Twilio response."

        if resp.status_code != 200:
            frappe.log_error(resp.text, f"Twilio status check failed ({sid})")
            return f" Failed to check status: {resp.text}"

        # Extract status
        if "whatsapp" in data:
            status = data["whatsapp"].get("status", "").upper()
            rejection_reason = data["whatsapp"].get("rejection_reason", "")

            # Update the template status
            frappe.db.set_value(
                "Twilio Template",
                docname,
                {
                    "template_status": status
                }
            )

            frappe.db.commit()

            return f" Status updated to: <b>{status}</b><br>Reason: {rejection_reason}"

        return " Invalid response from Twilio."

    except Exception as e:
        frappe.log_error(f"check_single_twilio_template_status error: {str(e)}", "Twilio Template Checker")
        return f" Error: {str(e)}"