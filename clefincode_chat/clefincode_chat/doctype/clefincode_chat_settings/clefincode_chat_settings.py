# Copyright (c) 2023, ClefinCode and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from frappe.utils import now_datetime
from datetime import timedelta

class ClefinCodeChatSettings(Document):
	pass

def get_user_round_robin(last_user):
	"""
	Get next user based on round robin
	"""
	respondent_user_role = frappe.db.get_single_value("ClefinCode Chat Settings", "role")
	users = frappe.db.get_all("Has Role", {"role": respondent_user_role , "parenttype": "User"}, "parent", order_by = "parent")
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

def get_user_load_balancing():
	"""Assign to the user with least number of open assignments"""
	respondent_user_role = frappe.db.get_single_value("ClefinCode Chat Settings", "role")
	users = frappe.db.get_all("Has Role", {"role": respondent_user_role}, "parent", order_by = "parent")
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