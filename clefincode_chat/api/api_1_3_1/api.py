import random
import re
import traceback
import frappe, shutil, os
import datetime
import json
import mimetypes

import base64
from PIL import Image
from io import BytesIO
from typing import List, Dict
from twilio.rest import Client
from frappe import _
import pytz
from moviepy.editor import VideoFileClip
import io
import time
from bs4 import BeautifulSoup
from frappe.desk.doctype.notification_log.notification_log import enqueue_create_notification
from frappe.utils.password import Auth
from passlib.context import CryptContext
from frappe import __version__ as frappe_version
import requests
from clefincode_chat.utils.fcm_notifications import send_notification_via_firebase ,send_notification_log_via_firebase
from clefincode_chat.utils.utils import  get_access_token, get_access_token_instagram,get_access_token_messenger, check_template_status, get_auth_token_twillio
import subprocess
from dateutil import parser
import urllib.parse
from urllib.parse import unquote
from frappe.utils.password import get_decrypted_password
import zipfile
from moviepy.editor import VideoFileClip
import tempfile
from frappe.utils import now_datetime
from frappe.utils import get_files_path, get_url
from frappe.utils.file_manager import save_file
from frappe.utils.pdf import get_pdf
import shutil
import os
import threading
import time






passlibctx = None
if int(frappe_version.split('.')[0]) > 14:
    from frappe.client import get_time_zone
    passlibctx = CryptContext(
    schemes=[
        "pbkdf2_sha256",
        "argon2",
    ],
)
else:
    from frappe.utils import get_time_zone
    passlibctx = CryptContext(
    schemes=[
        "pbkdf2_sha256",
        "argon2",
        "frappe_legacy",
    ],
    deprecated=[
        "frappe_legacy",
    ],
)

def get_clean_timezone(user_timezone):
    if isinstance(user_timezone, dict):
        return user_timezone.get("time_zone", "UTC")
    elif isinstance(user_timezone, str):
        return user_timezone
    return "UTC"

#############################################################################################
######################################## Users Accounts #####################################
#############################################################################################
@frappe.whitelist(allow_guest = True)
def login(email , password): 
    user = frappe.db.get("User", {"email": email}) 
    if user:
        if not user.enabled:          
            return [{"status":0,"description":"User Account is disabled","data":None}]
        result =(
            frappe.qb.from_(Auth)
            .select(Auth.name, Auth.password)
            .where(
                (Auth.doctype == "User")
                & (Auth.name == user.email)
                & (Auth.fieldname == "password")
                & (Auth.encrypted == 0)
            )
            .limit(1)
            .run(as_dict=True)
        )

        if not result or not passlibctx.verify(password, result[0].password):
            return [{"status":0,"description":"Incorrect email or password","data":None}]
            
        else:
            user = frappe.get_doc('User' , email)
            api_secret = frappe.generate_hash(length=15)
            # if api key is not set generate api key
            if not user.api_key:
                api_key = frappe.generate_hash(length=15)
                user.api_key = api_key
            user.api_secret = api_secret
            user.save(ignore_permissions=True)
            frappe.db.commit()               
            return [{'status':1,"description":"Done successfully","data":[{"api_key":user.api_key,"api_secret":api_secret,'full_name':user.full_name}]}]
            
    else:    
        return [{"status":0,"description":"User doesn't exist","data":None}]
# ==========================================================================================
@frappe.whitelist()
def get_versions():   
    versions = {}
    send_notification_with_content = 0
    try:
        enable_mobile_notifications = frappe.db.get_single_value("ClefinCode Chat Settings" , "enable_mobile_notifications")
        enable_system_notification_on_mobile_app = frappe.db.get_single_value("ClefinCode Chat Settings" , "enable_system_notification_on_mobile_app")
        if enable_mobile_notifications == 1:
            send_notification_with_content = frappe.db.get_single_value("ClefinCode Chat Settings" , "with_message_content")
        installed_apps = frappe.get_installed_apps()

        sorted_installed_apps = sorted(installed_apps)

        for app in sorted_installed_apps:
            versions.update({app : frappe.get_attr(app + ".__version__")})

        versions.update({"enable_mobile_notifications" : enable_mobile_notifications , "send_notification_with_content" : send_notification_with_content,"enable_system_notification_on_mobile_app":enable_system_notification_on_mobile_app})               

        return [{'status':1,"description":"Done successfully","data":[versions]}]
    except Exception as e:
        return [{"status":0,"description":"error","data":str(e)}]    
# ==========================================================================================
@frappe.whitelist(allow_guest = True)
def check_server():
    list_app_for_update=[
        {"frappe" : frappe.get_attr("frappe" + ".__version__")},
        {"clefincode_chat" : frappe.get_attr("clefincode_chat" + ".__version__")}]
 
    return [{"status":1,"description":"Done","data":list_app_for_update}]
# ==========================================================================================
@frappe.whitelist(allow_guest = False)
def get_user_theme_mode(email):
    them = frappe.get_value("User", email,"desk_theme")
    thems=[]
    thems.append({'them':str(them)})
    return [{"status":1,"description":"Done","data":thems}]
#############################################################################################
######################################## Settings ###########################################
#############################################################################################
@frappe.whitelist()
def set_registration_token(user_email, registration_token):
    try:
        user_profile = get_profile_id(user_email)
        if user_profile:
            old_token = get_registration_token(user_email)            
            if old_token != registration_token:
                frappe.db.set_value("ClefinCode Chat Profile" , user_profile , "registration_token" , registration_token)
                # send_notification(user_email , {"realtime_type" : "session_expired" , "old_token" : old_token}, "session_expired")
                return {"results" : [{"status" : 1}]}
            else:
                return {"results" : [{"status" : 1}]}
        else:
            return {"results" : [{"status" : "User not found"}]}
    except Exception as e:
        return {"results" : [{"status" : e}]}
# ==========================================================================================
@frappe.whitelist()
def check_registration_token(user_email, registration_token):    
    old_token = get_registration_token(user_email)
    if old_token != registration_token:
        return {"results" : [{"status" : 0}]}
    else:
        return {"results" : [{"status" : 1}]}
# ==========================================================================================
def get_registration_token(user_email):
    user_profile = get_profile_id(user_email)
    if user_profile:
        registration_token = frappe.db.get_value("ClefinCode Chat Profile" , user_profile , "registration_token")
        return registration_token    
# ==========================================================================================
@frappe.whitelist()
def set_platform(user_email, platform): 
    user_profile = get_profile_id(user_email)
    if user_profile:
        frappe.db.set_value("ClefinCode Chat Profile" , user_profile , "platform" , platform)
    return {"results" : [{"status" : "Done"}]}
# ==========================================================================================
def get_platform(user_email):   
    user_profile = get_profile_id(user_email)
    if user_profile:
        platform = frappe.db.get_value("ClefinCode Chat Profile" , user_profile , "platform")
        return platform
    else:
        return str(user_email)
# ==========================================================================================
def get_platform_for_chat(user_profile):    
    platform = frappe.db.get_value("ClefinCode Chat Profile", user_profile, "chat_platform")   
    return platform
# ==========================================================================================
@frappe.whitelist(allow_guest=True)
def get_settings(token):
    
    config = {
        'socketio_port': frappe.conf.socketio_port,
        'user_email': frappe.session.user,
        'is_admin': True if 'user_type' in frappe.session.data else False,
        'user_type': get_user_type(),
        'is_limited_user': False,
    }
    config = {**config, **get_chat_settings()}

    if config['user_type'] == "guest":
        config['user'] = 'Guest'
        profile_details = validate_token(token)
        if profile_details:
            config['channel'] = profile_details['channel']
            config['is_verified'] = True
        else:
            config['is_verified'] = False
    
    elif config['user_type'] == "website_user":
        config['user'] = frappe.db.get_value('User', config['user_email'], 'full_name')
        config['time_zone'] = frappe.db.get_value('User', config['user_email'], 'time_zone')

    elif config['user_type'] == "system_user":
        if is_limited_user(config['user_email']):
            config['is_limited_user'] = True
        else:
            config['whatsapp_numbers'] = get_whatsapp_numbers_for_sender(config['user_email'])
            config['default_whatsapp_number'] , config['default_whatsapp_type']= get_default_whatsapp_number(config['whatsapp_numbers'])
            config['default_instagram_profile'] = get_default_instagram_profile()
            config['default_messenger_profile'] = get_default_messenger_profile()
            config['default_telegram_profile'] = get_default_telegram_profile()
            
        
        config['user'] = frappe.db.get_value('User', config['user_email'], 'full_name')
        config['time_zone'] = frappe.db.get_value('User', config['user_email'], 'time_zone')
    
    return config
# ==========================================================================================
def get_default_instagram_profile():
    doc = frappe.get_all(
        "ClefinCode Instagram Profile",
        fields=["name"],
        limit=1
    )
    return doc[0].name if doc else None
# ==========================================================================================
def get_default_messenger_profile():
    doc = frappe.get_all(
        "ClefinCode Facebook Messenger Profile",
        fields=["name"],
        limit=1
    )
    return doc[0].name if doc else None
# ==========================================================================================
def get_default_telegram_profile():
    doc = frappe.get_all(
        "ClefinCode Telegram Profile",
        fields=["name"],
        limit=1
    )
    return doc[0].name if doc else None
# ==========================================================================================
def get_default_instagram_profile_for_user():
    doc = frappe.get_all(
        "ClefinCode Instagram Profile",
        fields=["name", "type"],
        limit=1
    )
    return (doc[0]["name"], doc[0]["type"]) if doc else (None, None)
# ==========================================================================================
def get_default_messenger_profile_for_user():
    doc = frappe.get_all(
        "ClefinCode Facebook Messenger Profile",
        fields=["name", "type"],
        limit=1
    )
    return (doc[0]["name"], doc[0]["type"]) if doc else (None, None)
# ==========================================================================================
def get_default_telegram_profile_for_user():
    doc = frappe.get_all(
        "ClefinCode Telegram Profile",
        fields=["name", "type"],
        limit=1
    )
    return (doc[0]["name"], doc[0]["type"]) if doc else (None, None)
# ==========================================================================================
@frappe.whitelist()
def get_social_config_for_user(user):
    default_whatsapp_number, default_whatsapp_type = get_default_whatsapp_number(get_whatsapp_numbers_for_sender(user))
    default_instagram_profile, default_instagram_type = get_default_instagram_profile_for_user()
    default_messenger_profile, default_messenger_type = get_default_messenger_profile_for_user()
    default_telegram_profile, default_telegram_type = get_default_telegram_profile_for_user()
    
    return {
        "results": [{
            "default_whatsapp_number": default_whatsapp_number,
            "default_whatsapp_type": default_whatsapp_type,
            "default_instagram_profile": default_instagram_profile,
            "default_instagram_type": default_instagram_type,
            "default_messenger_profile": default_messenger_profile,
            "default_messenger_type": default_messenger_type,
            "default_telegram_profile": default_telegram_profile,
            "default_telegram_type": default_telegram_type
        }]
    }
# ==========================================================================================

def is_limited_user(user):
    roles = frappe.get_roles(user)
    limited_roles = ["Customer", "Supplier", "Student", "Instructor", "Sales Partner", "Member", "Shareholder", "Guardian"]
    return any(role in roles for role in limited_roles)
# ==========================================================================================
def get_user_type():
    if frappe.session.user == "Guest":
        return "guest"
    else:
        if frappe.session.data.user_type == "Website User":
            return "website_user"
        else:
            return "system_user"
# ==========================================================================================
def validate_token(token):
    profile_details = None
    if not frappe.db.exists("ClefinCode Chat Profile", {"token": token}):         
        return
    
    profile = frappe.get_doc("ClefinCode Chat Profile", {"token": token})

    channel = frappe.db.get_value('ClefinCode Chat Channel', {'chat_profile': profile.name}, ['name'])
    if not channel:
        return

    profile_details = {
        'channel': channel,
    }
    return profile_details
# ==========================================================================================
def get_chat_settings():
    chat_settings = frappe.get_doc('ClefinCode Chat Settings')    
    result = {
        # 'enable_chat': False,
        'enable_portal_support': False,
        'chat_support_title': chat_settings.chat_support_title,
        'welcome_message': chat_settings.welcome_message
    }

    if frappe.session.user == 'Guest':
        if not chat_settings.enable_portal_support: 
            return result   

    # if chat_settings.start_time and chat_settings.end_time:
    #     start_time = datetime.time.fromisoformat(chat_settings.start_time)
    #     end_time = datetime.time.fromisoformat(chat_settings.end_time)
    #     current_time = datetime.datetime.now().time()

    #     chat_status = 'Online' if start_time <= current_time <= end_time else 'Offline'
    # else:
    #     chat_status = 'Online'

    result['enable_portal_support'] = True
    # result['chat_status'] = chat_status
    return result
# ==========================================================================================
@frappe.whitelist()
def calculate_unread_messages(user):
    unread_messages = 0
    unread_rooms = []
    
    results = frappe.db.sql(f"""
    SELECT 
    ChatChannel.name AS room,
    NULL AS parent_channel,
    last_message_number - ChatChannelUser.last_message_read AS user_unread_messages,
    type

    FROM `tabClefinCode Chat Channel` AS ChatChannel 
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser  ON ChatChannelUser.parent = ChatChannel.name AND ChatChannelUser.user = '{user}'
    WHERE type = 'Guest'

    UNION ALL 

    SELECT 
    ChatChannel.name AS room,
    NULL AS parent_channel,
    ChatChannelUser.channel_last_message_number - ChatChannelUser.last_message_read AS user_unread_messages,
    type

    FROM `tabClefinCode Chat Channel` AS ChatChannel 
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser  ON ChatChannelUser.parent = ChatChannel.name AND ChatChannelUser.user = '{user}'
    WHERE type = 'Group'

    UNION ALL    

    SELECT 
    ChatChannel.name AS room,
    NULL AS parent_channel,
    last_message_number - ChatChannelUser.last_message_read AS user_unread_messages,
    type

    FROM `tabClefinCode Chat Channel` AS ChatChannel
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser  ON ChatChannelUser.parent = ChatChannel.name AND ChatChannelUser.user = '{user}'
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser2  ON ChatChannelUser2.parent = ChatChannel.name AND ChatChannelUser2.user <> '{user}'
    AND type = 'Direct' AND is_parent = 1
    

    UNION ALL

    SELECT 
    ChatChannelContributor.channel AS room, 
    ChatChannel.name AS parent_channel,
    NULL AS user_unread_messages,
    'Contributor' AS type

    FROM `tabClefinCode Chat Channel` AS ChatChannel  INNER JOIN `tabClefinCode Chat Channel Contributor` AS ChatChannelContributor On
    ChatChannelContributor.parent = ChatChannel.name
    AND is_parent = 1 AND ChatChannelContributor.user = '{user}'
    GROUP BY ChatChannelContributor.user , ChatChannel.name   

        """ , as_dict = True)
    
    if results:
        for room in results:
            if room.user_unread_messages and room.user_unread_messages > 0 :
                unread_messages+=1
                unread_rooms.append(room.room)
            if room.type == "Contributor":
                user_unread_messages = contributor_unread_messages(user , room.parent_channel) 
                if  user_unread_messages > 0:
                    unread_messages+=1
                    unread_rooms.append(room.parent_channel) 

    return {"unread_messages" : unread_messages , "unread_rooms" : unread_rooms}
# ==========================================================================================
#############################################################################################
######################################## Rooms / Channels ###################################
#############################################################################################
@frappe.whitelist()
def create_channel(channel_name , users, type , last_message , creator_email , creator , creation_date = None):  
    # only for Direct chat 
    creation_date = datetime.datetime.utcnow()
    room_doc = frappe.get_doc({
        'doctype': 'ClefinCode Chat Channel',
        'channel_name' : channel_name,
        'channel_creator' : creator_email,
        'type': type,
        'is_parent' : 1,
        'creation_date' : creation_date,
        'modified_date': creation_date,
    })
    room_doc.insert(ignore_permissions=True)
    for user in json.loads(users):
        room_doc.append("members" , {"profile_id" : user.get("profile_id") or get_profile_id(user["email"]) ,"user" : user["email"] , "platform" : user["platform"], "platform_profile": user.get("platform_profile"), "platform_gateway": user.get("platform_gateway")})
        share_doctype("ClefinCode Chat Channel", room_doc.name, user["email"])
    room_doc.save(ignore_permissions=True)
    frappe.db.commit()
    
    return {"results" : [{"room" : room_doc.name}]}
# ==========================================================================================
@frappe.whitelist()
def create_group(selected_contacts_list , user , creation_date = None):
    platform = ""
    creation_date = datetime.datetime.utcnow()
    room_doc = frappe.get_doc({
        'doctype': 'ClefinCode Chat Channel',
        'type': "Group",
        'channel_creator' : user,
        'is_parent' : 1,
        'creation_date' : creation_date,
        'modified_date': creation_date,
    })
    room_doc.append("members" , {"profile_id" : get_profile_id(user) , "user" : user , "platform" : "Chat" ,"unread_messages" : 0 , "is_admin" : 1})    
    room_doc.insert(ignore_permissions=True)
    share_doctype("ClefinCode Chat Channel", room_doc.name, user)

    email_dict = {}

    for user in json.loads(selected_contacts_list):
        room_doc.append("members" , {"profile_id" : get_profile_id(user["email"]) , "user" : user["email"] , "platform" : user["platform"], "platform_profile": user.get("platform_profile"), "platform_gateway": user.get("platform_gateway")})
        share_doctype("ClefinCode Chat Channel", room_doc.name, user["email"])    

    room_doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"results" : [{"room" : room_doc.name  , "room_name" : room_doc.get_group_name()}]}
# ==========================================================================================
@frappe.whitelist()
def create_sub_channel(new_contributors , parent_channel , user , user_email , creation_date = None , last_active_sub_channel = None , user_to_remove = None , empty_contributor_list = 0):
    creation_date = datetime.datetime.utcnow()
    frappe.db.sql(f"""UPDATE `tabClefinCode Chat Channel` SET chat_status = 'Closed' WHERE `name` = '{get_last_sub_channel(parent_channel)}'""")
    parent_channel_doc = frappe.get_doc("ClefinCode Chat Channel" , parent_channel)
    chat_topic = frappe.get_all("ClefinCode Chat Topic" , "name" , {"chat_channel":parent_channel, "topic_status" : "Open"})
    if empty_contributor_list == "1":
        disable_contributor(parent_channel_doc , user_to_remove)
        frappe.db.sql(f"""UPDATE  `tabClefinCode Chat Channel User` SET active = 0 WHERE parent = '{last_active_sub_channel}' AND user = '{user_to_remove}'""")
        frappe.db.commit()
        results = {
            "parent_channel" : parent_channel,
            "sub_channel" : parent_channel,
            "realtime_type" : "create_sub_channel"            
        }
        for member in parent_channel_doc.members:
            if member.platform == "Chat":
                frappe.publish_realtime(event= parent_channel, message=results, user= member.user)
        
        results2 = {'parent_channel' : parent_channel, "sub_channel" : "" , "realtime_type" : "create_sub_channel", "target_user" : user_to_remove, "chat_topic": chat_topic[0].name if chat_topic else None}
        # frappe.publish_realtime(event= "receive_message", message= results2, user= user_to_remove)
        frappe.publish_realtime(event= last_active_sub_channel, message={'parent_channel' : parent_channel, "sub_channel" : "" , "realtime_type" : "create_sub_channel"}, user= user_to_remove)
        notification_title = get_room_name(parent_channel, "Contributor")
        send_notification(user_to_remove , results2, "create_sub_channel", notification_title)
        return {"results" : [{"channel" : parent_channel}]}
    else:    
        if user_to_remove:  
            res = {'parent_channel' : parent_channel, "sub_channel" : "" , "realtime_type" : "create_sub_channel" , "target_user" : user_to_remove, "chat_topic": chat_topic[0].name if chat_topic else None} 
            disable_contributor(parent_channel_doc , user_to_remove)         
            frappe.db.sql(f"""UPDATE  `tabClefinCode Chat Channel User` SET active = 0 WHERE parent = '{last_active_sub_channel}' AND user = '{user_to_remove}'""")            
            # frappe.publish_realtime(event= "receive_message", message= res, user= user_to_remove)
            frappe.publish_realtime(event= last_active_sub_channel, message={'parent_channel' : parent_channel, "sub_channel" : "" , "realtime_type" : "create_sub_channel"}, user= user_to_remove)
            notification_title = get_room_name(parent_channel, "Contributor")
            send_notification(user_to_remove , res, "create_sub_channel", notification_title)
        
        if isinstance(new_contributors , str):
            new_contributors = json.loads(new_contributors)
        
        sub_channel_doc = frappe.get_doc({
            'doctype': 'ClefinCode Chat Channel',
            'parent_channel' : parent_channel,
            'parent_channel_creator' : parent_channel_doc.channel_creator,
            'type': "Direct",
            "creation_date" : creation_date,
            "modified_date": creation_date
        })
        sub_channel_doc.insert(ignore_permissions=True)  

        if not user_to_remove:
            for user in parent_channel_doc.contributors:
                if user.active == 1:                    
                    sub_channel_doc.append("members" , {"profile_id" : get_profile_id(user.user) ,"user" : user.user ,"platform" : "Chat" ,"active" : 1 })

        for user in new_contributors:            
            sub_channel_doc.append("members" , {"profile_id" : get_profile_id(user["email"]) ,"user" : user["email"] ,"platform" : "Chat" , "active" : 1})            
            if not user_to_remove:
                parent_channel_doc.append("contributors" , {"profile_id" : get_profile_id(user["email"]) ,"user" : user["email"] ,"platform" : "Chat" ,"channel" : sub_channel_doc.name, "active" : 1})        
        
        parent_channel_doc.save(ignore_permissions=True)
        sub_channel_doc.save(ignore_permissions=True)
        frappe.db.commit()
        results = {
            "parent_channel" : parent_channel,
            "sub_channel" : sub_channel_doc.name,
            "realtime_type" : "create_sub_channel",
            "utc_message_date" : creation_date,
            "chat_topic": chat_topic[0].name if chat_topic else None
        }
        notification_title1 = get_room_name(parent_channel, parent_channel_doc.type, user_email)
        for member in parent_channel_doc.members:
            if member.platform == "Chat":
                share_doctype("ClefinCode Chat Channel", sub_channel_doc.name, member.user)
                results["send_date"] = convert_utc_to_user_timezone(creation_date, get_user_timezone(member.user)["results"][0]["time_zone"])
                results["target_user"] = member.user
                # frappe.publish_realtime(event= "receive_message", message=results, user= member.user)
                frappe.publish_realtime(event= parent_channel, message=results, user= member.user)
                send_notification(member.user , results, "create_sub_channel", notification_title1)
        
        notification_title2 = get_room_name(parent_channel, "Contributor")
        for member in sub_channel_doc.members:
            if member.platform == "Chat":
                share_doctype("ClefinCode Chat Channel", sub_channel_doc.name, member.user)
                results["send_date"] = convert_utc_to_user_timezone(creation_date, get_user_timezone(member.user)["results"][0]["time_zone"])
                results["target_user"] = member.user
                # frappe.publish_realtime(event= "receive_message", message=results, user= member.user)
                frappe.publish_realtime(event= last_active_sub_channel, message=results, user= member.user)                
                send_notification(member.user , results, "create_sub_channel", notification_title2)
        
        # when adding contributor then removing , then adding again
        # get last closed sub channel for this contributor (who was unactive)
        notification_title3 = get_room_name(parent_channel, "Contributor")
        if not user_to_remove:
            for user in new_contributors:
                sub_channel = get_last_closed_sub_channel_for_contributor(user["email"] , parent_channel)
                if sub_channel:
                    results["send_date"] = convert_utc_to_user_timezone(creation_date, get_user_timezone(user["email"])["results"][0]["time_zone"])
                    results["target_user"] = user["email"]
                    # frappe.publish_realtime(event= "receive_message", message=results, user= user["email"])
                    frappe.publish_realtime(event= sub_channel, message=results, user= user["email"])                    
                    send_notification(user["email"] , results, "create_sub_channel", notification_title3)
        
        time.sleep(1.5)
        return {"results" : [{"channel" : sub_channel_doc.name}]}
# ==========================================================================================
@frappe.whitelist()
def leave_contributor(parent_channel , user , creation_date = None , last_active_sub_channel = None , user_to_remove = None , empty_contributor_list = 0):
    creation_date = datetime.datetime.utcnow()
    frappe.db.sql(f"""UPDATE `tabClefinCode Chat Channel` SET chat_status = 'Closed' WHERE `name` = '{get_last_sub_channel(parent_channel)}'""")
    parent_channel_doc = frappe.get_doc("ClefinCode Chat Channel" , parent_channel)
    if empty_contributor_list == "1":
        disable_contributor(parent_channel_doc , user_to_remove)
        frappe.db.sql(f"""UPDATE  `tabClefinCode Chat Channel User` SET active = 0 WHERE parent = '{last_active_sub_channel}' AND user = '{user_to_remove}'""")
        frappe.db.commit()
        results = {
            "parent_channel" : parent_channel,
            "sub_channel" : parent_channel,
            "realtime_type" : "create_sub_channel"
        }
        for member in parent_channel_doc.members:
            if member.platform == "Chat":
                frappe.publish_realtime(event= parent_channel, message=results, user= member.user)
        res = {'parent_channel' : parent_channel, "sub_channel" : "" , "realtime_type" : "create_sub_channel", "target_user" : user_to_remove}
        # frappe.publish_realtime(event= "receive_message", message= res, user= user_to_remove)
        frappe.publish_realtime(event= last_active_sub_channel, message={'parent_channel' : parent_channel, "sub_channel" : "" , "realtime_type" : "create_sub_channel"}, user= user_to_remove)
        send_notification(user_to_remove , res, "create_sub_channel")
        
        return {"results" : [{"channel" : parent_channel}]}
    else:    
        res = {'parent_channel' : parent_channel, "sub_channel" : "" , "realtime_type" : "create_sub_channel" , "target_user" : user_to_remove}
        disable_contributor(parent_channel_doc , user_to_remove)         
        frappe.db.sql(f"""UPDATE  `tabClefinCode Chat Channel User` SET active = 0 WHERE parent = '{last_active_sub_channel}' AND user = '{user_to_remove}'""")            
        # frappe.publish_realtime(event="receive_message", message= res, user= user_to_remove)
        frappe.publish_realtime(event=last_active_sub_channel, message={'parent_channel' : parent_channel, "sub_channel" : "" , "realtime_type" : "create_sub_channel"}, user= user_to_remove)
        send_notification(user_to_remove , res, "create_sub_channel")

        
        sub_channel_doc = frappe.get_doc({
            'doctype': 'ClefinCode Chat Channel',
            'parent_channel' : parent_channel,
            'parent_channel_creator' : parent_channel_doc.channel_creator,
            'type': "Direct",
            "creation_date" : creation_date,
            "modified_date": creation_date
        })
        sub_channel_doc.insert(ignore_permissions=True)  

    
        for user in parent_channel_doc.contributors:
            if user.active == 1:
                sub_channel_doc.append("members" , {"profile_id" : get_profile_id(user.user) ,"user" : user.user ,"platform" : "Chat" ,"active" : 1 })            
       
        
        sub_channel_doc.save(ignore_permissions=True)
        frappe.db.commit()
        results = {
            "parent_channel" : parent_channel,
            "sub_channel" : sub_channel_doc.name,
            "realtime_type" : "create_sub_channel",
            "utc_message_date" : creation_date
        }
        notification_title = get_room_name(parent_channel, parent_channel_doc.type, user) 
        for member in parent_channel_doc.members:
            if member.platform == "Chat":
                share_doctype("ClefinCode Chat Channel", sub_channel_doc.name, member.user)
                results["send_date"] = convert_utc_to_user_timezone(creation_date, get_user_timezone(member.user)["results"][0]["time_zone"])
                results["target_user"] = member.user
                # frappe.publish_realtime(event= "receive_message", message=results, user= member.user)                
                frappe.publish_realtime(event= parent_channel, message=results, user= member.user)                               
                send_notification(member.user , results, "create_sub_channel", notification_title)
        
        notification_title2 = get_room_name(parent_channel, "Contributor")
        for member in sub_channel_doc.members:
            if member.platform == "Chat":
                share_doctype("ClefinCode Chat Channel", sub_channel_doc.name, member.user)
                results["send_date"] = convert_utc_to_user_timezone(creation_date, get_user_timezone(member.user)["results"][0]["time_zone"])
                results["target_user"] = member.user
                # frappe.publish_realtime(event= "receive_message", message=results, user= member.user)
                frappe.publish_realtime(event= last_active_sub_channel, message=results, user= member.user)
                notification_title = get_room_name(parent_channel, "Contributor")
                send_notification(member.user , results, "create_sub_channel", notification_title2)
        
        return {"results" : [{"channel" : sub_channel_doc.name}]}
