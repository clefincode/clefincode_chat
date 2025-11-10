# Copyright (c) 2025, ClefinCode L.L.C-FZ and contributors
# For license information, please see license.txt

# import frappe
import json
import frappe

from frappe import _dict, _
from frappe.model.document import Document
from frappe.utils.safe_exec import get_safe_globals, safe_exec
from frappe.integrations.utils import make_post_request
from frappe.desk.form.utils import get_pdf_link
from frappe.utils import add_to_date, nowdate, datetime
from clefincode_chat.api.api_1_3_1.api import get_profile_id,create_channel,check_if_contact_has_chat, send,send_whatsapp_message_from_template_notification, send_whatsapp_message_twilio_notification
from frappe.utils.print_format import download_pdf
import frappe
from frappe.utils.pdf import get_pdf
from frappe.utils import get_site_path
import os

from frappe.utils.file_manager import save_file
import base64



class ClefincodeNotification(Document):
    
	

    def validate(self):
        """Validate."""
        # if self.notification_type == "DocType Event":
        #     fields = frappe.get_doc("DocType", self.reference_doctype).fields
        #     fields += frappe.get_all(
        #         "Custom Field",
        #         filters={"dt": self.reference_doctype},
        #         fields=["fieldname"]
        #     )
        #     if not any(field.fieldname == self.field_name for field in fields): # noqa
        #         frappe.throw(_("Field name {0} does not exists").format(self.field_name))
        if self.custom_attachment:
            if not self.attach and not self.attach_from_field:
                frappe.throw(_("Either {0} a file or add a {1} to send attachemt").format(
                    frappe.bold(_("Attach")),
                    frappe.bold(_("Attach from field")),
                ))

        if self.set_property_after_alert:
            meta = frappe.get_meta(self.reference_doctype)
            if not meta.get_field(self.set_property_after_alert):
                frappe.throw(_("Field {0} not found on DocType {1}").format(
                    self.set_property_after_alert,
                    self.reference_doctype,
                ))
    def send_template_message(self, doc: Document, phone_no=None, default_template=None, ignore_condition=False):
        doc_data = doc.as_dict()
        recevie_profile = frappe.db.get_value("Clefincode Notification Recipient list",
            {"parent": self.name},
            "rcevier_by_filed"
            )
        recevie_profile= frappe.db.get_value(self.reference_doctype,doc.name,recevie_profile)
        contact = frappe.db.get_value(
                    "ClefinCode Chat Profile Contact Details",
                    {"parent": recevie_profile, "type": "WhatsApp"},
                    "contact_info"
                    )
        default_whatsapp_number = frappe.db.get_value("ClefinCode WhatsApp Profile", {"user": self.owner}, "name")
        
        data= check_if_contact_has_chat(self.owner, contact, "WhatsApp")
        frappe.log_error("dsds",[self.owner, contact, "WhatsApp"])
        results = data.get("results", {})
        


        if results:

            result = results
            room = result.get("name")
            chat_status = result.get("chat_status")
        else:
            room = None
            chat_status = None
        if not room:
            users=[{"email":self.owner,"name":self.owner,"platform":"Chat"},{"email":contact,"name":contact,"platform":"WhatsApp","platform_profile":"ClefinCode WhatsApp Profile","platform_gateway":default_whatsapp_number}]
            channel=create_channel('' , json.dumps(users), 'Direct' ,'' , self.owner , get_profile_id(self.owner) , creation_date = None)   
            
            
            results = channel.get("results", [])

            room = results[0].get("room") if results else None
            frappe.log_error("room",room)
        
        cond = (self.condition or "").strip()
        if cond and not ignore_condition:
            try:
                # allow dot access like doc.status
                ctx_doc = _dict(doc.as_dict())
                env = get_safe_globals().copy()

                passed = frappe.safe_eval(cond, env, {"doc": ctx_doc})
                if not passed:
                    frappe.log_error(
                        "ClefincodeNotification: condition not met",
                        f"Condition: {cond}\nDoc: {doc.doctype} {doc.name}\nKeys: {list(ctx_doc.keys())}"
                    )
                    return
            except Exception as e:
                frappe.log_error(
                    "ClefincodeNotification: condition error",
                    f"Error: {e}\nCondition: {cond}\nDoc: {doc.doctype} {doc.name}"
                )
                return
        recevie_profile = frappe.db.get_value("Clefincode Notification Recipient list",
            {"parent": self.name},
            "rcevier_by_filed"
            )
        variables = {}
        for var in self.variables:
                    key = str(var.variable_key).strip()
                    source_doctype = str(var.source_doctype)
                    source_field=str(var.source_field)
                    value= frappe.db.get_value(
                                    source_doctype,doc.name,source_field
                                    )
                    if key and value:
                        variables[key] = value
        recevie_profile= frappe.db.get_value(self.reference_doctype,doc.name,recevie_profile)
        if self.message_type=="Template":
        
                

                
            
                send_whatsapp_message_from_template_notification(self.template,recevie_profile,"14155238886",doc)
                if doc_data and self.set_property_after_alert and self.property_value:
                        if doc_data.doctype and doc_data.name:
                            fieldname = self.set_property_after_alert
                            value = self.property_value
                            meta = frappe.get_meta(doc_data.get("doctype"))
                            df = meta.get_field(fieldname)
                            if df:
                                if df.fieldtype in frappe.model.numeric_fieldtypes:
                                    value = frappe.utils.cint(value)

                                frappe.db.set_value(doc_data.get("doctype"), doc_data.get("name"), fieldname, value)
        else:
           

           
        # for k, v in variables.items():
        #     body_preview = body_preview.replace(f"{{{{{k}}}}}", v)
            message =self.message_content
            body_preview = message or ""
            for k, v in variables.items():
              body_preview = body_preview.replace(f"{{{{{k}}}}}", v)
            to_number = frappe.db.get_value(
                    "ClefinCode Chat Profile Contact Details",
                    {"parent": recevie_profile, "type": "WhatsApp"},
                    "contact_info"
                    )
            #send_whatsapp_message_twilio_notification( "14155238886", to_number, message, "text")
            send(body_preview, get_profile_id(self.owner), room , self.owner )
            if self.attach_document_print:
                # frappe.db.begin()
                key = doc.get_document_share_key()  # noqa
                frappe.db.commit()
                print_format = "Standard"
                doctype = frappe.get_doc("DocType", doc_data['doctype'])
                if doctype.custom:
                    if doctype.default_print_format:
                        print_format = doctype.default_print_format
                else:
                    default_print_format = frappe.db.get_value(
                        "Property Setter",
                        filters={
                            "doc_type": doc_data['doctype'],
                            "property": "default_print_format"
                        },
                        fieldname="value"
                    )
                print_format = default_print_format if default_print_format else print_format
                res=pdf(doc_data['doctype'], doc.name,key,print_format)
              
                frappe.log_error("dsds",res)
                #send_whatsapp_message_twilio_notification( "14155238886", to_number, res['file_url'], "document",res['file_name'])
                send( handle_pdf_attachment(res['file_url'], res['file_name']), get_profile_id(self.owner), room , self.owner,  attachment = res['file_url'] , sub_channel = None , is_link = None , is_media = None , is_document = 1,file_id=res['file_id'])




