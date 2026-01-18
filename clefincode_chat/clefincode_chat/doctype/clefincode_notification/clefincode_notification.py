# Copyright (c) 2025, ClefinCode L.L.C-FZ and contributors
# For license information, please see license.txt

# import frappe
import json
import re
from urllib.parse import urlparse
import frappe

from frappe import _dict, _
from frappe.model.document import Document
from frappe.utils.safe_exec import get_safe_globals, safe_exec
from frappe.integrations.utils import make_post_request
from frappe.desk.form.utils import get_pdf_link
from frappe.utils import add_to_date, nowdate, datetime
from clefincode_chat.api.api_1_3_1.api import get_profile_id,create_channel,check_if_contact_has_chat, send
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
                # Check if the "Attach Print" option is enabled
        if self.message_type=="Template": 
            if self.attach_document_print:
                # Ensure a template is selected
                if not self.template:
                    frappe.throw("Please select a template before enabling 'Attach Print'.")

                # Fetch the linked Template document
                template = frappe.get_doc("CiC Twilio Template", self.template)

                # Get the media URL from the template
                temp_url = template.media_url or ""
                
                match = re.match(r"^(.*?)\{\{", temp_url)
                media_url = match.group(1).strip() if match else temp_url.strip()

                # Get the base site URL
                base_url = frappe.utils.get_url()
                media_url = media_url.rstrip('/')
                base_url = base_url.rstrip('/')
                media_domain = urlparse(media_url).hostname
                base_domain = urlparse(base_url).hostname

                # Compare media_url with the base site URL
                if  media_domain != base_domain:
                    frappe.throw(
                        title="Invalid Media URL",
                        msg=(
                            "The media URL in the selected template does not match this site's base domain.<br>"
                            f"<b>Media URL:</b> {media_domain}<br>"
                            f"<b>Base URL:</b> {base_domain}<br>"
                            "Please replace the template with one belonging to this site."                            
                        )
                    )
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
       if self.channel=="Whatsapp":
            self.send_via_whatsapp( doc, phone_no, default_template, ignore_condition)
       if self.channel=="Telegram":
          self.send_via_telegram( doc, phone_no, default_template, ignore_condition)
       doc_data = doc.as_dict()
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


    def send_via_whatsapp(self, doc: Document, phone_no=None, default_template=None, ignore_condition=False):
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
        if contact is None:
                frappe.log_error(
                    message=f"WhatsApp contact_info not found for receive profile: {recevie_profile}",
                    title="Missing WhatsApp Contact Info"
                        )
                return
        default_whatsapp_number = frappe.db.get_value("ClefinCode WhatsApp Profile", {"user": self.owner}, "name")
        
        data= check_if_contact_has_chat(self.owner, contact, "WhatsApp")
       
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
                        f"Condition: {cond}\nDoc: {doc.doctype} {doc.name}\nKeys: {list(ctx_doc.keys())} status : {doc.status} "
                    )
                    return
               
               
            except Exception as e:
                
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
        attachment=None
        if self.message_type=="Template":  
                content=self.template+","+doc.name    
                if self.attach_document_print:
                    # frappe.db.begin()
                    key = doc.get_document_share_key()  # noqa
                    frappe.db.commit()
                    from packaging import version
                    frappe_version = frappe.__version__
                    if version.parse(frappe_version) < version.parse("15.0.0"):
                           res =pdf(
                            doctype=doc_data['doctype'],
                            name=doc.name,
                            key=key,
                            format=self.print_format,
                            lang=self.language,
                            letterhead=self.letter_head   
                        )  
                    else:
                        
                        res = generate_pdf_with_getpdf(
                                doctype=doc_data['doctype'],
                                name=doc.name,
                                print_format=self.print_format,
                                lang=self.language,
                                letterhead=self.letter_head,
                                is_private=self.is_private
                            )
                   
                    attachment=res['file_url']
                      

                
                
                send(content, get_profile_id(self.owner), room , self.owner ,message_type="information",message_template_type="Send Template",attachment=attachment)
        else:
           
                   # for k, v in variables.items():
        #     body_preview = body_preview.replace(f"{{{{{k}}}}}", v)
            message =self.message_content
            body_preview = message or ""
            for k, v in variables.items():
              body_preview = body_preview.replace(f"{{{{{k}}}}}", v)
            
            #send_whatsapp_message_twilio_notification( "14155238886", to_number, message, "text")
            send(body_preview, get_profile_id(self.owner), room , self.owner )
            if self.attach_document_print:
                # frappe.db.begin()
                key = doc.get_document_share_key()  # noqa
                frappe.db.commit()
               
                from packaging import version
                frappe_version = frappe.__version__
                if version.parse(frappe_version) < version.parse("15.0.0"):
                           res =pdf(
                            doctype=doc_data['doctype'],
                            name=doc.name,
                            key=key,
                            format=self.print_format,
                            lang=self.language,
                            letterhead=self.letter_head   
                        )  
                else:
                        res = generate_pdf_with_getpdf(
                                doctype=doc_data['doctype'],
                                name=doc.name,
                                print_format=self.print_format,
                                lang=self.language,
                                letterhead=self.letter_head,
                                is_private=False
                            )
              
                #send_whatsapp_message_twilio_notification( "14155238886", to_number, res['file_url'], "document",res['file_name'])
                send( handle_pdf_attachment(res['file_url'], res['file_name']), get_profile_id(self.owner), room , self.owner,  attachment = res['file_url'] , sub_channel = None , is_link = None , is_media = None , is_document = 1,file_id=res['file_id'])
        
    def send_via_telegram(self, doc: Document, phone_no=None, default_template=None, ignore_condition=False):
        doc_data = doc.as_dict()
        recevie_profile = frappe.db.get_value("Clefincode Notification Recipient list",
            {"parent": self.name},
            "rcevier_by_filed"
            )
        recevie_profile= frappe.db.get_value(self.reference_doctype,doc.name,recevie_profile)
        contact = frappe.db.get_value(
                    "ClefinCode Chat Profile Contact Details",
                    {"parent": recevie_profile, "type": "Telegram"},
                    "contact_info"
                    )
        if contact is None:
                frappe.log_error(
                    message=f"Telegram contact_info not found for receive profile: {recevie_profile}",
                    title="Missing Telegram Contact Info"
                        )
                return
        default_whatsapp_number = frappe.db.get_value("ClefinCode Telegram Profile", {"user": self.owner}, "name")       
        data= check_if_contact_has_chat(self.owner, contact, "Telegram")       
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
                        f"Condition: {cond}\nDoc: {doc.doctype} {doc.name}\nKeys: {list(ctx_doc.keys())} status : {doc.status} "
                    )
                    return            
            except Exception as e:                
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
        attachment=None
        message =self.message_content
        body_preview = message or ""
        for k, v in variables.items():
               pattern = rf"{{{{\s*{re.escape(k)}\s*}}}}"
               body_preview = re.sub(pattern, str(v), body_preview)
        send(body_preview, get_profile_id(self.owner), room , self.owner )
        if self.attach_document_print:
                # frappe.db.begin()
                key = doc.get_document_share_key()  # noqa
                frappe.db.commit()
               
                from packaging import version
                frappe_version = frappe.__version__
                if version.parse(frappe_version) < version.parse("15.0.0"):
                           res =pdf(
                            doctype=doc_data['doctype'],
                            name=doc.name,
                            key=key,
                            format=self.print_format,
                            lang=self.language,
                            letterhead=self.letter_head   
                        )  
                else:
                        res = generate_pdf_with_getpdf(
                                doctype=doc_data['doctype'],
                                name=doc.name,
                                print_format=self.print_format,
                                lang=self.language,
                                letterhead=self.letter_head,
                                is_private=False
                            )
              
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
@frappe.whitelist(allow_guest=True)
def pdf(doctype, name, key, format=None, lang=None, letterhead=None):
    import subprocess
    import tempfile
    import shutil
    import frappe
    from frappe.utils.file_manager import save_file

    

    DEFAULT_FOLDER = "CiC Chat Notif PDF"  

    
   
    create_folder_if_not_exists(DEFAULT_FOLDER,"Home/Attachments")

    # 1️⃣ Ensure wkhtmltopdf is installed
    wkhtml_path = shutil.which("wkhtmltopdf")
    if not wkhtml_path:
        frappe.throw("wkhtmltopdf is not installed on this server. Cannot generate PDF with header/footer.")

    created_letterhead_flag = False

    try:
        from packaging import version
        frappe_version = frappe.__version__

        # Load document
        doc = frappe.get_doc(doctype, name)
        frappe.logger().info(f"[PDF] Generating PDF via wkhtmltopdf for {doctype} {name}")

        # Apply language settings
        if version.parse(frappe_version) >= version.parse("15.0.0"):
            from frappe.translate import set_default_language
            set_default_language(lang)
        else:
            frappe.local.lang = lang or "en"

        #  Apply specific letterhead (Solution 4)
        if letterhead:
            frappe.flags.current_letterhead = letterhead
            created_letterhead_flag = True

        #  Render print HTML with letterhead enabled
        html = frappe.get_print(
            doctype,
            name,
            print_format=format,
            doc=doc,
            no_letterhead=0,
           
        )

        #  Convert relative paths → absolute URLs
        site_url = frappe.utils.get_url()
        html = html.replace('src="/', f'src="{site_url}/')
        html = html.replace('href="/', f'href="{site_url}/')
        html = html.replace("url('/", f"url('{site_url}/")

        # TEMP FILES
        html_file = tempfile.NamedTemporaryFile(delete=False, suffix=".html")
        pdf_file = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")

        with open(html_file.name, "w", encoding="utf-8") as f:
            f.write(html)

        #  wkhtmltopdf command
        command = [
            wkhtml_path,
            "--margin-top", "20mm",
            "--margin-bottom", "20mm",
            "--margin-left", "10mm",
            "--margin-right", "10mm",
            "--enable-local-file-access",
            html_file.name,
            pdf_file.name
        ]

        #  Run and capture output
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # Handle errors
        if result.returncode != 0:
            frappe.log_error(
                title="wkhtmltopdf error",
                message=f"""
                            Command: {command}

                            STDOUT:
                            {result.stdout}

                            STDERR:
                            {result.stderr}
                    """
            )
            raise Exception("wkhtmltopdf failed. Check error logs.")

        # 9️⃣ Read final PDF
        with open(pdf_file.name, "rb") as f:
            pdf_data = f.read()

        # 🔟 Save file into File DocType
        file_name = f"{doctype}_{name.replace(' ', '_')}.pdf"
        _file = save_file(file_name, pdf_data, doctype, name, is_private=False,folder=f"Home/Attachments/{DEFAULT_FOLDER}")

        return {
            "status": "success",
            "file_url": _file.file_url,
            "file_name": file_name,
            "file_id": _file.name
        }

    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            f"wkhtmltopdf PDF error: {doctype} {name}"
        )
        return {
            "status": "error",
            "message": "PDF generation failed. Check logs."
        }

    finally:
        # Clean up temporary letterhead override
        if created_letterhead_flag and hasattr(frappe.flags, "current_letterhead"):
            del frappe.flags.current_letterhead