# ==========================================================================================
@frappe.whitelist()
def get_channels_list(user_email, limit=10, offset=0, query=None, type=None):
    # sanitize inputs
    user_email_esc = frappe.db.escape(user_email)
    limit = int(limit)
    offset = int(offset)

    # Build the UNION of all channel types with platform info
    union_sql = f"""
        SELECT
            ChatChannel.name               AS room,
            NULL                           AS parent_channel,
            NULL                           AS contact,
            ChatChannel.modified_date      AS send_date,
            ChatChannel.last_message       AS last_message,
            (last_message_number - ChatChannelUser.last_message_read)
                                          AS user_unread_messages,
            channel_name,
            type,
            NULL                           AS is_removed,
            NULL                           AS remove_date,
            NULL                           AS is_website_support_group,
            ChatChannel.chat_status        AS chat_status,
            ChatChannel.channel_info        AS channel_info,
            NULL                           AS other_user_platform
        FROM `tabClefinCode Chat Channel` AS ChatChannel 
        INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser  
            ON ChatChannelUser.parent = ChatChannel.name
            AND ChatChannelUser.user = {user_email_esc}
        WHERE type = 'Guest'

        UNION ALL

        SELECT DISTINCT
            ChatChannel.name               AS room,
            NULL                           AS parent_channel,
            NULL                           AS contact,
            ChatChannel.modified_date      AS send_date,
            ChatChannel.last_message       AS last_message,
            (ChatChannelUser.channel_last_message_number - ChatChannelUser.last_message_read)
                                          AS user_unread_messages,
            channel_name,
            type,
            ChatChannelUser.is_removed     AS is_removed,
            ChatChannelUser.remove_date    AS remove_date,
            is_website_support_group,
            ChatChannel.chat_status        AS chat_status,
            ChatChannel.channel_info        AS channel_info,
            NULL                           AS other_user_platform
        FROM `tabClefinCode Chat Channel` AS ChatChannel 
        INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser  
            ON ChatChannelUser.parent = ChatChannel.name
            AND ChatChannelUser.user = {user_email_esc}
        WHERE type = 'Group'
          AND ChatChannelUser.platform = 'Chat'
          AND ChatChannelUser.is_removed = 0

        UNION ALL
        
        SELECT DISTINCT
        ChatChannel.name               AS room,
        NULL                           AS parent_channel,
        NULL                           AS contact,
        ChatChannelUser.remove_date    AS send_date,   
        ChatChannel.last_message       AS last_message,
        (ChatChannelUser.channel_last_message_number 
            - ChatChannelUser.last_message_read)
                                      AS user_unread_messages,
        channel_name,
        type,
        ChatChannelUser.is_removed     AS is_removed,
        ChatChannelUser.remove_date    AS remove_date,
        is_website_support_group,
        ChatChannel.chat_status        AS chat_status,
        ChatChannel.channel_info       AS channel_info,
        NULL                           AS other_user_platform
        FROM `tabClefinCode Chat Channel` AS ChatChannel 
        INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser  
            ON ChatChannelUser.parent = ChatChannel.name
            AND ChatChannelUser.user = {user_email_esc}
        WHERE type = 'Group'
        AND ChatChannelUser.platform = 'Chat'
        AND ChatChannelUser.is_removed = 1     

        UNION ALL

        SELECT
            ChatChannel.name               AS room,
            NULL                           AS parent_channel,
            ChatChannelUser2.user          AS contact,
            ChatChannel.modified_date      AS send_date,
            ChatChannel.last_message       AS last_message,
            (last_message_number - ChatChannelUser.last_message_read)
                                          AS user_unread_messages,
            channel_name,
            type,
            NULL                           AS is_removed,
            NULL                           AS remove_date,
            NULL                           AS is_website_support_group,
            ChatChannel.chat_status        AS chat_status,
            ChatChannel.channel_info        AS channel_info,
            ChatChannelUser2.platform      AS other_user_platform
        FROM `tabClefinCode Chat Channel` AS ChatChannel
        INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser
            ON ChatChannelUser.parent = ChatChannel.name
            AND ChatChannelUser.user = {user_email_esc}
        INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser2
            ON ChatChannelUser2.parent = ChatChannel.name
            AND ChatChannelUser2.user <> {user_email_esc}
            AND type = 'Direct'
            AND is_parent = 1

        UNION ALL

        SELECT
            ChatChannelContributor.channel AS room,
            ChatChannel.name               AS parent_channel,
            ChatChannel.channel_creator    AS contact,
            ChatChannel.modified_date      AS send_date,
            ChatChannel.last_message       AS last_message,
            NULL                           AS user_unread_messages,
            NULL                           AS channel_name,
            'Contributor'                  AS type,
            NULL                           AS is_removed,
            NULL                           AS remove_date,
            is_website_support_group,
            ChatChannel.chat_status        AS chat_status,
            ChatChannel.channel_info        AS channel_info,
            NULL                           AS other_user_platform
        FROM `tabClefinCode Chat Channel` AS ChatChannel
        INNER JOIN `tabClefinCode Chat Channel Contributor` AS ChatChannelContributor
            ON ChatChannelContributor.parent = ChatChannel.name
            AND is_parent = 1
            AND ChatChannelContributor.user = {user_email_esc}
        GROUP BY ChatChannelContributor.user, ChatChannel.name
    """

    filter_clause = ""
    if query:
        like_q = f"'%{ query.strip().lower() }%'"
        
        filter_clause = f"""
            WHERE LOWER(COALESCE(channel_info, '')) LIKE {like_q}
        """
        
        if type:
            like_t = f"'%{ type.strip().lower() }%'"
            filter_clause += f"""
            AND LOWER(COALESCE(other_user_platform, '')) LIKE {like_t}
        """

    
    # Paginated, ordered, and (optionally) filtered
    paged_sql = f"""
        SELECT * 
        FROM ({union_sql}) AS all_channels
        {filter_clause}
        ORDER BY send_date DESC
        LIMIT {limit} OFFSET {offset}
    """
    paged = frappe.db.sql(paged_sql, as_dict=True)
    
        # Total count of matching rows (for pagination or UI feedback)
    total_count_sql = f"""
        SELECT COUNT(*) 
        FROM ({union_sql}) AS all_channels
        {filter_clause}
    """
    total_count = frappe.db.sql(total_count_sql, as_list=True)[0][0]
    

    # Post-processing
    if paged:
        for room in paged:
            if not room.get('channel_name'):
                last_message_info = None
                if room['type'] == "Direct":
                    room['room_name'] = get_contact_full_name(room['contact'])
                    last_message_info = get_last_message_info(user_email, room['room'])
                elif room['type'] == "Contributor":
                    room['room_name'] = "@" + frappe.get_doc("ClefinCode Chat Channel", room['parent_channel']).get_channel_name_for_contributor()
                    last_message_info = get_last_sub_channel_for_user(room['parent_channel'], user_email)
                    if last_message_info:
                        room['send_date'] = last_message_info['send_date']
                    room['user_unread_messages'] = contributor_unread_messages(user_email, room['parent_channel'])
                elif room['type'] == "Group":
                    room['room_name'] = frappe.get_doc("ClefinCode Chat Channel", room['room']).get_group_name()
                    last_message_info = get_last_message_info(user_email, room['room'])
                else:
                    room['room_name'] = get_contact_full_name(room['contact'])

                if last_message_info:
                    room.update({
                        'sender_email': last_message_info['sender_email'],
                        'last_message_type': last_message_info['message_type'],
                        'last_message': last_message_info.get('content', '')
                    })
            else:
                # If channel_name exists, it's a normal channel
                room['room_name'] = room['channel_name']
                if room['type'] != "Guest":
                    last_message_info = get_last_message_info(user_email, room['room'])
                    if last_message_info:
                        room.update({
                            'last_message': last_message_info['content'],
                            'sender_email': last_message_info['sender_email'],
                            'last_message_type': last_message_info['message_type']
                        })

            # Determine the platform
            if room.get("other_user_platform"):
                room["platform"] = room["other_user_platform"]
            else:
                room["platform"] = get_platform_for_chat(room.get("channel_name"))

            # Convert send_date to user timezone
            room['utc_message_date'] = room['send_date']
            room['send_date'] = convert_utc_to_user_timezone(
                room['send_date'],
                get_user_timezone(user_email)["results"][0]["time_zone"]
            )

            # Message type & media details
            room['last_message_media_type'], room['last_message_voice_duration'] = get_last_message_type(
                room['type'],
                user_email,
                room['room'] if room['type'] != "Contributor" else room['parent_channel'],
                room.get('remove_date')
            )

            # Avatar
            room['avatar_url'] = frappe.db.get_value("ClefinCode Chat Channel", room['room'], "channel_image")

            # Open topic
            chat_topic = frappe.get_all(
                "ClefinCode Chat Topic", "name",
                {
                    "chat_channel": room['parent_channel'] if room['type'] == "Contributor" else room['room'],
                    "topic_status": "Open"
                }
            )
            room['chat_topic'] = chat_topic[0].name if chat_topic else None
    return {
        "results": paged,
        "num_of_results": total_count
    }
# ==========================================================================================
def get_last_sub_channel(room):    
    last_sub_channel = frappe.db.sql(f"""
    SELECT name
    FROM `tabClefinCode Chat Channel`
    WHERE parent_channel = '{room}'
    ORDER BY creation_date DESC
    LIMIT 1
    """ , as_dict = True)
    return last_sub_channel[0].name if len(last_sub_channel) == 1 else ""
# ==========================================================================================
def get_last_sub_channel_for_user(parent_channel , user_email):
    last_sub_channel = frappe.db.sql(f"""
    SELECT ChatChannel.name
    FROM `tabClefinCode Chat Channel` AS ChatChannel INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser ON
    ChatChannelUser.parent = ChatChannel.name
    WHERE ChatChannelUser.user = '{user_email}' 
    AND parent_channel = '{parent_channel}'
    ORDER BY ChatChannel.modified DESC
    LIMIT 1
    """ , as_dict = True)
    if not last_sub_channel:
        return ''

    last_sub_channel_message = frappe.db.sql(f"""
    SELECT name , content , send_date , modified , message_type , sender_email
    FROM `tabClefinCode Chat Message`
    WHERE sub_channel = '{last_sub_channel[0].name}'
    AND chat_channel = '{parent_channel}'
    AND (only_receive_by IS NULL OR only_receive_by = '') 
    
    UNION

    SELECT name , content , send_date , modified , message_type , sender_email
    FROM `tabClefinCode Chat Message`
    WHERE sub_channel = '{last_sub_channel[0].name}'
    AND chat_channel = '{parent_channel}'
    AND only_receive_by = '{user_email}'

    ORDER BY modified DESC
    LIMIT 1
    """ , as_dict = True)   
    
    return last_sub_channel_message[0] if last_sub_channel_message else ''
# ==========================================================================================
@frappe.whitelist()
def get_last_active_sub_channel(room):    
    sub_channel = frappe.db.sql(f"""
    SELECT name
    FROM `tabClefinCode Chat Channel` AS ChatChannel
    WHERE parent_channel = '{room}'
    AND chat_status = 'Open'
    ORDER BY creation_date DESC
    LIMIT 1
    """ , as_dict = True)
    return {"results" : [{"last_active_sub_channel" : sub_channel[0].name if len(sub_channel) == 1 else ""}]}
# ==========================================================================================
def get_last_closed_sub_channel_for_contributor(user , parent_channel):
    sub_channel = frappe.db.sql(f"""
    SELECT ChatChannel.name
    FROM `tabClefinCode Chat Channel` AS ChatChannel 
        INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser ON ChatChannelUser.parent = ChatChannel.name 
    AND ChatChannel.parent_channel = '{parent_channel}' AND ChatChannel.chat_status = 'Closed'
    WHERE ChatChannelUser.user = '{user}' AND ChatChannelUser.active = 0
    ORDER BY ChatChannel.modified_date DESC
    LIMIT 1
    """ , as_dict = True)

    if sub_channel:
        return sub_channel[0].name
# ==========================================================================================
@frappe.whitelist()
def get_all_sub_channels_for_contributor(parent_channel , user_email):
    results = []
    sub_channels = frappe.db.sql(f"""
    SELECT ChatChannel.name
    FROM `tabClefinCode Chat Channel` AS ChatChannel INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser ON
    ChatChannelUser.parent = ChatChannel.name
    WHERE ChatChannelUser.user = '{user_email}' 
    AND parent_channel = '{parent_channel}'
    """ , as_dict = True)
    if sub_channels:
        for c in sub_channels:
            results.append(c.name)
        return {"results" : results}
# ===========================================================================================
#############################################################################################
######################################## Messages ###########################################
#############################################################################################
@frappe.whitelist()
def send(content, user, room , email, send_date = None , is_first_message = 0, attachment = None , sub_channel = None , is_link = None , is_media = None , is_document = None, is_voice_clip = None , file_id = None , message_type = "" , message_template_type= "", only_receive_by = None , id_message_local_from_app = None, chat_topic = None, is_screenshot = 0):
    try:
       
        from packaging import version
        # Get current Frappe version
        frappe_version = frappe.__version__

        # Define room logic based on version
        if version.parse(frappe_version) >= version.parse("15.0.0"):
            guest_room_name = "user:Guest"
        else:
            guest_room_name = f"{frappe.local.site}:user:Guest"
            
        if is_media or is_document or message_template_type == "Remove User":
            time.sleep(3)
        file_type = ''
        if attachment:
            file_type = get_file_type(attachment)
        send_date = datetime.datetime.utcnow()
        new_message = frappe.get_doc(
            {
                "doctype": "ClefinCode Chat Message",
                "is_first_message" : is_first_message if is_first_message else 0,
                "content": content,
                "chat_channel": room,
                "sub_channel" : sub_channel,
                "sender_email": email,
                "sender":user,
                "is_media": 1 if file_type == 'image' or file_type == 'audio' or file_type == 'video' else 0,
                "is_document": 1 if file_type == 'document' else 0,
                "file_type": "text" if file_type == "application" else file_type,
                "is_link" : is_link if is_link else 0,
                "is_media" : is_media if is_media else 0,            
                "is_document" : is_document if is_document else 0,
                "is_voice_clip" : is_voice_clip if is_voice_clip else 0,
                "is_mention": is_mention(content),
                "file_id" : file_id,
                "send_date" : send_date,
                "message_type" : message_type,
                "message_template_type": message_template_type,
                "only_receive_by" : only_receive_by,
                "chat_topic": chat_topic
            }
        ).insert(ignore_permissions=True)
        
        
        if is_screenshot == "1":  
            content = extract_images_from_html(new_message, content, True)
            is_media = 1
            file_type = "image"
            new_message.content = content
            new_message.is_media = is_media
            new_message.file_type = file_type
            new_message.is_screenshot = 1  
            new_message.file_id = frappe.db.get_value("File" , {"attached_to_name": new_message.name}, "name")               
            new_message.save(ignore_permissions = True)

        if attachment: set_attach_message(attachment, new_message.name)
        

        share_everyone = 0
        if chat_topic:
            is_private = frappe.db.get_value("ClefinCode Chat Topic" , chat_topic , "is_private")
            if is_private == 0:
                share_everyone = 1
                share_doctype("ClefinCode Chat Message", new_message.name, everyone = share_everyone)
        
        channel_doc = frappe.get_doc("ClefinCode Chat Channel" , room)    
        
        last_responder_user = channel_doc.last_responder_user
        if channel_doc.type == "Group":
            channel_doc.last_responder_user = get_profile_id(email)
            for member in channel_doc.members:
                if member.is_removed == 0:
                    member.channel_last_message_number+=1
        channel_doc.last_message = content
        channel_doc.modified_date = send_date   
        channel_doc.last_message_number += 1   
        

        if sub_channel:
            sub_channel_doc = frappe.get_doc("ClefinCode Chat Channel" , sub_channel)
            sub_channel_doc.last_message = content
            sub_channel_doc.modified_date = send_date   
            sub_channel_doc.last_message_number += 1 
            sub_channel_doc.save(ignore_permissions=True)
        
        room_name = ""
        if not channel_doc.channel_name or channel_doc.channel_name == "":
            if channel_doc.type == "Direct":
                room_name = get_contact_full_name(channel_doc.channel_creator)
            elif channel_doc.type == "Group":
                room_name = channel_doc.get_group_name()       
        else:
            room_name = channel_doc.channel_name

        contact = None
        
        if user != "Guest":
            for member in channel_doc.members:
                platform = member.platform
                if member.user == email:
                    if channel_doc.type == "Group":
                        member.channel_last_message_number = channel_doc.last_message_number
                    member.last_message_read = channel_doc.last_message_number
                    
                    
                    if member.platform != "Chat":
                        contact = member.user 
                        
                    member.unread_messages = 0 
        channel_doc.save(ignore_permissions=True)
        frappe.db.commit()   

        results = {
            "file_type": file_type ,
            "content": content,
            "user": user,
            "sender_email": email, 
            "message_name" : new_message.name,
            "realtime_type" : "send_message",
            "is_first_message" : is_first_message if is_first_message else 0,
            "room_name" : room_name ,
            "last_message" : content ,
            "room_type" : channel_doc.type,
            "contact_name" : get_contact_full_name(channel_doc.members[1].user) if channel_doc.type != "Guest" else "Guest" ,        
            "file_id" : file_id,
            "is_media" : is_media ,
            "is_document": is_document,
            "contact": contact,
            "is_voice_clip" : is_voice_clip,
            "message_type" : message_type,
            "message_template_type": message_template_type,
            "avatar_url": channel_doc.channel_image,
            "utc_message_date" : send_date,
            "platform": platform 
        }
        

        frappe.db.set_value("ClefinCode Chat Profile", get_profile_id(email), "last_active", send_date)
        frappe.publish_realtime(event= "update_last_active", message=results)
        
        if id_message_local_from_app:
            results['id_message_local_from_app']= id_message_local_from_app
            
        if only_receive_by:
            # this case when setting admin for group
            if share_everyone == 0: share_doctype("ClefinCode Chat Message", new_message.name, only_receive_by) 
            results["room"] = room
            results["send_date"] = convert_utc_to_user_timezone(send_date, get_user_timezone(only_receive_by)["results"][0]["time_zone"])
            results["time_zone"] = frappe.db.get_value("User" , only_receive_by , "time_zone")
            results["target_user"] = only_receive_by
            frappe.publish_realtime(event=room, message=results, user=only_receive_by) 
            # frappe.publish_realtime(event="receive_message", message=results, user= only_receive_by)
            frappe.publish_realtime(event="msg", message=results, user= only_receive_by)
            send_notification(only_receive_by , results, "send_message", room_name, message_template_type) 
            return  {"results" : [{"new_message_name" : new_message.name}]}

        if channel_doc.type == "Guest":            
            results["room"] = room        
            if channel_doc.chat_profile.startswith("Guest"):
                results["send_date"] = convert_utc_to_user_timezone(send_date, get_time_zone())
                frappe.publish_realtime(event=room, message=results , room = guest_room_name)
                for member in channel_doc.members:
                    if share_everyone == 0: share_doctype("ClefinCode Chat Message", new_message.name, member.user)
                    results["room"] = room
                    results["send_date"] = convert_utc_to_user_timezone(send_date, get_user_timezone(member.user)["results"][0]["time_zone"])
                    results["time_zone"] = frappe.db.get_value("User" , member.user , "time_zone")
                    results["target_user"] = member.user            
                    frappe.publish_realtime(event=room, message=results, user=member.user)       
                    frappe.publish_realtime(event="new_chat_notification", message=results, user= member.user)
                    frappe.publish_realtime(event="update_room", message=results, user= member.user)
                    send_notification(member.user , results, "send_message")
            
            elif channel_doc.chat_profile.startswith("Support"):                           
                for member in channel_doc.members:
                    results["is_support"] = 1
                    if member.user:
                        if share_everyone == 0: share_doctype("ClefinCode Chat Message", new_message.name, member.user)
                        results["target_user"] = member.user                       
                        frappe.publish_realtime(event=room, message=results, user= member.user)
                        frappe.publish_realtime(event="update_room", message=results, user= member.user) 
                        send_notification(member.user , results, "send_message")                       
                    else:
                        # support user has only profile id
                        user_email = frappe.db.get_all("ClefinCode Chat Profile Contact Details" , {"parent" : member.profile_id , "type" : "Chat"} , "contact_info")
                        firebase_token = frappe.db.get_all("Chat App Device", {"chat_profile" : member.profile_id}, "firebase_token")
                        user_platform = frappe.db.get_all("Chat App Device", {"chat_profile" : member.profile_id}, "platform")
                        if user_email:
                            results["target_user"] = user_email[0].contact_info                        
                            notification_body = BeautifulSoup(content, 'html.parser').get_text()
                            push_notifications(firebase_token[0].firebase_token, results, "send_message" , user_platform[0].platform.lower() ,"ClefinCode Support" , notification_body)
        
        else:
            for member in channel_doc.members:
                if member.is_removed == 0 and member.platform == "Chat":
                    if share_everyone == 0: share_doctype("ClefinCode Chat Message", new_message.name, member.user)
                    results["room"] = room
                    results["send_date"] = convert_utc_to_user_timezone(send_date, get_user_timezone(member.user)["results"][0]["time_zone"])
                    results["time_zone"] = frappe.db.get_value("User" , member.user , "time_zone")
                    results["target_user"] = member.user
                    frappe.publish_realtime(event=room, message=results, user=member.user)  # listner in chat space      
                    frappe.publish_realtime(event="new_chat_notification", message=results, user= member.user) # listner when initilizing app 
                    frappe.publish_realtime(event="update_room", message=results, user= member.user) # listner in chat list 
                    frappe.publish_realtime(event="receive_message", message=results, user= member.user) # listner in mobile app
                    frappe.publish_realtime(event="msg", message=results, user= member.user) # listner in full page chat
                    
                    
                       
                    send_notification(member.user , results, "send_message", room_name if channel_doc.type == "Group" else get_contact_full_name(email), message_template_type)    
                elif member.platform == "WhatsApp" and email != member.user and message_template_type not in ["Rename Group" , "Send Confirmation"]  and not is_mention(content) and member.is_removed == 0:
                    process_whatsapp_message(member.platform_gateway, member.user , email, channel_doc, last_responder_user, new_message, file_type, attachment, content, is_voice_clip, is_screenshot,results)
                    if member.pending_messages >= 1:
                        frappe.db.set_value('ClefinCode Chat Channel User', member.name, 'pending_messages', member.pending_messages +1)
                elif member.platform == "Instagram" and str(email) != str(member.user) and message_template_type not in ["Rename Group" , "Send Confirmation"]  and not is_mention(content) and member.is_removed == 0:
                    process_instagram_message(member.platform_gateway, member.user , email, channel_doc, last_responder_user, new_message, file_type, attachment, content, is_voice_clip, is_screenshot)
                    if member.pending_messages >= 1:
                        frappe.db.set_value('ClefinCode Chat Channel User', member.name, 'pending_messages', member.pending_messages +1)
                elif member.platform == "Messenger" and str(email) != (member.user) and message_template_type not in ["Rename Group" , "Send Confirmation"]  and not is_mention(content) and member.is_removed == 0:
                    process_messenger_message(member.platform_gateway, member.user , email, channel_doc, last_responder_user, new_message, file_type, attachment, content, is_voice_clip, is_screenshot)
                    if member.pending_messages >= 1:
                        frappe.db.set_value('ClefinCode Chat Channel User', member.name, 'pending_messages', member.pending_messages +1)   
                elif member.platform == "Telegram" and str(email) != str(member.user) and message_template_type not in ["Rename Group" , "Send Confirmation"]  and not is_mention(content) and member.is_removed == 0:
                    process_telegram_message(member.platform_gateway, member.user , email, channel_doc, last_responder_user, new_message, file_type, attachment, content, is_voice_clip, is_screenshot)
                    if member.pending_messages >= 1:
                        frappe.db.set_value('ClefinCode Chat Channel User', member.name, 'pending_messages', member.pending_messages +1)             
            for contributor in channel_doc.contributors:
                if contributor.active == 1 and contributor.platform == "Chat":                    
                    if share_everyone == 0: share_doctype("ClefinCode Chat Message", new_message.name, contributor.user)
                    results["room"] = sub_channel
                    results["parent_channel"] = room
                    results["room_type"] = "Contributor"
                    results["room_name"] = "@" + channel_doc.get_channel_name_for_contributor()
                    results["send_date"] = convert_utc_to_user_timezone(send_date, get_user_timezone(contributor.user)["results"][0]["time_zone"])
                    results["time_zone"] = frappe.db.get_value("User" , contributor.user , "time_zone")
                    results["target_user"] = contributor.user
                    frappe.publish_realtime(event=sub_channel, message=results, user=contributor.user) 
                    frappe.publish_realtime(event="new_chat_notification", message=results, user= contributor.user)
                    frappe.publish_realtime(event="update_room", message=results, user= contributor.user)
                    # frappe.publish_realtime(event="receive_message", message=results, user= contributor.user)
                    frappe.publish_realtime(event="msg", message=results, user= contributor.user)
                    send_notification(contributor.user , results, "send_message", results["room_name"], message_template_type)
            if new_message.message_type == "information" and new_message.message_template_type=="Send Template Public":
                        send_clefincode_chat_template(new_message)
        
        return  {"results" : [{"new_message_name" : new_message.name}]}
    except Exception as e:
        error_message = traceback.format_exc()   
        frappe.log_error(
            title="error in send message",
            message=error_message
        )
        
        return {"results": [{"status": f"Error: {str(e)}"}]} 
# ==========================================================================================
@frappe.whitelist()
def get_messages(room , user_email , room_type , chat_topic = None, remove_date = None , limit = 10 , offset = 0):
    condition = ""
    if chat_topic:
        condition = f"chat_topic = '{chat_topic}'"
    
    if room_type != "Topic":
        if room_type != "Contributor":
            condition = f"chat_channel = '{room}'"
            if room_type == "Group":
                if remove_date and remove_date != "":
                    condition += f" AND send_date <='{remove_date}'"            
        else: 
            sub_channels = json.loads(room)
            sub_channels_list = []
            for d in sub_channels:
                sub_channels_list.append(d)
            sub_channels_str = ', '.join([frappe.db.escape(channel) for channel in sub_channels_list])
            condition = f"sub_channel IN ({sub_channels_str})"
    
    

    results = frappe.db.sql(f"""
    SELECT content , send_date , sender_email , sender , name AS message_name , is_media , is_document , is_voice_clip  , file_id  , message_type, message_template_type , only_receive_by
    FROM `tabClefinCode Chat Message`
    WHERE {condition} AND (only_receive_by IS NULL OR only_receive_by = '')

    UNION

    SELECT content , send_date , sender_email , sender , name AS message_name , is_media , is_document , is_voice_clip  , file_id  , message_type, message_template_type , only_receive_by
    FROM `tabClefinCode Chat Message`
    WHERE {condition} AND only_receive_by = '{user_email}'
    
    ORDER BY send_date DESC 
    LIMIT {limit} OFFSET {offset}
    """ , as_dict = True)
    for message in results:
        message.utc_message_date = message.send_date
        message.send_date = convert_utc_to_user_timezone(message.send_date, get_user_timezone(user_email)["results"][0]["time_zone"])
        message.time_zone = get_user_timezone(user_email)["results"][0]["time_zone"]         
        message.get_messages = 1
    return {"results" : sorted(results, key=lambda d: d["send_date"])}
# ==========================================================================================
@frappe.whitelist()
def get_messages_latest(room , user_email , room_type, remove_date = None , lastmessagedate = None):
    """This API provides a solution for iOS devices to view new messages through notifications while using another app."""
    condition = ""
    
    if room_type != "Topic":
        if room_type != "Contributor":
            condition = f"chat_channel = '{room}'"
            if room_type == "Group":
                if remove_date and remove_date != "":
                    condition += f" AND send_date <='{remove_date}'"            
        else: 
            sub_channels = json.loads(room)
            sub_channels_list = []
            for d in sub_channels:
                sub_channels_list.append(d)
            sub_channels_str = ', '.join([frappe.db.escape(channel) for channel in sub_channels_list])
            condition = f"sub_channel IN ({sub_channels_str})"
    
    if lastmessagedate and lastmessagedate != "":
        condition += f" AND send_date >'{lastmessagedate}'"
    

    results = frappe.db.sql(f"""
    SELECT content , send_date , sender_email , sender , name AS message_name , is_media , is_document , is_voice_clip  , file_id  , message_type, message_template_type , only_receive_by
    FROM `tabClefinCode Chat Message`
    WHERE {condition} AND (only_receive_by IS NULL OR only_receive_by = '')

    UNION

    SELECT content , send_date , sender_email , sender , name AS message_name , is_media , is_document , is_voice_clip  , file_id  , message_type, message_template_type , only_receive_by
    FROM `tabClefinCode Chat Message`
    WHERE {condition} AND only_receive_by = '{user_email}'
    
    ORDER BY send_date DESC 

    """ , as_dict = True)
    for message in results:
        message.utc_message_date = message.send_date
        message.send_date = convert_utc_to_user_timezone(message.send_date, get_user_timezone(user_email)["results"][0]["time_zone"])
        message.time_zone = get_user_timezone(user_email)["results"][0]["time_zone"]         
        message.get_messages = 1
    return {"results" : sorted(results, key=lambda d: d["send_date"])}

