"""Tombstone chat identities when a linked Contact / portal party is deleted.

No force deletes or commits: all changes participate in Frappe's delete transaction.
The profile and chat history remain; the retired person cannot be addressed by
his/her previous contact identifiers.
"""

import hashlib

import frappe
from frappe.utils import now_datetime


DELETED_LABEL = "Deleted Account"
PROFILE = "ClefinCode Chat Profile"
DETAIL = "ClefinCode Chat Profile Contact Details"
CHANNEL = "ClefinCode Chat Channel"
MEMBER = "ClefinCode Chat Channel User"
CONTRIBUTOR = "ClefinCode Chat Channel Contributor"
MESSAGE = "ClefinCode Chat Message"


# Set False if removing a Supplier/Customer should not disable a Website User.
DISABLE_ORPHAN_PORTAL_USERS = True


def on_contact_trash(doc, method=None):
    """Called by Frappe when Contact is really being deleted."""
    profile_names = frappe.get_all(
        PROFILE, filters={"contact": doc.name}, pluck="name"
    )
    for profile_name in profile_names:
        retire_chat_profile(profile_name, contact_doc=doc)


def on_party_trash(doc, method=None):
    """Called when Supplier or Customer is deleted.

    ERPNext will normally delete exclusively-linked Contacts first. If a
    Contact survives because it has other Dynamic Links, only retire its chat
    identity when the Website User has no *other* Portal User assignment.
    """
    if doc.doctype not in ("Supplier", "Customer"):
        return

    for portal in doc.get("portal_users") or []:
        user = portal.get("user")
        if not user or _has_other_portal_assignment(user, doc):
            continue

        if not frappe.db.exists("User", user):
            continue
        if frappe.db.get_value("User", user, "user_type") != "Website User":
            continue

        # May already be retired by Contact.on_trash in ERPNext's on_trash.
        # This lookup also works when Contact remains in another business doc.
        profile_names = frappe.get_all(
            DETAIL,
            filters={"contact_info": user, "type": "Chat", "parenttype": PROFILE},
            pluck="parent",
        )
        for profile_name in set(profile_names):
            retire_chat_profile(profile_name)

        if DISABLE_ORPHAN_PORTAL_USERS:
            # Do not delete User, role assignments, or transaction history.
            # DB update avoids running User.save hooks during parent deletion.
            frappe.db.set_value("User", user, "enabled", 0)
            # Logout only AFTER the deletion transaction has committed. Frappe's
            # clear_sessions() commits, which must never happen in on_trash.
            if hasattr(frappe.db, "after_commit"):
                frappe.db.after_commit.add(lambda user=user: _logout_disabled_user(user))


def _logout_disabled_user(user):
    try:
        from frappe.sessions import clear_sessions

        frappe.clear_cache(user=user)
        clear_sessions(user=user, force=True)
    except Exception:
        frappe.log_error(
            title="ClefinCode Chat: portal logout failed",
            message=frappe.get_traceback(),
        )


def _has_other_portal_assignment(user, current_party):
    rows = frappe.get_all(
        "Portal User", filters={"user": user},
        fields=["parenttype", "parent"],
    )
    return any(
        (r.parenttype, r.parent) != (current_party.doctype, current_party.name)
        for r in rows
    )


def _tombstone_identity(profile_name):
    digest = hashlib.sha256(profile_name.encode("utf-8")).hexdigest()[:24]
    return f"deleted-{digest}@example.invalid"


