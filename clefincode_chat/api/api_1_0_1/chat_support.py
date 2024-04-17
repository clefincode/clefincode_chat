import frappe
from clefincode_chat.api.api_1_0_1.api import get_profile_id


@frappe.whitelist()
def set_support_token(user_email, token):
    profile_id = get_profile_id(user_email)
    frappe.db.set_value("ClefinCode Chat Profile" , profile_id, "support_token" , token)
    frappe.db.commit()
    
    return {"results" : [{"status": "done"}]} 
# ==========================================================================================
@frappe.whitelist()
def set_support_channel(user_email, chat_channel = None):
    profile_id = get_profile_id(user_email)
    frappe.db.set_value("ClefinCode Chat Profile" , profile_id, "support_channel" , chat_channel)
    frappe.db.commit()
    
    return {"results" : [{"status": "done"}]} 
# ==========================================================================================
@frappe.whitelist()
def get_support_info(user_email):
    profile_id = get_profile_id(user_email)
    token = frappe.db.get_value("ClefinCode Chat Profile" , profile_id, "support_token")
    chat_channel = frappe.db.get_value("ClefinCode Chat Profile" , profile_id, "support_channel")
    
    return {"results" : [{"token": token, "chat_channel": chat_channel}]} 
# ==========================================================================================
@frappe.whitelist()
def get_user_info_for_support_chat(chat_channel):
    profile_id = frappe.db.get_value("ClefinCode Chat Channel" , chat_channel, "chat_profile")
    user_email = frappe.db.get_value("ClefinCode Chat Profile Contact Details", {"parent" : profile_id , "type" : "Chat"}, "contact_info")
    domain = frappe.db.get_value("ClefinCode Chat Profile" , profile_id, "domain")

    return {"results" : [{"user_email": user_email, "domain": domain}]} 