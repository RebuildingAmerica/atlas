"""Manual, source-linked intake for organizations the public needs to find."""

from __future__ import annotations

from datetime import UTC, datetime
from ipaddress import ip_address
from typing import TYPE_CHECKING, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator, model_validator

from atlas.domains.catalog.geo import geocode_entry
from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.catalog.taxonomy import ALL_ISSUE_SLUGS
from atlas.domains.moderation.review_queue import (
    EDITORIAL_PROFILE_CHANGE_KIND,
    ReviewQueueCRUD,
)
from atlas.platform.database import db

if TYPE_CHECKING:
    import aiosqlite


class EditorialCandidateConflictError(Exception):
    """An existing profile already has this name or official page."""

    def __init__(self, entity_id: str) -> None:
        self.entity_id = entity_id
        super().__init__("An existing profile may be the same organization.")


class EditorialProfileChangeConflictError(Exception):
    """An existing profile cannot accept this source-backed change."""


class EditorialCandidateCreateRequest(BaseModel):
    """One organization's claim source and official next step for human review."""

    name: str = Field(..., min_length=3, max_length=160)
    description: str = Field(..., min_length=10, max_length=500)
    city: str | None = Field(None, max_length=100)
    state: str = Field(..., min_length=2, max_length=2)
    geo_specificity: Literal["local", "regional", "statewide", "national"]
    region: str | None = Field(None, max_length=200)
    issue_areas: list[str] = Field(..., min_length=1, max_length=8)
    source_url: str
    source_context: str = Field(..., min_length=10, max_length=500)
    action_url: str
    sources_checked: Literal[True]

    @field_validator("name", "description", "source_context")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        """Reject whitespace-only candidate claims."""
        stripped = value.strip()
        if not stripped:
            raise ValueError("A nonempty value is required")  # noqa: TRY003
        return stripped

    @field_validator("city", "region")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        """Treat an empty optional place field as absent."""
        if value is None:
            return None
        return value.strip() or None

    @field_validator("source_url", "action_url")
    @classmethod
    def require_public_https(cls, value: str) -> str:
        """Keep editor-facing evidence and contact actions on public HTTPS pages."""
        url = value.strip()
        parsed = urlsplit(url)
        try:
            _ = parsed.port
        except ValueError:
            raise ValueError("Use a public HTTPS URL") from None  # noqa: TRY003
        host = parsed.hostname
        valid_host = False
        if host:
            try:
                valid_host = ip_address(host).is_global
            except ValueError:
                valid_host = "." in host and host != "localhost" and not host.endswith(".local")
        if parsed.scheme != "https" or not valid_host or parsed.username or parsed.password:
            raise ValueError("Use a public HTTPS URL")  # noqa: TRY003
        return url

    @model_validator(mode="after")
    def validate_editorial_scope(self) -> EditorialCandidateCreateRequest:
        """Require a defined place, taxonomy, and action on the cited organization's site."""
        self.state = self.state.strip().upper()
        if self.geo_specificity in {"local", "regional"} and not self.city:
            raise ValueError("Local and regional candidates need a city")  # noqa: TRY003
        invalid = set(self.issue_areas) - ALL_ISSUE_SLUGS
        if invalid:
            raise ValueError(f"Unknown issue area: {', '.join(sorted(invalid))}")  # noqa: TRY003
        if len(set(self.issue_areas)) != len(self.issue_areas):
            raise ValueError("Issue areas must be unique")  # noqa: TRY003
        source_host = urlsplit(self.source_url).hostname or ""
        action_host = urlsplit(self.action_url).hostname or ""
        if source_host.removeprefix("www.") != action_host.removeprefix("www."):
            raise ValueError("The official action must be on the cited organization's site")  # noqa: TRY003
        return self


class EditorialCandidateCreateResponse(BaseModel):
    """A held profile and the queue item an editor must decide."""

    entity_id: str
    review_item_id: str
    status: Literal["pending"] = "pending"


