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
from clefincode_chat.api.api_1_3_3.api import get_profile_id,create_channel,check_if_contact_has_chat, send
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

    def get_latest_custom_attachment_file(self, doc):
        target_var = None

        for var in self.variables:
            source_type = (getattr(var, "source_type", "") or "").strip()
            source_field = (getattr(var, "source_field", "") or "").strip()

            if (
                self.doctype_event == "Child Table Row Added"
                and self.child_table_field == "custom_attachment_settings"
                and source_type == "Child Row Field"
                and source_field == "file_name"
            ):
                target_var = var
                break

        if not target_var:
            return None

        added_row = getattr(doc, "_added_child_row", None)

        if not added_row:
            return None

        target_file_name = added_row.get(target_var.source_field)

        if not target_file_name:
            return None

        latest_file = frappe.db.get_all(
            "File",
            filters={
                "attached_to_doctype": self.reference_doctype,
                "attached_to_name": doc.name,
                "file_name": target_file_name,
            },
            fields=["name"],
            order_by="creation desc",
            limit=1,
        )

        if not latest_file:
            return None

        original_file = frappe.get_doc("File", latest_file[0].name)

        copied_file = frappe.copy_doc(original_file)
        copied_file.attached_to_doctype = self.reference_doctype
        copied_file.attached_to_name = doc.name
        copied_file.save(ignore_permissions=True)
       

        return copied_file.file_url

    def send_via_whatsapp(self, doc: Document, phone_no=None, default_template=None, ignore_condition=False):
            doc_data = doc.as_dict()

            recipient_info = resolve_notification_recipient(self, doc, channel_type="WhatsApp")
            if not recipient_info:
                frappe.log_error(
                    message=f"Could not resolve WhatsApp recipient for notification: {self.name}, doc: {doc.doctype} {doc.name}",
                    title="Missing WhatsApp Recipient"
                )
                return

            contact = recipient_info.get("contact")
            selected_profile = recipient_info.get("profile")

            if not contact:
                frappe.log_error(
                    message=f"Resolved recipient has no WhatsApp contact for notification: {self.name}",
                    title="Missing WhatsApp Contact"
                )
                return

            room = get_or_create_notification_channel(
                self,
                contact,
                platform="WhatsApp",
                selected_profile=selected_profile
            )

            cond = (self.condition or "").strip()
            if cond and not ignore_condition:
                try:
                    ctx_doc = _dict(doc.as_dict())
                    event_row = _dict(get_child_event_row(doc) or {})
                    env = get_safe_globals().copy()

                    passed = frappe.safe_eval(cond, env, {
                        "doc": ctx_doc,
                        "row": event_row
                    })

                    if not passed:
                        frappe.log_error(
                            "ClefincodeNotification: condition not met",
                            f"Condition: {cond}\nDoc: {doc.doctype} {doc.name}\nKeys: {list(ctx_doc.keys())}"
                        )
                        return

                except Exception:
                    frappe.log_error(frappe.get_traceback(), "Notification Condition Error")
                    return

            variables = self.get_notification_variables(doc)
            attachment = None

            if self.message_type == "Template":
                content = self.template + "," + doc.name

                if self.attach_document_print:
                    key = doc.get_document_share_key()  # noqa
                    frappe.db.commit()

                    from packaging import version
                    frappe_version = frappe.__version__

                    if version.parse(frappe_version) < version.parse("15.0.0"):
                        res = pdf(
                            doctype=doc_data["doctype"],
                            name=doc.name,
                            key=key,
                            format=self.print_format,
                            lang=self.language,
                            letterhead=self.letter_head
                        )
                    else:
                        res = generate_pdf_with_getpdf(
                            doctype=doc_data["doctype"],
                            name=doc.name,
                            print_format=self.print_format,
                            lang=self.language,
                            letterhead=self.letter_head,
                            is_private=self.is_private
                        )

                    attachment = res.get("file_url")

                if not attachment:
                    attachment = self.get_latest_custom_attachment_file(doc)

                send(
                    content,
                    get_profile_id(self.owner),
                    room,
                    self.owner,
                    message_type="information",
                    message_template_type="Send Template",
                    attachment=attachment,
                    override_variables=variables
                )

            else:
                message = self.message_content
                body_preview = message or ""

                for k, v in variables.items():
                    body_preview = body_preview.replace(f"{{{{{k}}}}}", str(v))

                send(body_preview, get_profile_id(self.owner), room, self.owner)

                if self.attach_document_print:
                    key = doc.get_document_share_key()  # noqa
                    frappe.db.commit()

                    from packaging import version
                    frappe_version = frappe.__version__

                    if version.parse(frappe_version) < version.parse("15.0.0"):
                        res = pdf(
                            doctype=doc_data["doctype"],
                            name=doc.name,
                            key=key,
                            format=self.print_format,
                            lang=self.language,
                            letterhead=self.letter_head
                        )
                    else:
                        res = generate_pdf_with_getpdf(
                            doctype=doc_data["doctype"],
                            name=doc.name,
                            print_format=self.print_format,
                            lang=self.language,
                            letterhead=self.letter_head,
                            is_private=False
                        )

                    send(
                        handle_pdf_attachment(res["file_url"], res["file_name"]),
                        get_profile_id(self.owner),
                        room,
                        self.owner,
                        attachment=res["file_url"],
                        sub_channel=None,
                        is_link=None,
                        is_media=None,
                        is_document=1,
                        file_id=res["file_id"]
                    )
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
        variables = self.get_notification_variables(doc)
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

    def get_notification_variables(self, doc: Document):
                variables = {}
                added_row = getattr(doc, "_added_child_row", None)
               

                for var in self.variables:
                    key = (var.variable_key or "").strip()
                    source_type = (var.source_type or "").strip()
                    source_field = (var.source_field or "").strip()
                    default_value = (var.default or "").strip()

                    if not key or not source_field:
                        continue

                    value = None

                    if source_type == "Document Field":
                        value = doc.get(source_field)

                    elif source_type == "Child Row Field" and added_row:
                        value = added_row.get(source_field)

                    if value in (None, "") and default_value not in (None, ""):
                        value = default_value

                    if value not in (None, ""):
                        variables[key] = str(value)

                return variables
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
def pdf(doctype, name, key, format=None, lang=None, letterhead=None):
    import subprocess
    import tempfile
    import shutil
    import frappe
    from frappe.utils.file_manager import save_file

    

    DEFAULT_FOLDER = "CiC Chat Notif PDF"  

    
   
    create_folder_if_not_exists(DEFAULT_FOLDER,"Home/Attachments")

    #  Ensure wkhtmltopdf is installed
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
        frappe.flags.ignore_print_permissions = True
        #  Render print HTML with letterhead enabled
        html = frappe.get_print(
            doctype,
            name,
            print_format=format,
            doc=doc,
            no_letterhead=0,
           
        )
        frappe.flags.ignore_print_permissions = False

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

        #  Read final PDF
        with open(pdf_file.name, "rb") as f:
            pdf_data = f.read()

        #  Save file into File DocType
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
    try:
        frappe.flags.ignore_print_permissions = True

        html = frappe.get_print(
            doctype,
            name,
            print_format=print_format,
            doc=doc
        )

    finally:
        frappe.flags.ignore_print_permissions = False

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