# ==========================================================================================
@frappe.whitelist()
def get_latest_channels_updates(user_email, last_message_date):
    """This API provides a solution for iOS devices to view new messages through notifications while using another app."""
    user_email_param = frappe.db.escape(user_email)
    last_message_date_param = frappe.db.escape(last_message_date)

    results = frappe.db.sql(
        f"""
        SELECT
            ChatChannel.name AS room,
            NULL AS parent_channel,
            NULL AS contact,
            ChatChannel.modified_date AS send_date,
            last_message,
            last_message_number - ChatChannelUser.last_message_read AS user_unread_messages,
            channel_name,
            type,
            NULL AS is_removed,
            NULL AS remove_date
        FROM `tabClefinCode Chat Channel` AS ChatChannel 
        INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser
            ON ChatChannelUser.parent = ChatChannel.name AND ChatChannelUser.user = {user_email_param}
        WHERE type = 'Guest' AND ChatChannel.modified_date > {last_message_date_param}
        UNION ALL
        SELECT DISTINCT
            ChatChannel.name AS room,
            NULL AS parent_channel,
            NULL AS contact,
            ChatChannel.modified_date AS send_date,
            last_message,
            ChatChannelUser.channel_last_message_number - ChatChannelUser.last_message_read AS user_unread_messages,
            channel_name,
            type,
            ChatChannelUser.is_removed AS is_removed,
            ChatChannelUser.remove_date
        FROM `tabClefinCode Chat Channel` AS ChatChannel 
        INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser
            ON ChatChannelUser.parent = ChatChannel.name AND ChatChannelUser.user = {user_email_param}
        WHERE type = 'Group' AND ChatChannelUser.platform = 'Chat' AND ChatChannel.modified_date > {last_message_date_param}
        UNION ALL
        SELECT
            ChatChannel.name AS room,
            NULL AS parent_channel,
            ChatChannelUser2.user AS contact,
            ChatChannel.modified_date AS send_date,
            last_message,
            last_message_number - ChatChannelUser.last_message_read AS user_unread_messages,
            channel_name,
            type,
            NULL AS is_removed,
            NULL AS remove_date
        FROM `tabClefinCode Chat Channel` AS ChatChannel
        INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser
            ON ChatChannelUser.parent = ChatChannel.name AND ChatChannelUser.user = {user_email_param}
        INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser2
            ON ChatChannelUser2.parent = ChatChannel.name AND ChatChannelUser2.user <> {user_email_param}
                            AND type = 'Direct' AND is_parent = 1 AND ChatChannel.modified_date > {last_message_date_param}
        UNION ALL
        SELECT
            ChatChannelContributor.channel AS room,
            ChatChannel.name AS parent_channel,
            ChatChannel.channel_creator AS contact,
            ChatChannel.modified_date AS send_date,
            ChatChannel.last_message,
            NULL AS user_unread_messages,
            NULL AS channel_name,
            'Contributor' AS type,
            NULL AS is_removed,
            NULL AS remove_date
        FROM `tabClefinCode Chat Channel` AS ChatChannel
        INNER JOIN `tabClefinCode Chat Channel Contributor` AS ChatChannelContributor
            ON ChatChannelContributor.parent = ChatChannel.name
            AND is_parent = 1 AND ChatChannelContributor.user = {user_email_param}
            AND ChatChannel.modified_date > {last_message_date_param}
        GROUP BY ChatChannelContributor.user, ChatChannel.name
        """,
        as_dict=True
    )

    if results:
        for room in results:
            if not room.get('channel_name'):
                last_message_info = None
                if room['type'] == "Direct":
                    room['room_name'] = get_contact_full_name(room['contact'])
                    last_message_info = get_last_message_info(user_email, room['room'])
                elif room['type'] == "Contributor":
                    room['room_name'] = "@" + frappe.get_doc("ClefinCode Chat Channel", room['parent_channel']).get_channel_name_for_contributor()
                    last_message_info = get_last_sub_channel_for_user(room['parent_channel'], user_email)
                    if last_message_info:
                        room['send_date'] = last_message_info['send_date']
                    room['user_unread_messages'] = contributor_unread_messages(user_email, room['parent_channel'])
                elif room['type'] == "Group":
                    room['room_name'] = frappe.get_doc("ClefinCode Chat Channel", room['room']).get_group_name()
                    last_message_info = get_last_message_info(user_email, room['room'])
                else:
                    room['room_name'] = get_contact_full_name(room['contact'])
                
                if last_message_info:
                    room.update({
                        'sender_email': last_message_info['sender_email'],
                        'last_message_type': last_message_info['message_type'],
                        'last_message': last_message_info.get('content', '')
                    })
            else:
                room['room_name'] = room['channel_name']
                if room['type'] != "Guest":
                    last_message_info = get_last_message_info(user_email, room['room'])
                    if last_message_info:
                        room.update({
                            'last_message': last_message_info['content'],
                            'sender_email': last_message_info['sender_email'],
                            'last_message_type': last_message_info['message_type']
                        })

            # Handle removed rooms
            if room.get('is_removed') == 1:
                last_message_info = get_last_message_info(user_email, room['room'], room['remove_date'])
                if last_message_info:
                    room.update({
                        'last_message': last_message_info['content'],
                        'sender_email': last_message_info['sender_email'],
                        'last_message_type': last_message_info['message_type'],
                        'send_date': room['remove_date']
                    })

            # Convert date and fetch additional details
            room['utc_message_date'] = room['send_date']
            room['send_date'] = convert_utc_to_user_timezone(room['send_date'], get_user_timezone(user_email)["results"][0]["time_zone"])

            # Fetch chat topic if it exists
            chat_topic = frappe.get_all("ClefinCode Chat Topic", "name", {"chat_channel": room['parent_channel'] if room['type'] == "Contributor" else room['room'], "topic_status": "Open"})
            room['chat_topic'] = chat_topic[0].name if chat_topic else None

    return {"results": sorted(results, key=lambda d: d["send_date"], reverse=True)}

# ==========================================================================================
@frappe.whitelist()
def mark_messsages_as_read(user , channel = None, parent_channel = None):
    if channel:
        last_message_number = frappe.db.get_value("ClefinCode Chat Channel" , channel , "last_message_number")
        frappe.db.sql(f"""
        UPDATE `tabClefinCode Chat Channel User`
        SET last_message_read = {last_message_number} , unread_messages = 0 
        WHERE user = '{user}' AND parent = '{channel}'""")

    if parent_channel:
        sub_channels = frappe.db.sql(f"""SELECT ChatChannel.name , last_message_number 
        FROM `tabClefinCode Chat Channel` AS ChatChannel INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser
        WHERE parent_channel = '{parent_channel}'
        AND ChatChannelUser.user = '{user}'
        ORDER BY modified_date DESC
        """ , as_dict = True)

        for c in sub_channels:
            frappe.db.sql(f"""
            UPDATE `tabClefinCode Chat Channel User`
            SET last_message_read = {c.last_message_number} , unread_messages = 0
            WHERE user = '{user}' AND parent = '{c.name}'""")
# ==========================================================================================
@frappe.whitelist()
def update_sub_channel_for_last_message(user , user_email , mentioned_users_emails , last_chat_space_message , last_active_sub_channel , content , chat_room , old_sub_channel = None):
    # frappe.db.set_value("ClefinCode Chat Channel" , chat_room , "last_message" , content)
    # frappe.db.set_value("ClefinCode Chat Channel" , last_active_sub_channel , "last_message" , content)
    
    frappe.db.set_value("ClefinCode Chat Message" , last_chat_space_message , "sub_channel" , last_active_sub_channel , update_modified=False)

    last_message_number = frappe.db.get_value("ClefinCode Chat Channel" , last_active_sub_channel , "last_message_number")
    frappe.db.set_value("ClefinCode Chat Channel" , last_active_sub_channel , "last_message_number" , last_message_number+1)    

    if old_sub_channel:
        last_message_number = frappe.db.get_value("ClefinCode Chat Channel" , old_sub_channel , "last_message_number")
        frappe.db.set_value("ClefinCode Chat Channel" , old_sub_channel , "last_message_number" , last_message_number-1) 

    mention_message_doc = frappe.get_doc("ClefinCode Chat Message" , last_chat_space_message)
    results = {
        "parent_channel": chat_room,
        "content": content,
        "sender": user,
        "sender_email": user_email, 
        "message_name" : last_chat_space_message,
        "realtime_type" : "update_sub_channel_for_last_message",
        "is_first_message" : 0,
        # "room_name" : room_name ,
        "last_message" : content ,
        # "room_type" : channel_doc.type,
        # "contact_name" : get_contact_full_name(channel_doc.members[1].user),
        # "file_id" : file_id,
        # "is_media" : is_media ,
        # "is_document": is_document,
        # "is_voice_clip" : is_voice_clip,
        "message_type" : mention_message_doc.message_type,
        "message_template_type": mention_message_doc.message_template_type,
        "utc_message_date" : mention_message_doc.send_date
    }   
    members = [email.strip() for email in mentioned_users_emails.split(',')]
    channel_doc = frappe.get_doc('ClefinCode Chat Channel',  chat_room)
    for member in members:
        results["room_type"] = "Contributor"
        results["room_name"] = "@" + channel_doc.get_channel_name_for_contributor()
        results["send_date"] = convert_utc_to_user_timezone(mention_message_doc.send_date, get_user_timezone(member)["results"][0]["time_zone"])
        results["time_zone"] = get_user_timezone(member)["results"][0]["time_zone"]
        results["target_user"] = member
        # frappe.publish_realtime(event= "receive_message", message=results, user=member)
        send_notification(member , results, "update_sub_channel_for_last_message") 
          
# ==========================================================================================
def get_last_message_info(user_email, channel, remove_date=None):
    query = """
        SELECT content, send_date, message_type, sender_email
        FROM `tabClefinCode Chat Message`
        WHERE chat_channel = %(channel)s
        AND (only_receive_by IS NULL OR only_receive_by = '' OR only_receive_by = %(user_email)s)
    """
    filters = {
        "channel": channel,
        "user_email": user_email
    }
    
    if remove_date:
        query += " AND send_date <= %(remove_date)s"
        filters["remove_date"] = remove_date

    query += " ORDER BY send_date DESC LIMIT 1"

    try:
        result = frappe.db.sql(query, filters, as_dict=True)
        return result[0] if result else None
    except Exception as e:
        frappe.log_error(message=str(e), title="Error fetching last message info")
        return None

# ==========================================================================================
@frappe.whitelist()
def get_last_message_type(room_type, user_email , channel, remove_date = None):
    last_message = None
    if room_type == "Contributor":
        last_message = getattr(get_last_sub_channel_for_user(channel, user_email), 'name', None)
    else:
        condition = ''
        if remove_date:
            condition = f" AND send_date <= '{remove_date}'"
        
        last_message = frappe.db.sql(f"""
        SELECT name , send_date
        FROM `tabClefinCode Chat Message`
        WHERE chat_channel = '{channel}' {condition}
        AND (only_receive_by IS NULL OR only_receive_by = '')

        UNION

        SELECT name , send_date
        FROM `tabClefinCode Chat Message`
        WHERE chat_channel = '{channel}' {condition}
        AND only_receive_by = '{user_email}' 

        ORDER BY send_date DESC
        LIMIT 1
        """)
        
        if last_message and last_message[0]:
            last_message = last_message[0][0]
    
    if last_message:
        chat_message = frappe.get_doc("ClefinCode Chat Message", last_message)
        if not chat_message.file_type or chat_message.file_type == '':
            return "text" , None
        elif chat_message.file_type == 'audio' and chat_message.is_voice_clip:
            duration = calculate_voice_clip_duration(chat_message.file_id)
            return "voice clip", duration["results"][0]["duration"]
        return chat_message.file_type, None
    else: return None, None
# ========================================================================================== 
#############################################################################################
######################################## Handling with Groups ###############################
#############################################################################################
@frappe.whitelist()
def set_group_name(room, newname, last_active_sub_channel = None):
    frappe.db.set_value('ClefinCode Chat Channel', room, 'channel_name', newname)
    results = {
        "realtime_type" : "rename_group",
        "new_group_name": newname
    }

    notification_title1 = get_room_name(room, "Group")
    for member in frappe.get_doc("ClefinCode Chat Channel" , room).members:
        if member.is_removed == 0 and member.platform == "Chat":
            results["room"] = room
            results["target_user"] = member.user
            frappe.publish_realtime(event= room, message=results, user=member.user)
            frappe.publish_realtime(event= "update_room", message=results, user=member.user)
            # frappe.publish_realtime(event= "receive_message", message=results, user= member.user)            
            send_notification(member.user , results, "rename_group", notification_title1)
    
    notification_title2 = get_room_name(room, "Contributor")
    for contributor in frappe.get_doc("ClefinCode Chat Channel" , room).contributors:
        if contributor.active == 1 and contributor.platform == "Chat":
            results["room"] = last_active_sub_channel
            results["parent_channel"] = room
            results["target_user"] = contributor.user
            frappe.publish_realtime(event= last_active_sub_channel, message=results, user=contributor.user) 
            frappe.publish_realtime(event= "update_room", message=results, user=contributor.user)  
            # frappe.publish_realtime(event="receive_message", message=results, user= contributor.user)            
            send_notification(contributor.user , results, "rename_group", notification_title2) 

    return {"results" : [{"room_new_name" : newname}]}
# ========================================================================================== 
@frappe.whitelist()
def add_group_member(new_members ,room , last_active_sub_channel = None):
    parent = frappe.get_doc("ClefinCode Chat Channel",room)
    previous_messages = frappe.get_all("ClefinCode Chat Message" , {"chat_channel" : room} , "name")
    for member in json.loads(new_members):
        old_member=frappe.get_all("ClefinCode Chat Channel User", 
        filters = {"parent": room,"user": member["email"]}, 
        fields = ['name','user','is_removed'])
        if old_member and old_member[0].is_removed == 1:
            frappe.db.set_value('ClefinCode Chat Channel User', old_member[0].name, 'is_removed', 0)
            frappe.db.set_value('ClefinCode Chat Channel User', old_member[0].name, 'remove_date', None)
            frappe.db.set_value('ClefinCode Chat Channel User', old_member[0].name, 'channel_last_message_number', parent.last_message_number)
            # frappe.db.set_value('ClefinCode Chat Channel User', old_member[0].name, 'last_message_read', parent.last_message_number)
        else:
            # it must get the new version of parent if we added multiple members, at least one of them was old member
            parent = frappe.get_doc("ClefinCode Chat Channel",room)
            parent.append('members', {"profile_id": get_profile_id(member["email"]), 'user': member["email"] , "platform" : member["platform"] , "platform_profile": member.get("platform_profile"), "platform_gateway": member.get("platform_gateway") , "channel_last_message_number" : parent.last_message_number ,"last_message_read" : parent.last_message_number})
            share_doctype("ClefinCode Chat Channel", room, member["email"])
            for msg in previous_messages:
                share_doctype("ClefinCode Chat Message", msg.name, member["email"])
            parent.save(ignore_permissions = True)
            frappe.db.commit()    
    
    results = {
        "channel" : room,
        "added_user_email" : json.loads(new_members),
        "realtime_type": "add_group_member"
    }

    results_for_mobile_app = {
        "channel" : room,
        "realtime_type": "add_group_member"
    }

    notification_title = get_room_name(room, "Group")
    for member in parent.members:
        if member.platform == "Chat":
            results["room"] = room
            results_for_mobile_app["room"] = room
            results["target_user"] = member.user
            frappe.publish_realtime(event= room, message=results, user= member.user)
            frappe.publish_realtime(event= "add_group_member", message=results, user= member.user)
            # frappe.publish_realtime(event="receive_message", message=results, user= member.user)
            send_notification(member.user , results_for_mobile_app, "add_group_member", notification_title)       

    if last_active_sub_channel:  
        notification_title2 = get_room_name(room, "Contributor") 
        for contributor in parent.contributors:
            if contributor.active == 1 and contributor.platform == "Chat":
                results["parent_channel"] = room
                results["room"] = last_active_sub_channel
                results_for_mobile_app["parent_channel"] = room
                results_for_mobile_app["room"] = last_active_sub_channel                
                results["target_user"] = contributor.user
                frappe.publish_realtime(event= last_active_sub_channel, message=results, user= contributor.user)
                frappe.publish_realtime(event= "add_group_member", message=results, user= contributor.user)
                # frappe.publish_realtime(event="receive_message", message=results, user= contributor.user)
                send_notification(contributor.user , results_for_mobile_app, "add_group_member", notification_title2)

    return {"results" : [{"new_members" : new_members}]}
# ==========================================================================================
@frappe.whitelist()
def remove_group_member(email, room , last_active_sub_channel = None):
    remove_date = datetime.datetime.utcnow()
    parent = frappe.get_doc("ClefinCode Chat Channel" , room)
    old_member=frappe.get_all("ClefinCode Chat Channel User", 
    filters = {"parent": room,"user": email  }, 
    fields = ['name','is_admin'])
    # is_removed = frappe.db.get_value('ClefinCode Chat Channel User', 'old_member.name', 'is_removed')
    # frappe.db.set_value('ClefinCode Chat Channel User', old_member[0].name, 'is_admin', 0 , update_modified=True)
    frappe.db.set_value('ClefinCode Chat Channel User', old_member[0].name, 'is_removed', 1)
    frappe.db.set_value('ClefinCode Chat Channel User', old_member[0].name, 'remove_date', remove_date)
    
    results = {
        "channel" : room,
        "removed_user" : get_contact_full_name(email),
        "removed_user_email" : email,
        "remove_date" : remove_date,
        "realtime_type": "remove_group_member"
    }

    notification_title1 = get_room_name(room, "Group")
    for member in parent.members:
        if member.is_removed == 0 and member.platform == "Chat":
            results["target_user"] = member.user
            # results["remove_date"] = convert_utc_to_user_timezone(remove_date, get_user_timezone(member.user)["results"][0]["time_zone"])
            # results["time_zone"] = get_user_timezone(member.user)["results"][0]["time_zone"]
            frappe.publish_realtime(event= room, message=results, user= member.user)
            frappe.publish_realtime(event= "remove_group_member", message=results, user= member.user)
            # frappe.publish_realtime(event="receive_message", message=results, user= member.user)
            send_notification(member.user , results, "remove_group_member", notification_title1)
        
    if last_active_sub_channel:
        notification_title2 = get_room_name(room, "Contributor")
        for contributor in parent.contributors:
            if contributor.active == 1 and contributor.platform == "Chat":
                results["target_user"] = contributor.user
                # results["remove_date"] = convert_utc_to_user_timezone(remove_date, get_user_timezone(contributor.user)["results"][0]["time_zone"])
                # results["time_zone"] = get_user_timezone(contributor.user)["results"][0]["time_zone"]
                frappe.publish_realtime(event= last_active_sub_channel, message=results, user= contributor.user)
                frappe.publish_realtime(event= "remove_group_member", message=results, user= contributor.user)
                # frappe.publish_realtime(event="receive_message", message=results, user= contributor.user)
                send_notification(contributor.user , results, "remove_group_member", notification_title2)
    
    return {"results" : [{"email" : email}]}
# ==========================================================================================
@frappe.whitelist()
def remove_group_member_and_assign_new_admin(email, room, new_admin_email, last_active_sub_channel = None):
    remove_date = datetime.datetime.utcnow()
    parent = frappe.get_doc("ClefinCode Chat Channel" , room)
    old_admin=frappe.get_all("ClefinCode Chat Channel User", 
    filters = {"parent": room,"user": email  }, 
    fields = ['name','is_admin'])
    new_admin=frappe.get_all("ClefinCode Chat Channel User", 
    filters = {"parent": room,"user": new_admin_email  }, 
    fields = ['name','is_admin'])
    frappe.db.set_value('ClefinCode Chat Channel User', old_admin[0].name, 'is_removed', 1)
    frappe.db.set_value('ClefinCode Chat Channel User', old_admin[0].name, 'is_admin', 0)
    frappe.db.set_value('ClefinCode Chat Channel User', old_admin[0].name, 'remove_date', remove_date)
    frappe.db.set_value('ClefinCode Chat Channel User', new_admin[0].name, 'is_admin', 1)

    results = {
        "channel" : room,
        "removed_user" : get_contact_full_name(email),
        "removed_user_email" : email,
        "new_admin_email":new_admin_email,
        "remove_date" : remove_date,
        "realtime_type": "remove_group_member"
    }

    notification_title1 = get_room_name(room, "Group")
    for member in parent.members:
        if member.is_removed == 0 and member.platform == "Chat":
            results["target_user"] = member.user
            frappe.publish_realtime(event= room, message=results, user= member.user)
            frappe.publish_realtime(event= "remove_group_member", message=results, user= member.user)
            # frappe.publish_realtime(event= "receive_message", message=results, user= member.user)
            send_notification(member.user , results, "remove_group_member", notification_title1)
        
    if last_active_sub_channel:
        notification_title2 = get_room_name(room, "Contributor")
        for contributor in parent.contributors:
            if contributor.active == 1 and contributor.platform == "Chat":
                results["target_user"] = contributor.user
                frappe.publish_realtime(event= last_active_sub_channel, message=results, user= contributor.user)
                frappe.publish_realtime(event= "remove_group_member", message=results, user= contributor.user)
                # frappe.publish_realtime(event= "receive_message", message=results, user= contributor.user)
                send_notification(contributor.user , results, "remove_group_member", notification_title2)
                
    return {"results" : [{"email" : email}]}
# ==========================================================================================
@frappe.whitelist()
def get_allowed_group_member():
    return get_users_for_mentions()
# ==========================================================================================
@frappe.whitelist()
def get_room_admins(room,email):  
    admin_members=frappe.get_all("ClefinCode Chat Channel User", 
    filters = {"parent": room,"is_admin": 1 ,"is_removed": 0}, 
    fields = ['user','is_admin'])
    if(len(admin_members)==1 and admin_members[0].user ==email):
        return True
    else:
        return False 
# ==========================================================================================
@frappe.whitelist()
def check_if_removed(email,room):
    parent = frappe.get_doc("ClefinCode Chat Channel",room)
    old_member=frappe.get_all("ClefinCode Chat Channel User", 
    filters = {"parent": room,"user": email  }, 
    fields = ['name','user','is_removed'])
    if(old_member):
        if(old_member[0].is_removed == 1):
            return True
        else:
            return False
# ==========================================================================================
@frappe.whitelist()
def check_if_room_admin(room, email):  
    admin_members=frappe.get_all("ClefinCode Chat Channel User", 
    filters = {"parent": room,"is_admin": 1, "is_removed" : 0 }, 
    fields = ['user','is_admin'])
    check = False
    for member in admin_members:
        if(member.user ==email):
            check = True
            break
    return check
# ==========================================================================================
@frappe.whitelist()
def get_room_creator(room):    
    result =frappe.get_all(
    "ClefinCode Chat Channel",
    fields=["channel_creator", "creation_date"],
    filters={
        "name": room,
    },
    order_by='name asc'
    )
    result[0].channel_creator_name = get_contact_full_name(result[0].channel_creator)
    result[0].utc_message_date = result[0].creation_date
    creation_date =convert_utc_to_user_timezone(result[0].creation_date, get_user_timezone(frappe.session.user)["results"][0]["time_zone"])
    result[0].creation_date= creation_date.strftime("%d/%m/%Y")
    result[0].creation_time= creation_date.strftime("%I:%M %p")
    return result
# ========================================================================================== 
#############################################################################################
######################################## Get Channel Info ###################################
#############################################################################################
@frappe.whitelist()
def get_chat_members(room):
    chat_members = []
    channel_doc = frappe.get_doc("ClefinCode Chat Channel" , room)    

    for user in channel_doc.members:
        if user.is_removed == 0 and user.is_admin == 1:
            chat_members.append({"profile_id" : user.profile_id , "name" : get_contact_full_name(user.user) , "email" : user.user, "is_admin":user.is_admin , "platform":user.platform})
        elif user.is_removed == 0 and user.is_admin == 0:
            chat_members.append({"profile_id" : user.profile_id , "name" : get_contact_full_name(user.user) , "email" : user.user, "is_admin":user.is_admin , "platform":user.platform})
    
    return {"results" : [{"chat_members" : chat_members}]}
# ==========================================================================================
@frappe.whitelist()
def get_contributors(room):
    contributors_list = []
    channel_doc = frappe.get_doc("ClefinCode Chat Channel" , room)    

    for user in channel_doc.contributors:
        if user.active == 1:
            contributors_list.append({"profile_id" : user.profile_id , "name" : get_contact_full_name(user.user) , "email" : user.user , "platform" : user.platform})
    
    return {"results" : [{"contributors" : contributors_list}]}
# ==========================================================================================
@frappe.whitelist()
def get_sub_channel_members(room , user_email):
    members_list = []
    channel_doc = frappe.get_doc("ClefinCode Chat Channel" , room)    

    for user in channel_doc.members:
        if user.user == user_email:
            continue
        if user.active == 1:
            members_list.append({"profile_id" : user.profile_id, "name" : get_contact_first_name(user.user) , "email" : user.user , "platform" : user.platform})
    
    return {"results" : [{"contributors" : members_list}]}
# ========================================================================================== 
@frappe.whitelist()
def get_room_in_common(email1,email2):
    results1 = []
    results2 = []
    results3 = []
    parents = frappe.db.sql(f"""
    SELECT ChatChannel.name, ChatChannel.type, ChatChannel.channel_name
    FROM `tabClefinCode Chat Channel` AS ChatChannel
    WHERE ChatChannel.type = 'Group'
   ORDER BY ChatChannel.name DESC
    """ , as_dict = True)

    if parents:
        for c in parents:
            results2.append(c.name)
            if c.channel_name:
                results1.append({"name" : c.name , "channel_name" : c.channel_name})
            else:
                results1.append({"name" : c.name , "channel_name" : frappe.get_doc("ClefinCode Chat Channel" , c.name).get_group_name()})
    
    results2_str = "', '".join(map(str, results2))
    query = f"""
    WITH email_count AS (
        SELECT parent, COUNT(DISTINCT user) AS cnt
        FROM `tabClefinCode Chat Channel User`
        WHERE parent IN ('{results2_str}') AND user IN (%s, %s)
        GROUP BY parent
        HAVING cnt = 2
    )
    SELECT parent FROM email_count;
    """
    users = frappe.db.sql(query,  [email1, email2], as_dict=True)
    for x in results1:
        for user in users:
            if (x['name'] == user['parent']):
                results3.append({"name" : x['name'] , "channel_name" : x['channel_name']})
    return {"results" : [{"results" : results3}]}
# ==========================================================================================  
@frappe.whitelist()
def get_chat_links(channel , remove_date = None):
    is_parent = frappe.db.get_value("ClefinCode Chat Channel" , channel , "is_parent")    
    condition = ""
    if is_parent == 1:
        condition = f"chat_channel = '{channel}'"
        if remove_date:
            condition+= f" AND send_date <= '{remove_date}'"                
    else:
        sub_channels = json.loads(channel)
        sub_channels_list = []
        for d in sub_channels:
            sub_channels_list.append(d)
        sub_channels_str = ', '.join([frappe.db.escape(c) for c in sub_channels_list])
        condition = f"sub_channel IN ({sub_channels_str})"

    results = frappe.db.sql(f"""
    SELECT content , send_date , sender_email , sender , name AS message_name , is_media , is_document , is_voice_clip , file_id  , message_type, message_template_type
    FROM `tabClefinCode Chat Message`
    WHERE {condition} And is_link = 1

    ORDER BY send_date DESC 
    """ , as_dict = True)
    
    for message in results:
        message.utc_message_date = message.send_date
    
    return {"results" : [{"results" : results}]} 
# ========================================================================================== 
@frappe.whitelist()
def get_chat_media(channel , remove_date = None):
    is_parent = frappe.db.get_value("ClefinCode Chat Channel" , channel , "is_parent")    
    condition = ""
    if is_parent == 1:
        condition = f"chat_channel = '{channel}'"
        if remove_date:
            condition+= f" AND send_date <= '{remove_date}'"                
    else:
        sub_channels = json.loads(channel)
        sub_channels_list = []
        for d in sub_channels:
            sub_channels_list.append(d)
        sub_channels_str = ', '.join([frappe.db.escape(c) for c in sub_channels_list])
        condition = f"sub_channel IN ({sub_channels_str})"

    results = frappe.db.sql(f"""
    SELECT content , send_date , sender_email , sender , name AS message_name , is_media , is_document , is_voice_clip , file_id  , message_type, message_template_type
    FROM `tabClefinCode Chat Message`
    WHERE {condition} And is_media = 1

    ORDER BY send_date DESC 
    """ , as_dict = True)
    
    for message in results:
        message.utc_message_date = message.send_date
    return {"results" : [{"results" : results}]}
# ==========================================================================================
@frappe.whitelist()
def get_chat_docs(channel , remove_date = None):
    is_parent = frappe.db.get_value("ClefinCode Chat Channel" , channel , "is_parent")    
    condition = ""
    if is_parent == 1:
        condition = f"chat_channel = '{channel}'"
        if remove_date:
            condition+= f" AND send_date <= '{remove_date}'"                
    else:
        sub_channels = json.loads(channel)
        sub_channels_list = []
        for d in sub_channels:
            sub_channels_list.append(d)
        sub_channels_str = ', '.join([frappe.db.escape(c) for c in sub_channels_list])
        condition = f"sub_channel IN ({sub_channels_str})"

    results = frappe.db.sql(f"""
    SELECT content , send_date , sender_email , sender , name AS message_name , is_media , is_document , is_voice_clip , file_id  , message_type, message_template_type
    FROM `tabClefinCode Chat Message`
    WHERE {condition} And is_document = 1

    ORDER BY send_date DESC 
    """ , as_dict = True)

    for message in results:
        message.utc_message_date = message.send_date
    return {"results" : [{"results" : results}]}
#############################################################################################
######################################## Handling with Files ################################
#############################################################################################
@frappe.whitelist()
def get_file(file_id):
    file_doc = frappe.get_doc("File", {"name": file_id})
    file_path = file_doc.get_full_path()
    audio_base64 = None
    with open(file_path, "rb") as in_file:
        audio_bytes = in_file.read()
        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
    return {"results" : audio_base64}
# ==========================================================================================
@frappe.whitelist()
def get_file_size(file_id):
    file_size = frappe.get_value("File", {"name": file_id},"file_size")
    return {"results" : file_size}
# ==========================================================================================
@frappe.whitelist()
def calculate_voice_clip_duration(file_id, formatted = True):
    # from pydub.utils import mediainfo
    # info = mediainfo(file_path)
    # duration = float(info['duration'])

    from pydub import AudioSegment 
    file_doc = frappe.get_doc("File", {"name": file_id})
    file_path = file_doc.get_full_path()

    if not os.path.exists(file_path):
        return {"error": "File does not exist at the specified path"}

    audio = AudioSegment.from_file(file_path)
    # duration_in_seconds = len(audio)
    duration_in_seconds = audio.duration_seconds
    if formatted:
        minutes, seconds = divmod(duration_in_seconds, 60)
        duration_in_seconds = f"{int(minutes):02d}:{int(seconds):02d}"
    return {"results" : [{"duration" : duration_in_seconds}]}
