import frappe
from pydub import AudioSegment
import io
import subprocess
import tempfile
import os
import base64
import unicodedata
from werkzeug.wrappers import Response
import datetime
import json
import requests
import mimetypes
from mimetypes import guess_type
from frappe.utils import random_string
from clefincode_chat.utils.utils import choose_user_to_respond, get_access_token, get_confirm_msg_template, get_msg_template_content, check_template_status
from clefincode_chat.api.api_1_0_1.api import create_group, get_profile_id, send, get_profile_full_name, create_channel, get_whatsapp_channel, send_message_confirm_template, process_whatsapp_message, remove_group_member, get_last_active_sub_channel

@frappe.whitelist(allow_guest=True)
def handle():
    if frappe.request.method == "GET":
        return verify_token_and_fulfill_challenge()

    try:
        form_dict = frappe.local.form_dict
        log_webhook(form_dict)

        messages = extract_messages(form_dict)
        if not messages:
            return
        
        error = messages[0].get("errors")
        if error and error[0].get("message") == "Re-engagement message":
            receiver_number = get_receiver_number(form_dict)
            if not validate_receiver_profile(receiver_number):
                return
            # customer number
            sender_number = messages[0].get("recipient_id")
            
            message_template = frappe.db.get_value("ClefinCode WhatsApp Profile" , receiver_number, "message_template")
            template_status = check_template_status(message_template)            

            # check if channel exist and the memebr isn't pending (pending_messages = 0)
            channel = get_whatsapp_channel(receiver_number, sender_number)
            if not channel:
                return
            
            last_sub_channel = get_last_active_sub_channel(channel)["results"][0]["last_active_sub_channel"]
            last_message_info = get_last_message_sent(channel)
            if not last_message_info:
                return

            sender, sender_email = last_message_info

            if not message_template or not template_status:
                content = "<p style='color:#0089FF'> No confirmation sent in over 24 hours. Please check the template in your WhatsApp profile.</p>"
                send(content = content, user = sender, room = channel, email = sender_email, sub_channel = last_sub_channel, message_type = "information", message_template_type = "Send Confirmation")                
                return
            
            content = "<p style='color:#FF0000'> Over 24 hours since the last reply. An automatic confirmation will be sent to check interest.</p>"
            send(content = content, user = sender, room = channel, email = sender_email, sub_channel = last_sub_channel, message_type = "information", message_template_type = "Send Confirmation")
            
            send_message_confirm_template(receiver_number, sender_number, channel, message_template)
            return
        
        message_type = messages[0]["type"] if "type" in messages[0] else None
        media_url , mime_type, file_url = None , None, None           

        sender_number, sender_profile_name = get_sender_info(messages, form_dict)
        chat_profile = get_or_create_chat_profile(sender_number, sender_profile_name)

        receiver_number = get_receiver_number(form_dict)
        if not validate_receiver_profile(receiver_number):
            return

        whatsapp_profile_doc = frappe.get_doc("ClefinCode WhatsApp Profile", receiver_number)
        chat_channel_info = handle_chat_channel(sender_number, receiver_number, chat_profile, whatsapp_profile_doc, messages)
        chat_channel , pending_messages = chat_channel_info
        last_sub_channel = get_last_active_sub_channel(chat_channel)["results"][0]["last_active_sub_channel"]

        response = None
        if pending_messages and pending_messages > 0:
            if (message_type == "text" and messages[0]["text"]["body"].lower() == "no") or (message_type == "button" and messages[0]["button"]["text"].lower() == "no"):
                response = "remove"
            else:
                pending_messages_list = get_pending_messages(chat_channel , pending_messages, sender_number)
                response = "resend"

        if message_type == "text":
            send(content= format_html_string(messages[0]["text"]["body"]), user = sender_profile_name, room= chat_channel, email= sender_number, sub_channel= last_sub_channel)
        elif message_type == "button":
            send(content= format_html_string( messages[0]["button"]["text"]), user= sender_profile_name, room= chat_channel, email= sender_number, sub_channel= last_sub_channel)
        elif message_type in ['image' , 'sticker' , 'video', 'audio' , 'document']:
            media_id =  messages[0][message_type]["id"] 
            media_url , mime_type = retrieve_media_url(media_id)
            file_url = download_media(media_url , mime_type , message_type)
            content = handle_attachment(file_url[0], messages[0][message_type].get("filename", ""), message_type)
            is_media , is_document , is_voice_clip = 0 , 0 , 0
            if message_type in ['image' , 'sticker' , 'video']:
                is_media=1
            elif message_type == "document":
                is_document=1
            else:
                is_voice_clip=1
            send(content = content, user = sender_profile_name, room = chat_channel, email = sender_number, sub_channel= last_sub_channel, attachment = file_url[0], is_media = is_media, is_document = is_document , is_voice_clip = is_voice_clip , file_id = file_url[2])
        if response == "resend":
            # reset pending messages to zero
            frappe.db.set_value('ClefinCode Chat Channel User', {"parent": chat_channel , "user": sender_number, "platform_gateway": receiver_number}, 'pending_messages', 0)
            # resend only by whatsapp
            resend_pending_messages(chat_channel, pending_messages_list, receiver_number, sender_number)
        elif response == "remove":
            remove_group_member(sender_number, chat_channel)

    except Exception as e:
        frappe.log_error(title = "Error when handling webhook" , message = str(e))

