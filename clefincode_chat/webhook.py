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
from clefincode_chat.utils.utils import choose_user_to_respond, get_access_token, get_confirm_msg_template, get_msg_template_content, check_template_status, get_access_token_instagram, get_access_token_messenger , get_auth_token_twillio
from clefincode_chat.api.api_1_3_1.api import create_group, get_profile_id, send, get_profile_full_name, create_channel, get_whatsapp_channel,get_instagram_channel,get_messenger_channel, send_message_confirm_template, process_whatsapp_message, process_instagram_message,process_messenger_message, get_social_config_for_user, remove_group_member, get_last_active_sub_channel,get_telegram_channel
import urllib.parse
from frappe.utils.password import get_decrypted_password
from requests.auth import HTTPBasicAuth

from twilio.twiml.messaging_response import MessagingResponse


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
                content = '<div class="handle-error-whatsapp" data-template="handle_error_whatsapp"><p style="color:#0089FF"> No confirmation sent in over 24 hours. Please check the template in your WhatsApp profile.</p>/div>'
                send(content = content, user = sender, room = channel, email = sender_email, sub_channel = last_sub_channel, message_type = "information", message_template_type = "Send Confirmation")                
                return
            
            content = '<div class="handle-error-whatsapp" data-template="handle_error_whatsapp"><p style="color:#FF0000"> Over 24 hours since the last reply. An automatic confirmation will be sent to check interest.</p></div>'
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
            send(content= format_html_string( messages[0]["button"]["text"],True), user= sender_profile_name, room= chat_channel, email= sender_number, sub_channel= last_sub_channel,message_type='information')
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
        return f'''<a href='{file_url}' target='_blank'><img src='{file_url}' class='img-responsive chat-image'><span class='hidden'>{file_name}</span></a>'''

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
        
        chat_profile = check_if_chat_profile_exists(f"+{sender_number}")
       
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
        channel_info = check_if_channel_exists(f"+{sender_number}", receiver_number, "Support")
        if not channel_info:
            recipients_list, responder_user = build_recipients_list(chat_profile, whatsapp_profile_doc, sender_number)
            chat_channel = create_group(json.dumps(recipients_list), responder_user)["results"][0]["room"]
            return [chat_channel , None,]
        else:
          chat_channel , pending_messages = channel_info 
          sender_number=f"+{sender_number}"
          return [chat_channel , pending_messages,sender_number]  
    else:    
        chat_channel , pending_messages = channel_info 
        return [chat_channel , pending_messages,sender_number]


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
       
        channel_info = check_if_channel_exists(f"+{sender_number}", receiver_number, "Personal")
        if not channel_info:
            chat_channel = create_direct_channel(chat_profile, receiver_user_email, whatsapp_profile_doc, messages, sender_number)
            
            return [chat_channel , None]
        else:
           chat_channel , pending_messages = channel_info
           sender_number=f"+{sender_number}"
           return [chat_channel , pending_messages,sender_number]  
    else:    
        chat_channel , pending_messages = channel_info 
        return [chat_channel , pending_messages,sender_number] 