def generate_pdf_with_getpdf(
    doctype,
    name,
    print_format=None,
    lang=None,
    letterhead=None,
    is_private=False,
  
):
    import frappe
    doc = frappe.get_doc(doctype, name)
    DEFAULT_FOLDER = "CiC Chat Notif PDF"  
    create_folder_if_not_exists(DEFAULT_FOLDER,"Home/Attachments")
    if lang:
        frappe.local.lang = lang

    # Letterhead
    if letterhead:
        frappe.flags.current_letterhead = letterhead

    # Generate HTML
    html = frappe.get_print(
        doctype,
        name,
        print_format=print_format,
        doc=doc,
        no_letterhead=0,
      
    )

    # Generate PDF (bytes)
    pdf_data = get_pdf(html)

    # Save file
    file_name = f"{doctype}_{name}.pdf"
    file_doc = save_file(
        file_name,
        pdf_data,
        doctype,
        name,
        is_private=is_private,
        folder=f"Home/Attachments/{DEFAULT_FOLDER}"
    )

    return {
        "status": "success",
        "file_url": file_doc.file_url,
        "file_name": file_name,
        "file_id": file_doc.name
    }

def create_folder_if_not_exists(folder_name, parent_folder="Home"):
    # Check if folder already exists
    exists = frappe.db.exists(
        "File",
        {
            "file_name": folder_name,
            "is_folder": 1,
            "folder": parent_folder
        }
    )

    if not exists:
        folder = frappe.get_doc({
            "doctype": "File",
            "file_name": folder_name,
            "is_folder": 1,
            "folder": parent_folder
        })
        folder.insert(ignore_permissions=True)
        return folder.name

    return exists

       
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