def retire_chat_profile(profile_name, contact_doc=None):
    """Archive a profile without breaking historical Channel/Message links.

    This helper is deliberately not @frappe.whitelist-ed. Only deletion hooks
    should invoke it. Repeating it is safe.
    """
    if not frappe.db.exists(PROFILE, profile_name):
        return

    profile = frappe.get_doc(PROFILE, profile_name)
    if profile.is_guest or profile.is_support or profile.get("is_deleted"):
        return

    tombstone = _tombstone_identity(profile.name)
    old_ids = {
        str(detail.contact_info).strip()
        for detail in profile.get("contact_details") or []
        if detail.contact_info and str(detail.contact_info).strip() != tombstone
    }

    contact_name = profile.contact
    if contact_doc is not None and contact_doc.name == contact_name:
        user = contact_doc.get("user")
    elif contact_name and frappe.db.exists("Contact", contact_name):
        user = frappe.db.get_value("Contact", contact_name, "user")
    else:
        user = None
    if user:
        old_ids.add(user)
    old_ids.discard(tombstone)

    member_rows = frappe.get_all(
        MEMBER,
        filters={"profile_id": profile.name, "parenttype": CHANNEL},
        fields=["name", "parent", "user"],
    )
    contributor_rows = frappe.get_all(
        CONTRIBUTOR,
        filters={"profile_id": profile.name, "parenttype": CHANNEL},
        fields=["name", "parent", "user"],
    )
    for row in member_rows + contributor_rows:
        if row.user and row.user != tombstone:
            old_ids.add(row.user)

    rooms = set(
        frappe.get_all(CHANNEL, {"chat_profile": profile.name}, pluck="name")
    )
    rooms.update(row.parent for row in member_rows + contributor_rows if row.parent)

    # First, rename historic identity fields, scoped ONLY to this person's rooms.
    # No message content, message IDs, attachments, or room records are deleted.
    for room in rooms:
        _anonymize_message_fields(room, old_ids, tombstone)
        _anonymize_channel_fields(room, old_ids, tombstone)

    removed_at = now_datetime()
    for row in member_rows:
        frappe.db.set_value(
            MEMBER, row.name,
            {
                "user": tombstone,
                "is_removed": 1,
                "active": 0,
                "is_admin": 0,
                "remove_date": removed_at,
            },
        )
    for row in contributor_rows:
        frappe.db.set_value(
            CONTRIBUTOR, row.name, {"user": tombstone, "active": 0}
        )

    # Preserve the PROFILE primary key: Channel User.profile_id, Channel.chat_profile
    # and Channel.last_responder_user all link to it.
    profile.full_name = DELETED_LABEL
    profile.contact = None
    profile.is_deleted = 1
    profile.token = None
    profile.registration_token = None
    profile.support_token = None
    profile.support_channel = None
    profile.chat_platform = None
    profile.last_active = None
    profile.platform = None
    profile.set("fcm_devices", [])
    # There must be NO Contact Details for a deleted account. The private,
    # deterministic tombstone exists ONLY in historical message/member IDs,
    # keeping each deleted person distinct without retaining a usable address.
    profile.set("contact_details", [])
    profile.save(ignore_permissions=True)

    # Channel.validate() only rebuilds channel_info on normal channel saves.
    # The cleanup above uses db.set_value(), so update the search index here.
    for room in rooms:
        _rebuild_channel_info(room)


def _anonymize_message_fields(room, identifiers, tombstone):
    if not identifiers:
        return
    identities = sorted(identifiers)
    placeholders = ", ".join(["%s"] * len(identities))
    frappe.db.sql(
        f"""UPDATE `tabClefinCode Chat Message`
               SET sender = %s, sender_email = %s
               WHERE chat_channel = %s AND sender_email IN ({placeholders})""",
        [DELETED_LABEL, tombstone, room, *identities],
    )
    frappe.db.sql(
        f"""UPDATE `tabClefinCode Chat Message`
               SET reply_preview_sender = %s, reply_preview_sender_email = %s
               WHERE chat_channel = %s
                 AND reply_preview_sender_email IN ({placeholders})""",
        [DELETED_LABEL, tombstone, room, *identities],
    )


def _anonymize_channel_fields(room, identifiers, tombstone):
    row = frappe.db.get_value(
        CHANNEL, room,
        ["channel_creator", "parent_channel_creator", "channel_name", "type", "is_parent"],
        as_dict=True,
    )
    if not row:
        return

    updates = {}
    if row.channel_creator in identifiers:
        updates["channel_creator"] = tombstone
    if row.parent_channel_creator in identifiers:
        updates["parent_channel_creator"] = tombstone

    # IMPORTANT: Never require channel_name == profile.full_name. Some Direct
    # channels store a short name, alias, or an earlier name. Since this room
    # contains the retired profile, replace its stored Direct-chat title.
    # Group titles are intentionally left untouched.
    if row.type == "Direct" and row.is_parent and row.channel_name != DELETED_LABEL:
        updates["channel_name"] = DELETED_LABEL

    if updates:
        frappe.db.set_value(CHANNEL, room, updates)


def _rebuild_channel_info(room):
    """Keep the denormalized search field in sync without triggering sends."""
    if not frappe.db.exists(CHANNEL, room):
        return
    doc = frappe.get_doc(CHANNEL, room)
    doc._build_channel_info()
    if doc.channel_info != frappe.db.get_value(CHANNEL, room, "channel_info"):
        frappe.db.set_value(
            CHANNEL, room, "channel_info", doc.channel_info,
            update_modified=False,
        )