# ==========================================================================================
@frappe.whitelist()
def get_file_view_size(file_id,is_video=None):
    file_doc = frappe.get_doc("File", {"name": file_id})
    file_path = file_doc.get_full_path()
    file_base64 = None
    duration=None
    if is_video:
        with VideoFileClip(file_path) as clip:
            frame = clip.get_frame(0)
            image = Image.fromarray(frame, 'RGB')
            img_downsampled = image.resize((50, 50), Image.ANTIALIAS)
            buffered = io.BytesIO()
            img_downsampled.save(buffered, format="JPEG")
            file_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
            duration = clip.duration
        clip.close()
    else:
        img = Image.open(file_path)
        img_downsampled = img.resize((20, 20), Image.ANTIALIAS)
        img_downsampled = img_downsampled.convert('RGB')
        if img_downsampled.mode == "RGBA":
            img_downsampled = img_downsampled.convert("RGB")
        buffer = BytesIO()
        img_downsampled.save(buffer, format="JPEG")
        file_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    return {"results" : [{'file_size':file_doc.file_size,'data':file_base64,'duration':duration}]}
# ==========================================================================================
def set_attach_message(attachment, message):
    file_doc = frappe.get_doc("File", {"file_url": attachment})
    file_doc.update({
        "attached_to_doctype": "ClefinCode Chat Message",
        "attached_to_name": message
    })
    file_doc.save(ignore_permissions = True)
# ==========================================================================================
def get_file_type(file_name):
    ext = os.path.splitext(file_name)[1]  # Get the file extension
    mime_type = mimetypes.guess_type(file_name)[0]
    if mime_type and mime_type.startswith('image/') or ext == '.webp' :
        return 'image'
    elif ext in ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.zip' , '.rar', 'csv' , 'ppsx']:
        return 'document'
    else:
        return mime_type.split('/')[0] if mime_type else ""
# ==========================================================================================
@frappe.whitelist()
def save_voice_clip(data , filename , platform=None, is_mov="False"):
    # Decode the base64 content
    audio_bytes=None
    if platform:
        if is_mov == "True":
            audio_bytes = convert_to_mp4(data)
        else:    
            audio_bytes = base64.b64decode(data)
    else:
        audio_bytes = base64.b64decode(data.split(',')[1])

    file = frappe.get_doc({
        "doctype" : "File",
        "content" : audio_bytes,
        "file_name" : filename,
        "is_private": 1,
    }).insert(ignore_permissions = True)
    
    return {"file_url" : file.file_url , "file_name" : file.file_name,"file_id": file.name}
# ==========================================================================================
def convert_to_mp4(data):
    try:
        # Step 1: Decode base64 into raw MOV bytes
        raw_bytes = base64.b64decode(data)
        
        # Step 2: Save MOV bytes to a temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mov") as temp_mov_file:
            temp_mov_file.write(raw_bytes)
            mov_filename = temp_mov_file.name
        
        # Step 3: Load MOV file and convert to MP4
        clip = VideoFileClip(mov_filename)
        
        # Step 4: Save to another temporary MP4 file
        temp_mp4_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        mp4_filename = temp_mp4_file.name
        temp_mp4_file.close()  # Close so that moviepy can write on it
        
        clip.write_videofile(
            mp4_filename,
            codec='libx264',
            audio_codec='aac',
            fps=clip.fps,
            preset='medium',
            threads=4,
            ffmpeg_params=["-vf", f"scale={clip.w}x{clip.h}"]
        )

        clip.close()
        
        # Step 5: Read the MP4 file back into bytes
        with open(mp4_filename, 'rb') as f:
            mp4_bytes = f.read()
        
        # Step 6: Cleanup temp files
        os.remove(mov_filename)
        os.remove(mp4_filename)

        # Step 7: Return MP4 bytes ready for saving
        return mp4_bytes

    except Exception as e:
        frappe.log_error("convert_to_mp4 error", str(e))
        raise
# ==========================================================================================
@frappe.whitelist()   
def set_avatar(data, filename, platform=None, is_group =None, parent =None, profile =None, last_active_sub_channel = None, delete_avatar = None):   
    parent_channel_doc = frappe.get_doc("ClefinCode Chat Channel" , parent)
    image_bytes=None   

    if platform:
        image_bytes = base64.b64decode(data)
    else:
        image_bytes = base64.b64decode(data.split(',')[1])
    
    if is_group =='1':
        if delete_avatar =='1':
            parent_channel_doc.set("channel_image", "")
            parent_channel_doc.save(ignore_permissions = True)
            results = {
                "room" : parent,
                "realtime_type" : "set_avatar",
                "file_url":""
            }
            for member in parent_channel_doc.members:
                if member.is_removed == 0 and member.platform == "Chat":
                    results["target_user"] = member.user
                    # frappe.publish_realtime(event= "receive_message", message=results, user= member.user)
                    send_notification(member.user , results, "set_avatar")
                    
            
            if last_active_sub_channel:   
                for contributor in parent_channel_doc.contributors:
                    if contributor.active == 1 and contributor.platform == "Chat":
                        results["target_user"] = contributor.user
                        # frappe.publish_realtime(event="receive_message", message=results, user= contributor.user)
                        send_notification(contributor.user , results, "set_avatar") 
            return {"results" : "image deleted"}
        else :

            file = frappe.get_doc({
                "doctype" : "File",
                "content" : image_bytes,
                "file_name" : filename,
                "is_private": 1,
                "attached_to_doctype":"ClefinCode Chat Channel",
                "attached_to_name":parent,
                "file_url": "/private/files/"+str(filename)            
            }).insert(ignore_permissions = True)
            
            parent_channel_doc.channel_image = file.file_url
            parent_channel_doc.save(ignore_permissions=True)        

            results = {
                "room" : parent,
                "realtime_type" : "set_avatar",
                "file_url":"/private/files/"+str(filename)
            }

        for member in parent_channel_doc.members:
            if member.is_removed == 0 and member.platform == "Chat":
                results["target_user"] = member.user
                # frappe.publish_realtime(event= "receive_message", message=results, user= member.user)
                send_notification(member.user , results, "set_avatar") 
            
        if last_active_sub_channel:   
            for contributor in parent_channel_doc.contributors:
                if contributor.active == 1 and contributor.platform == "Chat":
                    results["target_user"] = contributor.user
                    # frappe.publish_realtime(event="receive_message", message=results, user= contributor.user) 
                    send_notification(contributor.user , results, "set_avatar") 

    else:
        file = frappe.get_doc({
            "doctype" : "File",
            "content" : image_bytes,
            "file_name" : filename,
            "is_private": 1,
            "attached_to_doctype":"ClefinCode Chat Profile",
            "attached_to_name":profile,
            "file_url": "/private/files/"+str(filename)            
        }).insert(ignore_permissions = True)
        
        results = {
            "room" : parent,
            "realtime_type" : "set_avatar",
            "file_url":"/private/files/"+str(filename)
        }

        # frappe.publish_realtime(event= "receive_message", message=results)                    

    return  {"results" : [{"file_url" : file.file_url , "file_name" : file.file_name,"file_id": file.name}]}
# ==========================================================================================
def check_if_user_has_permission_to_file(message_name):
    chat_channel = frappe.db.get_value("ClefinCode Chat Message" , message_name , "chat_channel")
    for member in frappe.get_doc("ClefinCode Chat Channel" , chat_channel).members:
        if frappe.session.user == member.user:
            return True
    
    sub_channel = frappe.db.get_value("ClefinCode Chat Message" , message_name , "sub_channel")
    if sub_channel:
        for member in frappe.get_doc("ClefinCode Chat Channel" , sub_channel).members:
            if frappe.session.user == member.user:
                return True

    return False
#############################################################################################
######################################## ClefinCode Chat Topics ########################################
#############################################################################################
@frappe.whitelist()
def get_topic_info(chat_channel):
    chat_topic = frappe.get_all("ClefinCode Chat Topic" , ["name" , "subject" , "is_private"] , {"chat_channel":chat_channel , "topic_status" : "Open"})
    if chat_topic:
        reference_doctypes = frappe.db.sql(f"""
        SELECT doctype_link AS doctype , docname
        FROM `tabClefinCode Chat Topic Reference`
        WHERE parent = '{chat_topic[0].name}' AND active = 1
        ORDER BY idx
        """ , as_dict = True)
        if reference_doctypes:    
            return {"results" : [{"chat_topic" : chat_topic[0].name , "reference_doctypes" : reference_doctypes, "chat_topic_subject" : chat_topic[0].subject , "chat_topic_status": "private" if chat_topic[0].is_private == 1 else "public"}]}
        else:        
            return {"results" : [{"chat_topic" : chat_topic[0].name , "reference_doctypes" : [] , "chat_topic_subject" : chat_topic[0].subject , "chat_topic_status": "private" if chat_topic[0].is_private == 1 else "public"}]}
    else:
        return {"results" : [{"chat_topic" : None , "reference_doctypes" : [] , "chat_topic_subject" : None}]}
# ==========================================================================================
@frappe.whitelist()
def get_references_doctypes(chat_topic):
    """ for mobile app """
    reference_doctypes = frappe.db.sql(f"""
    SELECT doctype_link AS doctype , docname
    FROM `tabClefinCode Chat Topic Reference`
    WHERE parent = '{chat_topic}' AND active = 1
    ORDER BY idx
    """ , as_dict = True)
    
    return {"results" : [{"reference_doctypes" : reference_doctypes , "chat_topic_subject" : frappe.db.get_value("ClefinCode Chat Topic" , chat_topic, "subject") , "chat_topic_status" : frappe.db.get_value("ClefinCode Chat Topic" , chat_topic, "is_private")}]}
# ==========================================================================================
@frappe.whitelist()
def create_chat_topic(mention_doctypes, chat_channel, last_active_sub_channel = None):
    mention_doctypes = json.loads(mention_doctypes)
    chat_topic = frappe.get_doc({
        "doctype" : "ClefinCode Chat Topic",
        "chat_channel" : chat_channel,
        "topic_status": "Open",
        "is_private" : 1
    }).insert(ignore_permissions = True)
    for doc in mention_doctypes:
        chat_topic.append("references", {"doctype_link": doc["doctype"] , "docname":doc["docname"], "active":1})
    chat_topic.save(ignore_permissions = True)
    frappe.db.commit()

    results = {
        "realtime_type" : "set_topic",
        "chat_topic": chat_topic.name,
        "mention_doctypes" : mention_doctypes
    }

    for member in frappe.get_doc("ClefinCode Chat Channel" , chat_channel).members:
        if member.is_removed == 0 and member.platform == "Chat":
            share_doctype("ClefinCode Chat Topic", chat_topic.name, member.user)
            results["room"] = chat_channel
            results["target_user"] = member.user
            frappe.publish_realtime(event= chat_channel, message=results, user=member.user)   
            # frappe.publish_realtime(event="receive_message", message=results, user= member.user)
            send_notification(member.user , results, "set_topic")
    
    for contributor in frappe.get_doc("ClefinCode Chat Channel" , chat_channel).contributors:
        if contributor.active == 1 and contributor.platform == "Chat":
            share_doctype("ClefinCode Chat Topic", chat_topic.name, contributor.user)
            results["room"] = last_active_sub_channel
            results["parent_channel"] = chat_channel
            results["target_user"] = contributor.user
            frappe.publish_realtime(event= last_active_sub_channel, message=results, user=contributor.user)   
            # frappe.publish_realtime(event="receive_message", message=results, user= contributor.user) 
            send_notification(contributor.user , results, "set_topic")  

    return {"results" : [{"chat_topic" : chat_topic.name}]}
# ==========================================================================================
@frappe.whitelist()
def remove_chat_topic(chat_topic, chat_channel, last_active_sub_channel = None):
    frappe.db.set_value("ClefinCode Chat Topic" , chat_topic , "topic_status" , "Closed")

    results = {
        "realtime_type" : "remove_topic"
    }

    for member in frappe.get_doc("ClefinCode Chat Channel" , chat_channel).members:
        if member.is_removed == 0 and member.platform == "Chat":
            results["room"] = chat_channel
            results["target_user"] = member.user
            frappe.publish_realtime(event= chat_channel, message=results, user=member.user)   
            # frappe.publish_realtime(event="receive_message", message=results, user= member.user)
            send_notification(member.user , results, "remove_topic")
    
    for contributor in frappe.get_doc("ClefinCode Chat Channel" , chat_channel).contributors:
        if contributor.active == 1 and contributor.platform == "Chat":
            results["room"] = last_active_sub_channel
            results["parent_channel"] = chat_channel
            results["target_user"] = contributor.user
            frappe.publish_realtime(event= last_active_sub_channel, message=results, user=contributor.user)   
            # frappe.publish_realtime(event="receive_message", message=results, user= contributor.user)
            send_notification(contributor.user , results, "remove_topic")
    
    return {"results" : [{"chat_topic_subject" : frappe.db.get_value("ClefinCode Chat Topic" , chat_topic , "subject")}]}
# ==========================================================================================
@frappe.whitelist()
def add_reference_doctype(mention_doctypes, chat_topic, last_active_sub_channel = None):
    chat_topic_doc = frappe.get_doc("ClefinCode Chat Topic" , chat_topic)
    for doc in json.loads(mention_doctypes):
        reference_doctype_name = frappe.db.get_value("ClefinCode Chat Topic Reference" , {"parent" : chat_topic , "docname" : doc["docname"], "active" : 0} , "name")
        if reference_doctype_name:
            frappe.db.set_value("ClefinCode Chat Topic Reference" , reference_doctype_name , "active", 1)
        else:
            chat_topic_doc = frappe.get_doc("ClefinCode Chat Topic" , chat_topic)
            chat_topic_doc.append("references", {"doctype_link": doc["doctype"] , "docname":doc["docname"], "active":1})
            chat_topic_doc.save(ignore_permissions = True)
            frappe.db.commit()

    results = {
        "realtime_type" : "add_doctype",
        "chat_topic": chat_topic,
        "mention_doctypes" : json.loads(mention_doctypes)
    }

    for member in frappe.get_doc("ClefinCode Chat Channel" , chat_topic_doc.chat_channel).members:
        if member.is_removed == 0 and member.platform == "Chat":
            results["room"] = chat_topic_doc.chat_channel
            results["target_user"] = member.user
            frappe.publish_realtime(event= chat_topic_doc.chat_channel, message=results, user=member.user)   
            # frappe.publish_realtime(event="receive_message", message=results, user= member.user)
            send_notification(member.user , results, "add_doctype")
    
    for contributor in frappe.get_doc("ClefinCode Chat Channel" , chat_topic_doc.chat_channel).contributors:
        if contributor.active == 1 and contributor.platform == "Chat":
            results["room"] = last_active_sub_channel
            results["parent_channel"] = chat_topic_doc.chat_channel
            results["target_user"] = contributor.user
            frappe.publish_realtime(event= last_active_sub_channel, message=results, user=contributor.user)   
            # frappe.publish_realtime(event="receive_message", message=results, user= contributor.user)
            send_notification(contributor.user , results, "add_doctype")
    
    return {"results" : [{"chat_topic" : chat_topic}]}
# ==========================================================================================
@frappe.whitelist()
def remove_reference_doctype(chat_topic, reference_doctype, chat_channel, last_active_sub_channel = None):
    reference_doctype_name = frappe.db.get_value("ClefinCode Chat Topic Reference" , {"parent" : chat_topic , "docname" : reference_doctype, "active" : 1} , "name")
    frappe.db.set_value("ClefinCode Chat Topic Reference" , reference_doctype_name , "active", 0)

    results = {
        "realtime_type" : "remove_doctype",
        "removed_doctype": reference_doctype
    }

    for member in frappe.get_doc("ClefinCode Chat Channel" , chat_channel).members:
        if member.is_removed == 0 and member.platform == "Chat":
            results["room"] = chat_channel
            results["target_user"] = member.user
            frappe.publish_realtime(event= chat_channel, message=results, user=member.user)   
            # frappe.publish_realtime(event="receive_message", message=results, user= member.user)
            send_notification(member.user , results, "remove_doctype")
    
    for contributor in frappe.get_doc("ClefinCode Chat Channel" , chat_channel).contributors:
        if contributor.active == 1 and contributor.platform == "Chat":
            results["room"] = last_active_sub_channel
            results["parent_channel"] = chat_channel
            results["target_user"] = contributor.user
            frappe.publish_realtime(event= last_active_sub_channel, message=results, user=contributor.user)   
            # frappe.publish_realtime(event="receive_message", message=results, user= contributor.user)
            send_notification(contributor.user , results, "remove_doctype")

    return {"results" : [{"status" : "Done"}]}
# ==========================================================================================
@frappe.whitelist()
def set_topic_subject(chat_topic, new_subject, chat_channel, last_active_sub_channel = None):
    frappe.db.set_value("ClefinCode Chat Topic" , chat_topic , "subject", new_subject)
    
    results = {
        "realtime_type" : "rename_topic",
        "new_subject": new_subject
    }

    for member in frappe.get_doc("ClefinCode Chat Channel" , chat_channel).members:
        if member.is_removed == 0 and member.platform == "Chat":
            results["room"] = chat_channel
            results["target_user"] = member.user
            frappe.publish_realtime(event= chat_channel, message=results, user=member.user)   
            # frappe.publish_realtime(event="receive_message", message=results, user= member.user)
            send_notification(member.user , results, "rename_topic")
    
    for contributor in frappe.get_doc("ClefinCode Chat Channel" , chat_channel).contributors:
        if contributor.active == 1 and contributor.platform == "Chat":
            results["room"] = last_active_sub_channel
            results["parent_channel"] = chat_channel
            results["target_user"] = contributor.user
            frappe.publish_realtime(event= last_active_sub_channel, message=results, user=contributor.user)   
            # frappe.publish_realtime(event="receive_message", message=results, user= contributor.user)
            send_notification(contributor.user , results, "rename_topic")
    
    return {"results" : [{"status" : "Done"}]}
# ==========================================================================================
@frappe.whitelist()
def set_topic_status(chat_topic, chat_topic_status, chat_channel, last_active_sub_channel = None):
    old_status = frappe.db.get_value("ClefinCode Chat Topic" , chat_topic , "is_private")
    set_chat_topic_status = 1 if chat_topic_status == "private" else 0    
    frappe.db.set_value("ClefinCode Chat Topic" , chat_topic , "is_private", set_chat_topic_status)
    
    results = {
        "realtime_type" : "set_topic_status",
        "chat_topic_status": chat_topic_status
    }

    for member in frappe.get_doc("ClefinCode Chat Channel" , chat_channel).members:
        if member.is_removed == 0 and member.platform == "Chat":
            results["room"] = chat_channel
            results["target_user"] = member.user
            frappe.publish_realtime(event= chat_channel, message=results, user=member.user)   
            # frappe.publish_realtime(event="receive_message", message=results, user= member.user)
            send_notification(member.user , results, "set_topic_status")
    
    for contributor in frappe.get_doc("ClefinCode Chat Channel" , chat_channel).contributors:
        if contributor.active == 1 and contributor.platform == "Chat":
            results["room"] = last_active_sub_channel
            results["parent_channel"] = chat_channel
            results["target_user"] = contributor.user
            frappe.publish_realtime(event= last_active_sub_channel, message=results, user=contributor.user)   
            # frappe.publish_realtime(event="receive_message", message=results, user= contributor.user)
            send_notification(contributor.user , results, "set_topic_status")
    
    if old_status == 1 and set_chat_topic_status == 0:
        topic_messages = get_topic_messages(chat_topic)
        if topic_messages:
            for m in topic_messages:
                share_doctype("ClefinCode Chat Message", m.name, user = None, everyone = 1)
    
    return {"results" : [{"status" : "Done"}]}
# ==========================================================================================
@frappe.whitelist()
def check_if_user_has_permission(user_email, chat_topic, chat_channel):
    channel_members = frappe.get_doc("ClefinCode Chat Channel" , chat_channel).members
    for member in channel_members:
        if user_email == member.user:
            return True

    viewers = frappe.get_doc("ClefinCode Chat Topic" , chat_topic).viewers
    for v in viewers:
        if user_email == v.user and v.approved == 1:
            return True

    contributors = get_topic_contributors(chat_topic)
    for c in contributors:
        if user_email == c["email"]:
            return True
        
    return False
# ==========================================================================================
@frappe.whitelist()
def check_if_user_send_request(user_email, chat_topic):
    viewers = frappe.get_doc("ClefinCode Chat Topic" , chat_topic).viewers
    for v in viewers:
        if user_email == v.user and v.approved == 0:
            return True        
    return False
# ==========================================================================================
@frappe.whitelist()
def get_topic_contributors(chat_topic):
    chat_topic_contributors_list = []
    sub_channels = frappe.db.sql(f"""
    SELECT sub_channel
    FROM `tabClefinCode Chat Message`
    WHERE chat_topic ='{chat_topic}' AND sub_channel <> ''
    GROUP BY sub_channel
    """ , as_dict = True)
    for c in sub_channels:
        for member in frappe.get_doc("ClefinCode Chat Channel" , c.sub_channel).members:
            if chat_topic_contributors_list:
                user_exist = any(m["email"] == member.user for m in chat_topic_contributors_list)
                if not user_exist:
                    chat_topic_contributors_list.append({"email" : member.user , "name": get_profile_full_name(member.user)})
            else:
                chat_topic_contributors_list.append({"email" : member.user , "name": get_profile_full_name(member.user)})   
    return chat_topic_contributors_list
# ==========================================================================================
@frappe.whitelist()
def send_topic_access_request(user_email ,chat_topic ,chat_channel, chat_topic_subject, reference_doctype, reference_docname):  
    subject = chat_topic_subject if chat_topic_subject else chat_topic  
    notification_doc = {
    'type': "Alert",		
    'subject': get_profile_full_name(user_email) + " request access to topic " + subject,
    'from_user': user_email,
    'document_type': reference_doctype,
    'document_name': reference_docname,
    'email_content': chat_topic,
    'chat_topic': 1
    }
    for member in frappe.get_doc("ClefinCode Chat Channel" , chat_channel).members:
        enqueue_create_notification(member.user, notification_doc)
    chat_topic_doc = frappe.get_doc("ClefinCode Chat Topic" , chat_topic)
    chat_topic_doc.append("viewers" , {"user" : user_email , "Approved": 0})
    chat_topic_doc.save(ignore_permissions = True)
    frappe.db.commit()
# ==========================================================================================
@frappe.whitelist()
def approve_access_request(sender ,reciever, chat_topic , notification_log, chat_topic_subject, reference_doctype, reference_docname):
    subject = chat_topic_subject if chat_topic_subject else chat_topic  
    notification_doc = {
    'type': "Alert",		
    'subject': get_profile_full_name(sender) + " approved your request access to topic " + subject,
    'from_user': sender,
    'document_type': reference_doctype,
    'document_name': reference_docname,
    'email_content': chat_topic,
    }
    enqueue_create_notification(reciever, notification_doc)
    chat_topic_doc = frappe.get_doc("ClefinCode Chat Topic" , chat_topic)
    for v in chat_topic_doc.viewers:
        if v.user == reciever:
            v.approved = 1
            share_doctype("ClefinCode Chat Topic", chat_topic, reciever)
    chat_topic_doc.save(ignore_permissions = True)

    topic_messages = get_topic_messages(chat_topic)
    if topic_messages:
        for m in topic_messages:
            share_doctype("ClefinCode Chat Message", m.name, reciever)

    frappe.db.set_value("Notification Log" , notification_log , "approved" , 1)
    frappe.db.commit()
# ==========================================================================================
@frappe.whitelist()
def get_topic_messages(chat_topic):
    topic_messages = frappe.db.sql(f"""
    SELECT name
    FROM `tabClefinCode Chat Message`
    WHERE chat_topic = '{chat_topic}'   
    """ , as_dict = True)

    return topic_messages            
# ==========================================================================================
#############################################################################################
######################################## Contacts ###########################################
#############################################################################################
@frappe.whitelist()
def get_contacts(user_email):    
    contacts_list = frappe.db.sql(f"""
    SELECT DISTINCT ChatProfile.name AS profile_id, ChatProfile.full_name, Contact.user AS user_id, User.enabled
    FROM `tabClefinCode Chat Profile` AS ChatProfile
    INNER JOIN `tabContact` AS Contact ON Contact.name = ChatProfile.contact
    LEFT OUTER JOIN `tabUser` AS User ON User.name = Contact.user                     
    WHERE (User.enabled = 1 OR User.enabled IS NULL)
    ORDER BY Contact.user DESC
    """, as_dict=True)
        
    filtered_contacts = []
    if is_limited_user(user_email):
        filtered_contacts = [
            contact for contact in contacts_list if contact.get("user_id") and not is_limited_user(contact.get("user_id"))
        ]
    else:
        filtered_contacts = contacts_list

    for contact in filtered_contacts:
        # Fetch contact details
        contact['contact_details'] = frappe.db.sql("""
            SELECT contact_info, type AS contact_type,verified, `default`
            FROM `tabClefinCode Chat Profile Contact Details`
            WHERE parent = %s
        """, (contact['profile_id'],), as_dict=True)

    return {"results": [{"contacts": filtered_contacts}]}     
# ==========================================================================================
@frappe.whitelist()
def get_contacts_for_new_group(user_email):    
    contacts_list = frappe.db.sql(f"""
    SELECT DISTINCT ChatProfile.name AS profile_id , ChatProfile.full_name , Contact.user AS user_id, User.enabled
    FROM `tabClefinCode Chat Profile` AS ChatProfile INNER JOIN `tabClefinCode Chat Profile Contact Details` AS ContactDetails 
        ON ContactDetails.parent = ChatProfile.name
    INNER JOIN `tabContact` AS Contact
        ON Contact.name = ChatProfile.contact
    LEFT OUTER JOIN `tabUser` AS User
        ON User.name = Contact.user                     
    WHERE (User.enabled = 1 OR User.enabled IS NULL) AND ContactDetails.contact_info <> %s
    AND ContactDetails.type = 'Chat'
    ORDER BY Contact.user DESC
    """ , (user_email) , as_dict = True)    
    
    
    filtered_contacts = []
    if is_limited_user(user_email):
        filtered_contacts = [
            contact for contact in contacts_list if contact.get("user_id") and not is_limited_user(contact.get("user_id"))
        ]
    else:
        filtered_contacts = contacts_list

    for contact in filtered_contacts:
        contact['contact_details'] = frappe.db.sql("""
            SELECT contact_info, type AS contact_type, `default`
            FROM `tabClefinCode Chat Profile Contact Details`
            WHERE parent = %s AND type = 'Chat'
        """, (contact['profile_id'],), as_dict=True)

    return {"results": [{"contacts": filtered_contacts}]}       
# ==========================================================================================
@frappe.whitelist()
def get_contacts_for_adding_to_group(user_email , existing_members , existing_contributors = None): 
    results = []

    contacts_query = """
    SELECT DISTINCT ChatProfile.name AS profile_id, ChatProfile.full_name
    FROM `tabClefinCode Chat Profile` AS ChatProfile INNER JOIN `tabClefinCode Chat Profile Contact Details` AS ContactDetails 
        ON ContactDetails.parent = ChatProfile.name
    INNER JOIN `tabContact` AS Contact
        ON Contact.name = ChatProfile.contact
    LEFT OUTER JOIN `tabUser` AS User
        ON User.name = Contact.user
    WHERE (User.enabled = 1 OR User.enabled IS NULL)         
    AND ContactDetails.verified = 1
    AND ContactDetails.contact_info != %s
    AND ContactDetails.type = 'Chat'   
    ORDER BY ChatProfile.creation DESC
    """
    contacts_list = frappe.db.sql(contacts_query, (user_email,), as_dict=True)
    
    for contact in contacts_list:
        details_query = """
        SELECT contact_info, type AS contact_type, `default`
        FROM `tabClefinCode Chat Profile Contact Details`
        WHERE parent = %s AND type = 'Chat'
        """
        contact['contact_details'] = frappe.db.sql(details_query, (contact['profile_id'],), as_dict=True)    

    if existing_members:
        contacts_list, removed_profiles = filter_contact_list(contacts_list, json.loads(existing_members))
        results = [pro for pro in contacts_list if pro['profile_id'] not in [p['profile_id'] for p in removed_profiles]]
    
    if existing_contributors:
        results = [pro for pro in results if pro['profile_id'] not in [p['profile_id'] for p in json.loads(existing_contributors)]]

    return {"results": [{"contacts" : results}]}
# ==========================================================================================
def filter_contact_list(contacts_list, existing_members):
    removed_profiles = []
    for member in existing_members: 
        for profile in contacts_list: 
            if profile['profile_id'] == member["profile_id"]:
                profile['contact_details'] = [d for d in profile['contact_details'] if not (member["platform"] == d['contact_type'] and member["email"] == d['contact_info'])]
                
                if len(profile['contact_details']) == 0:
                    removed_profiles.append(profile)
    return contacts_list, removed_profiles 
# ==========================================================================================
def get_chat_profile_first_name(chat_profile):
    return frappe.db.get_value("ClefinCode Chat Profile", chat_profile , "full_name").split(' ')[0]
# ==========================================================================================
def get_contact_first_name(contact):
    return frappe.db.sql(f"""
        SELECT ChatProfile.full_name
        FROM `tabClefinCode Chat Profile` AS ChatProfile, `tabClefinCode Chat Profile Contact Details` AS ContactDetails
        WHERE ContactDetails.parent = ChatProfile.name AND ChatProfile.is_support <> 1 AND ContactDetails.contact_info = '{contact}'
        """ , as_dict = True)[0].full_name.split(' ')[0]
# ==========================================================================================
def get_contact_full_name(contact): 
    full_name = frappe.db.sql(f"""
        SELECT ChatProfile.full_name
        FROM `tabClefinCode Chat Profile` AS ChatProfile, `tabClefinCode Chat Profile Contact Details` AS ContactDetails
        WHERE ContactDetails.parent = ChatProfile.name AND ChatProfile.is_support <> 1 AND ContactDetails.contact_info = '{contact}'
        """ , as_dict = True)
    if full_name:
        return full_name[0].full_name
    
    elif not full_name:
        contact_full_name = get_contact_profile_full_name(contact)
        return contact_full_name
        
    else:
        frappe.log_error(
        title="get_contact_full_name",
        message=f"No profile found for contact: {contact} via ERPNext, Instagram, Messenger or Telegram."
    )
