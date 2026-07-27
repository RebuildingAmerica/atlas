"""Helper logic for seeding public Atlas profiles."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING

from atlas.domains.catalog.geo import geocode_entry
from atlas.models import EntryCRUD, SourceCRUD, get_db_connection, init_db
from atlas.models.database import db

if TYPE_CHECKING:
    from datetime import date

    import aiosqlite


@dataclass(frozen=True)
class SeedSource:
    url: str
    title: str
    publication: str
    published_date: date
    source_type: str
    extraction_context: str


@dataclass(frozen=True)
class SeedEntry:
    slug: str
    entry_type: str
    name: str
    description: str
    city: str | None
    state: str | None
    region: str | None
    geo_specificity: str
    website: str | None
    email: str | None
    phone: str | None
    social_media: dict[str, str] | None
    affiliated_org_slug: str | None
    verified: bool
    last_verified: date | None
    first_seen: date
    last_seen: date
    issue_areas: tuple[str, ...]
    sources: tuple[SeedSource, ...]


async def _get_entry_id_by_slug(conn: aiosqlite.Connection, slug: str) -> str | None:
    entry = await EntryCRUD.get_by_slug(conn, slug)
    return entry.id if entry is not None else None


async def _place_seed_entry(conn: aiosqlite.Connection, entry_id: str, seed: SeedEntry) -> None:
    existing = await EntryCRUD.get_by_id(conn, entry_id)
    if existing is not None and existing.latitude is not None and existing.longitude is not None:
        return

    located = await geocode_entry(seed.city, seed.state, None, allow_remote=False)
    if located is None:
        return

    await EntryCRUD.update(
        conn,
        entry_id,
        latitude=located.latitude,
        longitude=located.longitude,
        geocode_precision=located.precision,
        geocode_source=located.source,
    )


async def _ensure_entry(
    conn: aiosqlite.Connection, seed: SeedEntry, affiliated_org_id: str | None
) -> str:
    existing_id = await _get_entry_id_by_slug(conn, seed.slug)
    if existing_id is None:
        existing_id = await EntryCRUD.create(
            conn,
            entry_type=seed.entry_type,
            name=seed.name,
            description=seed.description,
            city=seed.city,
            state=seed.state,
            region=seed.region,
            geo_specificity=seed.geo_specificity,
            website=seed.website,
            email=seed.email,
            phone=seed.phone,
            social_media=seed.social_media,
            affiliated_org_id=affiliated_org_id,
            first_seen=seed.first_seen,
            last_seen=seed.last_seen,
        )

    await conn.execute(
        """
        UPDATE entries
        SET type = ?,
            name = ?,
            description = ?,
            city = ?,
            state = ?,
            region = ?,
            geo_specificity = ?,
            website = ?,
            email = ?,
            phone = ?,
            social_media = ?,
            affiliated_org_id = ?,
            active = TRUE,
            verified = ?,
            last_verified = ?,
            first_seen = ?,
            last_seen = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (
            seed.entry_type,
            seed.name,
            seed.description,
            seed.city,
            seed.state,
            seed.region,
            seed.geo_specificity,
            seed.website,
            seed.email,
            seed.phone,
            json.dumps(seed.social_media) if seed.social_media else None,
            affiliated_org_id,
            seed.verified,
            seed.last_verified.isoformat() if seed.last_verified else None,
            seed.first_seen.isoformat(),
            seed.last_seen.isoformat(),
            db.now_iso(),
            existing_id,
        ),
    )
    await conn.commit()
    await EntryCRUD.set_vanity_slug(conn, existing_id, seed.slug)
    await _place_seed_entry(conn, existing_id, seed)
    return existing_id


async def _sync_issue_areas(
    conn: aiosqlite.Connection, entry_id: str, issue_areas: tuple[str, ...]
) -> None:
    await conn.execute("DELETE FROM entry_issue_areas WHERE entry_id = ?", (entry_id,))
    await conn.executemany(
        "INSERT INTO entry_issue_areas (entry_id, issue_area, created_at) VALUES (?, ?, ?)",
        [(entry_id, issue_area, db.now_iso()) for issue_area in issue_areas],
    )
    await conn.commit()


async def _ensure_source(conn: aiosqlite.Connection, source: SeedSource) -> str:
    existing = await SourceCRUD.get_by_url(conn, source.url)
    if existing is None:
        return await SourceCRUD.create(
            conn,
            url=source.url,
            source_type=source.source_type,
            extraction_method="manual",
            title=source.title,
            publication=source.publication,
            published_date=source.published_date,
        )

    await SourceCRUD.update(
        conn,
        existing.id,
        title=source.title,
        publication=source.publication,
        published_date=source.published_date,
    )
    return existing.id


async def _sync_sources(
    conn: aiosqlite.Connection, entry_id: str, sources: tuple[SeedSource, ...]
) -> None:
    await conn.execute("DELETE FROM entry_sources WHERE entry_id = ?", (entry_id,))
    await conn.commit()
    for source in sources:
        source_id = await _ensure_source(conn, source)
        await SourceCRUD.link_to_entry(conn, entry_id, source_id, source.extraction_context)


async def seed_profiles(database_url: str) -> None:
    """Seed the launch-ready public profiles."""
    from atlas.seed_profiles import SEED_ENTRIES

    await init_db(database_url)
    conn = await get_db_connection(database_url)
    try:
        if getattr(conn, "backend", "sqlite") != "postgres":  # pragma: no branch
            await conn.execute("PRAGMA busy_timeout = 30000")
        org_ids_by_slug: dict[str, str] = {}

        for seed in SEED_ENTRIES:
            if seed.entry_type != "organization":
                continue
            entry_id = await _ensure_entry(conn, seed, affiliated_org_id=None)
            org_ids_by_slug[seed.slug] = entry_id
            await _sync_issue_areas(conn, entry_id, seed.issue_areas)
            await _sync_sources(conn, entry_id, seed.sources)

        for seed in SEED_ENTRIES:
            if seed.entry_type != "person":
                continue
            affiliated_org_id = org_ids_by_slug.get(seed.affiliated_org_slug or "")
            entry_id = await _ensure_entry(conn, seed, affiliated_org_id=affiliated_org_id)
            await _sync_issue_areas(conn, entry_id, seed.issue_areas)
            await _sync_sources(conn, entry_id, seed.sources)
    finally:
        await conn.close()