def create_direct_channel(chat_profile, receiver_user_email, whatsapp_profile_doc, messages, sender_number):
    frappe.log_error("create_direct_channel",messages)
    #channel_name = get_profile_full_name(receiver_user_email)  
    channel_name = frappe.db.get_value("ClefinCode Chat Profile", {"name": chat_profile}, "full_name") 
    message_type = messages[0]["type"] if "type" in messages[0] else "text"
    
    recipients_list = [
        build_chat_recipients(get_profile_id(receiver_user_email)),
        build_whatsapp_recipient_gateway(chat_profile, whatsapp_profile_doc, sender_number)
    ]
    if message_type == "text":
        return create_channel(
            channel_name or get_profile_full_name(sender_number) ,
            json.dumps(recipients_list),
            "Direct",
            format_html_string(messages[0]["text"]["body"]),
            receiver_user_email,
            get_profile_full_name(receiver_user_email) 
        )["results"][0]["room"]
        
    else:
        media_id =  messages[0][message_type]["id"] 
        media_url , mime_type = retrieve_media_url(media_id)
        file_url = download_media(media_url , mime_type , message_type)
        content = handle_attachment(file_url[0], messages[0][message_type].get("filename", ""), message_type) 
        
        return create_channel(
            get_profile_full_name(sender_number) ,
            json.dumps(recipients_list),
            "Direct",
            format_html_string(content),
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
            "platform": "WhatsApp",
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


def format_html_string(input_string, button = None):

    is_arabic = any(is_arabic_char(char) for char in input_string)

    if is_arabic:
        return f'<div style="direction: rtl; text-align: right;"><p>{input_string}</p></div>'
        
    else:
        if button:
            return f'<div class="approve-button-whatsapp" data-template="approve_button_whatsapp"><p>{str(input_string)}</p></div>'
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

# ==========================================================================================
# ==========================================================================================
# ===================================== Instagram Functions ================================
# ==========================================================================================
# ==========================================================================================
@frappe.whitelist(allow_guest=True)
def instagram_handle():
    """Handles Instagram webhook data."""
    if frappe.request.method == "GET":
        return instagram_webhook_handle()
        

    try:
        form_dict = frappe.local.form_dict
        log_webhook(form_dict)
        
        # Extract messages from form_dict
        messages = extract_social_messages(form_dict)
        
        if not messages:
            return
        
        message = messages[0]
        
        if "delivery" in message or "read" in message:
            return
        
        
        if message.get("errors"):
            frappe.log_error("Error Occurred Receiving Instagram Message", message)

        # Determine message type and content
        message_content = message.get("message", {}).get("text", None)

        media_url, mime_type, file_url = None, None, None

        sender_id, sender_profile_name = get_instagram_sender_info(message)
        
        receiver_id = get_receiver_id(form_dict)


        if not validate_instagram_receiver_profile(receiver_id):
            frappe.log_error("Invalid Receiver Profile", f"Receiver ID: {receiver_id}")
        
        instagram_profile_doc = None
        
        if not frappe.db.exists("ClefinCode Instagram Profile", receiver_id):
            instagram_profile_doc = frappe.db.get_value(
            "ClefinCode Chat Profile Contact Details",
            {"contact_info": receiver_id},
            "parent" 
            )
        else:
            instagram_profile_doc = frappe.get_doc("ClefinCode Instagram Profile", receiver_id)
            

        chat_profile = get_or_create_instagram_chat_profile(sender_id, sender_profile_name)
    
        
        
        chat_channel_info = handle_instagram_chat_channel(sender_id, receiver_id, chat_profile, instagram_profile_doc, messages)
        chat_channel, pending_messages = chat_channel_info
        last_sub_channel = get_last_active_sub_channel(chat_channel)["results"][0]["last_active_sub_channel"]
        
        response = None
        if pending_messages and pending_messages > 0:
            if message_content and message_content.lower() == "no":
                response = "remove"
            else:
                pending_messages_list = get_pending_messages(chat_channel, pending_messages, sender_id)
                response = "resend"

        # Process the message content
        if message_content:
            send(
                content=format_html_string(message_content),
                user=sender_profile_name,
                room=chat_channel,
                email=sender_id,
                sub_channel=last_sub_channel
            )
            
        elif "attachments" in message.get("message", {}):
            # Extract attachment details
            attachments = message["message"]["attachments"]

            # Extract attachment type and media URL and mime type
            attachment_type = attachments[0].get("type", "")
            media_url = attachments[0]["payload"]["url"]
            if not media_url:
                return
            
            mime_type = get_mime_type_from_url(media_url)
            file_name = form_dict['entry'][0]['messaging'][0]['message']['attachments'][0]['payload']['url'].split('/')[-1].split('?')[0]

            
            if attachment_type == "file":
                attachment_type = "document"

            file_url = download_media(media_url,mime_type,attachment_type)
            content = handle_attachment(file_url[0], file_name, attachment_type)
            
            send(
                content=content,
                user=sender_profile_name,
                room=chat_channel,
                email=sender_id,
                sub_channel=last_sub_channel,
                attachment=file_url[0],
                is_media= 1 if attachment_type in ['image', 'video', 'sticker'] else 0,
                is_document=attachment_type == "document",
                is_voice_clip=attachment_type == "audio",
                file_id=file_url[2]
            )

        if response == "resend":
            frappe.db.set_value(
                'ClefinCode Chat Channel User',
                {"parent": chat_channel, "user": sender_id, "platform_gateway": receiver_id},
                'pending_messages', 0
            )
            resend_instagram_pending_messages(chat_channel, pending_messages_list, receiver_id, sender_id)
        elif response == "remove":
            remove_group_member(sender_id, chat_channel)

    except Exception as e:
        frappe.log_error(title="Instagram Webhook Error", message=str(e))
# ==========================================================================================
def fetch_instagram_username(sender_id):
    """Fetch the Instagram username using the Graph API."""
    try:
        access_token = get_access_token_instagram() 
        api_base = "https://graph.instagram.com/v21.0"
        endpoint = f"{api_base}/{sender_id}"
        
        params = {
            "fields": "username", 
            "access_token": access_token
        }
        
        response = requests.get(endpoint, params=params)
        
        if response.ok:
            return response.json().get("username", sender_id)  
        else:
            frappe.log_error("Failed to fetch Instagram username", response.text)
            return sender_id 
    except Exception as e:
        frappe.log_error("Instagram Username Fetch Error", str(e))
        return sender_id
# ==========================================================================================
def get_instagram_sender_info(message):
    try:
        sender_id = message["sender"]["id"]
        sender_profile_name = fetch_instagram_username(sender_id)
        return sender_id, sender_profile_name

    except KeyError as e:
        frappe.log_error("Failed to extract sender info", str(e))
        return None, "Unknown"
# ==========================================================================================
def get_or_create_instagram_chat_profile(sender_id, sender_profile_name):
    chat_profile = check_if_chat_profile_exists(sender_id)

    if not chat_profile:
        contact = create_instagram_contact(sender_id, sender_profile_name)
        chat_profile = frappe.db.get_value("ClefinCode Chat Profile", {"contact": contact}, "name")
    return chat_profile
# ==========================================================================================
def get_receiver_id(form_dict):
    """Extracts receiver ID from webhook data."""
    entry = form_dict['entry'][0]['messaging'][0]
    return entry['recipient']['id']
# ==========================================================================================
def validate_instagram_receiver_profile(receiver_id):
    """Validates if a ClefinCode Chat Profile exists based on receiver_id matching contact_info or name."""
    try:
        # First, try to find in Contact Details
        contact_details = frappe.db.get_value(
            "ClefinCode Chat Profile Contact Details",
            {"contact_info": receiver_id},
            "parent" 
        )
        
        if contact_details:
            return True

        # If not found, try in Instagram Profile
        profile = frappe.db.get_value(
            "ClefinCode Instagram Profile",
            {"name": receiver_id},
            "name" 
        )

        if profile:
            return True

        # If neither found, log error
        frappe.log_error(
            title="ClefinCode Instagram Receiver Not Found",
            message=f"Receiver ID not found: {receiver_id}"
        )
        return False

    except Exception as e:
        frappe.log_error(
            title="Error Validating Instagram Receiver Profile",
            message=str(e)
        )
        return False
# ==========================================================================================
def handle_instagram_chat_channel(sender_id, receiver_id, chat_profile, instagram_profile_doc, messages):
        chat_channel = None
        if instagram_profile_doc.type == "Support":
            chat_channel = manage_instagram_support_channel(sender_id, receiver_id, chat_profile, instagram_profile_doc)
        else:
            chat_channel = manage_instagram_personal_channel(sender_id, receiver_id, chat_profile, instagram_profile_doc, messages)
        return chat_channel   
# ==========================================================================================
def manage_instagram_support_channel(sender_id, receiver_id, chat_profile, instagram_profile_doc):
    channel_info = check_if_channel_exists(sender_id, receiver_id, "Support")
    if not channel_info:
        recipients_list, responder_user = build_instagram_recipients_list(chat_profile, instagram_profile_doc, sender_id)
        chat_channel = create_group(json.dumps(recipients_list), responder_user)["results"][0]["room"]
        return [chat_channel , None]
    else:    
        chat_channel , pending_messages = channel_info 
        return [chat_channel , pending_messages]
# ==========================================================================================
def build_instagram_recipients_list(chat_profile, instagram_profile_doc, sender_id):
    recipients_list = []

    responder_user = choose_user_to_respond("ClefinCode Instagram Profile", instagram_profile_doc.name)
    if not responder_user:
        return
    
    recipients_list.append(build_instagram_recipient_gateway(chat_profile, instagram_profile_doc, sender_id))        

    if instagram_profile_doc.receive_by_profile == 1:
        for profile in instagram_profile_doc.chat_profiles:
            user_email = get_email_from_chat_profile(profile.chat_profile)
            if user_email and user_email != responder_user:
                recipients_list.append(build_chat_recipients(profile.chat_profile))
                
    return recipients_list, responder_user
# ==========================================================================================
def build_instagram_recipient_gateway(profile_id, instagram_profile_doc, sender_id):   
    return {
        "profile_id": profile_id,
        "email": sender_id,
        "platform": "Instagram",
        "platform_profile": "ClefinCode Instagram Profile",
        "platform_gateway": instagram_profile_doc.name
    }    
# ==========================================================================================
def manage_instagram_personal_channel(sender_id, receiver_id, chat_profile, instagram_profile_doc, messages):
    receiver_user_email = instagram_profile_doc.user
    channel_info = check_if_channel_exists(sender_id, receiver_id, "Personal")
    
    if not channel_info:
        chat_channel = create_instagram_direct_channel(chat_profile, receiver_user_email, instagram_profile_doc, messages, sender_id)
        return [chat_channel , None]
    else:    
        chat_channel , pending_messages = channel_info 
        return [chat_channel , pending_messages] 
# ==========================================================================================
def create_instagram_direct_channel(chat_profile, receiver_user_email, instagram_profile_doc, messages, sender_id):
    channel_name = get_profile_full_name(receiver_user_email) 

    recipients_list = [
        build_chat_recipients(get_profile_id(receiver_user_email)),
        build_instagram_recipient_gateway(chat_profile, instagram_profile_doc, sender_id)
    ]
    
    message_content = messages[0].get("message", {}).get("text", None)
    
    if message_content:
        return create_channel(
            get_profile_full_name(sender_id),
            json.dumps(recipients_list),
            "Direct",
            format_html_string(messages[0]["message"]["text"]),
            receiver_user_email,
            channel_name
        )["results"][0]["room"]
        
    else :
        attachments = messages[0]["message"]["attachments"]

        # Extract attachment type and media URL and mime type
        attachment_type = attachments[0].get("type", "")
        media_url = attachments[0]["payload"]["url"]
        if not media_url:
            return
        
        mime_type = get_mime_type_from_url(media_url)
        file_name = messages[0]['message']['attachments'][0]['payload']['url'].split('/')[-1].split('?')[0]

        
        if attachment_type == "file":
            attachment_type = "document"

        file_url = download_media(media_url,mime_type,attachment_type)
        content = handle_attachment(file_url[0], file_name, attachment_type)
        
        return create_channel(
            get_profile_full_name(sender_id),
            json.dumps(recipients_list),
            "Direct",
            format_html_string(content),
            receiver_user_email,
            channel_name
        )["results"][0]["room"]        
# ==========================================================================================
def instagram_webhook_handle():
    """Handles the initial webhook verification."""
    meta_challenge = frappe.form_dict.get("hub.challenge")
    expected_token = frappe.db.get_single_value("ClefinCode Instagram Integration", "webhook_verify_token")

    if frappe.form_dict.get("hub.verify_token") != expected_token:
        frappe.throw("Verify token does not match")

    return Response(meta_challenge, status=200)      
# ==========================================================================================
def create_instagram_contact(sender_id, sender_profile_name):
    try:
        contact = frappe.get_doc({
            "doctype": "Contact",
            "first_name": sender_profile_name,
            "platform": "Instagram",
            "social_contact": [
                {
                    "social_id": sender_id,
                    "platform": "Instagram"
                }
            ]
        })
        contact.insert(ignore_permissions=True)
        return contact.name
    except Exception as e:
        frappe.log_error(title="Instagram Contact Creation Failed", message=str(e))
# ==========================================================================================
def resend_instagram_pending_messages(chat_channel, pending_messages_list, platform_gateway, sender_id):
    attachment = None
    channel_doc = frappe.get_doc("ClefinCode Chat Channel" , chat_channel)
    for messsage in pending_messages_list:
        message_doc = frappe.get_doc("ClefinCode Chat Message" , messsage.name)
        if message_doc.file_id:
            attachment = frappe.db.get_value("File" , message_doc.file_id, "file_url")

        process_instagram_message(platform_gateway, sender_id, message_doc.sender_email, channel_doc, channel_doc.last_responder_user, message_doc, message_doc.file_type, attachment, message_doc.content, message_doc.is_voice_clip, message_doc.is_screenshot)


# ==========================================================================================
# ==========================================================================================
# ===================================== Messenger Functions ================================
# ==========================================================================================
# ==========================================================================================
@frappe.whitelist(allow_guest=True)
def messenger_handle():
    """Handles Messenger webhook data."""
    if frappe.request.method == "GET":
        return messenger_webhook_handle()

    try:
        form_dict = frappe.local.form_dict
        log_webhook(form_dict)
        # Extract messages from form_dict
        messages = extract_social_messages(form_dict)
        if not messages:
            return
        message = messages[0]
        
        if "delivery" in message or "read" in message:
            return
        
        if message.get("errors"):
            frappe.log_error("Error Occurred Receiving Messenger Message", message)

        # Determine message type and content
        message_content = message.get("message", {}).get("text", None)


        media_url, mime_type, file_url = None, None, None

        sender_id, sender_profile_name = get_messenger_sender_info(message)
        receiver_id = get_receiver_id(form_dict)

        if not validate_messenger_receiver_profile(receiver_id):
            frappe.log_error("Invalid Receiver Profile", f"Receiver ID: {receiver_id}")

        messenger_profile_doc = None
                
        if not frappe.db.exists("ClefinCode Facebook Messenger Profile", receiver_id):
            messenger_profile_doc = frappe.db.get_value(
            "ClefinCode Chat Profile Contact Details",
            {"contact_info": receiver_id},
            "parent" 
            )
        else:
            messenger_profile_doc = frappe.get_doc("ClefinCode Facebook Messenger Profile", receiver_id)
            
            
        chat_profile = get_or_create_messenger_chat_profile(sender_id, sender_profile_name)
        chat_channel_info = handle_messenger_chat_channel(sender_id, receiver_id, chat_profile, messenger_profile_doc, messages)
        chat_channel, pending_messages = chat_channel_info
        last_sub_channel = get_last_active_sub_channel(chat_channel)["results"][0]["last_active_sub_channel"]
        
        response = None
        if pending_messages and pending_messages > 0:
            if message_content and message_content.lower() == "no":
                response = "remove"
            else:
                pending_messages_list = get_pending_messages(chat_channel, pending_messages, sender_id)
                response = "resend"

        # Process the message content
        if message_content:
            send(
                content=format_html_string(message_content),
                user=sender_profile_name,
                room=chat_channel,
                email=sender_id,
                sub_channel=last_sub_channel
            )
            
        elif "attachments" in message.get("message", {}):
            # Extract attachment details
            attachments = message["message"]["attachments"]

            # Extract attachment type and media URL and mime type
            attachment_type = attachments[0].get("type", "")
            media_url = attachments[0]["payload"]["url"]
            if not media_url:
                return
            
            mime_type = get_mime_type_from_url(media_url)
            file_name = form_dict['entry'][0]['messaging'][0]['message']['attachments'][0]['payload']['url'].split('/')[-1].split('?')[0]

            
            if attachment_type == "file":
                attachment_type = "document"

            file_url = download_media(media_url,mime_type,attachment_type)
            content = handle_attachment(file_url[0], file_name, attachment_type)


            send(
                content=content,
                user=sender_profile_name,
                room=chat_channel,
                email=sender_id,
                sub_channel=last_sub_channel,
                attachment=file_url[0],
                is_media= 1 if attachment_type in ['image', 'video', 'sticker'] else 0,
                is_document=attachment_type == "document",
                is_voice_clip=attachment_type == "audio",
                file_id=file_url[2]
            )

        if response == "resend":
            frappe.db.set_value(
                'ClefinCode Chat Channel User',
                {"parent": chat_channel, "user": sender_id, "platform_gateway": receiver_id},
                'pending_messages', 0
            )
            resend_messenger_pending_messages(chat_channel, pending_messages_list, receiver_id, sender_id)
        elif response == "remove":
            remove_group_member(sender_id, chat_channel)

    except Exception as e:
        frappe.log_error(title="Messenger Webhook Error", message=str(e))
# ==========================================================================================
def extract_social_messages(form_dict):
    """Extracts messages from the form_dict."""
    try:
        result = form_dict["entry"][0]

        messages = result.get("messaging")
        if messages:
            return messages

        statuses = result.get("statuses")
        if statuses:
            return statuses

        return []
    except (KeyError, IndexError) as e:
        frappe.log_error(title="Error extracting messages", message=str(e))
        return []
# ==========================================================================================
def fetch_messenger_username(sender_id):
    """Fetch the Messenger username using the Graph API."""
    try:
        access_token = get_access_token_messenger() 
        api_base = "https://graph.facebook.com/v17.0"
        endpoint = f"{api_base}/{sender_id}"
        
        params = {
            "fields": "username", 
            "access_token": access_token
        }
        
        response = requests.get(endpoint, params=params)
        
        if response.ok:
            return response.json().get("username", sender_id)  
        else:
            return sender_id 
        
    except Exception as e:
        return sender_id
# ==========================================================================================
def get_messenger_sender_info(message):
    try:
        sender_id = message["sender"]["id"]
        sender_profile_name = fetch_messenger_username(sender_id)
        return sender_id, sender_profile_name

    except KeyError as e:
        frappe.log_error("Failed to extract sender info", str(e))
        return None, "Unknown"
# ==========================================================================================
def get_or_create_messenger_chat_profile(sender_id, sender_profile_name):
    chat_profile = check_if_chat_profile_exists(sender_id)

    if not chat_profile:
        contact = create_messenger_contact(sender_id, sender_profile_name)
        chat_profile = frappe.db.get_value("ClefinCode Chat Profile", {"contact": contact}, "name")
    return chat_profile
# ==========================================================================================
def validate_messenger_receiver_profile(receiver_id):
    """Validates if a ClefinCode Chat Profile exists based on receiver_id matching contact_info or name."""
    try:
        # First, try to find in Contact Details
        contact_details = frappe.db.get_value(
            "ClefinCode Chat Profile Contact Details",
            {"contact_info": receiver_id},
            "parent"  # always specify the field!
        )
        
        if contact_details:
            return True

        # If not found, try in Messenger Profile
        profile = frappe.db.get_value(
            "ClefinCode Facebook Messenger Profile",
            {"name": receiver_id},
            "name"  # again, explicitly ask for the field
        )

        if profile:
            return True

        # If neither found, log error
        frappe.log_error(
            title="ClefinCode Messenger Receiver Not Found",
            message=f"Receiver ID not found: {receiver_id}"
        )
        return False

    except Exception as e:
        frappe.log_error(
            title="Error Validating Messenger Receiver Profile",
            message=str(e)
        )
        return False
# ==========================================================================================
def handle_messenger_chat_channel(sender_id, receiver_id, chat_profile, messenger_profile_doc, messages):
    if sender_id != receiver_id:
        chat_channel = None
        if messenger_profile_doc.type == "Support":
            chat_channel = manage_messenger_support_channel(sender_id, receiver_id, chat_profile, messenger_profile_doc)
        else:
            chat_channel = manage_messenger_personal_channel(sender_id, receiver_id, chat_profile, messenger_profile_doc, messages)
        return chat_channel   
# ==========================================================================================
def manage_messenger_support_channel(sender_id, receiver_id, chat_profile, messenger_profile_doc):
    channel_info = check_if_channel_exists(sender_id, receiver_id, "Support")
    if not channel_info:
        recipients_list, responder_user = build_messenger_recipients_list(chat_profile, messenger_profile_doc, sender_id)
        chat_channel = create_group(json.dumps(recipients_list), responder_user)["results"][0]["room"]
        return [chat_channel , None]
    else:    
        chat_channel , pending_messages = channel_info 
        return [chat_channel , pending_messages]
# ==========================================================================================
def build_messenger_recipients_list(chat_profile, messenger_profile_doc, sender_id):
    recipients_list = []

    responder_user = choose_user_to_respond("ClefinCode Facebook Messenger Profile", messenger_profile_doc.name)
    if not responder_user:
        return
    
    recipients_list.append(build_messenger_recipient_gateway(chat_profile, messenger_profile_doc, sender_id))        

    if messenger_profile_doc.receive_by_profile == 1:
        for profile in messenger_profile_doc.chat_profiles:
            user_email = get_email_from_chat_profile(profile.chat_profile)
            if user_email and user_email != responder_user:
                recipients_list.append(build_chat_recipients(profile.chat_profile))
                
    return recipients_list, responder_user
# ==========================================================================================
def build_messenger_recipient_gateway(profile_id, messenger_profile_doc, sender_id):  
    return {
        "profile_id": profile_id,
        "email": sender_id,
        "platform": "Messenger",
        "platform_profile": "ClefinCode Facebook Messenger Profile",
        "platform_gateway": messenger_profile_doc.name
    }    
# ==========================================================================================
def manage_messenger_personal_channel(sender_id, receiver_id, chat_profile, messenger_profile_doc, messages):
    receiver_user_email = messenger_profile_doc.user
    channel_info = check_if_channel_exists(sender_id, receiver_id, "Personal")
    
    if not channel_info:
        chat_channel = create_messenger_direct_channel(chat_profile, receiver_user_email, messenger_profile_doc, messages, sender_id)
        return [chat_channel , None]
    else:    
        chat_channel , pending_messages = channel_info 
        return [chat_channel , pending_messages] 
# ==========================================================================================
def create_messenger_direct_channel(chat_profile, receiver_user_email, messenger_profile_doc, messages, sender_id):
    channel_name = get_profile_full_name(receiver_user_email) 


    recipients_list = [
        build_chat_recipients(get_profile_id(receiver_user_email)),
        build_messenger_recipient_gateway(chat_profile, messenger_profile_doc, sender_id)
    ]
    message_content = messages[0].get("message", {}).get("text", None)
    
    if message_content:
        return create_channel(
            get_profile_full_name(sender_id),
            json.dumps(recipients_list),
            "Direct",
            format_html_string(messages[0]["message"]["text"]),
            receiver_user_email,
            channel_name
        )["results"][0]["room"]
        
    else :
        attachments = messages[0]["message"]["attachments"]
        # Extract attachment type and media URL and mime type
        attachment_type = attachments[0].get("type", "")
        media_url = attachments[0]["payload"]["url"]
        if not media_url:
            return
        
        mime_type = get_mime_type_from_url(media_url)
        file_name = messages[0]['message']['attachments'][0]['payload']['url'].split('/')[-1].split('?')[0]

        if attachment_type == "file":
            attachment_type = "document"

        file_url = download_media(media_url,mime_type,attachment_type)
        content = handle_attachment(file_url[0], file_name, attachment_type)
        
        return create_channel(
            get_profile_full_name(sender_id),
            json.dumps(recipients_list),
            "Direct",
            format_html_string(content),
            receiver_user_email,
            channel_name
        )["results"][0]["room"]
# ==========================================================================================
def messenger_webhook_handle():
    """Handles the initial webhook verification."""
    meta_challenge = frappe.form_dict.get("hub.challenge")
    expected_token = frappe.db.get_single_value("ClefinCode Facebook Messenger Integration", "webhook_verify_token")

    if frappe.form_dict.get("hub.verify_token") != expected_token:
        frappe.throw("Verify token does not match")

    return Response(meta_challenge, status=200)       
# ==========================================================================================
def create_messenger_contact(sender_id, sender_profile_name):
    try:
        contact = frappe.get_doc({
            "doctype": "Contact",
            "first_name": sender_profile_name,
            "platform": "Messenger",
            "social_contact": [
                {
                    "social_id": sender_id,
                    "platform": "Messenger"
                }
            ]
        })
        contact.insert(ignore_permissions=True)
        return contact.name
    except Exception as e:
        frappe.log_error(title="Messenger Contact Creation Failed", message=str(e))
# ==========================================================================================
def resend_messenger_pending_messages(chat_channel, pending_messages_list, platform_gateway, sender_id):
    attachment = None
    channel_doc = frappe.get_doc("ClefinCode Chat Channel" , chat_channel)
    for messsage in pending_messages_list:
        message_doc = frappe.get_doc("ClefinCode Chat Message" , messsage.name)
        if message_doc.file_id:
            attachment = frappe.db.get_value("File" , message_doc.file_id, "file_url")

        process_messenger_message(platform_gateway, sender_id, message_doc.sender_email, channel_doc, channel_doc.last_responder_user, message_doc, message_doc.file_type, attachment, message_doc.content, message_doc.is_voice_clip, message_doc.is_screenshot)   
# ==========================================================================================
def get_mime_type_from_url(url):
    try:
        response = requests.head(url)
        
        if response.status_code == 200:
            mime_type = response.headers.get('Content-Type')
            return mime_type
        else:
            print(f"Failed to retrieve MIME type, status code: {response.status_code}")
            return None
    except Exception as e:
        print(f"Error retrieving MIME type: {str(e)}")
        return None 
    
             
# ==========================================================================================    
# ==========================================================================================
# ===================================== Telegram Functions =================================
# ==========================================================================================
# ==========================================================================================
@frappe.whitelist(allow_guest=True)
def telegram_webhook():        
    try:
        if frappe.request.method == "POST":
            data = frappe.request.get_data(as_text=True)
            update = json.loads(data)
            telegram_log_webhook(update)             

            # Extract message details
            if "message" in update:
                text = None
                mime_type = None
                file_id = None
                message_type = None
                file_name = None

                # Check if the message has text
                if "text" in update["message"]:
                    text = update["message"]["text"]
                    message_type = "text"

                # Check if the message has a voice attachment
                elif "voice" in update["message"]:
                    mime_type = update["message"]["voice"]["mime_type"]
                    file_id = update["message"]["voice"]["file_id"]
                    message_type = "audio"

                # Check if the message has a photo attachment
                elif "photo" in update["message"]:
                    photo = update["message"]["photo"][-1]
                    file_id = photo["file_id"]
                    mime_type = "image/jpeg"  
                    message_type = "image"

                # Check if the message has a video attachment
                elif "video" in update["message"]:
                    video = update["message"]["video"]
                    file_id = video["file_id"]
                    mime_type = video["mime_type"]
                    file_name = video.get("file_name", "Unnamed Video")                    
                    message_type = "video"
                
                # Check if the message has a video note attachment
                elif "video_note" in update["message"]:
                    video_note = update["message"]["video_note"]
                    file_id = video_note["file_id"]
                    mime_type = "video/mp4" 
                    file_name = "VideoNote.mp4" 
                    message_type = "video"    
                    
                # Check if the message has a document attachment
                elif "document" in update["message"]:
                    document = update["message"]["document"]
                    file_id = document["file_id"]
                    mime_type = document["mime_type"]  
                    file_name = document["file_name"]  
                    message_type = "document"
     

                # Handle unknown or unsupported message types
                else:
                    message_type = "unknown"
                    
                chat_id = update["message"]["chat"]["id"]
                sender_id = update["message"]["from"]["id"]
                sender_first_name = update["message"]["from"]["first_name"]
                # sender_last_name = update["message"]["from"]["last_name"]
                sender_profile_name = update["message"]["from"].get("username", "") or f"{sender_first_name} {sender_last_name}"
                receiver_id = get_telegram_receiver_id()
                telegram_profile_doc = frappe.get_doc("ClefinCode Telegram Profile", receiver_id)
                chat_profile = get_or_create_telegram_chat_profile(sender_id, sender_profile_name)
                chat_channel_info = handle_telegram_chat_channel(sender_id, receiver_id, chat_profile, telegram_profile_doc, update)
                chat_channel, pending_messages = chat_channel_info
                last_sub_channel = get_last_active_sub_channel(chat_channel)["results"][0]["last_active_sub_channel"]
                channel = get_telegram_channel(receiver_id, sender_id)
                                
                if message_type == "text":
                   send(
                    content=format_html_string(text),
                    user=sender_profile_name,
                    room=chat_channel,
                    email=sender_id,
                    sub_channel=last_sub_channel
                )     
                
                elif message_type in ["audio", "image", "video", "document"]:
                    file_url = download_telegram_media(file_id , mime_type , message_type, file_name)
                    content = handle_attachment(file_url[0], file_name, message_type)
                    
                    send(
                    content=content,
                    user=sender_profile_name,
                    room=chat_channel,
                    email=sender_id,
                    sub_channel=last_sub_channel,
                    attachment=file_url[0],
                    is_media= 1 if message_type in ['image', 'video', 'sticker'] else 0,
                    is_document = message_type == "document",
                    is_voice_clip = message_type == "audio",
                    file_id = file_url[2]
                )
                
        else:
            frappe.log_error("Invalid request method.", "Telegram Debugging")
        
    except Exception as e:
        frappe.log_error(title="Telegram Webhook Error", message=str(e))
        return {"error": "An error occurred while handling the webhook."}
# ==========================================================================================
def telegram_log_webhook(data):
    """
    Logs the webhook data into the ClefinCode Webhook Log Doctype.
    """
    try:
        frappe.get_doc({
            "doctype": "ClefinCode Webhook Log",
            "response": json.dumps(data, indent=2) 
        }).insert(ignore_permissions=True)
        frappe.db.commit()
    except Exception as e:
        frappe.log_error("Failed to log webhook data:", str(e))
# ==========================================================================================
def get_telegram_receiver_id():
    try:
        profiles = frappe.get_all("ClefinCode Telegram Profile", fields=["telegram_profile_id"])
        receiver_id = profiles[0].get("telegram_profile_id")
        return receiver_id
    except Exception as e:
        frappe.log_error("Failed to fetch Telegram Receiver ID:", str(e))
        return None
# ==========================================================================================
@frappe.whitelist(allow_guest=True)
def set_telegram_webhook():
    #access_token = frappe.db.get_value("ClefinCode Telegram Integration", None, "access_token")
    doc = frappe.get_doc("ClefinCode Telegram Integration")
    access_token = doc.get_password("access_token")
    if not access_token:
        frappe.throw("Access token for Telegram Integration is missing.")
   
    
    base_url = frappe.utils.get_url()
    webhook_url = f"{base_url}/api/method/clefincode_chat.webhook.telegram_webhook"

    frappe.log_error("telegram", f"https://api.telegram.org/bot{access_token}/setWebhook")
    response = requests.post(
        f"https://api.telegram.org/bot{access_token}/setWebhook",
        json={"url": webhook_url}
    )
    frappe.log_error("telegram", f"https://api.telegram.org/bot{access_token}/setWebhook")
    if response.ok:
        frappe.log_error("Telegram webhook set successfully!")
    else:
        error_description = response.json().get("description", "Unknown error")
        frappe.throw(f"Failed to set webhook: {error_description}")
# ==========================================================================================
def get_or_create_telegram_chat_profile(sender_id, sender_profile_name):
    chat_profile = check_if_chat_profile_exists(sender_id)
    
    if not chat_profile:
        contact = create_telegram_contact(sender_id, sender_profile_name)
        chat_profile = frappe.db.get_value("ClefinCode Chat Profile", {"contact": contact}, "name")
    return chat_profile
# ==========================================================================================
def create_telegram_contact(sender_id, sender_profile_name):
    try:
        contact = frappe.get_doc({
            "doctype": "Contact",
            "first_name": sender_profile_name,
            "platform": "Telegram",
            "social_contact": [
                {
                    "social_id": sender_id,
                    "platform": "Telegram"
                }
            ]
        })
        contact.insert(ignore_permissions=True)
        return contact.name
    except Exception as e:
        frappe.log_error(title="Telegram Contact Creation Failed", message=str(e))
# ==========================================================================================
def handle_telegram_chat_channel(sender_id, receiver_id, chat_profile, telegram_profile_doc, update):
    try:    
        chat_channel = None
        if telegram_profile_doc.type == "Support":
            chat_channel = manage_telegram_support_channel(sender_id, receiver_id, chat_profile, telegram_profile_doc)
        else:
            chat_channel = manage_telegram_personal_channel(sender_id, receiver_id, chat_profile, telegram_profile_doc, update)
        return chat_channel
    except Exception as e:
        frappe.log_error(title="Telegram Chat Channel Error", message=str(e))
        return None, None
# =============================================================================================
def manage_telegram_support_channel(sender_id, receiver_id, chat_profile, telegram_profile_doc):
    channel_info = check_if_channel_exists(sender_id, receiver_id, "Support")
    if not channel_info:
        recipients_list, responder_user = build_telegram_recipients_list(chat_profile, telegram_profile_doc, sender_id)
        chat_channel = create_group(json.dumps(recipients_list), responder_user)["results"][0]["room"]
        return [chat_channel , None]
    else:    
        chat_channel , pending_messages = channel_info 
        return [chat_channel , pending_messages]
# ==========================================================================================
def build_telegram_recipients_list(chat_profile, telegram_profile_doc, sender_id):
    recipients_list = []

    responder_user = choose_user_to_respond("ClefinCode Telegram Profile", telegram_profile_doc.name)
    if not responder_user:
        return
    
    recipients_list.append(build_telegram_recipient_gateway(chat_profile, telegram_profile_doc, sender_id))        

    if telegram_profile_doc.receive_by_profile == 1:
        for profile in telegram_profile_doc.chat_profiles:
            user_email = get_email_from_chat_profile(profile.chat_profile)
            if user_email and user_email != responder_user:
                recipients_list.append(build_chat_recipients(profile.chat_profile))
                
    return recipients_list, responder_user
# ==========================================================================================
def build_telegram_recipient_gateway(profile_id, telegram_profile_doc, sender_id):    
    return {
        "profile_id": profile_id,
        "email": sender_id,
        "platform": "Telegram",
        "platform_profile": "ClefinCode Telegram Profile",
        "platform_gateway": telegram_profile_doc.name
    }    
# ==========================================================================================
def manage_telegram_personal_channel(sender_id, receiver_id, chat_profile, telegram_profile_doc, update):
    receiver_user_email = telegram_profile_doc.user
    channel_info = check_if_channel_exists(sender_id, receiver_id, "Personal")
    
    if not channel_info:
        chat_channel = create_telegram_direct_channel(chat_profile, receiver_user_email, telegram_profile_doc, update, sender_id)
        return [chat_channel , None]
    else:    
        chat_channel , pending_messages = channel_info 
        return [chat_channel , pending_messages] 
# ==========================================================================================
def create_telegram_direct_channel(chat_profile, receiver_user_email, telegram_profile_doc, update, sender_id):
    channel_name = get_profile_full_name(receiver_user_email) 
    recipients_list = [
        build_chat_recipients(get_profile_id(receiver_user_email)),
        build_telegram_recipient_gateway(chat_profile, telegram_profile_doc, sender_id)
    ]
    
    if "text" in update["message"]:
        text = update["message"]["text"]
                
        return create_channel(
            get_profile_full_name(sender_id),
            json.dumps(recipients_list),
            "Direct",
            format_html_string(text),
            receiver_user_email,
            channel_name
        )["results"][0]["room"]

    # Check if the message has a voice attachment
    elif "voice" in update["message"]:
        mime_type = update["message"]["voice"]["mime_type"]
        file_id = update["message"]["voice"]["file_id"]
        message_type = "audio"
        file_name = None
        

    # Check if the message has a photo attachment
    elif "photo" in update["message"]:
        photo = update["message"]["photo"][-1]
        file_id = photo["file_id"]
        mime_type = "image/jpeg"  # Telegram doesn't provide mime_type directly for photos
        message_type = "image"
        file_name = photo.get("file_name", "Unnamed Image")

    # Check if the message has a video attachment
    elif "video" in update["message"]:
        video = update["message"]["video"]
        file_id = video["file_id"]
        mime_type = video["mime_type"]
        file_name = video.get("file_name", "Unnamed Video")                    
        message_type = "video"

    # Check if the message has a video note attachment
    elif "video_note" in update["message"]:
        video_note = update["message"]["video_note"]
        file_id = video_note["file_id"]
        mime_type = "video/mp4"  
        file_name = "VideoNote.mp4"  
        message_type = "video"    
        
    # Check if the message has a document attachment
    elif "document" in update["message"]:
        document = update["message"]["document"]
        file_id = document["file_id"]
        mime_type = document["mime_type"]  
        file_name = document["file_name"]  
        message_type = "document"
    
    file_url = download_telegram_media(file_id , mime_type , message_type, file_name) 
    content = handle_attachment(file_url[0], file_name, message_type)
    
    return create_channel(
            get_profile_full_name(sender_id),
            json.dumps(recipients_list),
            "Direct",
            format_html_string(content),
            receiver_user_email,
            channel_name
        )["results"][0]["room"]
# ==========================================================================================
def download_telegram_media(file_id, mime_type, message_type, file_name = None):
    try:
        access_token = get_decrypted_password(
            "ClefinCode Telegram Integration",  
            "ClefinCode Telegram Integration",                               
            "access_token"                      
        )
        
        url = f"https://api.telegram.org/bot{access_token}/getFile?file_id={file_id}"
        file_response = requests.get(url)
        

        if not file_response.ok:
            return None, None, None

        file_path = file_response.json().get("result", {}).get("file_path")
        if not file_path:
            frappe.log_error("File path is empty in Telegram response", "Telegram Debugging")
            return None, None, None

        # Download the media file
        download_url = f"https://api.telegram.org/file/bot{access_token}/{file_path}"
        media_response = requests.get(download_url)

        if not media_response.ok:
            frappe.log_error(f"Failed to download media: {media_response.text}", "Telegram Debugging")
            return None, None, None

        # Handle file content and type
        mimetypes.add_type('image/webp', '.webp')
        extension = None
        file_bytes = media_response.content

        if message_type == 'audio':
            file_bytes = convert_opus_to_aac(file_bytes)
            extension = ".aac"
        else:
            extension = mimetypes.guess_extension(mime_type, strict=False)

        # Save the file in the Frappe system
        file_doc = frappe.get_doc({
            "doctype": "File",
            "file_name": random_string(8) + extension if not file_name else file_name,
            "folder": "Home/attachments",
            "content": file_bytes,
            "is_private": 1
        })
        file_doc.insert(ignore_permissions=True)
        frappe.db.commit()

        return file_doc.file_url, file_doc.file_size, file_doc.name

    except Exception as e:
        frappe.log_error(title="Telegram Media Download Error", message=str(e))
        return None, None, None
# ==========================================================================================# ==========================================================================================
@frappe.whitelist(allow_guest=True)
def whatsapp_twillio_webhook():

    try:
        form_dict = frappe.local.form_dict
        log_webhook(form_dict)

        # =============================
        # Helper: Normalize WhatsApp numbers
        # =============================
        def normalize_number(number: str) -> str:
            return number.replace("whatsapp:+", "") if number and number.startswith("whatsapp:+") else number

        message_body = form_dict.get("Body")
        sender_number = normalize_number(form_dict.get("From"))
        receiver_number = normalize_number(form_dict.get("To"))
        message_type = "text"
        sender_profile_name=form_dict.get("ProfileName")
        # =============================
        # MEDIA CHECK (Images, Videos, Audio, Documents, vCard)
        # =============================
        media_count = int(form_dict.get("NumMedia", "0"))
        media_url, mime_type, file_url, file_id, vcard_text = None, None, None, None, None

        if media_count > 0:
            # Example: "image/jpeg" → media_type=image , mime_type=jpeg
            media_type = form_dict.get("MediaContentType0", "").split("/")[0]
            mime_type = form_dict.get("MediaContentType0", "").split("/")[1]
            media_url = form_dict.get("MediaUrl0")

            # Download the media (including vCard if MIME is text/vcard)
            file_url, file_id, vcard_text = download_media_twilio(
                media_url,
                mime_type=mime_type,
                message_type=media_type
            )

            message_type = media_type


        # =============================
        # LOCATION CHECK
        # =============================
        latitude = longitude = None
        if form_dict.get("MessageType") == "location":
            message_type = "location"
            latitude = form_dict.get("Latitude")
            longitude = form_dict.get("Longitude")


        # =============================
        # CONTACT CHECK (vCard)
        # =============================
        if form_dict.get("MessageType") == "contacts":
            message_type = "contacts"


        # Validate receiving WhatsApp profile
        if not validate_receiver_profile(str(receiver_number)):
            return

        # Retrieve or create chat profile
        chat_profile = get_or_create_chat_profile(sender_number, sender_profile_name)
        whatsapp_profile_doc = frappe.get_doc("ClefinCode WhatsApp Profile", receiver_number)
        

        # Register message inside chat channel
        chat_channel_info = handle_chat_channel(
            sender_number,
            receiver_number,
            chat_profile,
            whatsapp_profile_doc,
            messages=[{"text": {"type": message_type, "body": message_body}}]
        )

        chat_channel, _,email = chat_channel_info
        last_sub_channel = get_last_active_sub_channel(chat_channel)["results"][0]["last_active_sub_channel"]

        if email is None:
            email=sender_number
        # =============================
        # TEXT MESSAGE
        # =============================
        if message_type == "text":
      
            send(
                content=f"<p>{message_body}</p>",
                user=sender_number,
                room=chat_channel,
                email=email,
                sub_channel=last_sub_channel
            )
            return


        # =============================
        # LOCATION MESSAGE
        # =============================
        if message_type == "location":

            # Download static map + save inside ERPNext
            map_file_url, map_file_id = save_location_map(latitude, longitude)

            # Generate HTML using the saved map URL
            content = handle_attachment_twilio(
                file_url=map_file_url,
                file_name=f"location_{latitude}_{longitude}.png",
                message_type="location",
                latitude=latitude,
                longitude=longitude,
                extra_data={"file_id": map_file_id}
            )

            send(
                content=content,
                user=sender_number,
                room=chat_channel,
                email=email,
                sub_channel=last_sub_channel,
                attachment=map_file_url,
                is_media=1,
                file_id=map_file_id
            )
            return


        # =============================
        # CONTACT CARD (vCard)
        # =============================
        if message_type == "contacts":

            file_name = form_dict.get("MediaFilename0", "contact.vcf")

            # Parse vCard text extracted earlier
            name, phone = parse_vcard(vcard_text or "")

            # Generate WhatsApp-style preview card
            content = handle_attachment_twilio(
                file_url=file_url,
                file_name=file_name,
                message_type="contacts",
                extra_data={"name": name, "phone": phone}
            )

            send(
                content=content,
                user=sender_number,
                room=chat_channel,
                email=email,
                sub_channel=last_sub_channel,
                attachment=file_url,
                is_document=1,
                file_id=file_id
            )
            return


        # =============================
        # OTHER MEDIA (Image, Video, Audio, Document)
        # =============================
        file_name = form_dict.get("MediaFilename0", "attachment")

        content = handle_attachment_twilio(
            file_url=file_url,
            file_name=file_name,
            message_type=message_type
        )
        message_type=form_dict.get("MessageType")
        is_media = 1 if message_type in ["image", "video", "sticker"] else 0
        is_document = 1 if message_type == "document" else 0
        is_voice_clip = 1 if message_type  in ["audio"] else 0
        

        send(
            content=content + f"<p>{message_body}</p>",
            user=sender_number,
            room=chat_channel,
            email=email,
            sub_channel=last_sub_channel,
            attachment=file_url,
            is_media=is_media,
            is_document=is_document,
            is_voice_clip=is_voice_clip,
            file_id=file_id
        )

    except Exception:
        frappe.log_error(title="Twilio WhatsApp Webhook Error", message=frappe.get_traceback())


def download_media_twilio(media_url, mime_type=None, message_type="media", filename=None, folder="Home/Attachments"):

    doc = frappe.get_doc("ClefinCode Twilio Integration")
    account_sid = doc.get("account_sid")
    auth_token = get_auth_token_twillio()

    if not media_url:
        return None, None, None

    # Build filename
    if not filename:
        ext = mime_type.split("/")[-1] if mime_type else "bin"
        filename = f"{message_type}_{int(frappe.utils.now_datetime().timestamp())}.{ext}"

    try:
        response = requests.get(media_url, auth=HTTPBasicAuth(account_sid, auth_token))

        if response.status_code != 200:
            frappe.log_error(
                title="Twilio Media Download Failed",
                message=f"Status: {response.status_code}, URL: {media_url}"
            )
            return None, None, None

        # =====================================================
        # SPECIAL CASE: VCARD (Return text content)
        # =====================================================
        if mime_type == "vcard" or mime_type == "x-vcard" or message_type == "contacts":
            vcard_text = response.text
            # Save also as file (optional but useful)
            file_doc = frappe.get_doc({
                "doctype": "File",
                "file_name": filename,
                "folder": folder,
                "is_private": 1,
                "content": response.content
            })
            file_doc.insert(ignore_permissions=True)
            frappe.db.commit()

            return file_doc.file_url, file_doc.name, vcard_text

        # =====================================================
        # NORMAL MEDIA (image, video, audio, pdf, etc...)
        # =====================================================
        file_doc = frappe.get_doc({
            "doctype": "File",
            "file_name": filename,
            "folder": folder,
            "is_private": 1,
            "content": response.content
        })
        file_doc.insert(ignore_permissions=True)
        frappe.db.commit()

        return file_doc.file_url, file_doc.name, None

    except Exception as e:
        frappe.log_error(title="Twilio Media Download Error", message=str(e))
        return None, None, None

#=====================================================================================

def handle_attachment_twilio(file_url, file_name, message_type,
                      latitude=None, longitude=None, extra_data=None):

    """
    Generates HTML display for attachments (images, audio, videos, vCards, locations, documents).
    extra_data is used for passing parsed vCard info.
    """

    extra_data = extra_data or {}

    # =============== CONTACT CARD (vCard) ===============
    if message_type == "contacts":
        name = extra_data.get("name", "Contact")
        phone = extra_data.get("phone", "")

        # WhatsApp-style contact preview card
        return  f"""
<div style="width: 240px; background: #fff; border-radius: 12px;
            padding: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            font-family: sans-serif;">

    <!-- Avatar -->
    <div style="display:flex; align-items:center;">
        <div style="width:45px; height:45px; background:#dfe5e7;
                    border-radius:50%; display:flex;
                    justify-content:center; align-items:center;
                    font-size:20px; color:#444;">
            {name[0] if name else "?"}
        </div>

        <div style="margin-left:10px;">
            <div style="font-size:15px; font-weight:bold;">{name}</div>
            <div style="font-size:13px; color:#777;">{phone}</div>
        </div>
    </div>

    <!-- Buttons -->
    <div style="margin-top:15px; display:flex; flex-direction:column; gap:8px;">

        <!-- Download vCard -->
        <button onclick="window.open('{file_url}', '_blank')"
                style="background:#00A884; color:#fff; border:none;
                       padding:8px 12px; border-radius:8px;
                       font-size:13px; cursor:pointer; width:100%;">
            Download vCard
        </button>

        <!-- Create Contact -->
        <button onclick="createFrappeContact('{phone}', 'phone', '{name}')"
                style="background:#027eb5; color:#fff; border:none;
                       padding:8px 12px; border-radius:8px;
                       font-size:13px; cursor:pointer; width:100%;">
            Create Contact
        </button>

    </div>
</div>

<script>
function createFrappeContact(contact_info, contact_type, profile_id) {{
    frappe.call({{
        method: "clefincode_chat.api.api_1_3_1.api.create_contact",
        args: {{
            contact_info: contact_info,
            contact_type: contact_type,
            profile_id: profile_id
        }},
        callback: function(r) {{
            if (r.message) {{
                alert("Contact created successfully: " + r.message);
            }} else {{
                alert("Error creating contact");
            }}
        }}
    }});
}}
</script>
"""


    # =============== LOCATION MESSAGE ===============
    elif message_type == 'location':
            lat = latitude or ""
            lon = longitude or ""

            map_url = f"https://www.google.com/maps?q={lat},{lon}&hl=en"

            # Location icon
            icon_url = "/assets/clefincode_chat/images/location.png"

            return f""" <div class="document-container d-flex flex-column justify-content-start align-items-start" 
         style="width:235px;">

        <!-- BIG MAP IMAGE -->
        <a href="{map_url}" target="_blank" style="width:100%;">
            <img src="{file_url}" 
                 style="width:235px; border-radius:8px; display:block;">
        </a>
          </div>
        <p>
                <a href="{map_url}" target="_blank">
                    Location: {lat}, {lon}
                </a>
            </p>
             """

    # =============== IMAGE ===============
    elif message_type == 'image':
        return f"""
        <a href="{file_url}" target="_blank">
            <img src="{file_url}" class="img-responsive chat-image">
        </a>
        """

    # =============== VIDEO ===============
    elif message_type == 'video':
        return f"""
        <div>
            <video src="{file_url}" controls="controls" style="width:235px"></video>
        </div>
        """

    # =============== AUDIO ===============
    elif message_type == 'audio':
          
            return f"""<div><div class="voice-clip-container" data-audio="{file_url.split("/")[-1]}"><div class="record-sec"><div class="record-line"><canvas class="record-canvas"></canvas></div></div>
                    <button class="audio-btn" aria-label="Play voice message">
                    <span data-icon="audio-play">
                        <svg viewBox="0 0 45 34" height="34" width="34" preserveAspectRatio="xMidYMid meet">
                            <path fill="currentColor"
                                d="M8.5,8.7c0-1.7,1.2-2.4,2.6-1.5l14.4,8.3c1.4,0.8,1.4,2.2,0,3l-14.4,8.3
                                c-1.4,0.8-2.6,0.2-2.6-1.5V8.7z">
                            </path>
                        </svg>
                    </span><span data-icon="audio-pause" class="stop-btn" style="display:none;">
                        <svg viewBox="0 0 45 34" height="34" width="34" preserveAspectRatio="xMidYMid meet">
                            <path fill="currentColor"
                                d="M9.2,25c0,0.5,0.4,1,0.9,1h3.6c0.5,0,0.9-0.4,0.9-1V9c0-0.5-0.4-0.9-0.9-0.9h-3.6
                                C9.7,8,9.2,8.4,9.2,9V25z M20.2,8c-0.5,0-1,0.4-1,0.9V25c0,0.5,0.4,1,1,1h3.6c0.5,0,1-0.4,1-1V9
                                c0-0.5-0.4-0.9-1-0.9C23.8,8,20.2,8,20.2,8z">
                            </path></svg></span></button></div></div>"""


    # =============== DOCUMENT ===============
    elif message_type == 'document':
        file_extension = file_name.split('.')[-1].lower()

        # Map file extensions to icons
        icon_url = {
            'pdf': '/assets/clefincode_chat/images/pdf-red.png',
            'doc': '/assets/clefincode_chat/images/docx.png',
            'docx': '/assets/clefincode_chat/images/docx.png',
            'xls': '/assets/clefincode_chat/images/xlsx.png',
            'xlsx': '/assets/clefincode_chat/images/xlsx.png',
            'csv': '/assets/clefincode_chat/images/xlsx.png',
            'ppt': '/assets/clefincode_chat/images/ppt.png',
            'pptx': '/assets/clefincode_chat/images/ppt.png',
            'zip': '/assets/clefincode_chat/images/rar.png',
            'rar': '/assets/clefincode_chat/images/rar.png'
        }.get(file_extension, '/assets/clefincode_chat/images/txt.png')

        return f"""
        <div class="document-container d-flex flex-row justify-content-start align-items-center" style="width: 235px;">
            <img style="height: 32px;margin-right: 8px;" src="{icon_url}">
            <a href="{file_url}" target="_blank">{file_name}</a>
        </div>
        """

    # =============== DEFAULT FALLBACK ===============
    else:
        return f"""
        <a href="{file_url}" target="_blank" style="color: #027eb5;">{file_name}</a>
        """
    
    

def parse_vcard(vcard_text):
    """
    Extracts contact name and phone number from a vCard (.vcf) text file.
    """
    name = None
    phone = None

    # Loop through each line in the vCard file
    for line in vcard_text.splitlines():
        line = line.strip()

        # Extract full name field: FN:John Doe
        if line.startswith("FN:"):
            name = line.replace("FN:", "").strip()

        # Extract phone number field: TEL;CELL:+12345
        if line.startswith("TEL"):
            parts = line.split(":")
            if len(parts) > 1:
                phone = parts[-1].strip()

    return name, phone
def save_location_map(lat, lon, folder="Home/Attachments"):
    """
    Download static location map image from Yandex
    and save it as a File in ERPNext.
    Returns (file_url, file_id)
    """

    import requests

    # Yandex static map (no API key required)
    map_url = f"https://static-maps.yandex.ru/1.x/?ll={lon},{lat}&size=450,250&z=15&l=map&pt={lon},{lat},pm2rdm"

    response = requests.get(map_url)

    if response.status_code != 200:
        frappe.log_error("Map Download Error", f"Failed to download map image: {map_url}")
        return None, None

    filename = f"location_{lat}_{lon}.png"

    # Save as ERPNext File
    file_doc = frappe.get_doc({
        "doctype": "File",
        "file_name": filename,
        "folder": folder,
        "is_private": 1,
        "content": response.content
    })
    file_doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return file_doc.file_url, file_doc.name