# ==========================================================================================
def get_profile_id(user_email):
    user_profile = frappe.db.sql("""
    SELECT DISTINCT parent 
    FROM `tabClefinCode Chat Profile Contact Details` AS ContactDetails 
    INNER JOIN `tabClefinCode Chat Profile` AS ERPNextChatProfile 
    ON ERPNextChatProfile.name = ContactDetails.parent 
    WHERE ERPNextChatProfile.is_support <> 1 AND contact_info = %s
    """, (user_email,), as_dict=True)  # Parameterized query
    if user_profile:
        return user_profile[0].parent
    
    else:
        profile_id = get_contact_profile_full_name(user_email)
        
        if profile_id:
            return profile_id
        else:
            frappe.log_error(
            title="get_profile_id",
            message=f"No profile found for email: {user_email} via ERPNext, Instagram, Messenger or Telegram."
        )
# ==========================================================================================
@frappe.whitelist() 
def get_profile_full_name(user_email):
    full_names = frappe.db.sql(f"""
    SELECT DISTINCT ERPNextChatProfile.full_name
    FROM `tabClefinCode Chat Profile` AS ERPNextChatProfile, `tabClefinCode Chat Profile Contact Details` AS ContactDetails
    WHERE ERPNextChatProfile.name = ContactDetails.parent 
      AND ERPNextChatProfile.is_support <> 1 
      AND ContactDetails.contact_info = '{user_email}'
    """, as_dict=True)

    if full_names:
        if len(full_names) == 1:
            return full_names[0].full_name
        else:
            # More than one result: select the one that is NOT just numbers
            for entry in full_names:
                if not entry.full_name.isdigit():
                    return entry.full_name
            # If all entries are numbers, fallback to first one
            return full_names[0].full_name
    else:
        profile_name =  get_contact_profile_full_name(user_email)
        
        if profile_name:
            return profile_name
        else:
            frappe.log_error(
            title="get_profile_full_name",
            message=f"No profile found for email: {user_email} via ERPNext, Instagram, Messenger or Telegram."
        )
# ========================================================================================== 
def get_support_profile_id(user_email):
    user_profile = frappe.db.sql(f"""
    SELECT DISTINCT parent 
    FROM `tabClefinCode Chat Profile Contact Details` AS ContactDetails INNER JOIN `tabClefinCode Chat Profile` AS ERPNextChatProfile 
    ON ERPNextChatProfile.name = ContactDetails.parent AND ERPNextChatProfile.is_support = 1
    WHERE contact_info = '{user_email}'
    """ , as_dict = True)
    if user_profile:
        return user_profile[0].parent
# ==========================================================================================
#############################################################################################
################################ Detect Contact Status online/offline #######################
#############################################################################################
@frappe.whitelist()
def get_last_active(contact_email=None, user_email=None):
    last_active = ""
    last_active_utc = frappe.db.get_value('ClefinCode Chat Profile' , get_profile_id(contact_email), "last_active")

    if last_active_utc:
        last_active = convert_utc_to_user_timezone(last_active_utc, get_user_timezone(user_email)["results"][0]["time_zone"])
    return {"results" : [{"last_active" : last_active , "last_active_utc" : last_active_utc}]}
# ==========================================================================================
#############################################################################################
######################################## Search Query #######################################
#############################################################################################
@frappe.whitelist()
def search_by_contents(query , room_name_list , user):
    results = []
    for r in json.loads(room_name_list):
        my_messages = frappe.db.sql(f"""
        SELECT  ChatChannelMessage.name AS message_name , ChatChannelMessage.content , ChatChannel.name , ChatChannel.modified , ChatChannel.last_message , ChatChannel.last_message_number , ChatChannel.channel_name , ChatChannel.type
        FROM `tabClefinCode Chat Message` AS ChatChannelMessage INNER JOIN `tabClefinCode Chat Channel` AS ChatChannel ON 
            ChatChannelMessage.chat_channel = ChatChannel.name 
            AND ChatChannelMessage.content LIKE '%{query}%'
            AND ChatChannel.type = 'Direct'
            AND ChatChannelMessage.chat_channel = '{r}'
        
        ORDER BY ChatChannelMessage.modified DESC        
        """ , as_dict = True)
        for room in my_messages:
            if not room.channel_name or room.channel_name == "":
                channel_doc = frappe.get_doc("ClefinCode Chat Channel" , room.name)
                room.creator_email = channel_doc.get_members()[0]  
                room.creator_name = get_contact_full_name(channel_doc.get_members()[0])              
                room.recipient_email = channel_doc.get_members()[1]
                room.recipient_name = get_contact_full_name(channel_doc.get_members()[1])
                room.room_name =  "not_set"                
            else:
                room.room_name = room.channel_name
            
            room.user_unread_messages = frappe.db.sql(f"""
                SELECT unread_messages
                FROM `tabClefinCode Chat Channel User` 
                WHERE parent='{room.name}' AND user ='{user}'""")[0][0]

            room.last_message = room.content
            results.append(room)
        
    return results
# ==========================================================================================
@frappe.whitelist()
def search_in_rooms(user , query):
    room_list = []     
    rooms = frappe.db.sql(f"""
    SELECT 
        ChatChannel.name, 
        ChatChannel.modified, 
        ChatChannel.last_message, 
        ChatChannel.last_message_number, 
        ChatChannel.channel_name AS room_name, 
        ChatChannel.type, 
        ChatChannelUser.user
        
    FROM 
        `tabClefinCode Chat Channel User` AS ChatChannelUser 
        INNER JOIN `tabClefinCode Chat Channel` AS ChatChannel 
            ON ChatChannelUser.parent = ChatChannel.name 

    WHERE ChatChannelUser.user = '{user}'    
    
    """ , as_dict = True)
    for room in rooms:       
        if not room.room_name or room.room_name == "":
            channel_doc = frappe.get_doc("ClefinCode Chat Channel" , room.name)
            if room.type == "Direct":               
                room.creator_email = channel_doc.get_members()[0] 
                if room.creator_email == user:
                    room.recipient_name = get_contact_full_name(channel_doc.get_members()[1])
                else:
                    room.recipient_name = get_contact_full_name(channel_doc.get_members()[0])
                if query.lower() in room.recipient_name.lower():
                    room.room_name = "not_set"
                    room_exist = False
                    for r in room_list:
                        if room.name == r.name:
                            room_exist = True
                    if not room_exist:
                        room_list.append(room)                

            elif room.type == "Group":                
                room.members = [get_contact_first_name(member.user) for member in channel_doc.members]
                room.room_name = "not_set"
                for member in room.members:
                    if query.lower() in member.lower():                        
                        room_exist = False
                        for r in room_list:
                            if room.name == r.name:
                                room_exist = True
                        if not room_exist:
                            room_list.append(room)
        else:
            if query.lower() in room.room_name.lower():
                room_exist = False
                for r in room_list:
                    if room.name == r.name:
                        room_exist = True
                if not room_exist:
                    room_list.append(room)
                

    return {"results":room_list} 
# ==========================================================================================
@frappe.whitelist()
def search_in_message_content(user , query):    
    my_messages = frappe.db.sql(f"""
    SELECT ChatChannel.name , ChatChannel.modified , ChatChannel.last_message , ChatChannel.last_message_number , ChatChannel.channel_name , ChatChannel.type , ChatChannelMessage.name AS message_name , ChatChannelMessage.content
    FROM `tabClefinCode Chat Channel User` AS ChatChannelUser, `tabClefinCode Chat Channel` AS ChatChannel , `tabClefinCode Chat Message` AS ChatChannelMessage
    WHERE ChatChannelUser.parent = ChatChannel.name 
    AND ChatChannelMessage.chat_channel = ChatChannel.name
    AND ChatChannelUser.user = '{user}'
    AND ChatChannelMessage.content LIKE '%{query}%'
    ORDER BY ChatChannelMessage.modified DESC
    """ , as_dict = True)
    for room in my_messages:
        if not room.channel_name or room.channel_name == "":
            channel_doc = frappe.get_doc("ClefinCode Chat Channel" , room.name)
            if room.type == "Direct":
                room.creator_email = channel_doc.get_members()[0]  
                room.creator_name = get_contact_full_name(channel_doc.get_members()[0])              
                room.recipient_email = channel_doc.get_members()[1]
                room.recipient_name = get_contact_full_name(channel_doc.get_members()[1])
                room.room_name =  "not_set"
            elif room.type == "Group":                
                room.members = [get_contact_first_name(member.user) for member in channel_doc.members]
                room.room_name =  "not_set"
        else:
            room.room_name = room.channel_name
        
        room.user_unread_messages = frappe.db.sql(f"""
            SELECT unread_messages
            FROM `tabClefinCode Chat Channel User` 
            WHERE parent='{room.name}' AND user ='{user}'""")[0][0]

        room.last_message = room.content
        
    return my_messages
# ==========================================================================================
@frappe.whitelist()
def search_in_message_contents(channel , query, sub_channel = None):
    filters = {
    "content": ["like", f"%{query}%"],
    "chat_channel": channel
    }
    
    if sub_channel is not None:
        filters["sub_channel"] = sub_channel

    try:
        number_of_results = frappe.db.count("ClefinCode Chat Message", filters)
        return {"results": [{"count": number_of_results}]}
    except Exception as e:
        frappe.log_error(f"Error in search_in_message_contents: {str(e)}")  # Log the error for debugging
        return {"results" : [{"error" : str(e)}]}
    
# ==========================================================================================
#############################################################################################
######################################## WhatsApp Functions #################################
#############################################################################################
def process_whatsapp_message(platform_gateway, whatsapp_customer_number , email, channel_doc, last_responder_user, new_message, file_type, attachment, content, is_voice_clip, is_screenshot,results):    
    responder_user_profile = get_profile_id(email)
    message = None
    is_group_message = (channel_doc.type == "Group" and 
                        last_responder_user and 
                        last_responder_user != responder_user_profile and 
                        new_message.message_type != "information")

    if new_message.message_type == "information":
       
        message_content = process_message_template(content)
        message = f"_{BeautifulSoup(message_content, 'html.parser').get_text()}_"
    elif file_type in ["image", "video", "audio", "document"]:
        if is_screenshot:
            message = frappe.db.get_value("File" , {"attached_to_name": new_message.name}, "file_url")
        else:
            message = attachment
    else:
        if is_group_message:
            message = f"*{get_chat_profile_first_name(responder_user_profile)}*:\n{BeautifulSoup(content, 'html.parser').get_text()}"
        else:
            message = BeautifulSoup(content, 'html.parser').get_text()

    provider = frappe.db.get_value("ClefinCode WhatsApp Profile", platform_gateway, "provider")
    if provider == "Meta":
        #send_whatsapp_template_meta(message_content, whatsapp_customer_number)
        send_whatsapp_message(new_message, platform_gateway, whatsapp_customer_number , message, file_type if file_type in ["image", "video", "audio", "document"] else None, is_voice_clip)
    else:
        if new_message.message_template_type=="Send Template":
            send_whatsapp_message_from_template(new_message, whatsapp_customer_number,platform_gateway,results,attachment)
        else:
            send_whatsapp_message_twilio(new_message, platform_gateway, whatsapp_customer_number , message, file_type if file_type in ["image", "video", "audio", "document"] else None, is_voice_clip)
# ==========================================================================================
def process_message_template(template_html):
    soup = BeautifulSoup(template_html, 'html.parser')

    spans = soup.find_all('span', {'data-user': True})

    for span in spans:
        emails = [email.strip() for email in span['data-user'].split(',')]

        full_names = [get_contact_full_name(email) for email in emails]

        combined_names = ', '.join(full_names)

        if 'sender-user' in span.get('class', []):
            span.insert_after(combined_names + " ")
        elif 'receiver-user' in span.get('class', []):
            span.insert_before(" " + combined_names)

    processed_message = ' '.join(soup.stripped_strings)
    return processed_message
# ========================================================================================
def send_whatsapp_message(new_message_doc, sender, receiver, message, message_type="text", is_voice_clip=False):
    try:
        access_token = get_access_token()
        api_base = "https://graph.facebook.com/v23.0"
        phone_number_id = frappe.db.get_value("ClefinCode WhatsApp Profile", sender, "phone_number_id")
        endpoint = f"{api_base}/{phone_number_id}/messages"

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        if message_type in ['image', 'video', 'audio', 'document']:
            media_id, mime_type = upload_media(message, phone_number_id, access_token, is_voice_clip)
            
            
            if message_type == 'image' and mime_type == 'image/webp':
                response_data = create_media_payload(receiver, media_id, 'sticker')
            elif message_type == 'document':
                response_data = create_document_payload(receiver, media_id, message)
            else:
                response_data = create_media_payload(receiver, media_id, message_type)

        else:
            response_data = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": receiver,
                "type": "text",
                "text": {
                    "preview_url": "true",
                    "body": message
                }
            }

        response = requests.post(endpoint, json=response_data, headers=headers)

        if response.ok:
            new_message_doc.whatsapp_message_id = response.json().get("messages")[0].get("id")
            new_message_doc.save(ignore_permissions = True)
            frappe.db.commit()
        else:
            frappe.log_error(title="send whatsapp message Failed", message=response.text)
            
    except Exception as e:
        frappe.log_error(title="send whatsapp message Exception", message=str(e))
# ==========================================================================================
def send_message_confirm_template(platform_gateway, whatsapp_customer_number, channel, message_template):
    try:       
        access_token = get_access_token()
        api_base = "https://graph.facebook.com/v23.0"
        phone_number_id = frappe.db.get_value("ClefinCode WhatsApp Profile", platform_gateway, "phone_number_id")
        endpoint = f"{api_base}/{phone_number_id}/messages"

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        meta_template_name = frappe.db.get_value("ClefinCode WhatsApp Template" , message_template, "meta_template_name")

        data = {
            "messaging_product": "whatsapp",
            "to": whatsapp_customer_number,
            "type": "template",
             "template": {
                "name": meta_template_name,
                "language": {
                    "code": "en"
                }
            }
        }

        response = requests.post(endpoint, json=data, headers=headers)

        if response.ok:
            frappe.db.set_value('ClefinCode Chat Channel User', {"parent": channel , "user": whatsapp_customer_number, "platform_gateway": platform_gateway}, 'pending_messages', 1)
            frappe.db.commit()
        else:
            frappe.log_error(title="send whatsapp message template Failed", message=response.text)
            
    except Exception as e:
        frappe.log_error(title="send whatsapp message template Exception", message=str(e))
# ==========================================================================================
def create_media_payload(receiver, media_id, media_type):
    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": receiver,
        "type": media_type,
        media_type: {
            "id": media_id
        }
    }
# ==========================================================================================
def create_document_payload(receiver, media_id, file_path):
    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": receiver,
        "type": "document",
        "document": {
            "id": media_id,
            "filename": os.path.basename(file_path)
        }
    }
# ==========================================================================================
def upload_media(message, phone_number_id, access_token, is_voice_clip=False):
    try:
        api_base = "https://graph.facebook.com/v23.0"
        endpoint = f"{api_base}/{phone_number_id}/media"
        file_path = frappe.utils.get_site_path(message.lstrip('/'))
        result_file_path = file_path

        # Convert to OGG format if it's a voice clip
        if is_voice_clip:
            result_file_path = convert_to_ogg(file_path)

        # Register MIME types
        mimetypes.add_type('image/webp', '.webp')
        mimetypes.add_type('audio/ogg', '.ogg')
        mime_type, _ = mimetypes.guess_type(result_file_path)
        
        files = {
            'file': (result_file_path, open(result_file_path, 'rb'), mime_type)
        }

        response = requests.post(endpoint, data={"messaging_product": "whatsapp"}, files=files, headers={"Authorization": f"Bearer {access_token}"})

        if response.json().get("error"):
            frappe.throw(response.json().get("error").get("message"))
        
        if response.ok:
            return response.json().get("id"), mime_type
        
    except Exception as e:
        frappe.log_error(title="upload_media Failed", message=str(e))

# ==========================================================================================
def convert_to_ogg(input_file):
    try:
        folder = os.path.dirname(input_file)
        new_name = f"audio_{random.randint(10000, 99999)}.ogg"
        output_file = os.path.join(folder, new_name)
       
        command = [
            'ffmpeg',
            '-i', input_file,
            '-c:a', 'libopus',
            '-ac', '1',
            '-f', 'ogg',
            '-avoid_negative_ts', 'make_zero',
            output_file
        ]
        subprocess.run(command, check=True)
        return output_file
    except subprocess.CalledProcessError as e:
        frappe.log_error(title="convert_to_ogg Failed", message=str(e))
        raise e
