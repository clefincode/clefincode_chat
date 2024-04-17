import frappe
import requests

def after_migrate():
    try:
        print("Requesting Firebase Server Key ...")
        response = requests.get("https://clefincode.com/api/method/clefincode_support.api.mobile_notifications.request_firebase_server_key")
        
        if response.status_code == 200:
            data = response.json()
            firebase_server_key = data.get('message', {}).get('firebase_server_key')
            
            if firebase_server_key:
                doc = frappe.get_doc('ClefinCode Chat Settings')
                doc.firebase_server_key = firebase_server_key
                doc.save(ignore_permissions = True)
                frappe.db.commit()
                print("Firebase Server Key updated in ClefinCode Chat Settings")
            else:
                print("Server key not found in response.")
        else:
            print(f"Failed to get data: {response.status_code}")
    except Exception as e:
        print(f"An error occurred: {e}")