#========================================================================
def get_child_event_row(doc):
    return (
        getattr(doc, "_added_child_row", None)
        or getattr(doc, "_updated_child_row", None)
        or getattr(doc, "_removed_child_row", None)
        or getattr(doc, "_changed_child_row", None)
    )


def get_recipient_value_from_row(doc, row):
    
    recipient_source = (row.recipient_source or "").strip()
    receiver_field = (row.receiver_field or "").strip()
    linked_phone_field = (row.linked_phone_field or "").strip()
    receiver_value_type = (getattr(row, "receiver_value_type", "") or "").strip()
    fixed_chat_profile = (getattr(row, "fixed_chat_profile", "") or "").strip()
    fixed_phone_number = (getattr(row, "fixed_phone_number", "") or "").strip()

    child_row = get_child_event_row(doc)

    if recipient_source == "Fixed Value":
        if receiver_value_type == "Profile":
           
            return {
                "value_type": "Profile",
                "value": fixed_chat_profile
            }
        elif receiver_value_type == "Phone":
            return {
                "value_type": "Phone",
                "value": fixed_phone_number
            }
        return None

    if not recipient_source or not receiver_field:
        return None

    if recipient_source == "From Profile Field":
        return {
            "value_type": "Profile",
            "value": doc.get(receiver_field)
        }

    if recipient_source == "From Field":
        return {
            "value_type": "Phone",
            "value": doc.get(receiver_field)
        }

    if recipient_source == "From Linked Field":
        if not linked_phone_field:
            return None

        linked_docname = doc.get(linked_phone_field)
        if not linked_docname:
            return None

        meta = frappe.get_meta(doc.doctype)
        link_df = meta.get_field(linked_phone_field)
        if not link_df or link_df.fieldtype != "Link" or not link_df.options:
            return None

        return {
            "value_type": "Phone",
            "value": frappe.db.get_value(link_df.options, linked_docname, receiver_field)
        }

    if recipient_source == "Child Row Field":
        if not child_row:
            return None
        return {
            "value_type": "Phone",
            "value": child_row.get(receiver_field)
        }

    return None

