import frappe
import datetime
import json
import mimetypes
import os
import base64
from PIL import Image
from io import BytesIO
from typing import List, Dict
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
from clefincode_chat.utils.fcm_notifications import send_notification_via_firebase 

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
        if enable_mobile_notifications == 1:
            send_notification_with_content = frappe.db.get_single_value("ClefinCode Chat Settings" , "with_message_content")
        installed_apps = frappe.get_installed_apps()

        sorted_installed_apps = sorted(installed_apps)

        for app in sorted_installed_apps:
            versions.update({app : frappe.get_attr(app + ".__version__")})

        versions.update({"enable_mobile_notifications" : enable_mobile_notifications , "send_notification_with_content" : send_notification_with_content})               

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
                send_notification(user_email , {"realtime_type" : "session_expired" , "old_token" : old_token}, "session_expired")
                return {"results" : [{"status" : 0}]}
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
# ==========================================================================================
@frappe.whitelist(allow_guest=True)
def get_settings(token):
    config = {
        'socketio_port': frappe.conf.socketio_port,
        'user_email': frappe.session.user,
        'is_admin': True if 'user_type' in frappe.session.data else False,
        # 'guest_title': ''.join(frappe.get_hooks('guest_title')),
    }
    config = {**config, **get_chat_settings()}

    if config['is_admin']:
        config['user'] = frappe.db.get_value('User', config['user_email'], 'full_name')
        config['time_zone'] = frappe.db.get_value('User', config['user_email'], 'time_zone')    
    else:
        config['user'] = 'Guest'
        profile_details = validate_token(token)
        if profile_details:
            config['channel'] = profile_details['channel']
            config['is_verified'] = True
        else:
            config['is_verified'] = False
    return config
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
def create_channel(channel_name , users, type , last_message , creator_email , creator , creation_date):  
    # only for Direct chat   
    creation_date = datetime.datetime.utcnow()
    room_doc = frappe.get_doc({
        'doctype': 'ClefinCode Chat Channel',
        'channel_name' : channel_name,
        'channel_creator' : creator_email,
        'type': type,
        'is_parent' : 1,
        'creation_date' : creation_date,
        'modified_date': creation_date
    })
    room_doc.insert(ignore_permissions=True)
    for user in json.loads(users):
        room_doc.append("members" , {"profile_id" : get_profile_id(user["email"]) ,"user" : user["email"] , "platform" : "Chat"})
        share_doctype("ClefinCode Chat Channel", room_doc.name, user["email"])
    room_doc.save(ignore_permissions=True)
    frappe.db.commit()
    

    return {"results" : [{"room" : room_doc.name}]}
# ==========================================================================================
@frappe.whitelist()
def create_group(selected_contacts_list , user , creation_date):
    platform = ""
    creation_date = datetime.datetime.utcnow()
    room_doc = frappe.get_doc({
        'doctype': 'ClefinCode Chat Channel',
        'type': "Group",
        'channel_creator' : user,
        'is_parent' : 1,
        'creation_date' : creation_date,
        'modified_date': creation_date
    })
    room_doc.append("members" , {"profile_id" : get_profile_id(user) , "user" : user , "platform" : "Chat" ,"unread_messages" : 0 , "is_admin" : 1})    
    room_doc.insert(ignore_permissions=True)
    share_doctype("ClefinCode Chat Channel", room_doc.name, user)

    email_dict = {}

    for user in json.loads(selected_contacts_list):
        room_doc.append("members" , {"profile_id" : user["profile_id"] , "user" : user["email"] , "platform" :user["platform"]})
        share_doctype("ClefinCode Chat Channel", room_doc.name, user["email"])
        # if email in email_dict:
            # If the email already exists, append the type with a hyphen
            # if platform not in email_dict[email]:
            #     email_dict[email] += f'-{platform}'
        # else:
        #     email_dict[email] = platform

    # for email, platform in email_dict.items():
        

    room_doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {"results" : [{"room" : room_doc.name  , "room_name" : room_doc.get_group_name()}]}
