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

class CiCTwilioTemplate(Document):

    VAR_PATTERN = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")
    NEWLINE_VAR_PATTERN = re.compile(r"{{[^}]*\n[^}]*}}")
    
    def on_submit(self):
        self.post_whatsapp_template_twilio()
    
    def validate(self):
            
            self.validate_name_rules()
            self.validate_whatsapp_rules()
        
    
    
    def validate_whatsapp_rules(self):

            html = self.body or ""

            # Convert <p><br/></p> into a single newline BEFORE parsing
            html = re.sub(r"<p>\s*(<br\s*/?>)\s*</p>", "\n", html, flags=re.I)

            soup = BeautifulSoup(html, "html.parser")

            # Add a newline before every <p> or <div>
            for tag in soup.find_all(["p", "div"]):
                tag.insert_before("\n")

            text = soup.get_text(strip=False)

            # Remove leading newline
            body = text.lstrip("\n")

        

            if not body:
                return

            # ---------------------------------------------------
            # Extract variables {{ ... }} including raw content
            # ---------------------------------------------------
            raw_vars = re.findall(r"{{\s*(.*?)\s*}}", body)
            vars_in_body = self.VAR_PATTERN.findall(body)  # numeric + alpha identifiers
            total_vars = len(vars_in_body)

            # ---------------------------------------------------
            # Rule 0 — Variable name format (NEW)
            # ---------------------------------------------------
            for raw in raw_vars:
                var = raw.strip()

                # ❌ Case: variable contains space: {{id name}}
                if " " in var:
                    frappe.throw(
                        f"Variable '{{{{ {raw} }}}}' is invalid. "
                        "Variable names cannot contain spaces."
                    )

                # ❌ Case: variable contains invalid characters (only letters/numbers/_ allowed)
                if not re.match(r"^[A-Za-z0-9_]+$", var):
                    frappe.throw(
                        f"Variable '{{{{ {raw} }}}}' is invalid. "
                        "Allowed characters: letters, numbers, underscore only."
                    )

            # ---------------------------------------------------
            # Rule 1 — No newlines inside variables
            # ---------------------------------------------------
            if self.NEWLINE_VAR_PATTERN.search(body):
                frappe.throw("WhatsApp templates cannot contain variables spanning multiple lines.")

            # ---------------------------------------------------
            # Rule 2 — Sequential numeric variables
            # ---------------------------------------------------
            numeric_vars = [int(v) for v in vars_in_body if v.isdigit()]

            if numeric_vars:
                sorted_vars = sorted(numeric_vars)
                for i, v in enumerate(sorted_vars, start=1):
                    if v != i:
                        frappe.throw(
                            f"Numeric variables must be sequential. Expected {{ {{ {i} }} }} but found {{ {{ {v} }} }}."
                        )

            # ---------------------------------------------------
            # Rule 3 — No adjacent variables
            # ---------------------------------------------------
            if re.search(r"}}\s*{{", body):
                frappe.throw(
                    "Variables cannot appear next to each other in WhatsApp templates. "
                    "Add text between variables."
                )

            # ---------------------------------------------------
            # Rule 4 — Cannot start or end message with a variable
            # ---------------------------------------------------
            if body.startswith("{{"):
                frappe.throw("WhatsApp templates cannot start with a variable.")

            if re.search(r"{{\s*[A-Za-z0-9_]+\s*}}[\.\!\?]?$", body):
                frappe.throw(
                    "WhatsApp templates cannot end directly with a variable. "
                    "Add non-variable text after the final variable."
                )

            # ---------------------------------------------------
            # Rule 5 — Word-to-variable ratio (2x+1 rule)
            # ---------------------------------------------------
            non_variable_words = len([w for w in re.split(r"\s+", body) if "{{" not in w])
            if total_vars > 0 and non_variable_words < (2 * total_vars + 1):
                frappe.throw(
                    f"Message too short for {total_vars} variables. "
                    f"WhatsApp requires at least {2 * total_vars + 1} non-variable words."
                )

            # ---------------------------------------------------
            # Rule 6 — Maximum 100 variables
            # ---------------------------------------------------
            if total_vars > 100:
                frappe.throw("WhatsApp templates cannot include more than 100 variables.")
            self.validate_variable_table( body, vars_in_body)
            
    def validate_variable_table(self, body, vars_in_body):
                """
                Ensure variables in body match variables child table.
                """

                # List of variables from body (unique)
                body_vars = list(set(vars_in_body))

                # Variables defined in child table
                table_vars = []
                for row in self.variables:
                    if row.variable_key:
                        table_vars.append(row.variable_key.strip())

                # -----------------------------------------
                # Rule A — Every body variable must appear in variables table
                # -----------------------------------------
                missing = set(body_vars) - set(table_vars)
                if missing:
                    missing_list = ", ".join(missing)
                    frappe.throw(
                        f"Missing variables in Variables table: {missing_list}. "
                        "Every variable used in body must be defined in Variables child table."
                    )

              
              
    
    def validate_name_rules(self):
            # Block empty or None names
            if not self.friendly_name:
                frappe.throw("Document name cannot be empty.")
            
            if " " in self.friendly_name:
                 frappe.throw("Name cannot contain spaces.")

            # Allowed characters only
            import re
            if not re.match(r"^[A-Za-z0-9_.-]+$", self.friendly_name):
                frappe.throw(
                    "Invalid characters in name. Allowed: letters, numbers, dot, hyphen, underscore."
                )

            # Force lowercase (optional)
            safe_name = self.friendly_name.lower()
            if self.friendly_name != safe_name:
                self.friendly_name = safe_name

            # Prevent names that are purely numeric
            if self.friendly_name.isdigit():
                frappe.throw("Name cannot be only numbers. Please add letters.")

            # Prevent names shorter than 3 chars
            if len(self.friendly_name) < 3:
                frappe.throw("Name must be at least 3 characters long.")

            # Prevent double punctuation like -- or __
            if "--" in self.friendly_name or "__" in self.friendly_name:
                frappe.throw("Name cannot contain repeated punctuation such as '--' or '__'.")

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
                        'amount': "{:.2f}".format(float(b.amount))  
                    }
                    items_list.append(item)

              
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

            # 1) create content

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
            
            content_sid = create_data.get("sid")
            
            if not content_sid:
                frappe.throw(f"No content SID returned from Twilio: {create_data}")
           
            # save content sid as whatsapp_template_id
            frappe.db.set_value("CiC Twilio Template", self.name, 
                    "whatsapp_template_id", str(content_sid)
                    
                )
            
            frappe.db.commit()
            frappe.db.commit()
            # frappe.log_error("debug_after_save", {
            #     "name": self.name,
            #     "id": self.whatsapp_template_id,
            #     "status": self.template_status
            # })

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
                mapped_status = _status_map.get(twilio_status, "PENDING")

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
            card_doc = frappe.get_doc("CiC Template Card Carousel", card_link.card)

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
        

        # Load the document
        template = frappe.get_doc("CiC Twilio Template", docname)

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
                "CiC Twilio Template",
                docname,
                {
                    "template_status": status
                }
            )

            frappe.db.commit()

            return f" Status updated to: <b>{status}</b><br>Reason: {rejection_reason}"

        return " Invalid response from Twilio."

    except Exception as e:
        frappe.log_error(f"check_single_twilio_template_status error: {str(e)}", "CiC Twilio Template Checker")
        return f" Error: {str(e)}"
    
    