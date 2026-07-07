import frappe
from frappe.utils import get_url_to_form
from frappe import _
from frappe.model.document import Document

from bs4 import BeautifulSoup
import requests
from requests.auth import HTTPBasicAuth
import json
from clefincode_chat.utils.utils import get_access_token, get_auth_token_twillio



def _sanitize_name(name: str) -> str:
    """make lowercase, replace invalid chars with underscores"""
    if not name:
        return ""
    safe = name.lower()
    safe = "".join(ch if (ch.isalnum() or ch == "_") else "_" for ch in safe)
    return safe

class ClefinCodeWhatsAppTemplate(Document):
    def validate(self):
        existing_template = self.find_existing_same_content_language()
        


        if existing_template:
            url = get_url_to_form(
                    "ClefinCode WhatsApp Template",
                    existing_template.name
                )
            frappe.throw(
                msg = _(
                        "An existing WhatsApp template with the same content, language, and buttons already exists: {0}.<br><br>"
                        "Please use the existing template instead.<br><br>"
                        "If you want to create a new template, please change the message content or buttons."
                    ).format(
                        f"""<a href="{url}" target="_blank">
                                <b>{existing_template.meta_template_name or existing_template.name}</b>
                            </a>"""
                    ),
                title=_("Existing WhatsApp Template Found")
            )
    def before_insert(self):
        if self.whatsapp_business_account_id:
            self.template_name = f"{self.whatsapp_business_account_id}_{self.meta_template_name}"
        else:
            self.template_name = f"{self.whatsapp_profile}_{self.meta_template_name}"
    
    def on_submit(self):
        try:
            if not self.whatsapp_profile:
                frappe.throw("Please set Whatsapp Profile before submit")

            profile = frappe.get_doc("ClefinCode WhatsApp Profile", self.whatsapp_profile)
            provider = (getattr(profile, "provider", "") or "").strip().lower()

            if provider in ("meta", "facebook", "waba"):
               
                if not getattr(profile, "business_account_id", None):
                    frappe.throw("WhatsApp Business Account ID not set on profile")
                self.post_whatsapp_template_meta()
            elif provider in ("twilio",):
                self.post_whatsapp_template_twilio(profile)
            else:
                frappe.throw(f"Unknown whatsapp provider '{provider}' on profile {profile.name}")

        except Exception as e:
            frappe.log_error("ClefinCodeWhatsAppTemplate.on_submit",f"on_submit error for template {self.name}: {str(e)}")
            frappe.throw(str(e))
    
    def post_whatsapp_template_meta(self):
            try:
                existing_meta_template = self.find_existing_template_in_meta()

                if existing_meta_template:
                    self.whatsapp_template_id = existing_meta_template.get("id")
                    self.template_status = existing_meta_template.get("status")
                    self.save(ignore_permissions=True)
                    frappe.db.commit()

                    frappe.msgprint(
                        msg=_(
                            "An existing WhatsApp template was found in Meta with the same content, language, and buttons. "
                            "It has been linked to this ClefinCode template instead of creating a new one."
                        ),
                        title=_("Existing Meta Template Found"),
                        indicator="orange"
                    )

                    return

                access_token = get_access_token()
                api_base = "https://graph.facebook.com/v23.0"
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
                            "text": BeautifulSoup(self.body or "", "html.parser").get_text()
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
                    response_data = response.json()

                    self.whatsapp_template_id = response_data.get("id")
                    self.template_status = response_data.get("status")
                    self.save(ignore_permissions=True)
                    frappe.db.commit()

                    frappe.msgprint(
                        msg=_(
                            "WhatsApp message template {0} has been created to proceed communication with the customer outside of the 24-hour window."
                        ).format(
                            f"<b><a href='/app/clefincode-whatsapp-template/{self.name}' target='_blank'>{self.meta_template_name}</a></b>"
                        ),
                        title=_("WhatsApp Template Created"),
                        indicator="green"
                    )

                    return

                try:
                    error_data = response.json()
                except Exception:
                    error_data = {}

                error = error_data.get("error", {})
                error_subcode = error.get("error_subcode")

                if error_subcode == 2388024:
                    existing_meta_template = self.find_existing_template_in_meta()

                    if existing_meta_template:
                        self.whatsapp_template_id = existing_meta_template.get("id")
                        self.template_status = existing_meta_template.get("status")
                        self.save(ignore_permissions=True)
                        frappe.db.commit()

                        frappe.msgprint(
                            msg=_(
                                "Meta reported that a template with the same content and language already exists. "
                                "The existing Meta template has been linked instead of creating a duplicate."
                            ),
                            title=_("Existing Meta Template Linked"),
                            indicator="orange"
                        )

                        return

                frappe.throw(response.text)

            except Exception as e:
                frappe.throw(str(e))
            
    def post_whatsapp_template_twilio(self, profile):
        """
        Create Content template in Twilio and submit approval for WhatsApp.
        Updates: whatsapp_template_id (content SID), template_status
        """
        try:
            # read Twilio creds from Integration doctype
            doc = frappe.get_doc("ClefinCode Twilio Integration")
            account_sid = doc.get("account_sid")
            auth_token = get_auth_token_twillio()
            if not account_sid or not auth_token:
                frappe.throw("Twilio credentials not configured in ClefinCode WhatsApp Integration")

            # prepare content payload
            # use safe name for twilio approval (lowercase underscores)
            safe_name = _sanitize_name(self.meta_template_name or f"template_{self.name}")
            payload = {
                "friendly_name": safe_name,
                "language": self.template_language or "en",
                "variables": {"1": (self.meta_template_name or "")},
                "types": {
                    "twilio/text": {"body": BeautifulSoup(self.body or "", "html.parser").get_text()}
                }
            }

            # add quick-reply buttons if exist
            if getattr(self, "buttons", None) and len(self.buttons) > 0:
                qr_actions = []
                for idx, b in enumerate(self.buttons):
                            
                           
                    btn_title = b.get("button_text")
                    qr_actions.append({"title": btn_title, "id": btn_title})
                payload["types"]["twilio/quick-reply"] = {"body": BeautifulSoup(self.body or "", "html.parser").get_text(), "actions": qr_actions}

            # 1) create content
            create_url = "https://content.twilio.com/v1/Content"
            create_resp = requests.post(create_url, json=payload, auth=HTTPBasicAuth(account_sid, auth_token), timeout=30)

            try:
                create_data = create_resp.json()
            except ValueError:
                create_data = {"raw": create_resp.text}

            if create_resp.status_code >= 400:
                frappe.log_error(create_resp.text, "twilio_create_content_error")
                frappe.throw(f"Twilio create content failed: {create_resp.status_code} - {create_resp.text}")

            content_sid = create_data.get("sid")
            if not content_sid:
                frappe.throw(f"No content SID returned from Twilio: {create_data}")

            # save content sid as whatsapp_template_id
            self.whatsapp_template_id = content_sid
            self.template_status = "PENDING"
            self.save()
            frappe.db.commit()

            # 2) submit approval for whatsapp (name must be lowercase+underscores)
            approve_url = f"https://content.twilio.com/v1/Content/{content_sid}/ApprovalRequests/whatsapp"
            approve_payload = {"name": safe_name, "category": (self.category or "UTILITY").upper()}

            approve_resp = requests.post(approve_url, json=approve_payload, auth=HTTPBasicAuth(account_sid, auth_token), timeout=30)
            try:
                approve_data = approve_resp.json()
            except ValueError:
                approve_data = {"raw": approve_resp.text}

            if approve_resp.status_code >= 400:
                frappe.log_error(approve_resp.text, "twilio_approval_error")
                # Twilio may reject because WABA not linked — show message and set status REJECTED
                self.template_status = "REJECTED"
                self.save()
                frappe.db.commit()
                frappe.throw(f"Twilio approval failed: {approve_resp.status_code} - {approve_resp.text}")
            else:
                url = f"https://content.twilio.com/v1/Content/{content_sid}/ApprovalRequests"
                resp = requests.get(url, auth=HTTPBasicAuth(account_sid, auth_token), timeout=20)

                try:
                    resp_json = resp.json()
                except ValueError:
                    resp_json = {"raw": resp.text}

                if resp.status_code >= 400:
                    return {"status": "error", "http_status": resp.status_code, "response": resp_json}
                
                # rejection_reason = (resp_json.get("rejection_reason") or "") if isinstance(approval, dict) else ""
       
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
                # Twilio returns fields like 'status' and 'category'
                self.template_status = mapped_status
                self.save()
                frappe.db.commit()
                frappe.msgprint(f"Template created in Twilio (sid: {content_sid}) and submitted for WhatsApp approval (status: {self.template_status})")

        except Exception as e:
            frappe.log_error(f"post_whatsapp_template_twilio exception: {str(e)}", "post_whatsapp_template_twilio")
            frappe.throw(str(e))
    def find_existing_same_content_language(self):
        if not self.body or not self.template_language:
            return None

        existing_templates = frappe.get_all(
            "ClefinCode WhatsApp Template",
            filters={
                "template_language": self.template_language,
                "docstatus": ["!=", 2],
                "name": ["!=", self.name],
            },
            fields=["name", "meta_template_name", "template_name", "body"]
        )

        current_body = BeautifulSoup(
            self.body or "",
            "html.parser"
        ).get_text(" ").strip().lower()

        current_buttons = []
        for button in self.buttons or []:
            current_buttons.append({
                "type": (button.get("type") or "").strip().lower(),
                "button_text": (button.get("button_text") or "").strip().lower(),
            })

        for template in existing_templates:
            existing_doc = frappe.get_doc(
                "ClefinCode WhatsApp Template",
                template.name
            )

            existing_body = BeautifulSoup(
                existing_doc.body or "",
                "html.parser"
            ).get_text(" ").strip().lower()

            existing_buttons = []
            for button in existing_doc.buttons or []:
                existing_buttons.append({
                    "type": (button.get("type") or "").strip().lower(),
                    "button_text": (button.get("button_text") or "").strip().lower(),
                })
       

            if existing_body == current_body and existing_buttons == current_buttons:
                return existing_doc

        return None
    def find_existing_template_in_meta(self):
            try:
                access_token = get_access_token()
                api_base = "https://graph.facebook.com/v23.0"
                endpoint = f"{api_base}/{self.whatsapp_business_account_id}/message_templates"

                headers = {
                    "Authorization": f"Bearer {access_token}",
                }

                params = {
                    "fields": "id,name,status,language,category,components",
                    "limit": 100
                }

                response = requests.get(endpoint, headers=headers, params=params)

                if not response.ok:
                    frappe.log_error(response.text, "meta_template_lookup_error")
                    return None

                templates = response.json().get("data", [])

                current_body = BeautifulSoup(
                    self.body or "",
                    "html.parser"
                ).get_text(" ").strip().lower()

                current_buttons = []
                for button in self.buttons or []:
                    current_buttons.append(
                        (button.get("button_text") or "").strip().lower()
                    )

                for template in templates:
                    if template.get("language") != self.template_language:
                        continue

                    existing_body = ""
                    existing_buttons = []

                    for component in template.get("components", []):
                        if component.get("type") == "BODY":
                            existing_body = (
                                component.get("text") or ""
                            ).strip().lower()

                        if component.get("type") == "BUTTONS":
                            for btn in component.get("buttons", []):
                                existing_buttons.append(
                                    (btn.get("text") or "").strip().lower()
                                )

                    if existing_body == current_body and existing_buttons == current_buttons:
                        return template

                return None

            except Exception as e:
                frappe.log_error(str(e), "find_existing_template_in_meta")
                return None