def handle_attachment(file_url, file_name, message_type):
    if message_type == 'image':
        return f"""<a href="{file_url}" target="_blank"><img src="{file_url}" class="img-responsive chat-image"><span class="hidden">{file_name}</span></a>"""

    elif message_type == 'video':
        return f"""<div><video src="{file_url}" controls="controls" style="width:235px"></video><span class="hidden">{file_name}</span></div>"""

    elif message_type == 'audio':
        return f"""<audio src="{file_url}" controls="controls" class="voice-clip" style="width: 235px;"></audio>"""

    elif message_type == 'document':
        # Determine the appropriate icon based on file extension
        file_extension = file_name.split('.')[-1].lower()
        icon_url = {
            'doc': '/assets/clefincode_chat/images/docx.png',
            'docx': '/assets/clefincode_chat/images/docx.png',
            'xlsx': '/assets/clefincode_chat/images/xlsx.png',
            'xls': '/assets/clefincode_chat/images/xlsx.png',
            'csv': '/assets/clefincode_chat/images/xlsx.png',
            'pdf': '/assets/clefincode_chat/images/pdf-red.png',
            'pptx': '/assets/clefincode_chat/images/ppt.png',
            'ppt': '/assets/clefincode_chat/images/ppt.png',
            'ppsx': '/assets/clefincode_chat/images/ppt.png',
            'zip': '/assets/clefincode_chat/images/rar.png',
            'rar': '/assets/clefincode_chat/images/rar.png'
        }.get(file_extension, '/assets/clefincode_chat/images/txt.png')

        return f"""
        <div class="document-container d-flex flex-row justify-content-start align-items-center" style="width: 235px;">
            <img style="height: 32px;margin-right: 8px;" src="{icon_url}">
            <a href="{file_url}" target="_blank" style="white-space: pre-wrap;word-break: break-word;">{file_name}</a>
        </div>
        """
    else:
        return f"""<a href="{file_url}" target="_blank" style="color: #027eb5;">{file_name}</a>"""


def log_webhook(form_dict):
    frappe.get_doc({
        "doctype": "ClefinCode Webhook Log",
        "response": form_dict
    }).insert(ignore_permissions=True)
    frappe.db.commit()


def extract_messages(form_dict):
    try:
        result = form_dict["entry"][0]["changes"][0]["value"]

        messages = result.get("messages")
        if messages:
            return messages

        statuses = result.get("statuses")
        if statuses:
            return statuses

        return []
    except (KeyError, IndexError) as e:
        frappe.log_error(title = "Error extracting messages" , message = str(e))
        return []

def get_sender_info(messages, form_dict):
    sender_number = messages[0]["from"]
    sender_profile_name = form_dict["entry"][0]["changes"][0]["value"].get("contacts", [])[0]["profile"]["name"]
    return sender_number, sender_profile_name


def get_or_create_chat_profile(sender_number, sender_profile_name):
    chat_profile = check_if_chat_profile_exists(sender_number)
    if not chat_profile:
        contact = create_contact(sender_number, sender_profile_name)
        chat_profile = frappe.db.get_value("ClefinCode Chat Profile", {"contact": contact}, "name")
    return chat_profile


def get_receiver_number(form_dict):
    return form_dict["entry"][0]["changes"][0]["value"].get("metadata", {}).get("display_phone_number")


def validate_receiver_profile(receiver_number):
    if not frappe.db.exists("ClefinCode WhatsApp Profile", receiver_number):
        frappe.log_error(title="ClefinCode WhatsApp Profile not Found", message=str(receiver_number))
        return False
    return True