async def stage_editorial_profile_change(
    conn: aiosqlite.Connection,
    entity_id: str,
    request: EditorialCandidateCreateRequest,
) -> EditorialCandidateCreateResponse:
    """Hold a correction to an existing organization until source review."""
    entry = await EntryCRUD.get_by_id(conn, entity_id)
    if entry is None or not entry.active or entry.type != "organization":
        raise EditorialProfileChangeConflictError("Published organization not found")  # noqa: TRY003
    if await ReviewQueueCRUD.has_pending_published_change(conn, entity_id=entity_id):
        raise EditorialProfileChangeConflictError("A change is already awaiting review")  # noqa: TRY003
    _, sources = await EntryCRUD.get_with_sources(conn, entity_id)
    official_hosts = {
        (urlsplit(source["url"]).hostname or "").removeprefix("www.")
        for source in sources
        if source["type"] == "org_website"
    }
    if (urlsplit(request.source_url).hostname or "").removeprefix("www.") not in official_hosts:
        raise EditorialProfileChangeConflictError(  # noqa: TRY003
            "The cited page must be on a linked official organization site"
        )

    proposed: dict[str, dict[str, object]] = {}
    fields: dict[str, object] = {
        "name": request.name,
        "description": request.description,
        "city": request.city,
        "state": request.state,
        "region": request.region,
        "geo_specificity": request.geo_specificity,
        "website": request.action_url,
    }
    for field, after in fields.items():
        before = getattr(entry, field)
        if before != after:
            proposed[field] = {"before": before, "after": after}
    before_issues = sorted(await EntryCRUD.get_issue_areas(conn, entity_id))
    after_issues = sorted(request.issue_areas)
    if before_issues != after_issues:
        proposed["issue_areas"] = {"before": before_issues, "after": after_issues}
    if not proposed:
        raise EditorialProfileChangeConflictError("No public profile facts changed")  # noqa: TRY003

    source_urls = sorted({request.source_url, request.action_url})
    proposed["source_evidence"] = {
        "before": None,
        "after": _candidate_snapshot(request, source_urls)["source_evidence"]["after"],
    }
    review_item_id = await ReviewQueueCRUD.stage_published_change(
        conn,
        entity_id=entity_id,
        kind=EDITORIAL_PROFILE_CHANGE_KIND,
        proposed_changes=proposed,
        source_urls=source_urls,
    )
    return EditorialCandidateCreateResponse(entity_id=entity_id, review_item_id=review_item_id)


def _candidate_snapshot(
    request: EditorialCandidateCreateRequest, source_urls: list[str]
) -> dict[str, dict[str, object]]:
    """Keep the exact proposed facts so approval can reject later edits."""
    facts: dict[str, object] = {
        "name": request.name,
        "description": request.description,
        "city": request.city,
        "state": request.state,
        "region": request.region,
        "geo_specificity": request.geo_specificity,
        "website": request.action_url,
        "issue_areas": sorted(request.issue_areas),
        "source_evidence": [
            {
                "url": url,
                "context": request.source_context
                if url == request.source_url
                else "Official next step supplied for editorial review.",
            }
            for url in source_urls
        ],
    }
    return {field: {"before": None, "after": value} for field, value in facts.items()}