# ==========================================================================================
@frappe.whitelist()
def create_sub_channel(new_contributors , parent_channel , user , user_email , creation_date , last_active_sub_channel = None , user_to_remove = None , empty_contributor_list = 0):
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
def leave_contributor(parent_channel , user , creation_date , last_active_sub_channel = None , user_to_remove = None , empty_contributor_list = 0):
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
def get_channels_list(user_email , limit = 10 , offset = 0):
    results = frappe.db.sql(f"""
    SELECT
    ChatChannel.name AS room,
    NULL AS parent_channel,
    NULL AS contact ,
    ChatChannel.modified_date AS send_date,
    last_message,
    last_message_number - ChatChannelUser.last_message_read AS user_unread_messages,
    channel_name,
    type,
    NULL AS is_removed,
    NULL AS remove_date

    FROM `tabClefinCode Chat Channel` AS ChatChannel 
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser  ON ChatChannelUser.parent = ChatChannel.name AND ChatChannelUser.user = '{user_email}'
    WHERE type = 'Guest'
    
    UNION ALL
                            
    SELECT 
    DISTINCT ChatChannel.name AS room,
    NULL AS parent_channel,
    NULL AS contact ,
    ChatChannel.modified_date AS send_date ,
    last_message,
    ChatChannelUser.channel_last_message_number - ChatChannelUser.last_message_read AS user_unread_messages,
    channel_name,
    type,
    ChatChannelUser.is_removed AS is_removed,
    ChatChannelUser.remove_date

    FROM `tabClefinCode Chat Channel` AS ChatChannel 
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser  ON ChatChannelUser.parent = ChatChannel.name AND ChatChannelUser.user = '{user_email}'
    WHERE type = 'Group' AND ChatChannelUser.platform = "Chat"

    UNION ALL

    SELECT 
    ChatChannel.name AS room,
    NULL AS parent_channel,
    ChatChannelUser2.user AS contact ,
    ChatChannel.modified_date AS send_date,
    last_message,
    last_message_number - ChatChannelUser.last_message_read AS user_unread_messages,
    channel_name,
    type,
    NULL AS is_removed,
    NULL AS remove_date

    FROM `tabClefinCode Chat Channel` AS ChatChannel
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser  ON ChatChannelUser.parent = ChatChannel.name AND ChatChannelUser.user = '{user_email}'
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser2  ON ChatChannelUser2.parent = ChatChannel.name AND ChatChannelUser2.user <> '{user_email}'
    AND type = 'Direct' AND is_parent = 1
    

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

    FROM `tabClefinCode Chat Channel` AS ChatChannel  INNER JOIN `tabClefinCode Chat Channel Contributor` AS ChatChannelContributor On
    ChatChannelContributor.parent = ChatChannel.name
    AND is_parent = 1 AND ChatChannelContributor.user = '{user_email}'
    GROUP BY ChatChannelContributor.user , ChatChannel.name
        
    """ , as_dict = True)
    if results:
        for room in results:
            if not room.channel_name or room.channel_name == "":
                if room.type == "Direct":
                    room.room_name = get_contact_full_name(room.contact)
                    last_message_info = frappe.db.sql(f""" SELECT sender_email,  message_type FROM `tabClefinCode Chat Message` WHERE chat_channel = '{room.room}' ORDER BY send_date DESC LIMIT 1""" , as_dict = True)[0]
                    room.sender_email = last_message_info.sender_email
                    room.last_message_type = last_message_info.message_type
                elif room.type == "Contributor":
                    room.room_name = "@" + frappe.get_doc("ClefinCode Chat Channel" , room.parent_channel).get_channel_name_for_contributor()
                    last_message_info = get_last_sub_channel_for_user(room.parent_channel , user_email)
                    # content = last_message_info.content
                    room.sender_email = last_message_info.sender_email
                    room.last_message_type = last_message_info.message_type
                    room.last_message = last_message_info.content if last_message_info.content else ""
                    room.send_date = get_last_sub_channel_for_user(room.parent_channel , user_email).send_date
                    room.user_unread_messages = contributor_unread_messages(user_email , room.parent_channel)
                elif room.type == "Group":
                    room.room_name = frappe.get_doc("ClefinCode Chat Channel" , room.room).get_group_name()
                    last_message_info = get_last_message_info(user_email , room.room)
                    room.last_message = last_message_info.content
                    room.sender_email = last_message_info.sender_email
                    room.last_message_type = last_message_info.message_type

                else:
                    room.room_name = get_contact_full_name(room.contact)

            else:
                room.room_name = room.channel_name
                if room.type != "Guest":                
                    last_message_info = get_last_message_info(user_email , room.room)
                    room.last_message = last_message_info.content
                    room.sender_email = last_message_info.sender_email
                    room.last_message_type = last_message_info.message_type
            
            if room.is_removed == 1:
                last_message_info = get_last_message_info(user_email , room.room , room.remove_date)
                room.last_message = last_message_info.content
                room.sender_email = last_message_info.sender_email
                room.last_message_type = last_message_info.message_type
                room.send_date = room.remove_date
            
            room.utc_message_date = room.send_date
            room.send_date = convert_utc_to_user_timezone(room.send_date, get_user_timezone(user_email)["results"][0]["time_zone"])
            room.last_message_media_type , room.last_message_voice_duration = get_last_message_type(room.type, user_email, room.room if room.type != "Contributor" else room.parent_channel, room.remove_date)
            room.avatar_url = frappe.db.get_value("ClefinCode Chat Channel" , room.room , "channel_image")

            chat_topic = frappe.get_all("ClefinCode Chat Topic" , "name" , {"chat_channel":room.parent_channel if room.type == "Contributor" else room.room , "topic_status" : "Open"})
            room.chat_topic = chat_topic[0].name if chat_topic else None
                       
    
    return {"results" : sorted(results, key=lambda d: d["send_date"], reverse=True) , "num_of_results" : len(results) }
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
    
    return last_sub_channel_message[0]
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
# ==========================================================================================
#############################################################################################
######################################## Messages ###########################################
#############################################################################################
@frappe.whitelist()
def send(content, user, room , email, send_date , is_first_message = 0, attachment = None , sub_channel = None , is_link = None , is_media = None , is_document = None, is_voice_clip = None , file_id = None , message_type = "" , message_template_type= "", only_receive_by = None , id_message_local_from_app = None, chat_topic = None, is_screenshot = 0):
    try:
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
            new_message.save(ignore_permissions = True)

        if attachment: set_attach_message(attachment, new_message.name)

        share_everyone = 0
        if chat_topic:
            is_private = frappe.db.get_value("ClefinCode Chat Topic" , chat_topic , "is_private")
            if is_private == 0:
                share_everyone = 1
                share_doctype("ClefinCode Chat Message", new_message.name, everyone = share_everyone)
        
        channel_doc = frappe.get_doc("ClefinCode Chat Channel" , room)    
        
        if channel_doc.type == "Group":
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

        if user != "Guest":
            for member in channel_doc.members:
                if member.user == email:
                    if channel_doc.type == "Group":
                        member.channel_last_message_number = channel_doc.last_message_number
                    member.last_message_read = channel_doc.last_message_number 
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
            "is_voice_clip" : is_voice_clip,
            "message_type" : message_type,
            "message_template_type": message_template_type,
            "avatar_url": channel_doc.channel_image,
            "utc_message_date" : send_date # return utc for mobile app
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
                frappe.publish_realtime(event=room, message=results , room = f"{frappe.local.site}:user:Guest")
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
                    # frappe.publish_realtime(event="receive_message", message=results, user= member.user) # listner in mobile app
                    frappe.publish_realtime(event="msg", message=results, user= member.user) # listner in full page chat
                    send_notification(member.user , results, "send_message", room_name if channel_doc.type == "Group" else get_contact_full_name(email), message_template_type)                       
            
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
        
        return  {"results" : [{"new_message_name" : new_message.name}]}
    except Exception as e:
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
    SELECT content , send_date , sender_email , sender , name AS message_name , is_media , is_document , is_voice_clip , file_id  , message_type, message_template_type , only_receive_by
    FROM `tabClefinCode Chat Message`
    WHERE {condition} AND (only_receive_by IS NULL OR only_receive_by = '')

    UNION

    SELECT content , send_date , sender_email , sender , name AS message_name , is_media , is_document , is_voice_clip , file_id  , message_type, message_template_type , only_receive_by
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
    SELECT content , send_date , sender_email , sender , name AS message_name , is_media , is_document , is_voice_clip , file_id  , message_type, message_template_type , only_receive_by
    FROM `tabClefinCode Chat Message`
    WHERE {condition} AND (only_receive_by IS NULL OR only_receive_by = '')

    UNION

    SELECT content , send_date , sender_email , sender , name AS message_name , is_media , is_document , is_voice_clip , file_id  , message_type, message_template_type , only_receive_by
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
def get_latest_channels_updates(user_email , last_message_date):
    """This API provides a solution for iOS devices to view new messages through notifications while using another app."""    

    results = frappe.db.sql(f"""
    SELECT
    ChatChannel.name AS room,
    NULL AS parent_channel,
    NULL AS contact ,
    ChatChannel.modified_date AS send_date,
    last_message,
    last_message_number - ChatChannelUser.last_message_read AS user_unread_messages,
    channel_name,
    type,
    NULL AS is_removed,
    NULL AS remove_date

    FROM `tabClefinCode Chat Channel` AS ChatChannel 
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser  ON ChatChannelUser.parent = ChatChannel.name AND ChatChannelUser.user = '{user_email}'
    WHERE type = 'Guest' AND ChatChannel.modified_date > '{last_message_date}'
    
    UNION ALL
                            
    SELECT 
    DISTINCT ChatChannel.name AS room,
    NULL AS parent_channel,
    NULL AS contact ,
    ChatChannel.modified_date AS send_date ,
    last_message,
    ChatChannelUser.channel_last_message_number - ChatChannelUser.last_message_read AS user_unread_messages,
    channel_name,
    type,
    ChatChannelUser.is_removed AS is_removed,
    ChatChannelUser.remove_date

    FROM `tabClefinCode Chat Channel` AS ChatChannel 
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser  ON ChatChannelUser.parent = ChatChannel.name AND ChatChannelUser.user = '{user_email}'
    WHERE type = 'Group' AND ChatChannelUser.platform = "Chat" AND ChatChannel.modified_date > '{last_message_date}'

    UNION ALL

    SELECT 
    ChatChannel.name AS room,
    NULL AS parent_channel,
    ChatChannelUser2.user AS contact ,
    ChatChannel.modified_date AS send_date,
    last_message,
    last_message_number - ChatChannelUser.last_message_read AS user_unread_messages,
    channel_name,
    type,
    NULL AS is_removed,
    NULL AS remove_date

    FROM `tabClefinCode Chat Channel` AS ChatChannel
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser  ON ChatChannelUser.parent = ChatChannel.name AND ChatChannelUser.user = '{user_email}'
    INNER JOIN `tabClefinCode Chat Channel User` AS ChatChannelUser2  ON ChatChannelUser2.parent = ChatChannel.name AND ChatChannelUser2.user <> '{user_email}'
    AND type = 'Direct' AND is_parent = 1 AND ChatChannel.modified_date > '{last_message_date}'
    

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

    FROM `tabClefinCode Chat Channel` AS ChatChannel  INNER JOIN `tabClefinCode Chat Channel Contributor` AS ChatChannelContributor On
    ChatChannelContributor.parent = ChatChannel.name
    AND is_parent = 1 AND ChatChannelContributor.user = '{user_email}'AND ChatChannel.modified_date > '{last_message_date}'
    GROUP BY ChatChannelContributor.user , ChatChannel.name 
        
    """ , as_dict = True)
    if results:
        for room in results:
            if not room.channel_name or room.channel_name == "":
                if room.type == "Direct":
                    room.room_name = get_contact_full_name(room.contact)
                    last_message_info = frappe.db.sql(f""" SELECT sender_email,  message_type FROM `tabClefinCode Chat Message` WHERE chat_channel = '{room.room}' ORDER BY send_date DESC LIMIT 1""" , as_dict = True)[0]
                    room.sender_email = last_message_info.sender_email
                    room.last_message_type = last_message_info.message_type
                elif room.type == "Contributor":
                    room.room_name = "@" + frappe.get_doc("ClefinCode Chat Channel" , room.parent_channel).get_channel_name_for_contributor()
                    last_message_info = get_last_sub_channel_for_user(room.parent_channel , user_email)
                    room.sender_email = last_message_info.sender_email
                    room.last_message_type = last_message_info.message_type
                    room.last_message = last_message_info.content if last_message_info.content else ""
                    room.send_date = get_last_sub_channel_for_user(room.parent_channel , user_email).send_date
                    room.user_unread_messages = contributor_unread_messages(user_email , room.parent_channel)
                elif room.type == "Group":
                    room.room_name = frappe.get_doc("ClefinCode Chat Channel" , room.room).get_group_name()
                    last_message_info = get_last_message_info(user_email , room.room)
                    room.last_message = last_message_info.content
                    room.sender_email = last_message_info.sender_email
                    room.last_message_type = last_message_info.message_type

                else:
                    room.room_name = get_contact_full_name(room.contact)

            else:
                room.room_name = room.channel_name
                if room.type != "Guest":                
                    last_message_info = get_last_message_info(user_email , room.room)
                    room.last_message = last_message_info.content
                    room.sender_email = last_message_info.sender_email
                    room.last_message_type = last_message_info.message_type
            
            if room.is_removed == 1:
                last_message_info = get_last_message_info(user_email , room.room , room.remove_date)
                room.last_message = last_message_info.content
                room.sender_email = last_message_info.sender_email
                room.last_message_type = last_message_info.message_type
                room.send_date = room.remove_date
            
            room.utc_message_date = room.send_date
            room.send_date = convert_utc_to_user_timezone(room.send_date, get_user_timezone(user_email)["results"][0]["time_zone"])
            # room.last_message_media_type , room.last_message_voice_duration = get_last_message_type(room.type, user_email, room.room if room.type != "Contributor" else room.parent_channel, room.remove_date)

            chat_topic = frappe.get_all("ClefinCode Chat Topic" , "name" , {"chat_channel":room.parent_channel if room.type == "Contributor" else room.room , "topic_status" : "Open"})
            room.chat_topic = chat_topic[0].name if chat_topic else None
                       
    
    return {"results" : sorted(results, key=lambda d: d["send_date"], reverse=True)}
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
    for member in members:
        results["room_type"] = "Contributor"
        results["send_date"] = convert_utc_to_user_timezone(mention_message_doc.send_date, get_user_timezone(member)["results"][0]["time_zone"])
        results["time_zone"] = get_user_timezone(member)["results"][0]["time_zone"]
        results["target_user"] = member
        # frappe.publish_realtime(event= "receive_message", message=results, user=member)
        send_notification(member , results, "update_sub_channel_for_last_message") 
          