def convert_to_ogg_twilio(input_file):
    """
    Convert any audio file (wav, m4a, mp3, etc.) to a clean Ogg Opus file
    while keeping the original filename (only extension changes to .ogg).
    """
    try:
        folder = os.path.dirname(input_file)
        # Get filename without its current extension
        base_name = os.path.splitext(os.path.basename(input_file))[0]
        output_file = os.path.join(folder, base_name + ".ogg")

        # If file already exists, append a short random 4-digit suffix to avoid overwrite
        if os.path.exists(output_file):
            suffix = ''.join(random.choices(string.digits, k=4))
            output_file = os.path.join(folder, f"{base_name}_{suffix}.ogg")

        # FFmpeg command with best practices for clean Ogg/Opus output
        command = [
            'ffmpeg',
            '-i', input_file,

            # Critical: strip ALL old metadata (removes mp42, com.android.version, etc.)
            '-map_metadata', '-1',

            # Opus settings optimized for speech/voice messages
            '-c:a', 'libopus',             # Use Opus codec
            '-ac', '1',                    # Force mono (most voice notes are mono)
            '-ar', '48000',                # 48 kHz – official Opus recommendation
            '-b:a', '48k',                 # Excellent quality / tiny size for speech
            '-vbr', 'on',                  # Variable bitrate (better quality)
            '-compression_level', '10',    # Maximum compression efficiency

            # Additional cleanup
            '-fflags', '+genpts',          # Regenerate timestamps cleanly
            '-map', '0:a',                 # Copy only audio stream
            '-ignore_unknown',             # Ignore non-audio streams (metadata, etc.)

            # Output format and safety
            '-f', 'ogg',
            '-avoid_negative_ts', 'make_zero',

            # Final output path
            output_file
        ]

        # Run FFmpeg silently (no output unless error occurs)
        subprocess.run(
            command,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        return output_file

    except subprocess.CalledProcessError as e:
        # Log detailed error if FFmpeg fails
        error_msg = (e.stderr or b'').decode('utf-8', errors='ignore')
        frappe.log_error(
            title="Audio to OGG conversion failed",
            message=f"File: {input_file}\n"
                    f"Command: {' '.join(command)}\n"
                    f"Error: {error_msg}"
        )
        raise frappe.ValidationError("Failed to convert audio file to OGG. Make sure FFmpeg is installed.")

    except Exception as e:
        frappe.log_error(title="Unexpected error in convert_to_ogg_twilio", message=str(e))
        raise
# ==========================================================================================
@frappe.whitelist()
def get_whatsapp_numbers_for_sender(user_email):
    whatsapp_numbers_set = set()
    
    personal_numbers = frappe.db.sql(f"""
    SELECT name AS number, type, `default`
    FROM `tabClefinCode WhatsApp Profile`
    WHERE type = 'Personal' AND user = '{user_email}'    
    """, as_dict=True)

    if personal_numbers:
        for n in personal_numbers:
            whatsapp_numbers_set.add((n['number'], n['type'], n['default']))

    support_numbers = frappe.db.sql(f"""
    SELECT DISTINCT wp.name AS number, wp.type, users.`default`
    FROM `tabClefinCode WhatsApp Profile` AS wp 
    INNER JOIN `tabAuthorized Users` users ON users.parent = wp.name 
    WHERE type = 'Support' AND users.user = '{user_email}'    
    """, as_dict=True)

    if support_numbers:
        for n in support_numbers:
            whatsapp_numbers_set.add((n['number'], n['type'], n['default']))

    whatsapp_numbers_list = [dict(number=n[0], type=n[1], default=n[2]) for n in whatsapp_numbers_set]

    return whatsapp_numbers_list
# ==========================================================================================
def get_default_whatsapp_number(whatsapp_numbers_list):     
    for number_info in whatsapp_numbers_list:
        if number_info['default']:
            return number_info['number'] , number_info['type']
    return None, None
# ==========================================================================================
@frappe.whitelist()
def get_whatsapp_number_type(whatsapp_system_number):
    return frappe.db.get_value("ClefinCode WhatsApp Profile" , whatsapp_system_number, "type")
# ==========================================================================================
@frappe.whitelist()
def get_whatsapp_channel(whatsapp_system_number, whatsapp_contact_number):
    whatsapp_system_number_type = get_whatsapp_number_type(whatsapp_system_number)
    
    if whatsapp_system_number_type == "Support":
        condition = " AND type = 'Group' AND chat_status = 'Open' "
    else:
        condition = " AND type = 'Direct'"    

    results = frappe.db.sql(f"""
    SELECT ChatChannel.name
    FROM `tabClefinCode Chat Channel` AS ChatChannel 
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser ON ChatChannelUser.parent = ChatChannel.name
    WHERE ChatChannelUser.user = '{whatsapp_contact_number}' 
    AND platform_gateway = '{whatsapp_system_number}'
    AND is_parent = 1
    AND is_removed = 0
    AND pending_messages = 0
    {condition}     
    """ , as_dict = True)
    
    if results:
        return results[0].name   
# ==========================================================================================    
@frappe.whitelist()
def check_if_contact_has_whatsapp_chat(default_whatsapp_number, default_whatsapp_type, contact, platform, user_email):
    condition = " AND type = 'Direct'"
    if default_whatsapp_type == "Support":
        condition = " AND type = 'Group' AND chat_status = 'Open' "

    results = frappe.db.sql(f"""
    SELECT ChatChannel.name
    FROM `tabClefinCode Chat Channel` AS ChatChannel 
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser ON ChatChannelUser.parent = ChatChannel.name
    WHERE ChatChannelUser.user = '{contact}' 
    AND platform_gateway = '{default_whatsapp_number}'
    AND ChatChannelUser.platform = '{platform}'
    AND is_parent = 1
    AND is_removed = 0
    {condition}     
    """ , as_dict = True) 
    
    if results:
        user_exists = False
        room_name = None
        if default_whatsapp_type == "Support":
            room_doc = frappe.get_doc("ClefinCode Chat Channel" , results[0].name)   
            room_name = get_room_name(results[0].name, "Group")                
            viewer_exists = False
            for m in room_doc.members:
                if m.user == user_email:
                    user_exists = True                    
                    break            

        return {"results" : [{"room": results[0].name , "user_exists" : user_exists, "room_name" : room_name}]}
    else:
         return {"results" : []}
# ==========================================================================================
#############################################################################################
######################################## Helper Functions ###################################
#############################################################################################
@frappe.whitelist()
def trigger_chat_channel_status(room, is_open):
    if not room:
        frappe.throw(_("Room ID is required"))

    chat_channel = frappe.get_doc("ClefinCode Chat Channel", room)

    # your new behavior:
    if is_open in (True, "true", "1", 1):
        chat_channel.chat_status = "Closed"
    else:
        chat_channel.chat_status = "Open"

    chat_channel.save(ignore_permissions=True)
    frappe.db.commit()
    
    results = {
        "channel" : room,
        "realtime_type": "trigger_channel_status",
        'chat_status': is_open
    }

    # let any connected clients know
    frappe.publish_realtime(event='trigger_channel_status', message={"room": room, "status":"Closed" if is_open in (True, "true", "1", 1) else "Open"})
    
    for member in chat_channel.members:
        if member.platform == "Chat":
            send_notification(member.user , results, "trigger_channel_status")

    return {"status": "success", "message": f"Chat channel {chat_channel.chat_status.lower()}"}
# ==========================================================================================
@frappe.whitelist()
def check_if_contact_has_chat(user_email , contact , platform):
    res = [{}]
    results = frappe.db.sql(f"""
    SELECT ChatChannel.name, ChatChannel.chat_status
    FROM `tabClefinCode Chat Channel` AS ChatChannel 
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser ON ChatChannelUser.parent = ChatChannel.name
    WHERE ChatChannelUser.user IN ('{user_email}', '{contact}')
    AND type = 'Direct'
    AND is_parent = 1 
    GROUP BY ChatChannel.name
    HAVING COUNT(DISTINCT ChatChannelUser.user) = 2
    """ , as_dict = True) 
    if not results:
        res[0]["user"] = get_profile_full_name(user_email)
        results = res
    else:
        results[0].user = get_profile_full_name(user_email)
    return {"results" : results[0]}
# ==========================================================================================
@frappe.whitelist()
def check_if_contributor_active(channel , user_email):
    members = frappe.db.sql(f"""
    SELECT DISTINCT ChatChannelUser.active
    FROM `tabClefinCode Chat Channel` AS ChatChannel , `tabClefinCode Chat Channel User` AS ChatChannelUser
    WHERE ChatChannelUser.parent = ChatChannel.name 
    AND ChatChannelUser.user = '{user_email}'  AND parent = '{channel}'
    """ , as_dict = True)
    return {"results" : [{"active" : 1 if len(members) > 0 and members[0].active == 1 else 0}]}
# ==========================================================================================
@frappe.whitelist()
def contributor_unread_messages(user_email , parent_channel):    
    user_unread_messages = frappe.db.sql(f"""
    SELECT  SUM( DISTINCT last_message_number - ChatChannelUser.last_message_read) AS user_unread_messages
    FROM `tabClefinCode Chat Channel` AS ChatChannel INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser ON
    ChatChannelUser.parent = ChatChannel.name 
    WHERE parent_channel = '{parent_channel}'
    AND ChatChannelUser.user = '{user_email}'
    """ , as_dict = True)
    
    return user_unread_messages[0].user_unread_messages
# ==========================================================================================  
def disable_contributor(channel_doc , contributor):
    for c in channel_doc.contributors:
        if c.user == contributor and c.active == 1:
            c.active = 0
            break
    channel_doc.save(ignore_permissions=True)
# ==========================================================================================
@frappe.whitelist()
def get_user_timezone(user_email):  
    return {"results" : [{"time_zone":frappe.db.get_value("User" , user_email , "time_zone") or get_time_zone()}]}
# ==========================================================================================
@frappe.whitelist()
def set_user_timezone(user_email , time_zone):  
    frappe.db.set_value("User" , user_email , "time_zone" , time_zone)
# ==========================================================================================
def convert_utc_to_user_timezone(utc_time, user_timezone, formatted=None):
    # Check if utc_time is a string and convert to datetime
    if isinstance(utc_time, str):
        try:
            # Use datetime.fromisoformat if available, fallback to dateutil.parser.parse
            try:
                utc_time = datetime.fromisoformat(utc_time)  # Python >= 3.7
            except AttributeError:
                utc_time = parser.parse(utc_time)  # Fallback for Python < 3.7
        except ValueError:
            raise ValueError("Invalid UTC time format. Expected ISO 8601 string or datetime object.")
    
    # Ensure utc_time is timezone-aware in UTC
    if utc_time.tzinfo is None:
        utc_time = pytz.utc.localize(utc_time)
    elif utc_time.tzinfo != pytz.utc:
        raise ValueError("utc_time must be in UTC timezone.")
    # Define user timezone
    user_tz = pytz.timezone(get_clean_timezone(user_timezone))
    # Convert to user timezone
    user_time = utc_time.astimezone(user_tz)
    # Format the time if required
    if formatted:
        user_time = user_time.strftime("%I:%M %p")
    return user_time
# ========================================================================================== 
@frappe.whitelist()   
def get_time_now(user_email, formatted = None):
    return convert_utc_to_user_timezone(datetime.datetime.utcnow() , get_user_timezone(user_email)["results"][0]["time_zone"] , formatted)
# =====================================================================================
@frappe.whitelist()
def get_file_as_base64(file_name):
    """
    Convert a File (public or private) into Base64.
    Detects correct file path automatically.
    """
    try:
        file_doc = frappe.get_doc("File", file_name)

        if not file_doc.file_url:
            frappe.throw("File URL is missing in File document.")

        file_url = file_doc.file_url.strip("/")

        # Determine if public or private
        if file_url.startswith("files/"):
            # PUBLIC file
            file_path = os.path.join(frappe.get_site_path(), "public", file_url)
        elif file_url.startswith("private/files/"):
            # PRIVATE file
            file_path = os.path.join(frappe.get_site_path(), file_url)
        else:
            # Unknown or external path
            frappe.throw(f"Unknown file path format: {file_doc.file_url}")

        # Ensure absolute path
        file_path = os.path.abspath(file_path)

        # Check existence
        if not os.path.exists(file_path):
            frappe.throw(f"File not found at: {file_path}")

        # Read file
        with open(file_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode("utf-8")

        return {"results": {"compressed_base64": encoded}}

    except Exception as e:
        frappe.log_error(f"get_file_as_base64 failed: {str(e)}")
        return None
# ==========================================================================================
def sync_with_chat_profile(doc , method):    
    
    if frappe.flags.skip_profile_sync:
        return
    user_id = doc.user
    full_name = (doc.first_name if doc.first_name else "") + \
                (" " + doc.middle_name if doc.middle_name else "") + \
                (" " + doc.last_name if doc.last_name else "")
    
    contact_details = {}
    email_details = {}
    contact_details_list = []
    
    for email in doc.email_ids:
        if email.email_id == user_id:
            contact_details = frappe.get_doc({
            "doctype" : "ClefinCode Chat Profile Contact Details" ,
            "contact_info" : email.email_id,
            "type" : "Chat",
            "verified" : 1,
            "default" : 1,
            }) 
            email_details = frappe.get_doc({
            "doctype" : "ClefinCode Chat Profile Contact Details" ,
            "contact_info" : email.email_id,
            "type" : "Email",
            "verified" : 1,
            "default" : 0,
            })           
        else:
            contact_details = frappe.get_doc({
            "doctype" : "ClefinCode Chat Profile Contact Details" ,
            "contact_info" : email.email_id,
            "type" : "Email",
            "verified" : 1
            })
        contact_details_list.append(contact_details)
        if email_details:
            contact_details_list.append(email_details)
    
    for number in doc.phone_nos:
        contact_details = frappe.get_doc({
        "doctype" : "ClefinCode Chat Profile Contact Details" ,
        "contact_info" : number.phone,
        "type" : "WhatsApp",
        "verified" : 1,
        })       
        contact_details_list.append(contact_details)
        
    for social_id in doc.social_contact:
        contact_details = frappe.get_doc({
        "doctype" : "ClefinCode Chat Profile Contact Details" ,
        "contact_info" : social_id.social_id,
        "type" : social_id.platform,
        "verified" : 1,
        # "default": 1
        })       
        contact_details_list.append(contact_details)
            

    chat_profile_doc = frappe.db.get("ClefinCode Chat Profile", doc.name)
    if method == "after_insert" or  not chat_profile_doc:
        frappe.get_doc({
            "doctype" : "ClefinCode Chat Profile" ,
            "contact" : doc.name,
            "full_name" : full_name ,
            "contact_details" : contact_details_list
        }).insert(ignore_permissions=True)
    else:
        chat_profile = frappe.get_doc("ClefinCode Chat Profile" , doc.name)
        chat_profile.update({
        "full_name" : full_name,
        "contact_details" : contact_details_list
        })
    
        chat_profile.save(ignore_permissions=True)       
# ==========================================================================================
@frappe.whitelist()
def get_names_for_mentions(search_term, room = None):
    if ":" in search_term and get_user_type() == "system_user" and not is_limited_user(frappe.session.user):
        doctype_name_or_abbr = search_term.split(":")[0]
        shortcuts = frappe.db.get_all("ClefinCode DocType Shortcut" , filters = {"parent" : "ClefinCode Chat Settings"}, fields =["shortcut" , "doctype_name"], order_by = "`idx` DESC")
        
        shorcut_exist = None
        if shortcuts:
            for item in shortcuts:
                if item.shortcut.lower() == doctype_name_or_abbr.lower():
                    doctype_name = item.doctype_name
                    shorcut_exist = True
                    break
            if not shorcut_exist:
                doctype_name = doctype_name_or_abbr
        else:
            doctype_name = doctype_name_or_abbr     
        
        doctype_list = frappe.get_all("DocType" , "name")
        if any(doctype['name'] == doctype_name.title() for doctype in doctype_list):
            doc_name = search_term.split(":")[1].lower().strip()
            reocrds_list = []
            meta = frappe.get_meta(doctype_name.title())
            field_title = meta.title_field if meta and meta.title_field else None          
            records = frappe.get_all(doctype_name.title() , fields = ["name" , field_title] , as_list = True) 
            
            for r in records:
                compare_with = f"{r[0]}:{r[1]}" if field_title else f"{r[0]}"                   
                if doc_name and doc_name not in compare_with.lower():
                    continue
                reocrds_list.append({
                    "id": r[0] , 
                    "name" : r[0] , 
                    "value" : f"<b><span class='doc-id'>{r[0]}</span></b><br><span class='doc-title'>{r[1]}</span>" if field_title else f"{r[0]}" , 
                    "is_doctype" : 1 , 
                    "doctype": doctype_name.title(),
                    "link": frappe.utils.get_url_to_form(doctype_name.title(), r[0])
                    })                                                   
           
            return reocrds_list
    else:
        users_for_mentions = get_users_for_mentions(room)

        filtered_mentions = []
        for mention_data in users_for_mentions:
            if search_term.lower() not in mention_data.value.lower():
                continue

            filtered_mentions.append(mention_data)
        return sorted(filtered_mentions, key=lambda d: d["value"])
# ==========================================================================================
def get_users_for_mentions(room = None):
    excepted_users_list = []
    excepted_users_list.append("Administrator")
    excepted_users_list.append("Guest")
    excepted_users_list.append(frappe.session.user)
    
    chat_members_and_contributors = []

    if room and get_user_type() == "website_user":
        chat_members = get_chat_members(room)["results"][0]["chat_members"]
        contributors = get_contributors(room)["results"][0]["contributors"]
        
        for member in chat_members:
            chat_members_and_contributors.append(member["email"])
        
        for contributor in contributors:
            chat_members_and_contributors.append(contributor["email"])
        
        return frappe.get_all(
        "User",
        fields=["name as id", "full_name as value" , "full_name as name"],
        filters={
            "name": ["in", chat_members_and_contributors],
            "allowed_in_mentions": True,
            # "user_type": "System User",
            "enabled": True,
        },
        )

    if get_user_type() == "system_user" and is_limited_user(frappe.session.user):
        filtered_system_users = []
     
        system_users = frappe.get_all(
            "User",
            fields=["name as id", "full_name as value" , "full_name as name"],
            filters={
                "name": ["not in", excepted_users_list],
                "allowed_in_mentions": True,
                "user_type": "System User",
                "enabled": True,
            },
            )  
        for user in system_users:
            if user.id != frappe.session.user:
                if not is_limited_user(user.id):
                    filtered_system_users.append(user)

        return filtered_system_users
    
    return frappe.get_all(
        "User",
        fields=["name as id", "full_name as value" , "full_name as name"],
        filters={
            "name": ["not in", excepted_users_list],
            "allowed_in_mentions": True,
            # "user_type": "System User",
            "enabled": True,
        },
    )
# ==========================================================================================
@frappe.whitelist()
def set_typing(user, room, is_typing, last_active_sub_channel = None, mobile_app = None,text=None):
    parent_channel_doc = frappe.get_doc("ClefinCode Chat Channel" , room)
    first_name = get_contact_first_name(user)
    template_option=False
    if is_typing and text and text.startswith("/"):
      
      template_option=True
    results = {
        "channel" : room,
        "realtime_type": "typing",
        'user': user,
        'is_typing': is_typing,
        'first_name': first_name,
        'mobile_app': mobile_app
    }
    
    for member in parent_channel_doc.members:
        if member.is_removed == 0 and member.platform == "Chat":
            results["room"] = room
            frappe.publish_realtime(event=room, message=results ,user= member.user)
            send_notification(member.user , results, "typing")
            frappe.publish_realtime(event= "typing-portal", message=results, user= member.user)
            # frappe.publish_realtime(event= "receive_message", message=results, user= member.user)

        if member.is_removed == 0 and member.platform == "WhatsApp" and template_option:
            profile_whatsapp = frappe.get_all(
                    "ClefinCode WhatsApp Profile",
                    filters={"user": user},
                    fields=["name"]
            )
            templates_clefin = []
            templates_twilio = []
            if profile_whatsapp:
                whatsapp_profile_name = profile_whatsapp[0].name  

                templates_clefin = frappe.get_all(
                            "ClefinCode WhatsApp Template",
                            filters={
                                "docstatus": 1,
                                "whatsapp_profile": ["=", whatsapp_profile_name],  
                                "template_status":"APPROVED"
                            },
                            fields=["name", "meta_template_name"]
                        )
                for t in templates_clefin:
                        t["doctype"] = "ClefinCode WhatsApp Template"
            else:
                templates_clefin = []
            
            templates_twilio = frappe.get_all(
                "CiC Twilio Template",
                filters={
                    "whatsapp_template_id": ["is", "set"],
                    "template_status": "APPROVED",
                    
                },
                fields=["name", "friendly_name as meta_template_name"]
            )
           
            for t in templates_twilio:
                  t["doctype"] = "CiC Twilio Template"
            templates=templates_clefin + templates_twilio
            results["profile_whatsapp"] = profile_whatsapp
            results["realtime_type"]= "show_template"
            results["template"]= templates
            frappe.publish_realtime(event=room, message=results ,user= user)  
        if member.is_removed == 0 and member.platform == "Chat" and template_option:
            templates = frappe.get_all(
                    "Clefincode Chat Template",
                     fields=["name", "friendly_name as meta_template_name"]
            )
            for t in templates:
                  t["doctype"] = "Clefincode Chat Template"
            results["realtime_type"]= "show_template"
            results["template"]= templates
            frappe.publish_realtime(event=room, message=results ,user= user)  
            pass
              
    if parent_channel_doc.contributors:
        for contributor in parent_channel_doc.contributors:
            if contributor.active == 1 and contributor.platform == "Chat":
                results["room"] = last_active_sub_channel
                results["parent_channel"] = room
                frappe.publish_realtime(event= last_active_sub_channel, message=results , user= contributor.user)
                send_notification(contributor.user , results, "typing")
                frappe.publish_realtime(event= "typing-portal", message=results, user= contributor.user)
                # frappe.publish_realtime(event="receive_message", message=results, user= contributor.user)
# ==================================================================================================
def send_notification(to_user , results, realtime_type, title = None, message_template_type = None):
    try: 
        if check_notifications_status():       
            if to_user:
                registration_token = get_registration_token(to_user)   
                if registration_token:
                    user_platform = get_platform(to_user)
                    body = None
                    message_type = None
                    if realtime_type != 'typing':
                        if results.get("file_type"):
                            message_type = results.get("file_type")
                        if to_user == frappe.session.user:
                            push_notifications(registration_token, results, realtime_type, user_platform, None, None, 1)
                            return                
                        if realtime_type == "send_message": 
                            body = get_body_message(results)
                        else:
                            body = get_body_message_information(realtime_type)
                        push_notifications(registration_token, results, realtime_type, user_platform, title, body, message_type = message_type)                       
                    else:
                        push_notifications(registration_token, results, realtime_type, user_platform, message_type = message_type)    
                                                    
    except Exception as e:
        frappe.publish_realtime("console" , message = e)
#=====================================================================================
def get_body_message(results):
    if results.get("is_voice_clip"):
        body = u'\U0001F3A4 Voice message'
    elif results.get("file_type"):
        if results["file_type"]== "image":
            body = u'\U0001F4F7 Photo'
        elif results["file_type"] == "video":
            body = u'\U0001F4F9 Video'
        elif results["file_type"] == "audio":
            body = u'\U0001F3A4 Audio'
        elif results["file_type"] == 'document':
            body = u'\U0001F4C4 Document'
    else:
        soup = BeautifulSoup(results["content"], 'html.parser')
        body = soup.get_text().lstrip()
    return body.capitalize()
# ==========================================================================================
def get_body_message_information(realtime_type):
    body=None
    if realtime_type == "set_topic_status":
        body = 'The topic status has been updated'
    elif realtime_type == "rename_topic":
        body = 'The topic name has been updated'
    elif realtime_type == "rename_group":
        body = 'The group name has been updated'
    elif realtime_type == "add_group_member":
        body = 'A new member has been added to the group'
    elif realtime_type == "remove_group_member":
        body = 'One member has been removed from the group'
    elif realtime_type == "set_topic":
        body = 'A new topic has been set'
    elif realtime_type == "remove_topic":
        body = 'The topic has been removeed'
    elif realtime_type == "add_doctype":
        body = 'A new doctype has been added'
    else:
        body = 'The contributors have been changed in the conversation'
    return body
# ==========================================================================================
@frappe.whitelist()
def are_members(room):
    members=frappe.get_all("ClefinCode Chat Channel User", 
    filters = {"parent": room,'is_removed':0},
     
    fields = ['user','is_admin','active'])
    if(len(members)>1):
        return True
    else:
        return False 

#=======================================================================================================
@frappe.whitelist()
def disable_contributors( parent_channel , last_active_sub_channel = None , user_to_remove_list = None):
    frappe.db.sql(f"""UPDATE `tabClefinCode Chat Channel` SET chat_status = 'Closed' WHERE `name` = '{get_last_sub_channel(parent_channel)}'""")
    parent_channel_doc = frappe.get_doc("ClefinCode Chat Channel" , parent_channel)

    user_to_remove_list_a =json.loads(user_to_remove_list)
    for user_to_remove in user_to_remove_list_a :

        for c in parent_channel_doc.contributors:
             
            if c.user == user_to_remove and c.active == 1:
                c.active = 0
                break
        parent_channel_doc.save(ignore_permissions=True)
        frappe.db.sql(f"""UPDATE  `tabClefinCode Chat Channel User` SET active = 0 WHERE parent = '{last_active_sub_channel}' AND user = '{user_to_remove}'""")
        frappe.db.commit()
        parent_channel_doc.save(ignore_permissions=True)
    
        results = {
            "parent_channel" : parent_channel,
            "sub_channel" : parent_channel,
            "realtime_type" : "create_sub_channel"
        }
        for member in parent_channel_doc.members:
            if member.platform == "Chat":
                frappe.publish_realtime(event= parent_channel, message=results, user= member.user)
        
        # frappe.publish_realtime(event= "receive_message", message={'parent_channel' : parent_channel, "sub_channel" : "" , "realtime_type" : "create_sub_channel", "target_user" : user_to_remove}, user= user_to_remove)
        frappe.publish_realtime(event= last_active_sub_channel, message={'parent_channel' : parent_channel, "sub_channel" : "" , "realtime_type" : "create_sub_channel"}, user= user_to_remove)
            

    return {"results" : [{"channel" : parent_channel}]}

#=======================================================================================================
def share_doctype(doctype, docname, user = None, everyone = 0):
    if user and not frappe.db.exists("User", user):
        return
    
    if int(frappe_version.split('.')[0]) > 13:
        from frappe.share import add_docshare as docshare
    else:
        from frappe.share import add as docshare

    docshare(doctype, docname, user, everyone = everyone, flags={"ignore_share_permission": True})
#=======================================================================================================
def get_room_name(room, room_type, sender_email = None):
    room_name = ""
    channel_doc = frappe.get_doc("ClefinCode Chat Channel", room)
    if not channel_doc.channel_name or channel_doc.channel_name == "":
        if room_type == "Direct":
            room_name = get_contact_full_name(sender_email)
        elif room_type == "Group":
            room_name = channel_doc.get_group_name()     
        elif room_type == "Guest":
            room_name = "Guest" 
        elif room_type == "Contributor":
            room_name = "@" + channel_doc.get_channel_name_for_contributor()
    else:
        room_name = channel_doc.channel_name    
    return room_name
#=======================================================================================================
def extract_images_from_html(doc: "Document", content: str, is_private: bool = False):
    from frappe.utils.file_manager import safe_b64decode
    from frappe.utils.image import optimize_image
    from frappe import safe_decode    
    import re
    
    frappe.flags.has_dataurl = False

    def _save_file(match):
        data = match.group(1).split("data:")[1]
        headers, content = data.split(",")
        mtype = headers.split(";")[0]

        if isinstance(content, str):
            content = content.encode("utf-8")
        if b"," in content:
            content = content.split(b",")[1]
        content = safe_b64decode(content)

        content = optimize_image(content, mtype)

        if "filename=" in headers:
            filename = headers.split("filename=")[-1]
            filename = safe_decode(filename).split(";")[0]

        else:
            filename = get_random_filename(content_type=mtype)

        if doc.meta.istable:
            doctype = doc.parenttype
            name = doc.parent
        else:
            doctype = doc.doctype
            name = doc.name

        _file = frappe.get_doc(
            {
                "doctype": "File",
                "file_name": filename,
                "attached_to_doctype": doctype,
                "attached_to_name": name,
                "content": content,
                "decode": False,
                "is_private": is_private,
            }
        )
        _file.save(ignore_permissions=True)
        file_url = _file.file_url
        frappe.flags.has_dataurl = True

        return f'<a href="{file_url}" target="_blank"><img src="{file_url}" class="img-responsive chat-image"></a'

    if content and isinstance(content, str):
        content = re.sub(r'<img[^>]*src\s*=\s*["\'](?=data:)(.*?)["\']', _save_file, content)

    return content
#=======================================================================================================
def get_random_filename(content_type: str = None) -> str:
    from frappe.utils import random_string
    extn = None
    if content_type:
        extn = mimetypes.guess_extension(content_type)

    return random_string(7) + (extn or "")
#=======================================================================================================
def get_notifications_settings():
    send_notification_with_content = 0
    enable_mobile_notifications = frappe.db.get_single_value("ClefinCode Chat Settings" , "enable_mobile_notifications")
    if enable_mobile_notifications == 1:
        send_notification_with_content = frappe.db.get_single_value("ClefinCode Chat Settings" , "with_message_content")
    
    return [{"enable_mobile_notifications" : enable_mobile_notifications , "send_notification_with_content" : send_notification_with_content}]
#=======================================================================================================
def check_notifications_status():
    results = get_notifications_settings()[0]
    if results["enable_mobile_notifications"] == 0:
        return 0
    else: return True
#=======================================================================================================
def push_notifications(registration_token, information, realtime_type, platform = None ,title = None, body = None, same_user = None, message_type = None):
    try:
        results = get_notifications_settings()[0]
        if not check_notifications_status():
            return    
        else:            
            info = convert_to_string_values(information)
            if results["send_notification_with_content"] == 0:
                if realtime_type == "typing":
                    return
                info = ""
                title = "Chat Notifications"
                body = "New Message"         

            send_notification_via_firebase(registration_token, info, realtime_type, platform, title, body, same_user, message_type = message_type)            

    except Exception as e:
        frappe.publish_realtime("console" , message = str(e))
# ============================================================================
def convert_to_string_values(data):
    return {key: str(value) for key, value in data.items()}
# ============================================================================
def is_mention(content):
    soup = BeautifulSoup(content, 'html.parser')    
    if soup.find(class_='mention'):
        return True
    
    return False

#############################################################################################
######################################## Instagram Functions #################################
#############################################################################################
@frappe.whitelist()
def send_instagram_message(new_message_doc, sender, receiver, message, message_type="text", is_voice_clip=False, channel_doc=None, email=None):
    try:
        access_token = get_access_token_instagram()
        api_base = "https://graph.instagram.com/v21.0"
        instagram_profile_id = frappe.db.get_value("ClefinCode Instagram Profile", sender, "instagram_profile_id")
        endpoint = f"{api_base}/{instagram_profile_id}/messages"

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        base_url = frappe.utils.get_url()
        media_url = None
        was_private = False

        # Handle media messages
        if message_type in ["image", "video", "audio"]:
            if message_type == "audio":
                local_file_path = frappe.utils.get_site_path(message.lstrip('/'))
                media_url = standardize_audio_to_m4a(local_file_path)
            else:
                media_url , was_private = make_file_public(message)         

            # Validate media URL
            if not media_url:
                frappe.throw(f"Failed to prepare media file for {message_type}.")
                
                
            payload_url = f"{base_url}{urllib.parse.quote(media_url)}"
                
            # Payload for media
            payload = {
                "recipient": {"id": receiver},
                "message": {
                    "attachment": {
                        "type": message_type,
                        "payload": {"url": payload_url}
                    }
                }
            }

        # Handle text messages
        elif message_type == "text":
            payload = {
                "recipient": {"id": receiver},
                "message": {"text": message}
            }

        # Handle stickers
        elif message_type == "sticker":
            payload = {
                "recipient": {"id": receiver},
                "message": {
                    "attachment": {"type": "like_heart"}
                }
            }

        # Unsupported message types
        else:
            content = f'<div class="handle-error-whatsapp" data-template="handle_error_whatsapp"><p style="color:#0089FF">Instagram does not support message type: {message_type}</p></div>'
            send(content = content, user = sender, room = channel_doc.name, email = email, message_type = "information", message_template_type = "Send Confirmation")

        # Send the request
        response = requests.post(endpoint, json=payload, headers=headers)

        if response.ok:
            new_message_doc.instagram_message_id = response.json().get("id")
            new_message_doc.save(ignore_permissions=True)
            frappe.db.commit()

            if was_private:
                reset_file_to_private(media_url)
        else:
            content = '<div class="handle-error-whatsapp" data-template="handle_error_whatsapp"><p style="color:#0089FF">You can no longer send a message to this receiver because 24 hours have passed since their last message. Please wait for the receiver to send you a new message to reopen the conversation window.</p></div>'
            send(content = content, user = sender, room = channel_doc.name, email = email, message_type = "information", message_template_type = "Send Confirmation")                
            frappe.log_error("Failed to send Instagram message", response.text)

    except Exception as e:
        frappe.log_error("Instagram Message Exception", str(e))
# ==========================================================================================
def standardize_audio_to_m4a(file_path):
    """
    Converts an audio file to M4A format with AAC codec for Instagram compatibility.
    """
    try:
        base, _ = os.path.splitext(file_path)
        standardized_file_path = f"{base}_standardized.m4a"

        # Use FFmpeg to re-encode the file into M4A format
        command = [
            "ffmpeg", "-i", file_path,
            "-c:a", "aac",  # Force AAC codec
            "-b:a", "128k",  # Set bitrate to 128kbps
            "-ar", "44100",  # Set sample rate to 44.1 kHz
            "-map_metadata", "-1",  # Remove metadata
            "-y",  # Overwrite if file exists
            standardized_file_path
        ]
        subprocess.run(command, check=True)

        # Register the new standardized file in Frappe
        relative_file_path = standardized_file_path.replace(frappe.utils.get_site_path(), "")

        file_doc = frappe.get_doc({
            "doctype": "File",
            "file_name": os.path.basename(standardized_file_path),
            "file_url": relative_file_path,
            "is_private": 0,  
            "content": open(standardized_file_path, "rb").read()
        })
        file_doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return file_doc.file_url

    except subprocess.CalledProcessError as e:
        frappe.log_error(title="Audio Conversion Error", message=str(e))
    except Exception as e:
        frappe.log_error(title="File Registration Error", message=str(e))
# ==========================================================================================   
def make_file_public(file_path):
    """
    Makes a file public by updating its visibility and file URL.
    Handles duplicates by reusing or updating existing files with the same content hash.
    """
    try:
        # Retrieve the file document
        file_doc = frappe.get_doc("File", {"file_url": file_path})
        was_private = False

        # Check if the file is already public
        if not file_doc.is_private:
            return file_doc.file_url, was_private

        # Compute the public URL
        public_file_url = file_doc.file_url.replace("/private/files/", "/files/")
                
        # Check if a file with the same public URL exists
        existing_files = frappe.get_all(
            "File",
            filters={"file_url": public_file_url},
            fields=["name", "is_private", "file_url"],
        )

        if existing_files:
            for existing_file in existing_files:
                return existing_file.file_url, was_private

        file_doc.is_private = 0
        file_doc.save(ignore_permissions=True)
        public_file_url = file_doc.file_url 
        frappe.db.commit()
        was_private = True
        return public_file_url, was_private

    except frappe.DuplicateEntryError:
        # Handle concurrent processes creating duplicate entries
        existing_file_url = frappe.db.get_value("File", {"file_url": public_file_url}, "file_url")
        if existing_file_url:
            frappe.log_error(f"Duplicate file found, reusing: {existing_file_url}")
            return existing_file_url, was_private

    except Exception as e:
        frappe.log_error(f"Failed to make file public: {str(e)}")
        frappe.throw(f"Failed to prepare media file for sending: {str(e)}")
        
#=================================================================================
def get_temp_public_url(file_url):
  

    if not file_url:
        frappe.throw("file_url is required")

    
    file_name = os.path.basename(file_url)

    private_path = get_files_path(file_name, is_private=True)
    public_path = get_files_path(file_name, is_private=False)
    public_url = f"{get_url()}/files/{file_name.replace(' ', '%20')}"

    
    if "private/files" in file_url or os.path.exists(private_path):
        try:
           
            if not os.path.exists(public_path):
                shutil.copy(private_path, public_path)
                frappe.log_error(f"Temporary public copy created: {public_url}", "File Temp Copy")
        except Exception as e:
            frappe.log_error(str(e), "Error copying private file")
            frappe.throw("Unable to create temporary copy for private file")

    return public_url
# ==========================================================================================
def reset_file_to_private(file_path, time_delay=None):
    """
    Resets a file back to private if it is currently public.
    """
    try:
        if time_delay:
            import time
            time.sleep(int(time_delay))
       
        file_doc = frappe.get_doc("File", {"file_url": file_path})
        file_doc.is_private = 1
        file_doc.save(ignore_permissions=True)
        frappe.db.commit()

    except Exception as e:
        frappe.log_error(f"Failed to reset file to private: {str(e)}")
# ==========================================================================================
@frappe.whitelist()
def get_instagram_profile_type(instagram_system_id):
    return frappe.db.get_value("ClefinCode Instagram Profile" , instagram_system_id, "type")
# ==========================================================================================   
@frappe.whitelist()
def get_instagram_channel(instagram_system_id, instagram_user_id):
    instagram_system_id_type = get_instagram_profile_type(instagram_system_id)
    
    if instagram_system_id_type == "Support":
        condition = " AND type = 'Group' AND chat_status = 'Open' "
    else:
        condition = " AND type = 'Direct'"    

    results = frappe.db.sql(f"""
    SELECT ChatChannel.name
    FROM `tabClefinCode Chat Channel` AS ChatChannel 
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser ON ChatChannelUser.parent = ChatChannel.name
    WHERE ChatChannelUser.user = '{instagram_user_id}' 
    AND platform_gateway = '{instagram_system_id}'
    AND is_parent = 1
    AND is_removed = 0
    AND pending_messages = 0
    {condition}     
    """ , as_dict = True)
    if results:
        return results[0].name
# ====================================================================================
def process_instagram_message(platform_gateway, instagram_customer_id , email, channel_doc, last_responder_user, new_message, file_type, attachment, content, is_voice_clip, is_screenshot):
    responder_user_profile = get_profile_id(email)
    message = None
    is_group_message = (channel_doc.type == "Group" and 
                        last_responder_user and 
                        last_responder_user != responder_user_profile and 
                        new_message.message_type != "information")
    if new_message.message_type == "information":
        message_content = process_message_template(content)
        message = f"_{BeautifulSoup(message_content, 'html.parser').get_text()}_"
    elif file_type in ["image", "video", "audio", "document"]:
        if is_screenshot:
            message = frappe.db.get_value("File" , {"attached_to_name": new_message.name}, "file_url")
        else:
            message = attachment
    else:
        if is_group_message:
            message = f"*{get_chat_profile_first_name(responder_user_profile)}*:\n{BeautifulSoup(content, 'html.parser').get_text()}"
        else:
            message = BeautifulSoup(content, 'html.parser').get_text()
    send_instagram_message(new_message, platform_gateway, instagram_customer_id , message, file_type if file_type in ["image", "video", "audio", "document"] else "text", is_voice_clip, channel_doc, email)
# ==========================================================================================
@frappe.whitelist()
def get_contact_profile_full_name(sender_id):
    full_name = frappe.db.sql(f"""
    SELECT DISTINCT ERPNextChatProfile.full_name
    FROM `tabClefinCode Chat Profile` AS ERPNextChatProfile , `tabSocial Contact` AS ContactDetails
    WHERE ERPNextChatProfile.name = ContactDetails.name AND ERPNextChatProfile.is_support <> 1 AND ContactDetails.social_id = '{sender_id}'
    """ , as_dict = True)
    if full_name:
        return full_name[0].full_name        
    
    
#############################################################################################
######################################## Messenger Functions ################################
#############################################################################################
@frappe.whitelist()
def send_messenger_message(new_message_doc, sender, receiver, message, message_type="text", is_voice_clip=False, channel_doc=None, email=None):
    try:
        # if message_type == "document":
        #     frappe.throw(f"Failed to send message, message type {message_type} is not supported for Messenger platform.")

        access_token = get_access_token_messenger()
        api_base = "https://graph.facebook.com/v21.0"
        messenger_profile_id = frappe.db.get_value("ClefinCode Facebook Messenger Profile", sender, "messenger_profile_id")

        endpoint = f"{api_base}/{messenger_profile_id}/messages"

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        base_url = frappe.utils.get_url()
        media_url = None
        was_private = False
        
        if message_type == "document":
            message_type = "file"

        # Handle media messages
        if message_type in ["image", "video", "audio", "file"]:
            if message_type == "audio":
                local_file_path = frappe.utils.get_site_path(message.lstrip('/'))
                media_url = standardize_audio_to_m4a(local_file_path)
            else:
                media_url , was_private = make_file_public(message)      
            
            # Validate media URL
            if not media_url:
                frappe.throw(f"Failed to prepare media file for {message_type}.")
                
                
            payload_url = f"{base_url}{urllib.parse.quote(media_url)}"
            
            # Payload for media
            payload = {
                "recipient": {"id": receiver},
                "message": {
                    "attachment": {
                        "type": message_type,
                        "payload": {"url": payload_url}
                    }
                }
            }

        # Handle text messages
        elif message_type == "text":
            payload = {
                "recipient": {"id": receiver},
                "message": {"text": message}
            }

        # Handle stickers
        elif message_type == "sticker":
            payload = {
                "recipient": {"id": receiver},
                "message": {
                    "attachment": {"type": "like_heart"}
                }
            }

        # Unsupported message types
        else:
            content = f'<div class="handle-error-whatsapp" data-template="handle_error_whatsapp"><p style="color:#0089FF">Messenger does not support message type: {message_type}</p></div>'
            send(content = content, user = sender, room = channel_doc.name, email = email, message_type = "information", message_template_type = "Send Confirmation")
            
            
        # Send the request
        response = requests.post(endpoint, json=payload, headers=headers)

        if response.ok:
            new_message_doc.messenger_message_id = response.json().get("id")
            new_message_doc.save(ignore_permissions=True)
            frappe.db.commit()

            # Reset file to private if applicable
            if was_private:
                reset_file_to_private(media_url)
        else:
            content = '<div class="handle-error-whatsapp" data-template="handle_error_whatsapp"><p style="color:#0089FF">You can no longer send a message to this receiver because 24 hours have passed since their last message. Please wait for the receiver to send you a new message to reopen the conversation window.</p></div>'
            send(content = content, user = sender, room = channel_doc.name, email = email, message_type = "information", message_template_type = "Send Confirmation")
            frappe.log_error("Failed to send Messenger message", response.text)

    except Exception as e:
        frappe.log_error("Messenger Message Exception", str(e))
# ==========================================================================================
@frappe.whitelist()
def get_messenger_profile_type(messenger_system_id):
    return frappe.db.get_value("ClefinCode Facebook Messenger Profile" , messenger_system_id, "type")
# ==========================================================================================   
@frappe.whitelist()
def get_messenger_channel(messenger_system_id, messenger_user_id):
    messenger_system_id_type = get_messenger_profile_type(messenger_system_id)
    
    if messenger_system_id_type == "Support":
        condition = " AND type = 'Group' AND chat_status = 'Open' "
    else:
        condition = " AND type = 'Direct'"    

    results = frappe.db.sql(f"""
    SELECT ChatChannel.name
    FROM `tabClefinCode Chat Channel` AS ChatChannel 
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser ON ChatChannelUser.parent = ChatChannel.name
    WHERE ChatChannelUser.user = '{messenger_user_id}' 
    AND platform_gateway = '{messenger_system_id}'
    AND is_parent = 1
    AND is_removed = 0
    AND pending_messages = 0
    {condition}     
    """ , as_dict = True)
    
    if results:
        return results[0].name
# ====================================================================================
def process_messenger_message(platform_gateway, messenger_customer_id , email, channel_doc, last_responder_user, new_message, file_type, attachment, content, is_voice_clip, is_screenshot):    
    responder_user_profile = get_profile_id(email)
    message = None
    is_group_message = (channel_doc.type == "Group" and 
                        last_responder_user and 
                        last_responder_user != responder_user_profile and 
                        new_message.message_type != "information")
    if new_message.message_type == "information":
        message_content = process_message_template(content)
        message = f"_{BeautifulSoup(message_content, 'html.parser').get_text()}_"
    elif file_type in ["image", "video", "audio", "document"]:
        if is_screenshot:
            message = frappe.db.get_value("File" , {"attached_to_name": new_message.name}, "file_url")
        else:
            message = attachment
    else:
        if is_group_message:
            message = f"*{get_chat_profile_first_name(responder_user_profile)}*:\n{BeautifulSoup(content, 'html.parser').get_text()}"
        else:
            message = BeautifulSoup(content, 'html.parser').get_text()
    send_messenger_message(new_message, platform_gateway, messenger_customer_id , message, file_type if file_type in ["image", "video", "audio", "document"] else "text", is_voice_clip, channel_doc, email)
# ==========================================================================================
def auto_fill_contact_platform(doc, method):   
    if frappe.flags.skip_profile_sync:
        return
         
    if doc.social_contact and doc.social_contact[0].platform:
        doc.platform = doc.social_contact[0].platform

        
    elif doc.phone_nos and len(doc.phone_nos) > 0:
        doc.platform = "WhatsApp"
        frappe.logger().info("Platform set to WhatsApp")
        
    else:
        doc.platform = "Chat"
        frappe.logger().info("Platform set to Chat")
        
    # doc.save()
#############################################################################################
######################################## Telegram Functions #################################
#############################################################################################

@frappe.whitelist()
def get_telegram_profile_type(telegram_system_id):
    return frappe.db.get_value("ClefinCode Telegram Profile" , telegram_system_id, "type")

def get_telegram_channel(telegram_system_id, telegram_user_id):
    telegram_system_id_type = get_telegram_profile_type(telegram_system_id)
    
    if telegram_system_id_type == "Support":
        condition = " AND type = 'Group' AND chat_status = 'Open' "
    else:
        condition = " AND type = 'Direct'"    

    results = frappe.db.sql(f"""
    SELECT ChatChannel.name
    FROM `tabClefinCode Chat Channel` AS ChatChannel 
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser ON ChatChannelUser.parent = ChatChannel.name
    WHERE ChatChannelUser.user = '{telegram_user_id}' 
    AND platform_gateway = '{telegram_system_id}'
    AND is_parent = 1
    AND is_removed = 0
    AND pending_messages = 0
    {condition}     
    """ , as_dict = True)
    if results:
        return results[0].name               


@frappe.whitelist()
def send_telegram_message(chat_id, message, message_type="text", attachment_url=None):
    """
    Send a response from the bot to a user via Telegram.
    """
    try:
        # Get the bot access token
        access_token = get_decrypted_password(
            "ClefinCode Telegram Integration",
            "ClefinCode Telegram Integration",
            "access_token"
        )
        
        if not access_token:
            frappe.throw("Telegram bot access token is missing.")

        # Telegram API endpoint
        api_base = f"https://api.telegram.org/bot{access_token}"
        was_private = False
        public_attachment_url = None
        
        # Handle file visibility for media messages
        if attachment_url:
            if message_type == "audio":
                local_file_path = frappe.utils.get_site_path(message.lstrip('/'))
                public_attachment_url = standardize_audio_to_mp3(local_file_path)
            else:    
                public_attachment_url, was_private = make_file_public(message)
            

            payload_url = frappe.utils.get_url() + public_attachment_url

        # Prepare the payload
        if message_type == "text":
            payload = {
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "Markdown"
            }
            endpoint = f"{api_base}/sendMessage"


        elif message_type in ["image", "photo"]:
            payload = {
                "chat_id": chat_id,
                "photo": payload_url,
            }
            endpoint = f"{api_base}/sendPhoto"

        elif message_type == "video":
            payload = {
                "chat_id": chat_id,
                "video": payload_url,
            }
            endpoint = f"{api_base}/sendVideo"

        elif message_type == "audio":
            payload = {
                "chat_id": chat_id,
                "audio": payload_url,
            }
            endpoint = f"{api_base}/sendAudio"
            
        elif message_type == "document":
            payload = {
                "chat_id": chat_id,
                "document": payload_url,
            }
            endpoint = f"{api_base}/sendDocument"    
            

        else:
            frappe.throw(f"Unsupported message type: {message_type}")


        response = requests.post(endpoint, json=payload)
        frappe.log_error("api_base",[vars(response)])
        if was_private:
            reset_file_to_private(public_attachment_url)

    except Exception as e:
        frappe.log_error(title="Telegram Response Sending Error", message=str(e))


def process_telegram_message(platform_gateway, telegram_customer_id, email, channel_doc, last_responder_user, new_message, file_type, attachment, content, is_voice_clip, is_screenshot):    
    try:
        responder_user_profile = get_profile_id(email)
        message = None
        is_group_message = (channel_doc.type == "Group" and 
                            last_responder_user and 
                            last_responder_user != responder_user_profile and 
                            new_message.message_type != "information")
        
        if new_message.message_type == "information":
            message_content = process_message_template(content)
            message = f"_{BeautifulSoup(message_content, 'html.parser').get_text()}_"
                
        elif file_type in ["image", "video", "audio", "document"]:
            if is_screenshot:
                message = frappe.db.get_value("File", {"attached_to_name": new_message.name}, "file_url")
            else:
                message = attachment

        else:
            if is_group_message:
                message = f"*{get_chat_profile_first_name(responder_user_profile)}*:\n{BeautifulSoup(content, 'html.parser').get_text()}"
            else:
                message = BeautifulSoup(content, 'html.parser').get_text()

        # Send the message to Telegram
        
        send_telegram_message(
            chat_id=telegram_customer_id,
            message=message,
            message_type=file_type if file_type in ["image", "video", "audio", "document"] else "text",
            attachment_url=attachment if file_type in ["image", "video", "audio", "document"] else None
        )

    except Exception as e:
        frappe.log_error("Telegram Processing Exception", str(e))
# ==========================================================================================   
def standardize_audio_to_mp3(file_path):
    """
    Converts an audio file to MP3 format with AAC codec for Instagram compatibility.
    """
    try:
        base, _ = os.path.splitext(file_path)
        standardized_file_path = f"{base}_standardized.mp3"

        # Use FFmpeg to re-encode the file into M4A format
        command = [
            "ffmpeg", "-i", file_path,
            "-c:a", "libmp3lame",  
            "-b:a", "128k",  
            "-ar", "44100", 
            "-map_metadata", "-1",
            "-y", 
            standardized_file_path
        ]
        subprocess.run(command, check=True)

        # Register the new standardized file in Frappe
        relative_file_path = standardized_file_path.replace(frappe.utils.get_site_path(), "")

        file_doc = frappe.get_doc({
            "doctype": "File",
            "file_name": os.path.basename(standardized_file_path),
            "file_url": relative_file_path,
            "is_private": 0,
            "content": open(standardized_file_path, "rb").read()
        })
        file_doc.insert(ignore_permissions=True)
        frappe.db.commit()

        return file_doc.file_url

    except subprocess.CalledProcessError as e:
        frappe.log_error(title="Audio Conversion Error", message=str(e))
    except Exception as e:
        frappe.log_error(title="File Registration Error", message=str(e))

# =============================================================================

@frappe.whitelist()
def check_if_chat_topic_exist(channel_id):
    
    chat_topic_name = frappe.db.get_value(
        "ClefinCode Chat Topic", 
        {"chat_channel": channel_id, "topic_status": "Open"}, 
        "name"
    )
    
    # Return the result
    return {"results": [{"chat_topic": chat_topic_name if chat_topic_name else ""}]}
# =========================================================================================
@frappe.whitelist()
def after_insert_notification(doc,method):
    try:
        enable_system_notification_on_mobile_app = frappe.db.get_single_value("ClefinCode Chat Settings" , "enable_system_notification_on_mobile_app")
        if enable_system_notification_on_mobile_app:
            registration_token = get_registration_token(doc.for_user)
            user_platform = get_platform(doc.for_user)
            body=BeautifulSoup(doc.subject, 'html.parser').get_text()
            send_notification_log_via_firebase(registration_token,user_platform , body = body,title = 'Notification from system')
    except Exception as e:
        frappe.log_error(title="File Registration Error", message=str(e))
#=========================================================================================
@frappe.whitelist()
def get_notification_log(user, start=0, limit=10):
    """Get notifications for a user with pagination"""
    import frappe.utils


    try:
        if frappe.db.exists('User', user): 
            notifications = frappe.db.sql(f"""
                SELECT
                    *
                FROM `tabNotification Log`
                WHERE for_user = '{user}'
                ORDER BY `read` ASC,creation DESC
                LIMIT {limit} OFFSET {start}
            """, as_dict=True)

            # Add computed fields in Python
            for n in notifications:
                n["unread"] = True if n.get("read") in [0, None, "0"] else False
                n["timeAgo"] = frappe.utils.pretty_date(n.get("creation"))

                # initials from user
                if n.get("from_user"):
                    n["initials"] = n["from_user"][:2].upper()
                else:
                    n["initials"] = "NA"

                
                link_doctype = n.get("document_type") or "Notification Log"
                link_docname = n.get("document_name") or n.get("name")
                n["notification_link"] = frappe.utils.get_url_to_form(link_doctype, link_docname)

            return [{
                "status": 1,
                "description": "Done Successfully",
                "data": notifications
            }]
        else:
            return [{
                "status": 2,
                "description": "User not found",
                "data": None
            }]
    except Exception as e:
        frappe.log_error(message=str(e), title="get_notification_log error")
        return [{
            "status": 0,
            "description": "Not Available",
            "data": str(e)
        }]
# ==========================================================================================

def upload_media_to_server(file_path):
    """
    Uploads a local file to the server's public directory and returns the public URL.
    """
    file_name = os.path.basename(file_path)
    public_folder = frappe.get_site_path("public", "files")
    os.makedirs(public_folder, exist_ok=True)
    
    dest_path = os.path.join(public_folder, file_name)
    with open(file_path, "rb") as fsrc, open(dest_path, "wb") as fdst:
        fdst.write(fsrc.read())
    
    site_url = frappe.utils.get_url()
    return f"{site_url}/files/{file_name}"

# def send_whatsapp_message_twilio(new_message_doc, sender, receiver, message, message_type="text", is_voice_clip=False):
#     try:
#         # Retrieve Twilio credentials from Frappe database
#         doc = frappe.get_doc("ClefinCode Twilio Integration")
#         account_sid =doc.get("account_sid")
#         auth_token = get_auth_token_twillio()
#         twilio_whatsapp_number = frappe.db.get_value("ClefinCode WhatsApp Profile", sender, "whatsapp_number")

#         client = Client(account_sid, auth_token)

#         if message_type in ['image', 'video', 'audio', 'document']:
#             media_url = message
#             media_url, was_private = make_file_public(media_url)
#             public_url=media_url
#             site_url = frappe.utils.get_url()  
            
#             if is_voice_clip:
             
                
#                 #media_url =frappe.utils.get_site_path(media_url.lstrip('/'))
#                 site_name = frappe.local.site
#                 media_url = convert_to_ogg_twilio( os.path.join(".", site_name, "public", media_url.lstrip("/")))
               
#                 if media_url.startswith("./"):
#                     media_url = media_url[2:]

#                 if media_url.startswith(site_name):
#                     media_url = media_url[len(site_name+"/public"):]
                
#                  # --- Create Frappe File doc ---
#                 file_doc = frappe.get_doc({
#                 "doctype": "File",
#                 "file_url": media_url,
#                 "file_name": os.path.basename(media_url),
#                 "attached_to_doctype": new_message_doc.doctype,
#                 "attached_to_name": new_message_doc.name,
#                 "is_private": 0  # Public
#             })
#                 file_doc.insert(ignore_permissions=True)
#                 frappe.db.commit()

            
#             media_url=site_url+media_url
#             media_url = urllib.parse.quote(media_url, safe=':/')
           
#             msg = client.messages.create(
#                 from_=f'whatsapp:{twilio_whatsapp_number}',
#                 body=message if message_type != 'image' else None,
#                 media_url=[media_url],   # must be a list of URLs
#                 to=f'whatsapp:{receiver}'
#             )
           
#             from datetime import datetime, timedelta
#             # Reset file to private if applicable
#             if was_private:
#                 run_at = frappe.utils.add_to_date(frappe.utils.now_datetime(), seconds=60)

#                 # frappe.enqueue(
#                 #         "frappe.utils.background_jobs.enqueue_one",
#                 #         job_name=f"reset_file_{frappe.generate_hash()}",  
#                 #         method="clefincode_chat.api.api_1_3_1.api.reset_file_to_private",
#                 #         kwargs={"file_path": public_url},
#                 #         wait=60
#                 #     )
#                 frappe.enqueue(
#                        "clefincode_chat.api.api_1_3_1.api.reset_file_to_private",
#                         file_path=public_url,
#                         time_delay=60,
#                         queue='default',
#                         timeout=600,
                    
#                     )
#                 # reset_file_to_private(public_url)
#         else:  # text
            
#             msg = client.messages.create(
#                 from_=f'whatsapp:{twilio_whatsapp_number}',
#                 body=message,
#                 to=f'whatsapp:{receiver}'
#             )

#         new_message_doc.whatsapp_message_id = msg.sid
#         new_message_doc.save(ignore_permissions=True)
#         frappe.db.commit()

#     except Exception as e:
#         frappe.log_error(title="send whatsapp message Exception", message=str(e))


def send_whatsapp_message_twilio(new_message_doc, sender, receiver, message, message_type="text", is_voice_clip=False):
    try:
        # ------------------------------------------
        # Retrieve Twilio credentials from Frappe
        # ------------------------------------------
        doc = frappe.get_doc("ClefinCode Twilio Integration")
        account_sid = doc.get("account_sid")
        auth_token = get_auth_token_twillio()
        twilio_whatsapp_number = frappe.db.get_value(
            "ClefinCode WhatsApp Profile", sender, "whatsapp_number"
        )

        client = Client(account_sid, auth_token)

        # ------------------------------------------
        # MEDIA MESSAGE LOGIC (image / video / audio / document)
        # ------------------------------------------
        if message_type in ['image', 'video', 'audio', 'document']:

            original_url = message
            
            site_url = frappe.utils.get_url()

            # ------------------------------------------
            # 1️ Fetch the original file
            # ------------------------------------------
            file_info = frappe.db.get_value(
                "File", {"file_url": original_url},
                ["name", "is_private", "file_url"], as_dict=True
            )

            if not file_info:
                frappe.throw("File not found!")

            was_private = file_info.is_private

            # ------------------------------------------
            # 2️ If the file is private → create a new public copy
            # ------------------------------------------
            if was_private:
                # Load original file content
                file_path = frappe.get_site_path(file_info.file_url.lstrip("/"))
                with open(file_path, "rb") as f:
                    content = f.read()

                # Create a new public file
                new_public_file = frappe.get_doc({
                    "doctype": "File",
                    "file_name": os.path.basename(file_info.file_url),
                    "content": content,
                    "is_private": 0,  # Public
                    "attached_to_doctype": new_message_doc.doctype,
                    "attached_to_name": new_message_doc.name
                })

                new_public_file.insert(ignore_permissions=True)
                frappe.db.commit()

                public_url = new_public_file.file_url  # New public copy URL

            else:
                # File is already public
                public_url = file_info.file_url

            # ------------------------------------------
            # 3️ Special case: Voice clip → convert to OGG
            # ------------------------------------------
            if is_voice_clip:
                site_name = frappe.local.site

                converted_path = convert_to_ogg_twilio(
                    os.path.join(".", site_name, "public", public_url.lstrip("/"))
                )

                # Normalize returned path
                if converted_path.startswith("./"):
                    converted_path = converted_path[2:]

                if converted_path.startswith(site_name):
                    converted_path = converted_path[len(site_name + "/public"):]

                # Save converted file as a new public File doc
                new_public_file = frappe.get_doc({
                    "doctype": "File",
                    "file_url": converted_path,
                    "file_name": os.path.basename(converted_path),
                    "attached_to_doctype": new_message_doc.doctype,
                    "attached_to_name": new_message_doc.name,
                    "is_private": 0
                })
                new_public_file.insert(ignore_permissions=True)
                frappe.db.commit()

                public_url = new_public_file.file_url

            # ------------------------------------------
            # 4️ Prepare Twilio-compatible media URL
            # ------------------------------------------
            full_media_url = site_url + public_url
            full_media_url = urllib.parse.quote(full_media_url, safe=':/')

            # ------------------------------------------
            # 5️ Send media message through Twilio WhatsApp
            # ------------------------------------------
            msg = client.messages.create(
                from_=f'whatsapp:{twilio_whatsapp_number}',
                body=message if message_type != "image" else None,
                media_url=[full_media_url],
                to=f'whatsapp:{receiver}'
            )

            # ------------------------------------------
            # 6️ Schedule deletion of temporary public file

            # ------------------------------------------
            if was_private:
                frappe.enqueue(
                    "clefincode_chat.api.api_1_3_1.api.delete_temp_public_file",
                    file_url=public_url,
                    time_delay=60,
                    queue='default',
                    timeout=600,
                  
                )

        else:
            # ------------------------------------------
            # TEXT MESSAGE ONLY
            # ------------------------------------------
            msg = client.messages.create(
                from_=f'whatsapp:{twilio_whatsapp_number}',
                body=message,
                to=f'whatsapp:{receiver}'
            )

        # Save Twilio SID
        new_message_doc.whatsapp_message_id = msg.sid
        new_message_doc.save(ignore_permissions=True)
        frappe.db.commit()

    except Exception as e:
        frappe.log_error(title="send whatsapp message Exception", message=str(e))
@frappe.whitelist()


def delete_temp_public_file(file_url,time_delay=None):
    """
    Deletes the temporary public copy created for WhatsApp media sending.
    This keeps the original file untouched (if private).
    """
    try:
        if time_delay:
            import time
            time.sleep(int(time_delay))
        file_info = frappe.db.get_value(
            "File", {"file_url": file_url}, ["name"], as_dict=True
        )

        if file_info:
            frappe.delete_doc("File", file_info.name, ignore_permissions=True)
            frappe.db.commit()

    except Exception as e:
        frappe.log_error("Error deleting temp public file", str(e))

# ==========================================================================================
@frappe.whitelist()
def send_whatsapp_message_from_template(new_message, to_number, whatsapp_profile,results,attachment=None):
 
    template = None
    doctype = None
    file_id=None
    is_media=None
    is_document = None
    file_type = None
    media_url = None
    link=None
    from bs4 import BeautifulSoup

    content = new_message.content
    soup = BeautifulSoup(content, 'html.parser')

    text = soup.get_text()       # convert HTML → plain text
    messages = text.split(',')   # now you can split safely

    if len(messages) < 2:
        template_name = content.strip()
        docname = ""
    else:
        template_name = messages[0].strip()
        docname = messages[1].strip()
    


    if frappe.db.exists("ClefinCode WhatsApp Template", template_name):
        template = frappe.get_doc("ClefinCode WhatsApp Template", template_name)
        doctype = "ClefinCode WhatsApp Template"
    elif frappe.db.exists("CiC Twilio Template", template_name):
        template = frappe.get_doc("CiC Twilio Template", template_name)
        doctype = "CiC Twilio Template"
    else:
        frappe.throw(f"No template found with name '{template_name}' in known doctypes.")

    if not template.whatsapp_template_id:
        frappe.throw(" No 'WhatsApp Template ID' found in this template.")

    profile = frappe.get_doc("ClefinCode WhatsApp Profile", whatsapp_profile)
    from_number = profile.whatsapp_number

    integration_doc = frappe.get_doc("ClefinCode Twilio Integration")
    account_sid = integration_doc.get("account_sid")
    auth_token = get_auth_token_twillio()
    client = Client(account_sid, auth_token)

    variables = {}
    body_preview = ""

    if doctype == "ClefinCode WhatsApp Template":
        for idx, btn in enumerate(template.buttons, start=1):
            text = str(getattr(btn, "button_text", "")).strip()
            if text:
                variables[str(idx)] = text

        body_preview = template.body or ""
        for k, v in variables.items():
            body_preview = body_preview.replace(f"{{{{{k}}}}}", v)
        html =generate_whatsapp_html_preview(
                body=body_preview,
                template_name="",
                template_type="twilio/text",
               
            )

    elif doctype == "CiC Twilio Template":
        for var in template.variables:
                key = (var.variable_key or "").strip()
                source_doctype = (var.source or "").strip()
                source_field = (var.source_field or "").strip()
                value=var.default 

                if not key:
                    continue
                if (source_doctype and source_field):
                   
                    match = re.search(r"\(([^)]+)\)", source_doctype)
                    if match:
                        linked_doctype = match.group(1).strip()     # e.g. "Customer"
                        fieldname = source_doctype.split("(")[0].strip()  # e.g. "customer"

                        # Get linked docname from the parent document (by querying the field)
                        linked_docname = frappe.db.get_value(template.reference_doctype, docname, fieldname)

                        if not linked_docname:
                            frappe.log_error(
                                f"No linked docname found for field '{fieldname}' in {template.reference_doctype} {docname}",
                                "Twilio Template Mapping"
                            )
                            continue

                        # Fetch the field value from the linked doctype
                        value = frappe.db.get_value(linked_doctype, linked_docname, source_field)
                        if value and value.startswith("/"):
                            value= urllib.parse.quote(value[1:], safe=':/')

                    else:
                        # 🔹 Normal case — get the field value from the current document
                        value = frappe.db.get_value(source_doctype, docname, source_field)
                        if value and value.startswith("/"):
                            value= urllib.parse.quote(value[1:], safe=':/')
                # else:
                #     value=(var.default or "").strip()

                if key and value is not None:
                    variables[key] = value
                
       
       
    #     body_preview = json.dumps(variables, indent=2)
  
        media_url=None
        if template.media_url:
            attach_var= extract_placeholder(template.media_url)
            if attach_var in variables:
                media_url=template.media_url.replace(f"{{{{{attach_var}}}}}", str( variables[attach_var]))
        if template.attach_document_print:                
                    doc = frappe.get_doc(template.reference_doctype, docname)
                    # frappe.db.begin()
                    key = doc.get_document_share_key()  # noqa
                    frappe.db.commit()    
                    from packaging import version
                    frappe_version = frappe.__version__
                    if version.parse(frappe_version) < version.parse("15.0.0"):
                           res=pdf(template.reference_doctype, doc.name,key,template.print_format,template.language_format,letterhead=template.letter_head)   
                    else:
                        res = generate_pdf_with_getpdf(
                                doctype=template.reference_doctype,
                                name=doc.name,
                                print_format=template.print_format,
                                lang=template.language_format,
                                letterhead=template.letter_head,
                                is_private=template.is_private
                            )
                    link_attach=res['file_url']
                   
                    file_id=res['file_id']
                    if template.media_url:
                        attach_var= extract_placeholder(template.media_url)
                        if attach_var:
                            link=link_attach.lstrip('/')
                            variables[attach_var] = urllib.parse.quote(link, safe=':/')
                            if attach_var in variables:
                                media_url=template.media_url.replace(f"{{{{{attach_var}}}}}", str( variables[attach_var]))

                                frappe.log_error("sds",media_url)
                    
        if attachment:
            if template.media_url:
               
                attach_var= extract_placeholder(template.media_url)
                if attach_var:
                    link=attachment.lstrip('/')
                    variables[attach_var] = urllib.parse.quote(link, safe=':/')
                    if attach_var in variables:
                        media_url=template.media_url.replace(f"{{{{{attach_var}}}}}", str( variables[attach_var]))
        location={}         
        if template.template_type == "twilio/location": 
            location['lable']=template.lable
            location['latitude']=template.latitude
            location['longitude']=template.longitude         
        html,file_type= generate_whatsapp_html_preview(
        body=BeautifulSoup(template.body, 'html.parser').get_text(separator='\n'),
        template_name=template.name,
        template_type=template.template_type,
        variables=variables,
        media_url=media_url,
        items=template.items,
        location=location
                
    )
   
    if file_type in ("image", "video"):
        is_media = 1
    if file_type=="pdf":
        is_document = 1
    if file_id is None and media_url:
       file_id = get_file_id_from_url(media_url)

    attach_var= extract_placeholder(template.media_url)
    if link:
       
       
        file_info = frappe.db.get_value(
                    "File", {"file_url": f"/{link}"},
                    ["name", "is_private", "file_url"], as_dict=True
                )
        was_private = file_info.is_private
        if was_private:
                    # Load original file content
                    file_path = frappe.get_site_path(file_info.file_url.lstrip("/"))
                    with open(file_path, "rb") as f:
                        content = f.read()

                    # Create a new public file
                    new_public_file = frappe.get_doc({
                        "doctype": "File",
                        "file_name": f"temp_{os.path.basename(file_info.file_url)}",
                        "content": content,
                        "is_private": 0,  # Public
                        "attached_to_doctype": template.reference_doctype,
                        "attached_to_name": doc.name
                    })

                    new_public_file.insert(ignore_permissions=True)
                    frappe.db.commit()

                    public_url = new_public_file.file_url 
                  
                    variables[attach_var] = urllib.parse.quote(public_url.lstrip('/'), safe=':/')
                    frappe.enqueue(
                    "clefincode_chat.api.api_1_3_1.api.delete_temp_public_file",
                    file_url=public_url,
                    time_delay=60,
                    queue='default',
                    timeout=600,
                    
                )
                    
    message = client.messages.create(
        from_=f"whatsapp:{from_number}",
        to=f"whatsapp:{to_number}",
        content_sid=template.whatsapp_template_id,
        content_variables=json.dumps(variables)
    )
    
   
   
    
    # new_message.content=html
    # new_message.save(ignore_permissions = True)
    # room=new_message.chat_channel
    # results['content']=html
    # results['last_message']=html
    # frappe.publish_realtime(event=room, message=results, user=new_message.sender_email)
    # frappe.publish_realtime(event="update_room", message=results, user= new_message.sender_email)
    #send_notification(member.user , results, "send_message", room_name if channel_doc.type == "Group" else get_contact_full_name(email), message_template_type) 
   
   
    send(content=html, user=to_number, room=new_message.chat_channel, email=to_number,is_media=is_media,is_document=is_document,file_id=file_id)
   
    frappe.logger("whatsapp").info(
        f"✅ Sent WhatsApp template '{template.name}' ({doctype}) to {to_number} | SID={message.sid}"
    )
    
    return {
        "sid": message.sid,
        "status": message.status,
        "variables": variables,
        "body_preview": body_preview,
        "doctype": doctype
    }
    


#========================================================================================
@frappe.whitelist()
def get_all_whatsapp_templates():
    """Return all WhatsApp templates from ClefinCode and Twilio."""
    try:
        profile_whatsapp = frappe.get_all(
            "ClefinCode WhatsApp Profile", fields=["name"]
        )

        if profile_whatsapp:
            whatsapp_profile_name = profile_whatsapp[0].name

        # ClefinCode templates (force reference_doctype = None)
        templates_clefin_raw = frappe.get_all(
             "ClefinCode WhatsApp Template",
                            filters={
                                "docstatus": 1,
                                "whatsapp_profile": ["=", whatsapp_profile_name],  
                                "template_status":"APPROVED"
                            },
                            fields=["name", "meta_template_name"]
                        )

        # Add reference_doctype = None
        templates_clefin = [
            {
                "name": t.name,
                "meta_template_name": t.meta_template_name,
                "reference_doctype": None
            }
            for t in templates_clefin_raw
        ]

        # Twilio templates
        templates_twilio = frappe.get_all(
            "CiC Twilio Template",
            filters={"whatsapp_template_id": ["is", "set"],"template_status": "APPROVED"},
            fields=["name", "friendly_name as meta_template_name", "reference_doctype"]
        )

        # Combine
        templates = templates_clefin + templates_twilio

        return {"results": templates}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Get WhatsApp Templates API Error")
        raise e
    
@frappe.whitelist()
def get_chat_templates():
    """Return all WhatsApp templates from ClefinCode and Twilio."""
    try:
        templates = frappe.get_all(
                "Clefincode Chat Template",
                 fields=["name", "friendly_name as meta_template_name","reference_doctype"]
        )
        for t in templates:
              t["doctype"] = "Clefincode Chat Template"
        

        return {"results": templates}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Get WhatsApp Templates API Error")
        raise e
#====================================================================================
import frappe
import requests

@frappe.whitelist(allow_guest=False)
def send_whatsapp_template_meta(template_name, recipient, params=None):
   

    
    template = frappe.get_doc("ClefinCode WhatsApp Template", template_name)

    if not template.whatsapp_profile:
        return {"error": "WhatsApp Profile not linked to this template"}

   
    profile = frappe.get_doc("ClefinCode WhatsApp Profile", template.whatsapp_profile)
    ACCESS_TOKEN = profile.get("access_token")
    PHONE_NUMBER_ID = profile.get("phone_number_id")

    if not ACCESS_TOKEN or not PHONE_NUMBER_ID:
        return {"error": "Missing WhatsApp credentials in profile"}

   
    url = f"https://graph.facebook.com/v23.0/{PHONE_NUMBER_ID}/messages"
    headers = {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Content-Type": "application/json"
    }

    
    body_params = []
    if params:
        for p in params:
            body_params.append({"type": "text", "text": str(p)})

    
    components = []

    # === 1. Header ===
    if template.header_type and template.header_type != "None":
        header_component = {"type": "header", "parameters": []}

        if template.header_type == "Text" and template.header:
            header_component["parameters"].append({"type": "text", "text": template.header})

        elif template.header_type in ["Image", "Video", "Document"] and template.header_attachment:
            
            media_id = upload_media_to_meta(
                PHONE_NUMBER_ID,
                ACCESS_TOKEN,
                template.header_attachment,
                template.header_type.lower()
            )
            if media_id:
                header_component["parameters"].append({
                    "type": template.header_type.lower(),
                    template.header_type.lower(): {"id": media_id}
                })

        components.append(header_component)

    # === 2. Body ===
    components.append({
        "type": "body",
        "parameters": body_params
    })

    # === 3. Buttons ===
    if template.buttons:
        button_components = {"type": "button", "sub_type": "quick_reply", "parameters": []}

        # Meta API expects each button as a separate "button" component
        buttons = frappe.get_all(
            "ClefinCode WhatsApp Template Button",
            filters={"parent": template.name},
            fields=["type", "button_text", "url_type", "website_url", "phone_number", "offer_code"]
        )

        for index, btn in enumerate(buttons):
            btn_type = btn.get("type")
            btn_text = btn.get("button_text")

            # Quick Reply (Custom)
            if btn_type == "Custom" or btn_type == "Complete flow":
                components.append({
                    "type": "button",
                    "sub_type": "quick_reply",
                    "index": index,
                    "parameters": [{"type": "payload", "payload": btn_text}]
                })

            # Visit Website
            elif btn_type == "Visit website" and btn.get("website_url"):
                components.append({
                    "type": "button",
                    "sub_type": "url",
                    "index": index,
                    "parameters": [{"type": "text", "text": btn.get("website_url")}]
                })

            # Call Phone Number
            elif btn_type == "Call phone number" and btn.get("phone_number"):
                components.append({
                    "type": "button",
                    "sub_type": "call",
                    "index": index,
                    "parameters": [{"type": "text", "text": btn.get("phone_number")}]
                })

            # Copy Offer Code
            elif btn_type == "Copy offer code" and btn.get("offer_code"):
                components.append({
                    "type": "button",
                    "sub_type": "copy_code",
                    "index": index,
                    "parameters": [{"type": "text", "text": btn.get("offer_code")}]
                })

    # === Final Payload ===
    payload = {
        "messaging_product": "whatsapp",
        "to": recipient,
        "type": "template",
        "template": {
            "name": template.meta_template_name,
            "language": {"code": template.template_language or "en_US"},
            "components": components
        }
    }

    # === Send Request ===
    response = requests.post(url, headers=headers, json=payload)
    result = response.json()

    if response.status_code == 200:
        frappe.msgprint(f" Template '{template.meta_template_name}' sent successfully.")
    else:
        frappe.log_error(
            title="WhatsApp Template Send Error",
            message=f"Template: {template.meta_template_name}\nResponse: {result}"
        )

    return result


def upload_media_to_meta(phone_number_id, access_token, file_url, media_type):
   
    try:
        file_path = frappe.utils.get_files_path(file_url.split("/")[-1])
        url = f"https://graph.facebook.com/v23.0/{phone_number_id}/media"
        files = {"file": open(file_path, "rb")}
        data = {"messaging_product": "whatsapp"}
        headers = {"Authorization": f"Bearer {access_token}"}

        response = requests.post(url, headers=headers, files=files, data=data)
        result = response.json()
        return result.get("id")
    except Exception as e:
        frappe.log_error("Media Upload Error", str(e))
        return None
#=======================================================
def send_whatsapp_message_twilio_notification(sender, receiver, message, message_type="text",file_name=None):
    try:
        # Retrieve Twilio credentials from Frappe database
        doc = frappe.get_doc("ClefinCode Twilio Integration")
        account_sid =doc.get("account_sid")
        auth_token = get_auth_token_twillio()
        twilio_whatsapp_number = frappe.db.get_value("ClefinCode WhatsApp Profile", sender, "whatsapp_number")

        client = Client(account_sid, auth_token)

        if message_type in ['document']:
            media_url = message
            media_url, was_private = make_file_public(media_url)
            public_url=media_url
            site_url = frappe.utils.get_url()  
           

            
            media_url=site_url+media_url
            media_url = urllib.parse.quote(media_url, safe=':/')
            body = file_name or message  
            
            
            msg = client.messages.create(
                from_=f'whatsapp:{twilio_whatsapp_number}',
                body = body,
                media_url=[media_url],   # must be a list of URLs
                to=f'whatsapp:{receiver}'
            )
            # Reset file to private if applicable
            if was_private:
                reset_file_to_private(public_url)
        else:  # text
            
            msg = client.messages.create(
                from_=f'whatsapp:{twilio_whatsapp_number}',
                body=message,
                to=f'whatsapp:{receiver}'
            )

       
        frappe.db.commit()

    except Exception as e:
        frappe.log_error(title="send whatsapp message Exception", message=str(e))
#======================================================================================
def extract_placeholder(media_url: str) -> str | None:
    """
    Extracts the variable name or number inside {{ }} from a URL.
    Example:
        'https://erp.clefincode.com/{{media_var}}' → 'media_var'
    """
    match = re.search(r"\{\{(.*?)\}\}", media_url or "")
    return match.group(1) if match else None
#=======================================================================
def generate_whatsapp_html_preview(
    body="",
    template_name="",
    template_type="twilio/text",
    variables=None,
    media_url=None,
    location=None,
    cards=None,
    actions=None,
    items=None
):
    variables = variables or {}
    cards = cards or []
    actions = actions or []
    items = items or []
    location = location or {}
    file_id=None
    file_type=None

    # --- Replace variables ---
    final_body = body
    for k, v in variables.items():
        final_body = final_body.replace("{{" + k + "}}", str(v))

    safe_body = final_body.replace("\n", "<br>")

    # --- Helper bubble ---
    def msg_block(text):
        safe_text = text.replace("\n", "<br>")
        return f"""
                    <div class='wa-msg-row in'>
                    <div class='wa-msg'>
                        <div class='wa-msg-text'>{safe_text}</div>
                    </div>
                    </div>
                    """

    # --- START HTML ---
    html = f"""
                    <div class='whatsapp-card'>
                    <header class='wa-chat-header'>{template_name}</header>
                    <div class='wa-chat-body'>
                    """

    # BODY message
    html += msg_block(final_body)

    # --- LIST PICKER ITEMS AS ROWS ---
    if template_type == "twilio/list-picker" and items:
        html += "<div class='wa-list-container in'><div class='wa-msg'>"
        html += "<div class='wa-msg-text'></div>"
        for it in items:
            title = it.get("item") or it.get("title") or ""
            html += "<div class='wa-list-row'>• " + title + "</div>"
        html += "</div></div>"

    # --- MEDIA ---
     # --- LOCATION ---
    if template_type == "twilio/location":
        lat = location.get("latitude")
        lng = location.get("longitude")
        name = location.get("lable", "")
        address = location.get("address", "")

        if lat and lng:
            google_maps_url = f"https://www.google.com/maps?q={lat},{lng}"

            html += (
                "<div class='wa-msg-row in'><div class='wa-msg'>"
                "<div class='wa-msg-text'>"
                "<strong> Location</strong><br>"
                + (name + "<br>" if name else "")
                + (address + "<br>" if address else "")
                + f"<a href='{google_maps_url}' target='_blank'>View on Google Maps</a>"
                "</div></div></div>"
            )
    if media_url and template_type in ["twilio/media", "twilio/card", "whatsapp/card"]:
            ext = media_url.lower().split(".")[-1]

            if ext in ["jpg", "jpeg", "png", "gif", "webp"]:
                # IMAGE
                html += f"""
                        <div class='wa-msg-row in'>
                        <div class='wa-msg'>
                            <img src="{media_url}" style="max-width:100%;">
                        </div>
                        </div>
                        """
                file_type="image"
                
                

            elif ext in ["mp4", "mov", "webm", "m4v"]:
                # VIDEO
                html += (
                    "<div class='wa-msg-row in'><div class='wa-msg'>"
                    "<video controls style='max-width:100%;'>"
                    "<source src='" + media_url + "' type='video/mp4'>"
                    "</video>"
                    "</div></div>"
                )
                file_type="video"
                

            elif ext == "pdf":
                # PDF
                html += f"""
                                    <div class='wa-msg-row in'>
                                    <div class='wa-msg'>
                                        <object data="{media_url}" type="application/pdf" width="100%" height="300px">
                                            <a href="{media_url}">View PDF</a>
                                        </object>
                                    </div>
                                    </div>
                                    """

                file_type="pdf"

            else:
                # UNKNOWN FILE
                html += (
                    "<div class='wa-msg-row in'><div class='wa-msg'>"
                    "<a href='" + media_url + "' target='_blank'>Download file</a>"
                    "</div></div>"
                )

    # END WRAPPERS
    html += """</div></div>"""

    return html,file_type
#==========================================================
@frappe.whitelist()
def is_reference_doctype_Template_empty(docname, template_type):

    try:
        # Validate input
        if not docname:
            frappe.throw("Docname is required")

        if template_type == "CiC Twilio Template":
            doc = frappe.get_doc("CiC Twilio Template", docname)
            value = doc.reference_doctype

            return {
                "empty": 0 if value else 1,
                "value": value or ""
            }
            
        if template_type == "Clefincode Chat Template":
            doc = frappe.get_doc("Clefincode Chat Template", docname)
            value = doc.reference_doctype

            return {
                "empty": 0 if value else 1,
                "value": value or ""
            }

        if template_type == "ClefinCode WhatsApp Template":
            # Always empty for this template
            return {
                "empty": 1,
                "value": ""
            }

        # Unsupported template type
        return {
            "error": 1,
            "message": f"Unsupported template_type: {template_type}"
        }

    except Exception as e:
        # Log full traceback in error log
        frappe.log_error(
            title="Error in is_reference_doctype_Template_empty",
            message=frappe.get_traceback()
        )

        # Return safe error response
        return {
            "error": 1,
            "message": str(e)
        }
#+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

import re
import frappe


# ============================================================
# Helper: Check if value is an image URL or internal file path
# ============================================================
def detect_image_url(value):
    if not value:
        return None

    value = str(value).strip().lower()
    image_extensions = (".jpg", ".jpeg", ".png", ".gif", ".webp")

    # External full URL
    if value.startswith(("http://", "https://")) and value.endswith(image_extensions):
        return value

    # Internal file path
    if value.startswith("files/") and value.endswith(image_extensions):
        return frappe.utils.get_url(value)

    return None


# ============================================================
# Helper: Find first image inside vars
# ============================================================
def find_image_in_vars(vars_dict):
    for k, v in vars_dict.items():
        img = detect_image_url(v)
        if img:
            return img
    return None


# ============================================================
# MAIN FUNCTION

def get_file_id_from_url(url):
    # Extract file name
    file_name = url.split("/")[-1]
    

    # Try public
    file_id = frappe.db.get_value("File", {"file_url": "/files/" + file_name}, "name")
    if file_id:
        return file_id
    
    # Try private
    file_id = frappe.db.get_value("File", {"file_url": "/private/files/" + file_name}, "name")
    return file_id
# ============================================================
def send_clefincode_chat_template(new_message):

    # -----------------------------
    # Parse template name + docname
    # -----------------------------
    from bs4 import BeautifulSoup
    base_url = frappe.utils.get_url()
    content = new_message.content
    soup = BeautifulSoup(content, 'html.parser')
    file_id=""
    text = soup.get_text()       # convert HTML → plain text
    messages = text.split(',')   # now you can split safely

    if len(messages) < 2:
        template_name = content.strip()
        docname = ""
    else:
        template_name = messages[0].strip()
        docname = messages[1].strip()

    template = frappe.get_doc("Clefincode Chat Template", template_name)

    # --------------------------------------------
    # Extract variables from the template
    # --------------------------------------------
    
    vars_values = extract_varibale_from_template(template, docname)
    
    

    # --------------------------------------------
    # Apply vars to message_content
    # --------------------------------------------
    final_body = template.message_content
    for k, v in vars_values.items():
        pattern = r"{{\s*" + re.escape(k) + r"\s*}}"
        final_body = re.sub(pattern, str(v), final_body)

    # --------------------------------------------
    # Detect image in the vars values
    # --------------------------------------------
    detected_image_url = find_image_in_vars(vars_values)
    is_media=0
    if detected_image_url:
        file_id=get_file_id_from_url(detected_image_url)
        is_media=1
        attachment = detected_image_url.replace(base_url, "")
        image_html = f"""
        <a href="{detected_image_url}" target="_blank">
            <img src="{detected_image_url}" class="img-responsive chat-image">
        </a>
        """
    else:
        image_html = ""
        attachment=""

    # --------------------------------------------
    # Build final HTML message
    # --------------------------------------------
    html_message =image_html+f"<p>{final_body}</p>"
    
   
    
    # --------------------------------------------
    # Send the HTML message first
    # --------------------------------------------
    send(
        html_message,
        new_message.sender,
        new_message.chat_channel,
        new_message.sender_email,
        is_media=is_media,
        attachment=attachment,
        file_id=file_id,
     
    )

    # ===============================================================
    # If template is set to attach the document print → generate PDF
    # ===============================================================
    if template.attach_document_print and docname:

       

        # Get document
        doc = frappe.get_doc(template.reference_doctype, docname)

        # Share key
        key = doc.get_document_share_key()
        frappe.db.commit()

        # Generate PDF
        pdf_result = generate_pdf_with_getpdf(
                            doctype=doc.doctype,
                            name=doc.name,
                            print_format=template.print_format,
                            lang=template.language,
                            letterhead=template.letter_head,
                            is_private=True
                        )

        # Build download link
        pdf_url = frappe.utils.get_url(pdf_result['file_url'])
        secure_pdf_url = frappe.utils.get_url(pdf_result['access_url'])

        # pdf_html = f"""
        #     <div style="font-family: Arial; font-size:14px; padding:10px;">
        #         Document is ready for download:
        #         <br><br>
        #         <a href="{pdf_url}" 
        #            style="background:#0275d8; color:white; padding:10px 15px; 
        #            text-decoration:none; border-radius:5px;">
        #            Download PDF
        #         </a>
        #     </div>
        # """
        send( handle_pdf_attachment(pdf_result['file_url'], pdf_result['file_name']),new_message.sender, new_message.chat_channel , template.owner,  attachment = secure_pdf_url , sub_channel = None , is_link = None , is_media = None , is_document = 1,file_id=pdf_result['file_id'])
        # Send PDF as attachment
        # send(
        #     pdf_html,
        #     new_message.sender,
        #     new_message.chat_channel,
        #     template.owner,
        #     attachment=pdf_result['file_url'],
        #     is_document=1,
         
        #     file_id=pdf_result['file_id']
        # )


#++++++++++++++++++++++++++++++++++++++++++++++++++++++++++     
    

     
     
def extract_varibale_from_template(template,docname):
   
    variables={}
 
    for var in template.variables:
                key = (var.variable_key or "").strip()
                source_doctype = (var.source or "").strip()
                source_field = (var.source_field or "").strip()
                value=var.default
                
                if key and value is not None:
                    
                    variables[key] = value 

                if not key:
                    continue
                if (source_doctype and source_field):
                   
                    match = re.search(r"\(([^)]+)\)", source_doctype)
                    if match:
                        linked_doctype = match.group(1).strip()     # e.g. "Customer"
                        fieldname = source_doctype.split("(")[0].strip()  # e.g. "customer"

                        # Get linked docname from the parent document (by querying the field)
                        linked_docname = frappe.db.get_value(template.reference_doctype, docname, fieldname)

                        if not linked_docname:
                            frappe.log_error(
                                f"No linked docname found for field '{fieldname}' in {template.reference_doctype} {docname}",
                                "Twilio Template Mapping"
                            )
                            
                        continue

                        # Fetch the field value from the linked doctype
                        value = frappe.db.get_value(linked_doctype, linked_docname, source_field)
                        if value and value.startswith("/"):
                            value= urllib.parse.quote(value[1:], safe=':/')

                    else:
                        # 🔹 Normal case — get the field value from the current document
                        value = frappe.db.get_value(source_doctype, docname, source_field)
                        if value and value.startswith("/"):
                            value= urllib.parse.quote(value[1:], safe=':/')
                # else:
                #     value=(var.default or "").strip()
                if value is None:
                    value=var.default 
                if key and value is not None:
                    variables[key] = value
                      
    return variables
#=================================================================
@frappe.whitelist()
def get_documents_by_doctype(doctype, page=1, search=None):
    try:
        # Check read permission on the DocType
        if not frappe.has_permission(doctype, "read"):
            frappe.throw("No Permission", frappe.PermissionError)

        meta = frappe.get_meta(doctype)

        # Determine the best field to use as a title
        # Priority:
        # 1. meta.title_field
        # 2. subject
        # 3. title
        # 4. name (fallback)
        if meta.title_field:
            title_source = meta.title_field
        elif meta.has_field("subject"):
            title_source = "subject"
        elif meta.has_field("title"):
            title_source = "title"
        else:
            title_source = "name"

        # Collect searchable fields from DocType metadata
        search_fields = []
        if meta.search_fields:
            search_fields = [f.strip() for f in meta.search_fields.split(",")]

        # Build a list of valid fields to fetch
        valid_fields = ["name", title_source]
        for f in search_fields:
            df = meta.get_field(f)
            if df and df.fieldtype not in ["Date", "Datetime"]:
                valid_fields.append(f)

        # Remove duplicates
        all_fields = list(set(valid_fields))

        # Pagination setup
        page = int(page)
        page_length = 10
        start = (page - 1) * page_length

        # Build OR filters for search
        or_filters = []
        if search:
            for f in all_fields:
                or_filters.append([doctype, f, "like", f"%{search}%"])

        # Fetch documents
        docs = frappe.get_list(
            doctype,
            fields=all_fields,
            or_filters=or_filters,
            start=start,
            page_length=page_length,
            order_by="modified desc"
        )

        # Normalize the title field in the response
        for d in docs:
            d["title"] = d.get(title_source) or d.get("name")

        return {
            "doctype": doctype,
            "page": page,
            "page_length": page_length,
            "title_field_used": title_source,
            "results": docs
        }


    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "Link Search API Error")
        raise e


#====================================================

def pdf(doctype, name, key, format=None, lang=None, letterhead=None):
    import subprocess
    import tempfile
    import shutil
    import frappe
    from frappe.utils.file_manager import save_file

    wkhtml_path = shutil.which("wkhtmltopdf")
    if not wkhtml_path:
        frappe.throw("wkhtmltopdf is not installed on this server.")

    created_letterhead_flag = False
    

    DEFAULT_FOLDER = "CiC Chat Template PDF"  

    
   
    create_folder_if_not_exists(DEFAULT_FOLDER,"Home/Attachments")
    save_folder = folder or DEFAULT_FOLDER
    try:
        from packaging import version
        frappe_version = frappe.__version__

        doc = frappe.get_doc(doctype, name)

        if version.parse(frappe_version) < version.parse("15.0.0"):
            frappe.local.lang = lang or "en"

        if letterhead:
            frappe.flags.current_letterhead = letterhead
            created_letterhead_flag = True

            original_ignore = frappe.flags.get('ignore_permissions', False)
        frappe.flags.ignore_permissions = True
        try:
            html = frappe.get_print(
                doctype,
                name,
                print_format=format,
                doc=doc,
                no_letterhead=0
            )
        finally:
            frappe.flags.ignore_permissions = original_ignore  
        site_url = frappe.utils.get_url()

        # Convert all src="/..." to src="https://your-site.com/..."
        html = html.replace('src="/', f'src="{site_url}/')
        html = html.replace("href=\"/", f"href=\"{site_url}/")

        html_file = tempfile.NamedTemporaryFile(delete=False, suffix=".html")
        pdf_file = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")

        with open(html_file.name, "w", encoding="utf-8") as f:
            f.write(html)

        command = [
            wkhtml_path,
            "--print-media-type",
            "--margin-top", "20mm",
            "--margin-bottom", "20mm",
            "--margin-left", "10mm",
            "--margin-right", "10mm",
            "--enable-local-file-access",
            html_file.name,
            pdf_file.name
        ]

        # Run the command and CAPTURE STDERR/STDOUT
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        if result.returncode != 0:
            frappe.log_error(
                title="wkhtmltopdf error",
                message=f"Command: {command}\n\nSTDOUT:\n{result.stdout}\n\nSTDERR:\n{result.stderr}"
            )
            raise Exception("wkhtmltopdf failed. Check error log.")

        # Read PDF
        with open(pdf_file.name, "rb") as f:
            pdf_data = f.read()

        file_name = f"{doctype}_{name.replace(' ', '_')}.pdf"
        _file = save_file(file_name, pdf_data, doctype, name, is_private=False,folder=f"Home/Attachments/{DEFAULT_FOLDER}")

        return {
            "status": "success",
            "file_url": _file.file_url,
            "file_name": file_name,
            "file_id": _file.name
        }

    except Exception:
        frappe.log_error(frappe.get_traceback(), f"wkhtmltopdf PDF error: {doctype} {name}")
        return {"status": "error", "message": "PDF generation failed. Check logs."}

    finally:
        if created_letterhead_flag and hasattr(frappe.flags, "current_letterhead"):
            del frappe.flags.current_letterhead        
            
            

            
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
########################################################################################################################

@frappe.whitelist()
def update_profile_contacts(profile_id, contact_details):
    import json

    # Convert JSON string
    if isinstance(contact_details, str):
        contact_details = json.loads(contact_details)

    # Load profile
    doc = frappe.get_doc("ClefinCode Chat Profile", profile_id)

    # Old list
    old_list = [row.contact_info for row in doc.contact_details]

    # New list
    new_list = [row.get("contact_info") for row in contact_details]

    # Detect NEW contacts
    new_contacts = [c for c in new_list if c not in old_list]

    # Validate new contacts
    for new_contact in new_contacts:
        validate_contact_unique(new_contact, profile_id)

    # Detect deleted contacts
    deleted_contacts = [c for c in old_list if c not in new_list]

    # Process deleted contacts (rooms, etc.)
    process_deleted_contacts(deleted_contacts, profile_id)

    # -----------------------------------------
    # ❗ Delete removed child table rows
    # -----------------------------------------
    doc.contact_details = [
        row for row in doc.contact_details
        if row.contact_info not in deleted_contacts
    ]

    # -----------------------------------------
    # Add only NEW contacts to child table
    # -----------------------------------------
    for row in contact_details:
        contact_info = row.get("contact_info")
        contact_type = row.get("contact_type")
       

        if contact_info in new_contacts:
            #
            doc.append("contact_details", {
                "contact_info": contact_info,
                "type": contact_type,
                "default": row.get("default", 0),
                "verified": row.get("verified", 0),
                "user": row.get("user", frappe.session.user)
            })

            # Create ERPNext Contact
           # create_contact(contact_info, contact_type, profile_id)

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "status": "success",
        "message": "Contact details updated, new contacts created, deleted contacts removed."
    }

