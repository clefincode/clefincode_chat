# Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE

import json
from urllib.parse import quote

import frappe
import frappe.defaults
import frappe.desk.form.meta
import frappe.share
import frappe.utils
from frappe import _, _dict
from frappe.desk.form.document_follow import is_document_followed
from frappe.model.utils import is_virtual_doctype
from frappe.model.utils.user_settings import get_user_settings
from frappe.permissions import get_doc_permissions
from frappe.utils.data import cstr
from clefincode_chat.api.api_1_2_1.api import get_contact_full_name, check_if_user_has_permission_to_file
from frappe import __version__ as frappe_version
from frappe.utils import cint
from packaging import version

if version.parse(frappe.__version__) < version.parse("16.0.0"):
	from frappe.desk.form.load import get_docinfo, get_attachments, get_communications, get_comments, get_versions, get_assignments, get_tags, get_point_logs, get_additional_timeline_content, get_milestones, update_user_info, set_link_titles,run_onload,_get_communications,add_comments,get_document_email
else:
	from frappe.desk.form.load import get_docinfo, get_attachments, get_communications, get_comments, get_versions, get_assignments, get_tags, get_additional_timeline_content, get_milestones, update_user_info, set_link_titles,run_onload,_get_communications,add_comments,get_document_email

	
@frappe.whitelist()
def getdoc(doctype, name, user=None):
	"""
	Loads a doclist for a given document. This method is called directly from the client.
	Requries "doctype", "name" as form variables.
	Will also call the "onload" method on the document.
	"""
	if not (doctype and name):
		raise Exception("doctype and name required!")

	if not name:
		name = doctype

	if not is_virtual_doctype(doctype) and not frappe.db.exists(doctype, name):
		return []

	doc = frappe.get_doc(doctype, name)
	run_onload(doc)
	
	
	has_access = False
	if doctype == "File" and doc.attached_to_doctype == "ClefinCode Chat Message":
		has_access = check_if_user_has_permission_to_file(doc.attached_to_name)

	if not has_access:
		if not doc.has_permission("read"):
			frappe.flags.error_message = _("Insufficient Permission for {0}").format(
				frappe.bold(doctype + " " + name)
			)
			raise frappe.PermissionError(("read", doctype, name))

	doc.apply_fieldlevel_read_permissions()

	# add file list
	doc.add_viewed()
	get_docinfo(doc)

	doc.add_seen()
	set_link_titles(doc)
	if frappe.response.docs is None:
		frappe.local.response = _dict({"docs": []})
	frappe.response.docs.append(doc)




@frappe.whitelist()
def get_docinfo(doc=None, doctype=None, name=None):
	if not doc:
		doc = frappe.get_doc(doctype, name)
		if not doc.has_permission("read"):
			raise frappe.PermissionError

	all_communications = _get_communications(doc.doctype, doc.name)
	automated_messages = [
		msg for msg in all_communications if msg["communication_type"] == "Automated Message"
	]
	communications_except_auto_messages = [
		msg for msg in all_communications if msg["communication_type"] != "Automated Message"
	]

	docinfo = frappe._dict(user_info={})

	add_comments(doc, docinfo)
	add_chat_topics(doc, docinfo)

	doc.name = str(doc.name)

	data = {
		"doctype": doc.doctype,
		"name": doc.name,
		"attachments": get_attachments(doc.doctype, doc.name),
		"communications": communications_except_auto_messages,
		"automated_messages": automated_messages,
		"total_comments": len(json.loads(doc.get("_comments") or "[]")),
		"versions": get_versions(doc),
		"assignments": get_assignments(doc.doctype, doc.name),
		"permissions": get_doc_permissions(doc),
		"shared": frappe.share.get_users(doc.doctype, doc.name),
		"views": get_view_logs(doc.doctype, doc.name),
		"additional_timeline_content": get_additional_timeline_content(doc.doctype, doc.name),
		"milestones": get_milestones(doc.doctype, doc.name),
		"is_document_followed": is_document_followed(doc.doctype, doc.name, frappe.session.user),
		"tags": get_tags(doc.doctype, doc.name),
		"document_email": get_document_email(doc.doctype, doc.name),
	}

	# Only add energy points if version < 16
	major_version = cint(frappe.__version__.split(".")[0])
	if major_version < 16:
		data["energy_point_logs"] = get_point_logs(doc.doctype, doc.name)

	docinfo.update(data)

	update_user_info(docinfo)
	frappe.response["docinfo"] = docinfo
	
def get_view_logs(doctype, docname):
	"""get and return the latest view logs if available"""
	logs = []
	if hasattr(frappe.get_meta(doctype), "track_views") and frappe.get_meta(doctype).track_views:
		view_logs = frappe.get_all(
			"View Log",
			filters={
				"reference_doctype": doctype,
				"reference_name": docname,
			},
			fields=["name", "creation", "owner"],
			order_by="creation desc",
		)

		if view_logs:
			logs = view_logs
	return logs

def add_chat_topics(doc, docinfo):
	docinfo.chat_topics = []
	chat_topics = frappe.db.sql(
		"""
		SELECT 
			ref.parent, topic.chat_channel, topic.is_private, topic.subject, 
			topic.owner, topic.creation, topic.topic_status
		FROM 
			`tabClefinCode Chat Topic Reference` AS ref
		JOIN 
			`tabClefinCode Chat Topic` AS topic ON ref.parent = topic.name
		WHERE 
			ref.docname = %s AND ref.active = 1
		""", 
		(doc.name,), as_dict=True
	)

	for chat_topic_data in chat_topics:
		chat_channel = chat_topic_data.chat_channel
		is_private = chat_topic_data.is_private
		chat_topic_subject = f'"{chat_topic_data.subject}"' if chat_topic_data.subject else ""
		
		alternative_subject = get_topic_title(chat_channel)
		title = chat_topic_subject if chat_topic_subject else alternative_subject
		display_subject = chat_topic_subject if chat_topic_subject else split_channel_name(alternative_subject)
		
		channel_name = (
			f"<span class='topic-card' data-channel='{chat_channel}' data-topic='{chat_topic_data.parent}' "
			f"data-subject='{chat_topic_subject}' data-alternative-subject='{alternative_subject}' "
			f"data-is-private='{is_private}' title='{title}' "
			f"style='text-decoration:underline;cursor:pointer'>{display_subject}</span>"
		)
		subject = f"<b>@ClefinCode Chat Topic:</b> {channel_name}"
		
		docinfo.chat_topics.append({
			"name": chat_topic_data.parent,
			"owner": chat_topic_data.owner,
			"subject": subject,
			"creation": chat_topic_data.creation,
			"topic_status": chat_topic_data.topic_status,
		})


def get_topic_title(chat_channel):
	channel_doc = frappe.get_doc("ClefinCode Chat Channel", chat_channel)

	if channel_doc.type == "Group":
		return channel_doc.channel_name or channel_doc.get_group_name()

	if channel_doc.type == "Direct" and len(channel_doc.members) >= 2:
		return f"{get_contact_full_name(channel_doc.members[0].user)} and {get_contact_full_name(channel_doc.members[1].user)}"

	return ""



def split_channel_name(channel_name):
	return channel_name[0:40] + "..." if len(channel_name) >= 40 else channel_name