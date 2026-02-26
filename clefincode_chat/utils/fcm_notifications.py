import frappe
import json
import firebase_admin
from firebase_admin import  credentials, messaging
from bs4 import BeautifulSoup

def initialize_firebase():
    firebase_server_key = frappe.db.get_single_value("ClefinCode Chat Settings", "firebase_server_key")
    cleaned_key = firebase_server_key.strip() if firebase_server_key else None

    if not cleaned_key:
        return
    else:
        try:
            firebase_admin.get_app()
        except ValueError:
            cred_dict = json.loads(cleaned_key)
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred)

#====================================================================================================================
@frappe.whitelist(allow_guest = True)
def send_notification_via_firebase(registration_token, info, realtime_type, platform = None ,title = None, body = None, same_user = None ,message_type = None):
    initialize_firebase()    
    message=None
    if realtime_type in ["typing", "update_sub_channel_for_last_message"] or same_user == 1:        
        try:
            message = messaging.Message(
                notification =messaging.Notification(title= None, body= None), 
                data = {"route" : str(info) , "realtime_type" : realtime_type, "content_available": "true", "same_user" : str(same_user)},
                token = registration_token,  
                apns=messaging.APNSConfig(payload=messaging.APNSPayload(aps=messaging.Aps(content_available=True,)))
            ) 
            messaging.send(message)

        except Exception as e:
            frappe.log_error(f"Error in sending notifications: {str(e)}")
    else:  
        if platform == "ios":
            if info and info.get("is_voice_clip") == "1":
                soup = BeautifulSoup(info["content"], 'html.parser')
                voice_clip_containers = soup.find_all('div', class_='voice-clip-container')
                for container in voice_clip_containers:
                    for child in container.find_all('button', recursive=False):
                        child.decompose()
                info["content"] = str(soup)
            
            try:    
                message = messaging.Message(
                    notification=messaging.Notification(title=None, body=None),
                    data={
                        "route": str(info),
                        "realtime_type": realtime_type,
                        "notification_title": title or '',
                        "notification_body": body or '',
                        "content_available": "true",
                        "same_user": str(same_user),
                        "msg_type": message_type or '',
                    },
                    token=registration_token,
                    apns=messaging.APNSConfig(payload=messaging.APNSPayload(aps=messaging.Aps(content_available=True))),
                )
                messaging.send(message)
                message1 = messaging.Message(
                    **({"notification": messaging.Notification(title=title, body=body)} if title or body else {}),
                    data={
                        "route": str(info),
                        "realtime_type": realtime_type,
                        "notification_title": title or '',
                        "notification_body": body or '',
                        "same_user": str(same_user),
                        "content_available": "true",
                        "no_duplicate": "true"
                    },
                    token=registration_token,
                    apns=messaging.APNSConfig(
                        payload=messaging.APNSPayload(
                            aps=messaging.Aps(
                                content_available=True,
                                sound="default" if title or body else None,
                                mutable_content=True if title or body else None,
                                category="REPLY_ACTIONS" if title or body else None
                            )
                        )
                    )
                )
                messaging.send(message1)   
                
            except Exception as e:
                frappe.log_error("IOS Error in sending notifications",f"IOS Error in sending notifications: {str(e)}")
        else:            
            try:                
                message = messaging.Message(
                notification =messaging.Notification(),   
                data = {"msg_type": message_type or '',"route" : str(info) , "realtime_type" : realtime_type , "notification_title" : title or '' ,"notification_body": body or ''},
                token = registration_token,   
                apns=messaging.APNSConfig(payload=messaging.APNSPayload(aps=messaging.Aps(content_available=True, sound="default"))),
                )
                messaging.send(message)

            except Exception as e:
                frappe.log_error("Android Error in sending notifications",f"Android Error in sending notifications: {str(e)}")
# ==================================================================================
@frappe.whitelist(allow_guest = True)
def send_notification_log_via_firebase(registration_token,platform = None , body = None,title = 'Notification from system'):
    initialize_firebase()    
    message=None 
    if platform == "ios":
        try:    
            message1 = messaging.Message(
                **({"notification": messaging.Notification(title=title, body=body)} if title or body else {}),
                token=registration_token,
                apns=messaging.APNSConfig(
                    payload=messaging.APNSPayload(
                        aps=messaging.Aps(
                            content_available=True,
                            sound="default" if title or body else None,
                            mutable_content=True if title or body else None,
                        )
                    )
                )
            )
            response = messaging.send(message1)
            frappe.log_error("FCM SUCCESS RESPONSE", response)
            
        except Exception as e:
            frappe.log_error(f"IOS Error in sending notifications: {str(e)}")
    else:            
        try:                
            message = messaging.Message(
            notification =messaging.Notification(),   
            data = {"notification_title" : title or '' ,"notification_body": body or ''},
            token = registration_token,   
            apns=messaging.APNSConfig(payload=messaging.APNSPayload(aps=messaging.Aps(content_available=True, sound="default"))),
            )
            messaging.send(message)

        except Exception as e:
            frappe.log_error(f"Android Error in sending notifications: {str(e)}")