def validate_contact_unique(contact_info, current_profile_id):
    """
    Checks if the contact exists in another profile.
    Only new contacts are validated.
    """
    result = frappe.db.sql("""
        SELECT parent
        FROM `tabClefinCode Chat Profile Contact Details`
        WHERE contact_info = %s
        AND parent != %s
        LIMIT 1
    """, (contact_info, current_profile_id), as_dict=True)

    if result:
        profile = result[0].parent
        frappe.throw(
            f"This contact ({contact_info}) already exists in another profile ({profile}). You cannot add it again."
        )
def process_deleted_contacts(deleted_list, profile_id):
    """
    For each deleted contact:
    - Find all chat rooms that include this user inside Chat Channel User child table
    - Close every chat room by setting chat_status = 'Closed'
    """

    if not deleted_list:
        return

    for deleted_contact in deleted_list:

        # 1) Find all rooms that contain this contact
        rooms = frappe.db.get_all(
            "ClefinCode Chat Channel User",
            filters={"user": deleted_contact},
            fields=["parent"]
        )

        if not rooms:
            frappe.logger().info(f"No chat rooms found for deleted contact: {deleted_contact}")
            continue

        # 2) Close each room
        for r in rooms:
            room_name = r.get("parent")

            frappe.logger().info(
                f"Closing chat room {room_name} because contact {deleted_contact} was removed."
            )

            frappe.db.set_value(
                "ClefinCode Chat Channel",
                room_name,
                "chat_status",
                "Closed"
            )

        frappe.db.commit()
