import json
import traceback

import frappe
import datetime
from clefincode_chat.utils.utils import choose_user_to_respond
from clefincode_chat.api.api_1_2_1.api import get_profile_id , convert_utc_to_user_timezone , get_user_timezone , send_notification, share_doctype, get_contact_full_name
from clefincode_chat.api.api_1_3_3.api import build_reply_preview, get_room_name
from frappe.utils import now_datetime
from bs4 import BeautifulSoup
from packaging import version
frappe_version = frappe.__version__

@frappe.whitelist(allow_guest = True)
def create_guest_profile_and_channel(content , sender , sender_email , creation_date):    
    creation_date = datetime.datetime.utcnow()
    profile = frappe.get_doc({
        "doctype": "ClefinCode Chat Profile",
        "is_guest" : 1,
    }).insert(ignore_permissions = True)

    respondent_user = choose_user_to_respond("ClefinCode Chat Settings")    

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
        "members" : [
            {'doctype': 'ClefinCode Chat Channel User', 
             'profile_id': get_profile_id(respondent_user) , 
             'user': respondent_user ,
             'platform': 'Chat'},
            {
            'doctype': 'ClefinCode Chat Channel User',
            'profile_id': profile.name,  # assuming profile.name is guest profile ID
            'user': '',
            'platform': 'Chat'}
                     ]
        }).insert(ignore_permissions = True)

    frappe.db.set_single_value("ClefinCode Chat Settings", "last_user", respondent_user) 

    send(content , new_channel.name , sender , sender_email , creation_date , respondent_user) 

    return {"results" : [{"room" : new_channel.name , "token" : profile.token , "respondent_user" : respondent_user}] }
# ==========================================================================================
@frappe.whitelist(allow_guest=True)
def send(content , room , sender , sender_email , send_date , respondent_user,reply_to_message_name):    
    send_date = datetime.datetime.utcnow()
    if version.parse(frappe_version) >= version.parse("15.0.0"):
            guest_room_name = "user:Guest"
    else:
            guest_room_name = f"{frappe.local.site}:user:Guest"
    new_message = frappe.get_doc({
        "doctype": "ClefinCode Chat Message",
        "content": f"<p>{content}</p>",
        "chat_channel": room,
        "sender_email": sender_email,
        "sender": sender,
        "send_date" : send_date,
        "reply_to_message":reply_to_message_name,
    }).insert(ignore_permissions=True) 
    if reply_to_message_name:
                try:
                  
                 new_message=  build_reply_preview(new_message, reply_to_message_name)
                  
                except Exception:
                    frappe.log_error(title="Reply Preview Error", message=frappe.get_traceback())
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
        "target_user": respondent_user,
        "reply_to_message":reply_to_message_name,
    }
    if reply_to_message_name :
            results.update({"reply_to_message":reply_to_message_name,
            "reply_preview_type": new_message.reply_preview_type ,
            "reply_preview_file" : new_message.reply_preview_file ,
            "reply_preview_file_url": new_message.reply_preview_file_url ,
            "reply_preview_sender":new_message.reply_preview_sender ,
            "reply_preview_text":new_message.reply_preview_text,})
    # update Room

    channel_doc = frappe.get_doc("ClefinCode Chat Channel" , room)
    channel_doc.last_message_number = channel_doc.last_message_number + 1
    channel_doc.last_message = content
    channel_doc.modified_date = send_date
    channel_doc.save(ignore_permissions = True)
    frappe.db.commit()  
    for member in channel_doc.members:
                   
                    results["room"] = room
                    results["send_date"] = convert_utc_to_user_timezone(send_date, get_user_timezone(member.user)["results"][0]["time_zone"])
                    results["time_zone"] = frappe.db.get_value("User" , member.user , "time_zone")
                    results["target_user"] = member.user  
                    frappe.publish_realtime(event=room, message=results , room = guest_room_name)
                    if member.user:          
                        frappe.publish_realtime(event=room, message=results, user=member.user)       
                        frappe.publish_realtime(event="new_chat_notification", message=results, user= member.user)
                        frappe.publish_realtime(event="update_room", message=results, user= member.user)
                        send_notification(member.user , results, "send_message")
    # frappe.publish_realtime(event= room , message=results)
    # frappe.publish_realtime(event= "new_chat_notification", message= results, user = respondent_user)
    # frappe.publish_realtime(event= "update_room", message= results, user = respondent_user)
    # frappe.publish_realtime(event= "receive_message", message= results, user = respondent_user)
    # send_notification(respondent_user, results, "send_message") 
    return results