# ==========================================================================================
def get_last_message_info(user_email , channel , remove_date = None):
    condition = ""
    if remove_date:
        condition = f" send_date <= '{remove_date}' AND "
    return frappe.db.sql(f"""
    SELECT content , send_date , message_type, sender_email
    FROM `tabClefinCode Chat Message`
    WHERE {condition} chat_channel = '{channel}' 
    AND (only_receive_by IS NULL OR only_receive_by = '')
     

    UNION

    SELECT content , send_date , message_type, sender_email
    FROM `tabClefinCode Chat Message`
    WHERE {condition} chat_channel = '{channel}' 
    AND only_receive_by = '{user_email}'
    

    ORDER BY send_date DESC 
    LIMIT 1
    """ , as_dict = True)[0]
# ==========================================================================================
@frappe.whitelist()
def get_last_message_type(room_type, user_email , channel, remove_date = None):
    last_message = None
    if room_type == "Contributor":
        last_message = get_last_sub_channel_for_user(channel , user_email).name
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
        
    chat_message = frappe.get_doc("ClefinCode Chat Message", last_message)
    if not chat_message.file_type or chat_message.file_type == '':
        return "text" , None
    elif chat_message.file_type == 'audio' and chat_message.is_voice_clip:
        duration = calculate_voice_clip_duration(chat_message.file_id)
        return "voice clip", duration["results"][0]["duration"]
    return chat_message.file_type, None
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
            parent.append('members', {"profile_id": member["profile_id"], 'user': member["email"] , "platform" : member["platform"] ,"channel_last_message_number" : parent.last_message_number ,"last_message_read" : parent.last_message_number})
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
def remove_group_member(email,room , last_active_sub_channel = None):
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
    elif ext in ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt']:
        return 'document'
    else:
        return mime_type.split('/')[0] if mime_type else ""
