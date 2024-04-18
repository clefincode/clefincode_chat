import frappe
import subprocess

def after_install(): 
    create_roles()   
    create_users_profiles()
    # Replace installing this package with pyproject.toml
    # install_ffmpeg()
# =================================================================================
def create_roles():
    if not frappe.db.exists("Role", "Chat Support"):
        frappe.get_doc({"doctype": "Role", "role_name": "Chat Support"}).insert()
# =================================================================================
def create_users_profiles():
    users = frappe.db.get_all("User", "name")    
    if users:
        for user in users:
            if user.name not in ["Administrator" , "Guest"]:
                user_contact = frappe.db.get_all("Contact" , {"user" : user.name} , "name")
                if user_contact and not frappe.db.exists("ClefinCode Chat Profile" , user_contact[0].name):
                    first_name = frappe.db.get_value("User" , user.name , "first_name")
                    middle_name = frappe.db.get_value("User" , user.name , "middle_name")
                    last_name = frappe.db.get_value("User" , user.name , "last_name")

                    full_name = (first_name if first_name else "") + \
                                (" " + middle_name if middle_name else "") + \
                                (" " + last_name if last_name else "")
                    
                                
                    contact_details_list = [{
                        "contact_info" : user.name,
                        "type" : "Chat",
                        "default" : 1,
                        "verified": 1
                    },
                    {
                        "contact_info" : user.name,
                        "type" : "Email",
                        "default" : 0,
                        "verified": 1
                    }]                
                    
                    frappe.get_doc({
                    "doctype" : "ClefinCode Chat Profile" ,
                    "contact" : user_contact[0].name,
                    "full_name" : full_name ,
                    "contact_details" : contact_details_list
                    }).insert(ignore_permissions=True)    
    
    
    contacts = frappe.db.get_all("Contact", "name")    
    if contacts:
        for contact in contacts:
            if not frappe.db.get_value("Contact" , contact.name, "user") and not frappe.db.exists("ClefinCode Chat Profile" , contact.name):            
                contact_details_list = []
                contact_doc = frappe.get_doc("Contact" , contact.name)
                for email in contact_doc.email_ids:                
                    email_details = frappe.get_doc({
                    "doctype" : "ClefinCode Chat Profile Contact Details" ,
                    "contact_info" : email.email_id,
                    "type" : "Email",
                    "verified" : 1
                    })
                
                    contact_details_list.append(email_details)

                for number in contact_doc.phone_nos:
                    contact_details = frappe.get_doc({
                    "doctype" : "ClefinCode Chat Profile Contact Details" ,
                    "contact_info" : number.phone,
                    "type" : "WhatsApp",
                    "verified" : 1,
                    })

                    contact_details_list.append(contact_details)

                if contact_details_list:
                    full_name = (contact_doc.first_name if contact_doc.first_name else "") + \
                        (" " + contact_doc.middle_name if contact_doc.middle_name else "") + \
                        (" " + contact_doc.last_name if contact_doc.last_name else "")            

                    frappe.get_doc({
                        "doctype" : "ClefinCode Chat Profile" ,
                        "contact" : contact.name,
                        "full_name" : full_name ,
                        "contact_details" : contact_details_list
                        }).insert(ignore_permissions=True)
                
    frappe.db.commit()       
# =================================================================================
def install_ffmpeg():
    try:
        subprocess.run(["sudo", "apt", "update", "--fix-missing" , "-y",], check=True)
        subprocess.run(["sudo", "apt", "install", "ffmpeg", "--fix-missing" , "-y"], check=True)
    except subprocess.CalledProcessError as e:
        print(f"An error occurred: {e}")
# =================================================================================