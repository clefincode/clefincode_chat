# Copyright (c) 2024, Ahmad Kamaleddin and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from clefincode_chat.api.api_1_2_1.api import get_contact_first_name

class ClefinCodeChatChannel(Document):
	def get_group_name(self):
		if self.channel_name and self.channel_name != '':
			return self.channel_name
		else:    
			members_list = []
			results = ""
			members = frappe.db.sql(f"""
			SELECT DISTINCT ChatProfile.full_name
			FROM `tabClefinCode Chat Profile` AS ChatProfile , `tabClefinCode Chat Channel User` AS ChatChannelUser
			WHERE ChatChannelUser.profile_id = ChatProfile.name
			AND ChatChannelUser.parent = '{self.name}'
			AND ChatChannelUser.is_removed <> 1
			ORDER BY ChatProfile.full_name ASC
			""" , as_dict = True)
			for member in members:
				members_list.append(member.full_name.split(' ')[0])
			
			results = ', '.join(f'{name}' for name in members_list)
			if not results:
				return "Inactive Group" 
			return results			
	
	def get_members(self):
		members = []
		if self.members:
			for member in self.members:
				members.append(member.user)
			if self.type == "Guest":
				members.append("Guest")
			return members
		return []

	def get_channel_name_for_contributor(self):
		if self.type == "Group":
			return self.get_group_name()
		elif self.type == "Direct":
			return f"{get_contact_first_name(self.members[0].user)}, {get_contact_first_name(self.members[1].user)}"
		else:
			return ""

	def validate(self):
        # every time you save (insert or update), rebuild channel_info
		self._build_channel_info()
        
	def _build_channel_info(self):
		"""
		Take every row in the 'members' child-table and
		concatenate profile_id, user and contact into
		the longtext field `channel_info`.
		"""
		if not self.members:
			# if no members, clear it or set a default
			self.channel_info = ""
			return

		lines = []
		for row in self.members:
			# row.profile_id, row.user and row.platform come from your child-table fields
			lines.append(f"{row.profile_id} {row.user}")

		lines.append(self.channel_name)
		# join with newlines (or commas, or however you like)
		self.channel_info = " ".join(lines)