async def stage_editorial_candidate(
    conn: aiosqlite.Connection,
    request: EditorialCandidateCreateRequest,
) -> EditorialCandidateCreateResponse:
    """Store an inactive profile, its evidence, and its review item together.

    Parameters
    ----------
    conn : aiosqlite.Connection
        Request-scoped SQLite or PostgreSQL-compatible connection.
    request : EditorialCandidateCreateRequest
        Official-source facts supplied by a named editor.

    Returns
    -------
    EditorialCandidateCreateResponse
        Identifiers for the held profile and required editorial decision.
    """
    existing = await conn.execute(
        """SELECT e.id FROM entries e WHERE e.type = 'organization'
           AND LOWER(TRIM(e.name)) = LOWER(?) AND e.state = ?
           AND (e.active = TRUE OR EXISTS (
               SELECT 1 FROM review_queue q WHERE q.entity_id = e.id AND q.status = 'pending'
           )) LIMIT 1""",
        (request.name, request.state),
    )
    row = await existing.fetchone()
    if row is not None:
        raise EditorialCandidateConflictError(str(row[0]))

    source_urls = sorted({request.source_url, request.action_url})
    placeholders = ", ".join("?" for _ in source_urls)
    linked = await conn.execute(
        f"""SELECT es.entry_id FROM entry_sources es
            JOIN sources s ON s.id = es.source_id
            JOIN entries e ON e.id = es.entry_id
            WHERE s.url IN ({placeholders})
              AND (e.active = TRUE OR EXISTS (
                  SELECT 1 FROM review_queue q
                  WHERE q.entity_id = e.id AND q.status = 'pending'
              )) LIMIT 1""",
        source_urls,
    )
    row = await linked.fetchone()
    if row is not None:
        raise EditorialCandidateConflictError(str(row[0]))

    located = await geocode_entry(request.city, request.state, None, allow_remote=False)
    now = db.now_iso()
    today = datetime.now(UTC).date().isoformat()
    entity_id = db.generate_uuid()
    review_item_id = db.generate_uuid()
    slug = EntryCRUD.generate_slug(request.name, entity_id)
    try:
        await conn.execute(
            """INSERT INTO entries (
                id, type, name, description, city, state, region, geo_specificity,
                latitude, longitude, geocode_precision, geocode_source, website,
                active, first_seen, last_seen, created_at, updated_at, slug
            ) VALUES (?, 'organization', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?, ?, ?, ?, ?)""",
            (
                entity_id,
                request.name,
                request.description,
                request.city,
                request.state,
                request.region,
                request.geo_specificity,
                located.latitude if located else None,
                located.longitude if located else None,
                located.precision if located else None,
                located.source if located else None,
                request.action_url,
                today,
                today,
                now,
                now,
                slug,
            ),
        )
        for issue_area in sorted(request.issue_areas):
            await conn.execute(
                """INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
                   VALUES (?, ?, ?)""",
                (entity_id, issue_area, now),
            )
        for url in source_urls:
            cursor = await conn.execute("SELECT id FROM sources WHERE url = ?", (url,))
            row = await cursor.fetchone()
            source_id = str(row[0]) if row is not None else db.generate_uuid()
            if row is None:
                await conn.execute(
                    """INSERT INTO sources (
                        id, url, title, publication, type, ingested_at,
                        extraction_method, created_at
                    ) VALUES (?, ?, ?, ?, 'org_website', ?, 'manual', ?)""",
                    (
                        source_id,
                        url,
                        f"{request.name} official source"
                        if url == request.source_url
                        else f"{request.name} official next step",
                        request.name,
                        now,
                        now,
                    ),
                )
            await conn.execute(
                """INSERT INTO entry_sources (entry_id, source_id, extraction_context, created_at)
                   VALUES (?, ?, ?, ?)""",
                (
                    entity_id,
                    source_id,
                    request.source_context
                    if url == request.source_url
                    else "Official next step supplied for editorial review.",
                    now,
                ),
            )
        await conn.execute(
            """INSERT INTO review_queue (
                id, entity_id, kind, status, hold_reason, dedup_suspect,
                created_at, source_urls, proposed_changes
            ) VALUES (?, ?, 'organization', 'pending', 'editorial_candidate', FALSE, ?, ?, ?)""",
            (
                review_item_id,
                entity_id,
                now,
                db.encode_json(source_urls),
                db.encode_json(_candidate_snapshot(request, source_urls)),
            ),
        )
        await conn.commit()
    except Exception:
        await conn.execute("ROLLBACK")
        raise
    return EditorialCandidateCreateResponse(
        entity_id=entity_id,
        review_item_id=review_item_id,
    )
