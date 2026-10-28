# Copyright (c) 2024, Ahmad Kamaleddin and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from clefincode_chat.api.api_1_2_1.api import get_contact_first_name

DELETED_LABEL = "Deleted Account"
PROFILE = "ClefinCode Chat Profile"


class ClefinCodeChatChannel(Document):
    def get_group_name(self):
        # Keep explicit group names (do not rename groups after a user leaves).
        if self.channel_name:
            return self.channel_name

        members = frappe.db.sql(
            """
            SELECT DISTINCT profile.full_name, profile.is_deleted
            FROM `tabClefinCode Chat Profile` AS profile
            INNER JOIN `tabClefinCode Chat Channel User` AS member
                ON member.profile_id = profile.name
            WHERE member.parent = %s
              AND COALESCE(member.is_removed, 0) != 1
            ORDER BY profile.full_name ASC
            """,
            (self.name,),
            as_dict=True,
        )
        names = []
        for member in members:
            if member.is_deleted:
                names.append(DELETED_LABEL)
            elif member.full_name:
                names.append(member.full_name.split()[0])
        return ", ".join(names) if names else "Inactive Group"

    def get_members(self):
        members = []
        if self.members:
            for member in self.members:
                members.append(member.user)
            if self.type == "Guest":
                members.append("Guest")
        return members

    def get_channel_name_for_contributor(self):
        if self.type == "Group":
            return self.get_group_name()
        if self.type != "Direct":
            return ""

        names = []
        for member in (self.members or [])[:2]:
            profile = (
                frappe.db.get_value(
                    PROFILE, member.profile_id,
                    ["full_name", "is_deleted"], as_dict=True,
                ) if member.profile_id else None
            )
            if profile and profile.is_deleted:
                names.append(DELETED_LABEL)
            elif profile and profile.full_name:
                names.append(profile.full_name.split()[0])
            else:
                names.append(get_contact_first_name(member.user))
        return ", ".join(name for name in names if name)

    def validate(self):
        self._build_channel_info()

    def _build_channel_info(self):
        """Keep deleted identity IDs out of denormalized channel search text."""
        if not self.members:
            self.channel_info = ""
            return

        pieces = []
        for row in self.members:
            if row.profile_id and frappe.db.get_value(
                PROFILE, row.profile_id, "is_deleted"
            ):
                pieces.append(DELETED_LABEL)
                continue

            values = [row.profile_id, row.user]
            piece = " ".join(str(value) for value in values if value)
            if piece:
                pieces.append(piece)

        if self.channel_name:
            pieces.append(self.channel_name)
        self.channel_info = " ".join(pieces)
