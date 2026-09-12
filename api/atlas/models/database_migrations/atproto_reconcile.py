"""Pure row arithmetic the ATProto migration needs, kept free of I/O."""

from __future__ import annotations

import json
import uuid
from collections import defaultdict
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .atproto_records import (
        _GlobalAtprotoIdentity,
        _LegacyAtprotoIdentity,
        _LegacyEntryAtprotoLink,
    )


def _deduplicate_existing_controls(rows: list[tuple[Any, ...]]) -> list[tuple[Any, ...]]:
    controls_by_user: dict[tuple[str, str], tuple[Any, ...]] = {}
    for row in rows:
        key = (row[1], row[2])
        existing = controls_by_user.get(key)
        preferred_id = _migration_id("control", row[1], row[2])
        preference = (row[0] == preferred_id, row[7], row[0])
        if existing is None:
            controls_by_user[key] = row
            continue
        existing_preference = (
            existing[0] == preferred_id,
            existing[7],
            existing[0],
        )
        if preference > existing_preference:
            controls_by_user[key] = row
    return sorted(controls_by_user.values(), key=lambda row: row[0])


def _conflicting_control_identity_ids(rows: list[tuple[Any, ...]]) -> set[str]:
    users_by_identity: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        if row[3] == "disconnected":
            continue
        users_by_identity[row[1]].add(row[2])
    return {identity_id for identity_id, user_ids in users_by_identity.items() if len(user_ids) > 1}


def _reconcile_control_conflict(
    row: tuple[Any, ...],
    *,
    conflicting_identity_ids: set[str],
) -> tuple[Any, ...]:
    if row[1] not in conflicting_identity_ids or row[3] != "active":
        return row
    return (*row[:3], "conflict", *row[4:])


def _remap_existing_identity_id(
    row: tuple[Any, ...],
    *,
    identity_id_map: dict[str, str],
    identity_index: int,
) -> tuple[Any, ...]:
    source_identity_id = row[identity_index]
    identity_id = identity_id_map.get(source_identity_id)
    if identity_id is None:
        msg = f"Existing ATProto graph row references unknown identity {source_identity_id}"
        raise RuntimeError(msg)
    values = list(row)
    values[identity_index] = identity_id
    return tuple(values)


def _legacy_control_rows(
    global_identity: _GlobalAtprotoIdentity,
    legacy_identities: list[_LegacyAtprotoIdentity],
) -> list[tuple[Any, ...]]:
    identities_by_user: dict[str, _LegacyAtprotoIdentity] = {}
    for identity in legacy_identities:
        identities_by_user.setdefault(identity.user_id, identity)
    control_status = "active" if len(identities_by_user) == 1 else "conflict"
    controls: list[tuple[Any, ...]] = []
    for user_id, source_identity in identities_by_user.items():
        control = (
            _migration_id("control", global_identity.id, user_id),
            global_identity.id,
            user_id,
            control_status,
            source_identity.handle_verified_at or source_identity.did_resolved_at,
            None,
            source_identity.created_at,
            source_identity.updated_at,
        )
        controls.append(control)
    return controls


def _profile_link_row(
    identity: _GlobalAtprotoIdentity,
    legacy_link: _LegacyEntryAtprotoLink,
    proof_links: dict[tuple[str, str, str], tuple[str, str]],
) -> tuple[Any, ...]:
    handle = _normalize_handle(legacy_link.handle)
    handle_matches = _normalize_handle(identity.current_handle) == handle
    status = (
        "verified"
        if identity.resolution_status == "verified" and handle_matches
        else "reverification_required"
    )
    claim_id, proof_id = proof_links.get(
        (legacy_link.entry_id, legacy_link.did, handle),
        (None, None),
    )
    return (
        _migration_id("profile-link", legacy_link.entry_id, identity.id),
        legacy_link.entry_id,
        identity.id,
        claim_id,
        proof_id,
        status,
        legacy_link.verified_at,
        legacy_link.verified_at,
        None,
        legacy_link.created_at,
        legacy_link.updated_at,
    )


def _migration_id(kind: str, *parts: str) -> str:
    name = json.dumps((kind, *parts), separators=(",", ":"))
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"atlas:atproto-identity-graph:{name}"))


def _nonempty_text(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _normalize_handle(handle: str) -> str:
    return handle.strip().removeprefix("@").casefold()
