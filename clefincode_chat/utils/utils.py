import frappe
from frappe.utils import now_datetime
from datetime import timedelta

@frappe.whitelist()
def choose_user_to_respond(doctype, docname = None):
    user, rule, role = None, None, None
    if doctype == "ClefinCode Chat Settings":
        rule  = frappe.db.get_single_value(doctype, "rule")   
        role  = frappe.db.get_single_value(doctype, "role") 
        last_user = frappe.db.get_single_value(doctype, "last_user")
    
    elif doctype == "ClefinCode WhatsApp Profile":
        rule  = frappe.db.get_value(doctype, docname, "rule")   
        role  = frappe.db.get_value(doctype, docname, "role")  
        last_user = frappe.db.get_value(doctype, docname, "last_user")
    
    if rule == "Round Robin":
        user = get_user_round_robin(last_user, doctype, role)        
    elif rule == "Load Balancing":
        user = get_user_load_balancing(doctype, role)
    else: return
    return user
# ============================================================================
def get_user_round_robin(last_user, doctype, role):
    """
    Get next user based on round robin
    """
    users = frappe.db.get_all("Has Role", {"role": role , "parenttype": "User"}, "parent")
    
    # first time, pick the first
    if not users: return

    if not last_user:
        user_doc = frappe.get_doc("User", users[0].parent)		
        return user_doc.name

    # find out the next online user in the list
    
    userslist, offlineusers = [], []
    for user in users:
        user_doc = frappe.get_doc("User", user.parent)
        if not user_doc.enabled: continue
        offlineusers.append(user_doc.name)
        
        if check_last_active(user_doc):
            userslist.append(user_doc.name)
    
    # if there is no active user at least then assign the channel to an offline user
    if not userslist:
        userslist = offlineusers

    if not last_user in userslist:
        # Add element to list, sort list
        userslist.append(last_user)
    
    userslist.sort()
    index = userslist.index(last_user)

    if index < len(userslist) - 1:
        return userslist[index + 1]
    else:
        return userslist[0]

    # bad last user, assign to the first one
    return userslist[0]
# ============================================================================
def get_user_load_balancing(doctype, role):
    """Assign to the user with least number of open assignments"""
    users = frappe.db.get_all("Has Role", {"role": role, "parenttype": "User"}, "parent")
    userslist, offlineusers = [], []
    for user in users:
        user_doc = frappe.get_doc("User", user.parent)
        if not user_doc.enabled: continue
        offlineusers.append(user_doc.name)

        if check_last_active(user_doc):
            userslist.append(user_doc.name)

    # if there is no active user at least then assign the channel to an offline user
    if not userslist:
        userslist = offlineusers

    counts = {}
    for d in userslist:
        channels = frappe.db.get_all('ClefinCode Chat Channel User', {'user': d}, 'parent', distinct = True)
        counts[d] = 0
        for channel in channels:
            channel_doc = frappe.get_doc("ClefinCode Chat Channel", channel.parent)
            if channel_doc.chat_status == 'Open':
                counts[d] = counts.get(d, 0) + 1

    # sort by dict value
    sorted_counts = sorted(counts.items(), key=lambda k: k[1])
    if not sorted_counts:
        return
    # pick the first user
    return sorted_counts[0][0]
# ============================================================================
def check_last_active(user_doc):
    last_active = user_doc.get('last_active')

    if last_active:
        now = now_datetime()
        time_diff = now - timedelta(minutes=10)
        # Check if last active is between now and 10 minutes ago
        if time_diff <= last_active <= now:
            return True
        else:
            return False
    else:
        return False
# ============================================================================
def get_access_token():
    doc = frappe.get_doc("ClefinCode WhatsApp Integration")
    access_token = doc.get_password("access_token")
    if not access_token:
        frappe.throw("Access Token doesn't exist")
    return access_token
# ============================================================================
def get_confirm_msg_template(whatsapp_number):
    message_template = frappe.db.get_value("ClefinCode WhatsApp Profile" , whatsapp_number, "message_template")
    if not message_template:
        return None
    
    return message_template
# ============================================================================
def get_meta_template_name(message_template):
    meta_template_name = frappe.db.get_value("ClefinCode WhatsApp Template" , message_template, "meta_template_name")
    return meta_template_name
# ============================================================================
def get_msg_template_content(message_template):
    content = frappe.db.get_value("ClefinCode WhatsApp Template" , message_template, "body")
    return content
# ============================================================================
def check_template_status(message_template):
    template_status = frappe.db.get_value("ClefinCode WhatsApp Template" , message_template, "template_status")
    if not template_status or template_status == "REJECTED":
        return False
    
    return True