@frappe.whitelist()
def call_trigger_notifications():
    """Trigger notifications."""
    try:
        # Directly call the trigger_notifications function
        trigger_notifications()  
    except Exception as e:
        # Log the error but do not show any popup or alert
        frappe.log_error(frappe.get_traceback(), "Error in call_trigger_notifications")
        # Optionally, you could raise the exception to be handled elsewhere if needed
        raise e

def trigger_notifications(method="daily"):
    if frappe.flags.in_import or frappe.flags.in_patch:
        # don't send notifications while syncing or patching
        return

    if method == "daily":
        doc_list = frappe.get_all(
            "Clefincode Notification", filters={"doctype_event": ("in", ("Days Before", "Days After")), "disabled": 0}
        )
        for d in doc_list:
            alert = frappe.get_doc("Clefincode Notification", d.name)
            alert.get_documents_for_today() 


    
@frappe.whitelist(allow_guest=True)
def pdf(doctype, name, key, format=None):
    try:
        # Get the document
        doc = frappe.get_doc(doctype, name)
        frappe.logger().info(f"PDF generation started for {doctype} {name}")

        # Generate HTML and PDF
        html = frappe.get_print(doctype, name, print_format=format, doc=doc, no_letterhead=0)
        pdf_data = get_pdf(html)

        # Save PDF to File DocType (auto-handles public/private path)
        file_name = f"{doctype}_{name.replace(' ', '_')}.pdf"
        _file = save_file(file_name, pdf_data, doctype, name, is_private=False)

        # Return the URL for download
        return {
            "status": "success",
            "file_url": _file.file_url,
            "file_name":file_name,
            "file_id": _file.name   
        }

    except Exception:
        frappe.log_error(
            message=frappe.get_traceback(),
            title=f"PDF error: {doctype} {name}"
        )
        return {
            "status": "error",
            "message": "Failed to generate PDF. Check logs for details."
        }
        
def handle_pdf_attachment(file_url, file_name):
    """Return HTML content for a PDF file attachment, similar to the JS handle_attachment function."""
    from frappe.utils import get_url

    # Ensure file_url is absolute (convert to full site URL if it's relative)
    if not file_url.startswith("http"):
        file_url = get_url(file_url)

    # Path to the same PDF icon used in frontend
    icon_path = "/assets/clefincode_chat/images/pdf-red.png"

    # Generate HTML for displaying the PDF attachment
    html = f"""
    <div class="document-container d-flex flex-row justify-content-start align-items-center" style="width:235px;">
        <img src="{icon_path}" style="height:32px; margin-right:8px;">
        <a href="{file_url}" target="_blank" style="white-space: pre-wrap; word-break: break-word;">{file_name}</a>
    </div>
    """
    return html.strip()