def handle_chat_channel(sender_number, receiver_number, chat_profile, whatsapp_profile_doc, messages):
    chat_channel = None
    if whatsapp_profile_doc.type == "Support":
        chat_channel = manage_support_channel(sender_number, receiver_number, chat_profile, whatsapp_profile_doc)
    else:
        chat_channel = manage_personal_channel(sender_number, receiver_number, chat_profile, whatsapp_profile_doc, messages)
    return chat_channel


def manage_support_channel(sender_number, receiver_number, chat_profile, whatsapp_profile_doc):
    channel_info = check_if_channel_exists(sender_number, receiver_number, "Support")
    if not channel_info:
        recipients_list, responder_user = build_recipients_list(chat_profile, whatsapp_profile_doc, sender_number)
        chat_channel = create_group(json.dumps(recipients_list), responder_user)["results"][0]["room"]
        return [chat_channel , None]
    else:    
        chat_channel , pending_messages = channel_info 
        return [chat_channel , pending_messages]


def build_recipients_list(chat_profile, whatsapp_profile_doc, sender_number):
    recipients_list = []

    responder_user = choose_user_to_respond("ClefinCode WhatsApp Profile", whatsapp_profile_doc.name)
    if not responder_user:
        return
    
    recipients_list.append(build_whatsapp_recipient_gateway(chat_profile, whatsapp_profile_doc, sender_number))        

    if whatsapp_profile_doc.receive_by_profile == 1:
        for profile in whatsapp_profile_doc.chat_profiles:
            user_email = get_email_from_chat_profile(profile.chat_profile)
            if user_email and user_email != responder_user:
                recipients_list.append(build_chat_recipients(profile.chat_profile))
    
    

    return recipients_list, responder_user


def build_whatsapp_recipient_gateway(profile_id, whatsapp_profile_doc, sender_number):    
    return {
        "profile_id": profile_id,
        "email": sender_number,
        "platform": "WhatsApp",
        "platform_profile": "ClefinCode WhatsApp Profile",
        "platform_gateway": whatsapp_profile_doc.name
    }

def build_chat_recipients(profile_id):
    return {
        "profile_id": profile_id,
        "email": get_email_from_chat_profile(profile_id),
        "platform": "Chat"
    }


def manage_personal_channel(sender_number, receiver_number, chat_profile, whatsapp_profile_doc, messages):
    receiver_user_email = whatsapp_profile_doc.user
    channel_info = check_if_channel_exists(sender_number, receiver_number, "Personal")
    if not channel_info:
        chat_channel = create_direct_channel(chat_profile, receiver_user_email, whatsapp_profile_doc, messages, sender_number)
        return [chat_channel , None]
    else:    
        chat_channel , pending_messages = channel_info 
        return [chat_channel , pending_messages] 


def create_direct_channel(chat_profile, receiver_user_email, whatsapp_profile_doc, messages, sender_number):
    channel_name = get_profile_full_name(receiver_user_email)   
    recipients_list = [
        build_chat_recipients(get_profile_id(receiver_user_email)),
        build_whatsapp_recipient_gateway(chat_profile, whatsapp_profile_doc, sender_number)
    ]
    return create_channel(
        get_profile_full_name(sender_number) ,
        json.dumps(recipients_list),
        "Direct",
        format_html_string(messages[0]["text"]["body"]),
        receiver_user_email,
        channel_name
    )["results"][0]["room"]

def verify_token_and_fulfill_challenge():
    meta_challenge = frappe.form_dict.get("hub.challenge")
    expected_token = frappe.db.get_single_value("ClefinCode WhatsApp Integration", "webhook_verify_token")

    if frappe.form_dict.get("hub.verify_token") != expected_token:
        frappe.throw("Verify token does not match")

    return Response(meta_challenge, status=200)


def check_if_chat_profile_exists(sender_number):
    chat_profile = frappe.db.get_all("ClefinCode Chat Profile Contact Details", {"contact_info": sender_number}, "parent")
    return chat_profile[0].parent if chat_profile else None


def create_contact(sender_number, sender_profile_name):
    try:
        contact = frappe.get_doc({
            "doctype": "Contact",
            "first_name": sender_profile_name,
            "phone_nos": [{
                "phone": sender_number,
                "is_primary_phone": 1,
                "is_primary_mobile": 1
            }]
        })
        contact.insert(ignore_permissions=True)
        return contact.name
    except Exception as e:
        frappe.log_error(title="Contact Creation Failed", message=str(e))