@frappe.whitelist()
def create_contact(contact_info, contact_type, profile_id):
    """
    Update the Contact linked to this profile (via Profile.contact field)
    without creating a new Contact.
    Always update the existing Contact instead of creating a new one.
    """

    # 1) Load the Chat Profile document
    profile = frappe.get_doc("ClefinCode Chat Profile", profile_id)

    # 2) Ensure the profile already has a linked Contact
    if not profile.contact:
        frappe.throw("This profile does not have a Contact linked to it.")

    contact_name = profile.contact

    # 3) Load the linked Contact document
    doc = frappe.get_doc("Contact", contact_name)

    # 4) Update fields based on the contact type
    ctype = contact_type.lower()

    if ctype == "phone":
        if doc.phone_nos:
            doc.phone_nos[0].phone = contact_info
        else:
            doc.append("phone_nos", {"phone": contact_info})

    elif ctype == "email":
        if doc.email_ids:
            doc.email_ids[0].email_id = contact_info
        else:
            doc.append("email_ids", {"email_id": contact_info})

    else:
        if doc.social_contact:
            doc.social_contact[0].social_id = contact_info
            doc.social_contact[0].platform = contact_type
        else:
            doc.append("social_contact", {
                "platform": contact_type,
                "social_id": contact_info
            })

    # 5) Save Contact document with updated data
    doc.save(ignore_permissions=True)

    return doc.name



@frappe.whitelist()
def get_contact_by_profile(profile_id):
    # Fetch the main contact record
    contact = frappe.db.sql("""
        SELECT 
            ChatProfile.name AS profile_id,
            ChatProfile.full_name,
            Contact.user AS user_id
            
        FROM `tabClefinCode Chat Profile` AS ChatProfile
        INNER JOIN `tabContact` AS Contact ON Contact.name = ChatProfile.contact
        
        WHERE ChatProfile.name = %s
        LIMIT 1
    """, (profile_id,), as_dict=True)

    if not contact:
        return {"results": {}}

    contact = contact[0]

    # Fetch contact details
    contact["contact_details"] = frappe.db.sql("""
        SELECT 
            contact_info, 
            type AS contact_type, 
            verified, 
            `default`
        FROM `tabClefinCode Chat Profile Contact Details`
        WHERE parent = %s
    """, (profile_id,), as_dict=True)

    return {"results": contact}
import subprocess
import tempfile
import frappe

def generate_pdf_with_wkhtml(html, options=None):
    if options is None:
        options = {
            '--margin-top': '25mm',
            '--margin-bottom': '25mm',
            '--header-spacing': '5',
            '--footer-spacing': '5',
            '--enable-local-file-access': None
        }

    pdf_out = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    html_in = tempfile.NamedTemporaryFile(delete=False, suffix=".html")

    with open(html_in.name, "w", encoding="utf-8") as f:
        f.write(html)

    command = ["wkhtmltopdf"]

    for k, v in options.items():
        if v is None:
            command.append(k)
        else:
            command.extend([k, v])

    command.extend([html_in.name, pdf_out.name])

    subprocess.run(command, check=True)

    return pdf_out.name

def generate_pdf_with_getpdf(
    doctype,
    name,
    print_format=None,
    lang=None,
    letterhead=None,
    is_private=True,
   
    
):
    import frappe

  
    doc = frappe.get_doc(doctype, name, ignore_permissions=True)
    DEFAULT_FOLDER = "CiC Chat Template PDF"  

    
   
    create_folder_if_not_exists(DEFAULT_FOLDER,"Home/Attachments")

    if lang:
        frappe.local.lang = lang

    # Letterhead
    if letterhead:
        frappe.flags.current_letterhead = letterhead

    
    original_ignore = frappe.flags.get('ignore_permissions', False)
    frappe.flags.ignore_permissions = True
    try:
        html = frappe.get_print(
            doctype,
            name,
            print_format=print_format,
            doc=doc,
            no_letterhead=0
        )
    finally:
        frappe.flags.ignore_permissions = original_ignore 

    
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

@frappe.whitelist()
def get_template_suggestions(user, platform="Chat", text=""):
    if not text or not text.startswith("/"):
        return []

    templates = []

    if platform == "Chat":
        templates = frappe.get_all(
            "Clefincode Chat Template",
            fields=["name", "friendly_name as meta_template_name"]
        )
        for t in templates:
            t["doctype"] = "Clefincode Chat Template"

    elif platform == "WhatsApp":
        profile = frappe.get_all(
            "ClefinCode WhatsApp Profile",
            filters={"user": user},
            fields=["name"]
        )

        if profile:
            templates = frappe.get_all(
                "ClefinCode WhatsApp Template",
                filters={
                    "docstatus": 1,
                    "whatsapp_profile": profile[0].name,
                    "template_status": "APPROVED"
                },
                fields=["name", "meta_template_name"]
            )
            for t in templates:
                t["doctype"] = "ClefinCode WhatsApp Template"

        twilio_templates = frappe.get_all(
            "CiC Twilio Template",
            filters={
                "whatsapp_template_id": ["is", "set"],
                "template_status": "APPROVED"
            },
            fields=["name", "friendly_name as meta_template_name"]
        )
        for t in twilio_templates:
            t["doctype"] = "CiC Twilio Template"

        templates += twilio_templates

    return templates




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


