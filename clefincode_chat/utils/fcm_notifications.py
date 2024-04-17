import frappe
from pyfcm import FCMNotification
from bs4 import BeautifulSoup

@frappe.whitelist(allow_guest = True)
def send_notification_via_firebase(registration_token, info, realtime_type, platform = None ,title = None, body = None, same_user = None): 
    firebase_server_key = frappe.db.get_single_value("ClefinCode Chat Settings" , "firebase_server_key")
    if not firebase_server_key:
        return
    push_service = FCMNotification(api_key=firebase_server_key)
    if realtime_type in ["typing", "update_sub_channel_for_last_message"] or same_user == 1:        
        try:
            push_service.notify_single_device(
                registration_id= registration_token,
                message_title= None,
                message_body=None,
                data_message= {"route" : str(info) , "realtime_type" : realtime_type, "content_available": True, "same_user" : same_user},
                content_available=True
            )
        except Exception as e:
            frappe.log_error(f"Error in sending notifications: {str(e)}")   
    else:  
        if platform == "ios":
            try:
                if info and info.get("is_voice_clip") == "1":
                    soup = BeautifulSoup(info["content"], 'html.parser')
                    voice_clip_containers = soup.find_all('div', class_='voice-clip-container')
                    for container in voice_clip_containers:
                        for child in container.find_all('button', recursive=False):
                            child.decompose()
                    info["content"] = str(soup)
                
                push_service.notify_single_device(
                    registration_id= registration_token,
                    message_title= None,
                    message_body=None,
                    data_message= {"route" : str(info) , "realtime_type" : realtime_type, "notification_title" : title ,"notification_body": body, "no_duplicate" : "true", "content_available": True, "same_user" : same_user},
                    content_available=True
                )

                push_service.notify_single_device(
                    registration_id= registration_token,
                    message_title= title,
                    message_body=body,
                    data_message= {"route" : str(info) , "realtime_type" : realtime_type, "notification_title" : title ,"notification_body": body, "same_user" : same_user},
                    sound = "default"
                )

                
            except Exception as e:
                frappe.log_error(f"Error in sending notifications: {str(e)}")
        else:            
            try:
                push_service.notify_single_device(
                    registration_id= registration_token,
                    data_message= {"route" : str(info) , "realtime_type" : realtime_type, "notification_title" : title ,"notification_body": body},
                )
            except Exception as e:
                frappe.log_error(f"Error in sending notifications: {str(e)}")

# # ============================================================================

