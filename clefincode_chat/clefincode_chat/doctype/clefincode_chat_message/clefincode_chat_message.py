# Copyright (c) 2024, Ahmad Kamaleddin and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


def process_ai_reply_job(chat_message_name):
    """Compatibility entry point for any older queued jobs (not auto-triggered).

    api.send() handles messages that already have sub_channel.
    update_sub_channel_for_last_message() queues this job when a message
    receives its sub_channel later. Topic preservation lives in api.py.
    """
    from clefincode_chat.api.api_1_4_1 import api

    msg = frappe.get_doc("ClefinCode Chat Message", chat_message_name)
    channel = frappe.get_doc("ClefinCode Chat Channel", msg.chat_channel)
    sub_channel = msg.sub_channel or None
    if sub_channel:
        rows = [
            (row, True) for row in (channel.contributors or [])
            if api._contributor_matches_thread(row, msg.chat_channel, sub_channel)
        ]
    else:
        rows = [
            (row, False) for row in (channel.members or [])
            if not row.is_removed and row.platform == "Chat"
        ] + [
            (row, True) for row in (channel.contributors or [])
            if api._contributor_matches_thread(row, msg.chat_channel, None)
        ]
    # The seen set below prevents a bot in both lists from replying twice.
    seen = set()
    for row, is_contributor in rows:
        if not row.profile_id or row.profile_id in seen:
            continue
        seen.add(row.profile_id)
        api.process_ai_reply_job(
            row, msg.sender, msg.chat_channel, msg,
            is_contributor=is_contributor
        )


class ClefinCodeChatMessage(Document):
    def after_insert(self):
        # api.send() already triggers the AI after writing the message.
        # Do NOT enqueue the job here; doing so duplicates replies.
        pass
