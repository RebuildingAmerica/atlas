"""Row shapes the ATProto identity-graph migration moves between tables."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

_LEGACY_ENTRY_ATPROTO_COLUMNS = (
    "linked_atproto_did",
    "linked_atproto_handle",
    "linked_atproto_verified_at",
)

_ATPROTO_MIGRATION_SAVEPOINT = "migrate_atproto_identity_graph"

_ATPROTO_MIGRATION_ADVISORY_LOCK_KEY = 0x41544C4153415450


@dataclass(frozen=True, slots=True)
class _LegacyAtprotoIdentity:
    id: str
    user_id: str
    did: str
    current_handle: str
    pds_url: str | None
    did_resolved_at: Any
    handle_verified_at: Any
    created_at: Any
    updated_at: Any


@dataclass(frozen=True, slots=True)
class _GlobalAtprotoIdentity:
    id: str
    did: str
    current_handle: str
    pds_url: str | None
    resolution_status: str
    did_resolved_at: Any
    handle_verified_at: Any
    last_resolution_error: str | None
    created_at: Any
    updated_at: Any


@dataclass(frozen=True, slots=True)
class _LegacyEntryAtprotoLink:
    entry_id: str
    did: str
    handle: str
    verified_at: Any
    created_at: Any
    updated_at: Any


@dataclass(frozen=True, slots=True)
class _IdentityMigrationRows:
    identities: dict[str, _GlobalAtprotoIdentity]
    controls: list[tuple[Any, ...]]
    identity_id_map: dict[str, str]


@dataclass(frozen=True, slots=True)
class _ProfileLinkMigrationRows:
    identities: dict[str, _GlobalAtprotoIdentity]
    links: list[tuple[Any, ...]]


@dataclass(frozen=True, slots=True)
class _ExistingAtprotoGraphRows:
    controls: list[tuple[Any, ...]]
    links: list[tuple[Any, ...]]


@dataclass(frozen=True, slots=True)
class _AtprotoMigrationExpectations:
    identity_count: int
    control_count: int
    link_count: int
    identities: dict[str, _GlobalAtprotoIdentity]
    controls: list[tuple[Any, ...]]
    links: list[tuple[Any, ...]]