# ==========================================================================================
@frappe.whitelist()
def save_voice_clip(data , filename , platform=None):
    # Decode the base64 content
    audio_bytes=None
    if platform:
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
    SELECT DISTINCT ChatProfile.name AS profile_id , ChatProfile.full_name , Contact.user AS user_id, User.enabled
    FROM `tabClefinCode Chat Profile` AS ChatProfile INNER JOIN `tabClefinCode Chat Profile Contact Details` AS ContactDetails 
        ON ContactDetails.parent = ChatProfile.name
    INNER JOIN `tabContact` AS Contact
        ON Contact.name = ChatProfile.contact
    LEFT OUTER JOIN `tabUser` AS User
        ON User.name = Contact.user                     
    WHERE (User.enabled = 1 OR User.enabled IS NULL) AND ContactDetails.type IN ("Chat", "Email")
    AND ContactDetails.contact_info <> %s
    ORDER BY Contact.user DESC
    """ , (user_email) , as_dict = True)
    for contact in contacts_list:
        contact.contact_details = frappe.db.sql(f"""
        SELECT contact_info , type AS contact_type, `default`
        FROM `tabClefinCode Chat Profile Contact Details`
        WHERE parent = %s AND type IN ("Chat", "Email")
        """  , (contact.profile_id) , as_dict = True)
    return {"results": [{"contacts" : contacts_list}]}
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
        WHERE parent = %s AND type = "Chat"
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
# ==========================================================================================
def get_profile_id(user_email):
    user_profile = frappe.db.sql(f"""
    SELECT DISTINCT parent 
    FROM `tabClefinCode Chat Profile Contact Details` AS ContactDetails INNER JOIN `tabClefinCode Chat Profile` AS ERPNextChatProfile 
    ON ERPNextChatProfile.name = ContactDetails.parent AND ERPNextChatProfile.is_support <> 1
    WHERE contact_info = '{user_email}'
    """ , as_dict = True)
    if user_profile:
        return user_profile[0].parent
# ==========================================================================================
@frappe.whitelist()
def get_profile_full_name(user_email):
    full_name = frappe.db.sql(f"""
    SELECT DISTINCT ERPNextChatProfile.full_name
    FROM `tabClefinCode Chat Profile` AS ERPNextChatProfile , `tabClefinCode Chat Profile Contact Details` AS ContactDetails
    WHERE ERPNextChatProfile.name = ContactDetails.parent AND ERPNextChatProfile.is_support <> 1 AND ContactDetails.contact_info = '{user_email}'
    """ , as_dict = True)
    if full_name:
        return full_name[0].full_name
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
def get_last_active(contact_email, user_email):
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
                

    return room_list 
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
######################################## Helper Functions ###################################
#############################################################################################
@frappe.whitelist()
def check_if_contact_has_chat(user_email , contact , platform):
    res = [{}]
    results = frappe.db.sql(f"""
    SELECT ChatChannel.name
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
def convert_utc_to_user_timezone(utc_time, user_timezone , formatted = None):
    # Convert naive datetime to aware datetime in UTC
    utc_time = pytz.utc.localize(utc_time)

    # Define user timezone    
    user_tz = pytz.timezone(user_timezone)
    
    # Convert to user timezone
    user_time = utc_time.astimezone(user_tz)
    
    if formatted:
    # Format the time in the desired format
        user_time = user_time.strftime("%I:%M %p")

    return user_time