# ==========================================================================================
@frappe.whitelist(allow_guest=True)
def get_messages(room):    
    results = frappe.db.sql(f"""
    SELECT content , send_date , sender_email , sender , reply_to_message , is_deleted ,is_edited,reply_preview_type, 
        name AS message_name,
        reply_preview_file, 
        reply_preview_file_url, 
        reply_preview_sender, 
        reply_preview_text,
        reply_preview_sender_email,
        reactions_json 
    FROM `tabClefinCode Chat Message`
    WHERE chat_channel = '{room}'

    ORDER BY send_date ASC""" , as_dict = True)

    for message in results:
        message.send_date = convert_utc_to_user_timezone(message.send_date, get_user_timezone(get_respondent_user(room))["results"][0]["time_zone"])
        if message.is_deleted:
            message.content = None
            message.file_id = None
            message.reply_preview_file = None
            message.reply_preview_file_url = None
            message.reply_preview_text = None
            message.forwarded_from = None
            message.is_media = 0
            message.is_document = 0
            message.is_voice_clip = 0
            message.reply_preview_type = None

    return results
# ==========================================================================================
@frappe.whitelist(allow_guest=True)
def get_respondent_user(room): 
    return frappe.get_doc("ClefinCode Chat Channel" , room).members[0].user
# ==========================================================================================
@frappe.whitelist()
def create_website_support_group(website_user_email, content):
    respondent_user = choose_user_to_respond("ClefinCode Chat Settings")
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
@frappe.whitelist(allow_guest=True)
def delete_guest_chat_message(message_name):


   

    msg = frappe.get_doc("ClefinCode Chat Message", message_name)

    if msg.sender_email != "Guest":
        frappe.throw("Not allowed")

    

    settings = frappe.get_single("ClefinCode Chat Settings")
    max_delete_time = settings.max_delete_time or 0

    if max_delete_time > 0:
        creation_time = msg.creation
        current_time = now_datetime()
        time_diff = (current_time - creation_time).total_seconds()

        if time_diff > (max_delete_time * 60):
            frappe.throw("Deleting time has expired for this message.")


    frappe.get_doc({
        "doctype": "CiC Backup Chat Message",
        "original_content": msg.content,
        "original_message": msg.name,
        "change_type": "Delete"
    }).insert(ignore_permissions=True)

    
    msg.is_deleted = 1
    msg.content = "<p>This message was deleted</p>"
    msg.save(ignore_permissions=True)

    results = {
        "realtime_type": "delete_message",
        "channel_name": msg.chat_channel,
        "message_name": msg.name,
    }

    frappe.publish_realtime(
        event=msg.chat_channel,
        message=results
    )

    last_message = frappe.get_all(
        "ClefinCode Chat Message",
        filters={"chat_channel": msg.chat_channel},
        fields=["name"],
        order_by="creation desc",
        limit=1
    )

    if last_message and last_message[0].name == msg.name:
        frappe.db.set_value(
            "ClefinCode Chat Channel",
            msg.chat_channel,
            "last_message",
            "This message was deleted"
        )

    frappe.db.commit()

    return True