def repair_deleted_chat_channel_names(dry_run=False):
    """Repair existing tombstones (run from `bench execute`, not the web).

    Only parent Direct channels containing an is_deleted=1 Chat Profile are renamed.
    Existing messages, group titles, room IDs and membership are not modified.
    Safe to run more than once.
    """
    affected = set()
    profiles = frappe.get_all(PROFILE, filters={"is_deleted": 1}, pluck="name")
    for profile_id in profiles:
        affected.update(
            frappe.get_all(CHANNEL, filters={"chat_profile": profile_id}, pluck="name")
        )
        affected.update(
            row.parent for row in frappe.get_all(
                MEMBER,
                filters={"profile_id": profile_id, "parenttype": CHANNEL},
                fields=["parent"],
            ) if row.parent
        )
        affected.update(
            row.parent for row in frappe.get_all(
                CONTRIBUTOR,
                filters={"profile_id": profile_id, "parenttype": CHANNEL},
                fields=["parent"],
            ) if row.parent
        )

    updated = []
    examined_direct = 0
    for room in sorted(affected):
        channel = frappe.db.get_value(
            CHANNEL, room, ["type", "channel_name", "is_parent"], as_dict=True
        )
        if not channel or channel.type != "Direct" or not channel.is_parent:
            continue
        examined_direct += 1
        if channel.channel_name != DELETED_LABEL:
            updated.append(room)
            if not dry_run:
                frappe.db.set_value(CHANNEL, room, "channel_name", DELETED_LABEL)
        if not dry_run:
            _rebuild_channel_info(room)

    return {
        "deleted_profiles": len(profiles),
        "direct_channels_examined": examined_direct,
        "direct_channels_updated": len(updated),
        "updated_channel_ids": updated,
        "dry_run": bool(dry_run),
    }


def repair_deleted_profile_contact_details(dry_run=False):
    """One-time migration for profiles deleted by v1/v2 of this patch.

    Older versions inserted `deleted-<hash>@example.invalid` as a synthetic
    Contact Detail. That child row is unnecessary and should be removed.
    This repair leaves profile IDs, member IDs, room IDs, and messages intact.

    Call from bench console/execute with a site backup. It is idempotent.
    """
    changed = []
    profiles = frappe.get_all(PROFILE, filters={"is_deleted": 1}, pluck="name")
    for profile_name in profiles:
        profile = frappe.get_doc(PROFILE, profile_name)
        if not (profile.get("contact_details") or profile.contact):
            continue
        changed.append(profile_name)
        if dry_run:
            continue
        profile.contact = None
        profile.set("contact_details", [])
        profile.save(ignore_permissions=True)

    return {
        "deleted_profiles_checked": len(profiles),
        "profiles_cleaned": len(changed),
        "profile_ids": changed,
        "dry_run": bool(dry_run),
    }


def diagnose_deleted_chat_visibility(user_email):
    """Read-only diagnosis for a particular surviving user's direct chats.

    The SQL reports one row per room whose *other* member is a deleted
    profile; no name-based de-duplication. Not exposed as a web API.
    """
    user_email = str(user_email or "").strip()
    if not user_email:
        frappe.throw("Please supply the active chat user's exact email")

    rows = frappe.db.sql(
        """
        SELECT DISTINCT
            ch.name AS room,
            ch.channel_name,
            ch.chat_status,
            other.profile_id AS deleted_profile,
            other.user AS deleted_member_key,
            other.is_removed AS deleted_member_removed
        FROM `tabClefinCode Chat Channel` ch
        INNER JOIN `tabClefinCode Chat Channel User` me
            ON me.parent = ch.name AND me.user = %s
        INNER JOIN `tabClefinCode Chat Channel User` other
            ON other.parent = ch.name AND other.name != me.name
        INNER JOIN `tabClefinCode Chat Profile` p
            ON p.name = other.profile_id AND p.is_deleted = 1
        WHERE ch.type = 'Direct' AND ch.is_parent = 1
        ORDER BY ch.modified_date DESC
        """,
        (user_email,),
        as_dict=True,
    )

    # The shipped API is paginated, and the frontend may also filter or
    # de-duplicate conversations. Examine these room IDs in its response.
    return {
        "user": user_email,
        "deleted_direct_rooms_in_database": len({row.room for row in rows}),
        "rooms": rows,
        "note": (
            "Compare these room IDs to the Network response for "
            "get_channels_list. If the rooms are returned there but are not "
            "drawn, the remaining bug is in the chat-list frontend. "
            "Use room IDs, never 'Deleted Account', as list keys."
        ),
    }
