# Copyright (c) 2023, ClefinCode and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.model.naming import make_autoname

class ClefinCodeChatProfile(Document):
    def before_save(self):
        if self.is_guest == 1 or self.is_support == 1:
            self.token = frappe.generate_hash()   
    
    def before_insert(self):
        if self.is_guest == 1:
            self.name = make_autoname("Guest .######")
        elif self.is_support == 1:
            self.name = make_autoname("Support .######")
        else:
            self.name = self.contact