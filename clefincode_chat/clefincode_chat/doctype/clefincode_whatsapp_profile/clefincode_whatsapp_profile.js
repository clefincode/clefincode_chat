// Copyright (c) 2024, ClefinCode L.L.C-FZ and contributors
// For license information, please see license.txt

frappe.ui.form.on('ClefinCode WhatsApp Profile', {
	refresh: function(frm){
        frm.fields_dict['message_template'].get_query = function(doc) {
            return {
                filters:[{
                    "whatsapp_profile": doc.name
                    }                    
                ]
            }
        }
    }
});