def find_chat_profile_by_contact(contact_info):
    if not contact_info:
        return None

    profile = frappe.db.get_value(
        "ClefinCode Chat Profile Contact Details",
        {"contact_info": contact_info},
        "parent"
    )
    if profile:
        return profile

    # جرّب مع +
    if isinstance(contact_info, str) and not contact_info.startswith("+"):
        profile = frappe.db.get_value(
            "ClefinCode Chat Profile Contact Details",
            {"contact_info": f"+{contact_info}"},
            "parent"
        )
        if profile:
            return profile

    return None


def create_contact_and_get_profile(contact_info, sender_name=None, platform="WhatsApp"):
    if not contact_info:
        return None

    try:
        contact_doc = frappe.get_doc({
            "doctype": "Contact",
            "first_name": sender_name or contact_info,
            "platform": platform,
            "phone_nos": [{
                "phone": contact_info,
                "is_primary_phone": 1,
                "is_primary_mobile": 1
            }]
        })
        contact_doc.insert(ignore_permissions=True)

        profile = frappe.db.get_value(
            "ClefinCode Chat Profile",
            {"contact": contact_doc.name},
            "name"
        )
        return profile
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Create Contact / Profile Error")
        return None


def get_or_create_chat_profile_from_phone(contact_info, sender_name=None, platform="WhatsApp"):
    profile = find_chat_profile_by_contact(contact_info)
    if profile:
        return profile

    return create_contact_and_get_profile(contact_info, sender_name=sender_name, platform=platform)

def resolve_notification_recipient(self, doc, channel_type="WhatsApp"):
    recipient_rows = frappe.get_all(
        "Clefincode Notification Recipient list",
        filters={"parent": self.name},
        fields=[
            "name",
            "recipient_source",
            "receiver_field",
            "linked_phone_field",
            "receiver_value_type",
            "fixed_whatsapp_profile",
            "fixed_phone_number"
        ]
    )

    for row in recipient_rows:
        row = frappe._dict(row)
        result = get_recipient_value_from_row(doc, row)

        if not result:
            continue

        raw_value = result.get("value")
        value_type = result.get("value_type")

        if not raw_value:
            continue

      
        if value_type == "Profile":
            profile_name = raw_value

            contact = frappe.db.get_value(
                "ClefinCode Chat Profile Contact Details",
                {"parent": profile_name, "type": channel_type},
                "contact_info"
            )

            if contact:
                return {
                    "profile": profile_name,
                    "contact": contact,
                    "source_row": row
                }
            continue

   
        if value_type == "Phone":
            profile_name = get_or_create_chat_profile_from_phone(
                raw_value,
                sender_name=str(raw_value),
                platform=channel_type
            )

            if not profile_name:
                continue

            contact = frappe.db.get_value(
                "ClefinCode Chat Profile Contact Details",
                {"parent": profile_name, "type": channel_type},
                "contact_info"
            )

            if not contact:
                contact = raw_value

            return {
                "profile": profile_name,
                "contact": contact,
                "source_row": row
            }

    return None

def get_or_create_notification_channel(self, contact, platform="WhatsApp", selected_profile=None):
    default_gateway = None
    platform_profile_doctype = None

    if platform == "WhatsApp":
        platform_profile_doctype = "ClefinCode WhatsApp Profile"
        default_gateway = (
            selected_profile
            if self.owner == "Administrator" and selected_profile
            else frappe.db.get_value(
                platform_profile_doctype,
                {"user": self.owner},
                "name"
            )
        )

    elif platform == "Telegram":
        platform_profile_doctype = "ClefinCode Telegram Profile"
        default_gateway = (
            selected_profile
            if self.owner == "Administrator" and selected_profile
            else frappe.db.get_value(
                platform_profile_doctype,
                {"user": self.owner},
                "name"
            )
        )

    if not default_gateway:
        frappe.log_error(
            f"No default {platform} gateway found for user {self.owner}",
            f"{platform} Gateway Missing"
        )
        return None

    data = check_if_contact_has_chat(self.owner, contact, platform)
    results = data.get("results", {})

    if results:
        room = results.get("name")
        if room:
            return room

    users = [
        {"email": self.owner, "name": self.owner, "platform": "Chat"},
        {
            "email": contact,
            "name": contact,
            "platform": platform,
            "platform_profile": platform_profile_doctype,
            "platform_gateway": default_gateway
        }
    ]

    channel = create_channel(
        "",
        json.dumps(users),
        "Direct",
        "",
        self.owner,
        get_profile_id(self.owner),
        creation_date=None
    )

    results = channel.get("results", [])
    return results[0].get("room") if results else None