@frappe.whitelist(allow_guest=True)
def add_or_update_reaction(message_name, emoji):
    sender_account = "Guest"
    
    
    if not frappe.db.exists("ClefinCode Chat Message", message_name):
        frappe.throw("Message not found")

    doc = frappe.get_doc("ClefinCode Chat Message", message_name)

 
    try:
        stored_data = json.loads(doc.reactions_json) if doc.reactions_json else []
    except json.JSONDecodeError:
        stored_data = []

 
    if not stored_data:
        stored_data = [{
            "reactions": [],
            "emoji_summary": {
                "total_emojis": 0,
                "emoji_details": {}
            }
        }]

    reactions = stored_data[0].get("reactions", [])

  
    existing_reaction = next(
        (r for r in reactions if r["emoji_sender"] == sender_account),
        None
    )

    if existing_reaction:
        if existing_reaction["emoji"] == emoji:
      
            reactions.remove(existing_reaction)
        else:
        
            existing_reaction["emoji"] = emoji
            existing_reaction["send_date"] = datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    else:
       
        reactions.append({
            "emoji_sender": sender_account,
            "emoji": emoji,
            "send_date": datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
        })

    emoji_count = {}
    for reaction in reactions:
        e = reaction["emoji"]
        emoji_count[e] = emoji_count.get(e, 0) + 1

    emoji_summary = {
        "total_emojis": len(reactions),
        "emoji_details": emoji_count
    }

   
    stored_data[0]["reactions"] = reactions
    stored_data[0]["emoji_summary"] = emoji_summary


    doc.reactions_json = json.dumps(stored_data)

    doc.save(ignore_permissions=True)
    frappe.db.commit()
    
    
    channel = frappe.get_doc("ClefinCode Chat Channel", doc.chat_channel)
    room_name = get_room_name(channel.name,channel.type, sender_email = sender_account)
    results={
            "realtime_type": "reactions_message",
            "channel_name":doc.chat_channel,
            "message_name": message_name,
            "reactions_json":doc.reactions_json,
            "reactions": reactions,
            "emoji_counts": emoji_summary["emoji_details"],
           

        }

    frappe.publish_realtime(
        event=doc.chat_channel,
        message=results
    )
    for member in channel.members:
        results['target_user'] = member.user
        results['emoji'] = emoji
        send_notification(member.user, results, "reactions_message",room_name)

    soup = BeautifulSoup(doc.content, "html.parser")
    clean_content = soup.get_text()

 
    frappe.db.set_value(
            "ClefinCode Chat Channel",
            doc.chat_channel,
            "last_message",
            f"<p>{room_name} Reacted {emoji} to {clean_content[:40]}</p>"
        )
    frappe.db.commit()


    return {
        "status": "success",
        "message": "Reaction updated or added"
    }

@frappe.whitelist(allow_guest=True)
def edit_guest_chat_message(message_name, new_content):
    try:
        msg = frappe.get_doc("ClefinCode Chat Message", message_name)
        channel = frappe.get_doc("ClefinCode Chat Channel", msg.chat_channel)

    
        if channel.type != "Guest" or not (channel.chat_profile or "").startswith("Guest"):
            frappe.throw("Not allowed")

      
       

        original_content = msg.content

        
        settings = frappe.get_single("ClefinCode Chat Settings")
        max_edit_time = settings.max_edit_time or 0

        if max_edit_time > 0:
            creation_time = msg.creation
            current_time = now_datetime()
            time_diff = (current_time - creation_time).total_seconds()
            if time_diff > (max_edit_time * 60):
                frappe.throw("Editing time has expired for this message.")

        if msg.is_edited:
            frappe.throw("This message has already been edited and cannot be edited again.")

        # ✅ Backup
        frappe.get_doc({
            "doctype": "CiC Backup Chat Message",
            "original_content": original_content,
            "original_message": msg.name,
            "change_type": "Edit"
        }).insert(ignore_permissions=True)
        frappe.db.commit()

        # ✅ Save
        msg.content = new_content
        msg.is_edited = 1
        msg.save(ignore_permissions=True)
        frappe.db.commit()

        # ✅ realtime guest_room_name نفس send
        frappe_version = frappe.__version__
        if version.parse(frappe_version) >= version.parse("15.0.0"):
            guest_room_name = "user:Guest"
        else:
            guest_room_name = f"{frappe.local.site}:user:Guest"

        results = {
            "realtime_type": "edit_message",
            "channel_name": msg.chat_channel,
            "room": msg.chat_channel,
            "message_name": message_name,
            "content": new_content,
            "original_content": original_content,
        }

   
        frappe.publish_realtime(
            event=msg.chat_channel,
            message=results,
            room=guest_room_name
        )


        for member in channel.members:
            if member.user:
                results["target_user"] = member.user
                frappe.publish_realtime(event=msg.chat_channel, message=results, user=member.user)

       
        last_message = frappe.get_all(
            "ClefinCode Chat Message",
            filters={"chat_channel": msg.chat_channel},
            fields=["name"],
            order_by="creation desc",
            limit=1
        )
        if last_message and last_message[0].name == msg.name:
            frappe.db.set_value("ClefinCode Chat Channel", msg.chat_channel, "last_message", new_content)
            frappe.db.commit()

        return True

    except Exception:
        frappe.log_error(title="error in edit_guest_chat_message", message=traceback.format_exc())
        frappe.throw("Failed to edit message")