def check_if_channel_exists(sender, receiver, profile_type=None):
    channel_type = "Group" if profile_type == "Support" else "Direct"
    query = """
        SELECT channel.name , member.pending_messages
        FROM `tabClefinCode Chat Channel` as channel
        INNER JOIN `tabClefinCode Chat Channel User` member ON member.parent = channel.name
        WHERE channel.chat_status = 'Open' AND channel.type = %s AND member.user = %s AND member.platform_gateway = %s AND member.is_removed = 0
    """
    chat_channel = frappe.db.sql(query, (channel_type, sender, receiver), as_dict=True)
    return [chat_channel[0].name , chat_channel[0].pending_messages] if chat_channel else None


def get_email_from_chat_profile(chat_profile):
    chat_profile_details = frappe.db.get_all("ClefinCode Chat Profile Contact Details", {"parent": chat_profile, "type": "Chat"}, "contact_info")
    return chat_profile_details[0].contact_info if chat_profile_details else None


def retrieve_media_url(id):
    access_token = get_access_token()
    api_base = "https://graph.facebook.com/v17.0"
    endpoint = f"{api_base}/{id}"

    response = requests.get(
        endpoint,
        headers={
            "Authorization": "Bearer " + access_token,
        },
    )
    if response.ok:
        return response.json().get("url") , response.json().get("mime_type")

def download_media(url , mime_type, message_type , file_name = None ):
    access_token = get_access_token()
    response = requests.get(
        url,
        headers={
            "Authorization": "Bearer " + access_token,
        },
    )
          
    
    mimetypes.add_type('image/webp', '.webp')
    # mimetypes.add_type('audio/aac', '.acc')
    
    extension = None
    file_bytes=None
    if message_type == 'audio':
        file_bytes= convert_opus_to_aac(response.content)
        extension = ".aac"
    else:
        file_bytes = response.content
        extension = mimetypes.guess_extension(mime_type, strict=False)
    
    file_doc = frappe.get_doc({
        "doctype": "File",
        "file_name": random_string(8) + extension if not file_name else file_name,
        "folder":"Home/attachments",
        "content" : file_bytes,
        "is_private": 1
    })
    file_doc.insert(ignore_permissions = True)
    frappe.db.commit()
    return file_doc.file_url , file_doc.file_size , file_doc.name


def format_html_string(input_string):

    is_arabic = any(is_arabic_char(char) for char in input_string)

    if is_arabic:
        return f'<div style="direction: rtl; text-align: right;"><p>{input_string}</p></div>'
        
    else:
        return f'<p>{str(input_string)}</p>'

def is_arabic_char(char):
    return unicodedata.name(char).startswith('ARABIC')

def get_pending_messages(channel , pending_messages, sender_number):
    messages = frappe.db.sql(f"""
    SELECT name
    FROM `tabClefinCode Chat Message`
    WHERE chat_channel = '{channel}' 
    AND is_mention = 0
    AND message_template_type NOT IN ('Rename Group' , 'Send Confirmation')
    AND sender_email <> '{sender_number}'
    ORDER BY send_date DESC
    LIMIT {pending_messages}
    """ , as_dict = True)
    
    messages.reverse()
    return messages

def resend_pending_messages(chat_channel, pending_messages_list, platform_gateway, sender_number):
    attachment = None
    channel_doc = frappe.get_doc("ClefinCode Chat Channel" , chat_channel)
    for messsage in pending_messages_list:
        message_doc = frappe.get_doc("ClefinCode Chat Message" , messsage.name)
        if message_doc.file_id:
            attachment = frappe.db.get_value("File" , message_doc.file_id, "file_url")

        process_whatsapp_message(platform_gateway, sender_number, message_doc.sender_email, channel_doc, channel_doc.last_responder_user, message_doc, message_doc.file_type, attachment, message_doc.content, message_doc.is_voice_clip, message_doc.is_screenshot)

def get_last_message_sent(channel):
    results = frappe.db.sql(f"""

    SELECT sender , sender_email
    FROM `tabClefinCode Chat Message`
    WHERE chat_channel = '{channel}'    

    ORDER BY send_date DESC 
    LIMIT 1
    """ , as_dict = True)

    if results:
        return [results[0].sender , results[0].sender_email]
    return None

def convert_opus_to_aac(ogg_binary_data):
    # Create a subprocess to call ffmpeg
    process = subprocess.Popen(
        ['ffmpeg', '-i', 'pipe:0', '-f', 'adts', 'pipe:1'],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # Send the binary OGG data to ffmpeg and get the AAC output
    aac_output, error = process.communicate(input=ogg_binary_data)

    # Check if there was an error during conversion
    if process.returncode != 0:
        raise RuntimeError(f"FFmpeg error: {error.decode('utf-8')}")

    return aac_output