# ========================================================================================== 
@frappe.whitelist()   
def get_time_now(user_email, formatted = None):
    return convert_utc_to_user_timezone(datetime.datetime.utcnow() , get_user_timezone(user_email)["results"][0]["time_zone"] , formatted)
# ==========================================================================================
def sync_with_chat_profile(doc , method):    
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
def get_names_for_mentions(search_term):
    if ":" in search_term:
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
        users_for_mentions = get_users_for_mentions()

        filtered_mentions = []
        for mention_data in users_for_mentions:
            if search_term.lower() not in mention_data.value.lower():
                continue

            filtered_mentions.append(mention_data)
        return sorted(filtered_mentions, key=lambda d: d["value"])
# ==========================================================================================
def get_users_for_mentions():
    excepted_users_list = []
    excepted_users_list.append("Administrator")
    excepted_users_list.append("Guest")
    
    return frappe.get_all(
        "User",
        fields=["name as id", "full_name as value" , "full_name as name"],
        filters={
            "name": ["not in", excepted_users_list],
            "allowed_in_mentions": True,
            "user_type": "System User",
            "enabled": True,
        },
    )
# ==========================================================================================
@frappe.whitelist()
def set_typing(user, room, is_typing, last_active_sub_channel = None, mobile_app = None):
    parent_channel_doc = frappe.get_doc("ClefinCode Chat Channel" , room)
    first_name = get_contact_first_name(user)
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
    
    if parent_channel_doc.contributors:
        for contributor in parent_channel_doc.contributors:
            if contributor.active == 1 and contributor.platform == "Chat":
                results["room"] = last_active_sub_channel
                results["parent_channel"] = room
                frappe.publish_realtime(event= last_active_sub_channel, message=results , user= contributor.user)
                send_notification(contributor.user , results, "typing")
                frappe.publish_realtime(event= "typing-portal", message=results, user= contributor.user)
                # frappe.publish_realtime(event="receive_message", message=results, user= contributor.user)
# ==========================================================================================
def send_notification(to_user , results, realtime_type, title = None, message_template_type = None):
    try: 
        if check_notifications_status():       
            if to_user:
                registration_token = get_registration_token(to_user)   
                if registration_token:
                    user_platform = get_platform(to_user)
                    body = None
                    if realtime_type != 'typing':
                        if to_user == frappe.session.user:
                            push_notifications(registration_token, results, realtime_type, user_platform, None, None, 1)
                            return                
                        if realtime_type == "send_message": 
                            body = get_body_message(results)
                        else:
                            body = get_body_message_information(realtime_type)
                        push_notifications(registration_token, results, realtime_type, user_platform, title, body)                       
                    else:
                        push_notifications(registration_token, results, realtime_type, user_platform)                                              
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
def push_notifications(registration_token, information, realtime_type, platform = None ,title = None, body = None, same_user = None):
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

            send_notification_via_firebase(registration_token, info, realtime_type, platform, title, body, same_user)            

    except Exception as e:
        frappe.publish_realtime("console" , message = str(e))
# ============================================================================
def convert_to_string_values(data):
    return {key: str(value) for key, value in data.items()}
# ============================================================================