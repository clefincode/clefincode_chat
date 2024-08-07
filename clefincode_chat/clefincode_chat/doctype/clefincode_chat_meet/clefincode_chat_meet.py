# Copyright (c) 2024, ClefinCode L.L.C-FZ and contributors
# For license information, please see license.txt

# import frappe
from frappe.model.document import Document

class ClefinCodeChatMeet(Document):
	def get_members(self):
		members = []
		if self.members:
			for member in self.members:
				members.append(member.user)
			return members
		return []