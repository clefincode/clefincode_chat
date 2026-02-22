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
		
		if self.channel_name:
			lines.append(self.channel_name)
		# join with newlines (or commas, or however you like)
		self.channel_info = " ".join(lines)
  
  
	# def on_change(self):
			#frappe.msgprint("fsdfsdf")
			#نفّذ فقط لو الحقل unread_messages تغيّر فعلاً
			# if not self.has_value_changed("unread_messages"):
			# 	frappe.msgprint("fsdfsdf")
			# 	return

			# حاول نجيب profile id من السجل نفسه أولاً
			# profile_name = getattr(self, "profile_id", None)
			# frappe.msgprint(profile_name)
			# # لو ما كان موجود، جرّب تجيب من الدوكتايب الأب (لو السجل child row)
			# if not profile_name and getattr(self, "parenttype", None) and getattr(self, "parent", None):
			# 	try:
			# 		channel_doc = frappe.get_doc("ClefinCode Chat Channel", self.parent)
			# 		channel_members = [m.user for m in getattr(channel_doc, "members", [])]
			# 		bot_user_emails = []
			# 		for m in channel_members:
			# 			profile_id = getattr(m, "profile_id", None) or getattr(m, "profile", None)
			# 			user_email = getattr(m, "user", None) or getattr(m, "email", None)
			# 			if not profile_id:
			# 				continue
			# 			try:
			# 				prof = frappe.get_doc("ClefinCode Chat Profile", profile_id)
			# 			except Exception:
			# 					# إذا ما قدرنا نجيب البروفايل تجاهل هذا العضو
			# 				continue
						
			# 			if getattr(prof, "is_ai_bot", False):
			# 				if user_email:
			# 					bot_user_emails.append(user_email)					# لو لسا ما عندنا agent_profile_key، حاول ناخذ الحقل ai_agent_profile من ClefinCode Chat Profile
	
			# 		if not bot_user_emails:
			# 			return
			# # هل المرسل بوت؟ (نستخدم sender_email أو sender كfallback)
			# 		sender_email = getattr(self, "user", None) 
			# 		is_sender_bot = sender_email in bot_user_emails

			# # لا نريد أن نعالج رسائل الصادرة من البوت هنا (لتفادي حلقات)
			# 		if is_sender_bot:
			# 			return
								

			# 	except Exception:
			# 		profile_name = None


			
			# 	output ="asasasasa"
			# 	# 1) طباعة كـ popup للمستخدم (لو تبي يظهر في واجهة المستخدم)
			# 	try:
			# 		frappe.msgprint(output)
			# 	except Exception:
			# 		# لو الوضع headless أو ما نريد popup، نلوج بدلها
			# 		pass

			# 	# 2) سجل في error log/server log (مفيد للتتبع في الخلفية)
			# 	frappe.log_error(json.dumps(output, ensure_ascii=False, indent=2), title="ClefinCodeChatChannelUser.unread_messages")
