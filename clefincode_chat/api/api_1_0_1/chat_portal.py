import frappe
import datetime
from clefincode_chat.clefincode_chat.doctype.clefincode_chat_settings.clefincode_chat_settings import get_user_round_robin, get_user_load_balancing
from clefincode_chat.api.api_1_0_1.api import get_profile_id , convert_utc_to_user_timezone , get_user_timezone , send_notification, share_doctype, get_contact_full_name

@frappe.whitelist(allow_guest = True)
def create_guest_profile_and_channel(content , sender , sender_email , creation_date):    
    creation_date = datetime.datetime.utcnow()
    profile = frappe.get_doc({
        "doctype": "ClefinCode Chat Profile",
        "is_guest" : 1,
    }).insert(ignore_permissions = True)

    respondent_user = choose_user_to_respond()    

    new_channel = frappe.get_doc({
        "doctype": "ClefinCode Chat Channel",
        "chat_profile": profile.name,
        "channel_name": profile.name,
        "platform": "ERPNext Chat",
        "type": "Guest",
        "is_parent" : 1,
        "creation_date": creation_date,
        "modified_date": creation_date,
        "last_message" : content,
        "members" : [{'doctype': 'ClefinCode Chat Channel User', 'profile_id': get_profile_id(respondent_user) , 'user': respondent_user , 'platform': 'Chat'}]
        }).insert(ignore_permissions = True)

    frappe.db.set_single_value("ClefinCode Chat Settings", "last_user", respondent_user) 

    send(content , new_channel.name , sender , sender_email , creation_date , respondent_user) 

    return {"results" : [{"room" : new_channel.name , "token" : profile.token , "respondent_user" : respondent_user}] }
# ==========================================================================================
@frappe.whitelist()
def choose_user_to_respond():
    user = None
    rule  = frappe.db.get_single_value("ClefinCode Chat Settings", "rule")
    last_user = frappe.db.get_single_value("ClefinCode Chat Settings", "last_user")
    if rule == "Round Robin":
        user = get_user_round_robin(last_user)        
    elif rule == "Load Balancing":
        user = get_user_load_balancing()
    else: return
    return user
# ==========================================================================================
@frappe.whitelist(allow_guest=True)
def send(content , room , sender , sender_email , send_date , respondent_user):    
    send_date = datetime.datetime.utcnow()
    new_message = frappe.get_doc({
        "doctype": "ClefinCode Chat Message",
        "content": f"<p>{content}</p>",
        "chat_channel": room,
        "sender_email": sender_email,
        "sender": sender,
        "send_date" : send_date
    }).insert(ignore_permissions=True) 

    results = {
        "content": f"<p>{content}</p>",
        "user": sender,
        "sender_email": sender_email, 
        "message_name" : new_message.name,
        "realtime_type" : "send_message",
        "room" : room,
        "room_name" : frappe.db.get_value("ClefinCode Chat Channel" , room , "channel_name") ,
        "last_message" : content ,
        "room_type" : "Guest",
        "contact_name" : sender ,
        "send_date": convert_utc_to_user_timezone(send_date, get_user_timezone(respondent_user)["results"][0]["time_zone"]),
        "utc_message_date" : send_date, # return utc for mobile app
        "target_user": respondent_user
    }
    
    # update Room
    channel_doc = frappe.get_doc("ClefinCode Chat Channel" , room)
    channel_doc.last_message_number = channel_doc.last_message_number + 1
    channel_doc.last_message = content
    channel_doc.modified_date = send_date
    channel_doc.save(ignore_permissions = True)
    frappe.db.commit()  

    frappe.publish_realtime(event= room , message=results, user = respondent_user)
    frappe.publish_realtime(event= "new_chat_notification", message= results, user = respondent_user)
    frappe.publish_realtime(event= "update_room", message= results, user = respondent_user)
    frappe.publish_realtime(event= "receive_message", message= results, user = respondent_user)
    send_notification(respondent_user, results, "send_message") 
    
# ==========================================================================================
@frappe.whitelist(allow_guest=True)
def get_messages(room):    
    results = frappe.db.sql(f"""
    SELECT content , send_date , sender_email , sender 
    FROM `tabClefinCode Chat Message`
    WHERE chat_channel = '{room}'

    ORDER BY send_date ASC""" , as_dict = True)

    for message in results:
        message.send_date = convert_utc_to_user_timezone(message.send_date, get_user_timezone(get_respondent_user(room))["results"][0]["time_zone"])

    return results
# ==========================================================================================
@frappe.whitelist(allow_guest=True)
def get_respondent_user(room): 
    return frappe.get_doc("ClefinCode Chat Channel" , room).members[0].user
# ==========================================================================================
@frappe.whitelist()
def create_website_support_group(website_user_email, content):
    respondent_user = choose_user_to_respond()
    creation_date = datetime.datetime.utcnow()
    new_channel = frappe.get_doc({
        'doctype': 'ClefinCode Chat Channel',
        'type': "Group",
        'channel_creator' : respondent_user,
        'channel_name': f"{get_contact_full_name(website_user_email)} Support",
        'is_parent' : 1,
        "is_website_support_group": 1,
        'creation_date' : creation_date,
        'modified_date': creation_date
    })
    new_channel.append("members" , {"profile_id" : get_profile_id(respondent_user) , "user" : respondent_user , "platform" : "Chat" ,"unread_messages" : 1 , "is_admin" : 1})
    new_channel.append("members" , {"profile_id" : get_profile_id(website_user_email) , "user" : website_user_email , "platform" : "Chat" ,"unread_messages" : 0 , "is_admin" : 0})     
    new_channel.insert(ignore_permissions=True)
    new_channel.save(ignore_permissions=True)

    share_doctype("ClefinCode Chat Channel", new_channel.name, respondent_user)
    share_doctype("ClefinCode Chat Channel", new_channel.name, website_user_email) 

    frappe.db.commit()

    frappe.db.set_single_value("ClefinCode Chat Settings", "last_user", respondent_user) 

    return {"results" : [{"room" : new_channel.name   , "room_name" : new_channel.get_group_name(), "respondent_user" : respondent_user}]}
# ==========================================================================================
@frappe.whitelist()
def check_if_website_user_has_support_channel(website_user_email):
    support_channel = frappe.db.sql(f"""
    SELECT channel.name
    FROM `tabClefinCode Chat Channel` AS channel INNER JOIN `tabClefinCode Chat Channel User` user
        ON channel.name = user.parent AND user.user = '{website_user_email}' AND channel.is_website_support_group = 1    
    """ , as_dict = True)
    
    if support_channel: return support_channel[0].name
# ==========================================================================================