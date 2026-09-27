"""Discovery review queue.

Extends the moderation domain from reactive entity/source flags into a
proactive queue of publication holds and proposed edits to public profiles.
"""

from dataclasses import dataclass
from dataclasses import field as dataclass_field
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from urllib.parse import urlsplit

from atlas.platform.database import db
from atlas.platform.dates import coerce_date, row_timestamp_string

__all__ = [
    "RESOLVABLE_HOLD_REASONS",
    "STAGED_ENTRY_FIELDS",
    "ReviewConflictError",
    "ReviewQueueCRUD",
    "ReviewQueueItemModel",
]

PUBLISHED_CHANGE_REASON = "published_profile_change"
WEBSITE_CANDIDATE_KIND = "website_candidate"
STAGED_ENTRY_FIELDS = frozenset(
    {
        "name",
        "description",
        "city",
        "state",
        "region",
        "geo_specificity",
        "full_address",
        "website",
        "email",
        "phone",
        "social_media",
    }
)
STAGED_ISSUE_FIELD = "issue_areas"
_UNAVAILABLE_PROFILE = "Published profile is no longer available"
_INVALID_PROPOSAL = "Review proposal contains unsupported fields"
_STALE_PROPOSAL = "Published profile changed after this proposal was staged"
_MISSING_CANDIDATE_SOURCE = "Candidate source is no longer linked to this profile"


def _reviewable_website_url(value: str) -> bool:
    """Only present a usable HTTPS URL; an editor still checks its ownership."""
    try:
        parsed = urlsplit(value)
        _ = parsed.port
        return bool(
            parsed.scheme == "https"
            and parsed.hostname
            and not parsed.username
            and not parsed.password
            and not parsed.netloc.endswith(":")
        )
    except ValueError:
        return False


class ReviewConflictError(Exception):
    """The published fact changed after its proposed replacement was staged."""


STALE_SOURCE_REVIEW_DAYS = 365
STALE_SOURCE_REVIEW_KIND = "source_staleness"
STALE_SOURCE_REVIEW_REASON = "stale_public_source_review"
# Holds that a later resolution of the same entity may lift. A possible
# duplicate and a stale public source are left for a person to close.
RESOLVABLE_HOLD_REASONS = frozenset(
    {
        "uncorroborated_web_only",
        "person_requires_review",
        "type_conflict",
        "identity_ambiguous",
        "no_current_role",
    }
)


@dataclass
class ReviewQueueItemModel:
    """A publication hold or proposed public-profile change for review."""

    id: str
    org_id: str | None
    entity_id: str | None
    kind: str
    status: str
    hold_reason: str
    score: float | None
    dedup_suspect: bool
    dedup_note: str | None
    created_at: str
    reviewed_at: str | None
    reviewed_by: str | None
    proposed_changes: dict[str, dict[str, Any]] | None = None
    source_urls: list[str] = dataclass_field(default_factory=list)
    entity_name: str | None = None
    entity_slug: str | None = None
    entity_type: str | None = None


def _row_to_item(row: tuple[Any, ...]) -> ReviewQueueItemModel:
    return ReviewQueueItemModel(
        id=row[0],
        org_id=row[1],
        entity_id=row[2],
        kind=row[3],
        status=row[4],
        hold_reason=row[5],
        score=row[6],
        dedup_suspect=bool(row[7]),
        dedup_note=row[8],
        created_at=row_timestamp_string(row[9]) or "",
        reviewed_at=row_timestamp_string(row[10]),
        reviewed_by=row[11],
        proposed_changes=(
            cast("dict[str, dict[str, Any]]", db.decode_json(row[12])) if row[12] else None
        ),
        source_urls=cast("list[str]", db.decode_json(row[13])) if row[13] else [],
        entity_name=row[14],
        entity_slug=row[15],
        entity_type=row[16],
    )


_SELECT_COLUMNS = (
    "id, org_id, entity_id, kind, status, hold_reason, score, dedup_suspect, "
    "dedup_note, created_at, reviewed_at, reviewed_by, proposed_changes, source_urls, "
    "(SELECT name FROM entries WHERE entries.id = review_queue.entity_id), "
    "(SELECT slug FROM entries WHERE entries.id = review_queue.entity_id), "
    "(SELECT type FROM entries WHERE entries.id = review_queue.entity_id)"
)


class ReviewQueueCRUD:
    """CRUD for publication holds and proposed changes."""

    @staticmethod
    async def has_pending_published_change(conn: Any, *, entity_id: str) -> bool:
        """Whether an entry has a public-fact proposal awaiting review."""
        cursor = await conn.execute(
            """
            SELECT 1 FROM review_queue
            WHERE entity_id = ? AND status = 'pending' AND hold_reason = ?
            LIMIT 1
            """,
            (entity_id, PUBLISHED_CHANGE_REASON),
        )
        return await cursor.fetchone() is not None

    @staticmethod
    async def enqueue(  # noqa: PLR0913
        conn: Any,
        *,
        org_id: str | None = None,
        entity_id: str | None,
        kind: str,
        hold_reason: str,
        score: float | None,
        dedup_suspect: bool,
        dedup_note: str | None,
        proposed_changes: dict[str, dict[str, Any]] | None = None,
        source_urls: list[str] | None = None,
    ) -> str:
        """Insert a held record and return its id."""
        item_id = db.generate_uuid()
        created_at = db.now_iso()
        await conn.execute(
            """
            INSERT INTO review_queue (
                id, org_id, entity_id, kind, status, hold_reason, score,
                dedup_suspect, dedup_note, created_at, proposed_changes, source_urls
            ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                org_id,
                entity_id,
                kind,
                hold_reason,
                score,
                dedup_suspect,
                dedup_note,
                created_at,
                db.encode_json(proposed_changes) if proposed_changes else None,
                db.encode_json(sorted(set(source_urls))) if source_urls else None,
            ),
        )
        await conn.commit()
        return item_id

    @staticmethod
    async def stage_published_change(  # noqa: PLR0913 - review provenance is explicit
        conn: Any,
        *,
        entity_id: str,
        kind: str,
        proposed_changes: dict[str, dict[str, Any]],
        source_urls: list[str] | None = None,
        org_id: str | None = None,
    ) -> str:
        """Keep one reviewable proposal per published entry until a person decides."""
        cursor = await conn.execute(
            """
            SELECT id FROM review_queue
            WHERE entity_id = ? AND status = 'pending' AND hold_reason = ?
            LIMIT 1
            """,
            (entity_id, PUBLISHED_CHANGE_REASON),
        )
        existing = await cursor.fetchone()
        if existing is not None:
            return str(existing[0])
        return await ReviewQueueCRUD.enqueue(
            conn,
            org_id=org_id,
            entity_id=entity_id,
            kind=kind,
            hold_reason=PUBLISHED_CHANGE_REASON,
            score=None,
            dedup_suspect=False,
            dedup_note=None,
            proposed_changes=proposed_changes,
            source_urls=source_urls,
        )

    @staticmethod
    async def enqueue_website_candidates(conn: Any, *, city: str, state: str) -> list[str]:
        """Stage linked organization-site URLs without publishing contact facts."""
        cursor = await conn.execute(
            """
            SELECT e.id, e.website, s.url
            FROM entries e
            JOIN resource_ownership ro ON ro.resource_id = e.id
            JOIN entry_sources es ON es.entry_id = e.id
            JOIN sources s ON s.id = es.source_id
            WHERE ro.resource_type = 'entry'
              AND ro.visibility = 'public'
              AND e.active = TRUE
              AND e.type = 'organization'
              AND e.city = ?
              AND e.state = ?
              AND (e.website IS NULL OR e.website = '')
              AND s.type = 'org_website'
              AND (
                  SELECT COUNT(*) FROM entry_sources linked
                  WHERE linked.source_id = s.id
              ) = 1
            ORDER BY e.id, s.url
            """,
            (city, state),
        )
        candidates: dict[str, tuple[str | None, set[str]]] = {}
        for entity_id, website, source_url in await cursor.fetchall():
            key = str(entity_id)
            if key not in candidates:
                candidates[key] = (website, set())
            candidates[key][1].add(str(source_url))

        review_item_ids: list[str] = []
        for entity_id, (before, urls) in candidates.items():
            if len(urls) != 1 or await ReviewQueueCRUD.has_pending_published_change(
                conn, entity_id=entity_id
            ):
                continue
            url = next(iter(urls))
            if not _reviewable_website_url(url):
                continue
            cursor = await conn.execute(
                """
                SELECT 1 FROM review_queue
                WHERE entity_id = ? AND kind = ? AND status = 'rejected'
                  AND source_urls = ?
                LIMIT 1
                """,
                (entity_id, WEBSITE_CANDIDATE_KIND, db.encode_json([url])),
            )
            if await cursor.fetchone() is not None:
                continue
            review_item_ids.append(
                await ReviewQueueCRUD.stage_published_change(
                    conn,
                    entity_id=entity_id,
                    kind=WEBSITE_CANDIDATE_KIND,
                    proposed_changes={"website": {"before": before, "after": url}},
                    source_urls=[url],
                )
            )
        return review_item_ids

    @staticmethod
    async def list_pending(
        conn: Any, *, limit: int = 50, offset: int = 0, org_id: str | None = None
    ) -> list[ReviewQueueItemModel]:
        """List pending held records oldest-first."""
        if org_id is not None:
            cursor = await conn.execute(
                f"""
                SELECT {_SELECT_COLUMNS} FROM review_queue
                WHERE status = 'pending' AND org_id = ?
                ORDER BY created_at ASC
                LIMIT ? OFFSET ?
                """,
                (org_id, limit, offset),
            )
            rows = await cursor.fetchall()
            return [_row_to_item(row) for row in rows]

        cursor = await conn.execute(
            f"""
            SELECT {_SELECT_COLUMNS} FROM review_queue
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        )
        rows = await cursor.fetchall()
        return [_row_to_item(row) for row in rows]

    @staticmethod
    async def enqueue_stale_public_sources(
        conn: Any,
        *,
        org_id: str | None = None,
        stale_after_days: int = STALE_SOURCE_REVIEW_DAYS,
    ) -> list[str]:
        """Enqueue public records with stale or undated source evidence."""
        rows = await ReviewQueueCRUD._public_entry_source_rows(conn, org_id=org_id)
        threshold = datetime.now(UTC).date() - timedelta(days=stale_after_days)
        review_item_ids: list[str] = []
        for row_org_id, entity_id, latest_source_date, source_count in rows:
            latest_date = coerce_date(latest_source_date)
            if latest_date is not None and latest_date > threshold:
                continue
            if await ReviewQueueCRUD._has_pending_staleness_item(
                conn, org_id=str(row_org_id), entity_id=str(entity_id)
            ):
                continue
            review_item_id = await ReviewQueueCRUD.enqueue(
                conn,
                org_id=str(row_org_id),
                entity_id=str(entity_id),
                kind=STALE_SOURCE_REVIEW_KIND,
                hold_reason=STALE_SOURCE_REVIEW_REASON,
                score=float(source_count),
                dedup_suspect=False,
                dedup_note=(
                    f"Latest source date: {latest_date.isoformat()}"
                    if latest_date is not None
                    else "No dated source"
                ),
            )
            review_item_ids.append(review_item_id)
        return review_item_ids

    @staticmethod
    async def _public_entry_source_rows(
        conn: Any,
        *,
        org_id: str | None,
    ) -> list[tuple[str, str, str | None, int]]:
        """Return public entries with their latest published source date."""
        where_org = "AND ro.org_id = ?" if org_id is not None else ""
        params = (org_id,) if org_id is not None else ()
        cursor = await conn.execute(
            f"""
            SELECT
                ro.org_id,
                e.id,
                MAX(s.published_date),
                COUNT(DISTINCT s.id)
            FROM resource_ownership ro
            JOIN entries e ON e.id = ro.resource_id
            JOIN entry_sources es ON es.entry_id = e.id
            JOIN sources s ON s.id = es.source_id
            WHERE ro.resource_type = 'entry'
              AND ro.visibility = 'public'
              AND e.active = TRUE
              {where_org}
            GROUP BY ro.org_id, e.id
            """,
            params,
        )
        rows = await cursor.fetchall()
        return [(str(row[0]), str(row[1]), row[2], int(row[3] or 0)) for row in rows]

    @staticmethod
    async def _has_pending_staleness_item(conn: Any, *, org_id: str, entity_id: str) -> bool:
        """Return whether a stale-source review item is already pending."""
        cursor = await conn.execute(
            """
            SELECT 1 FROM review_queue
            WHERE status = 'pending'
              AND org_id = ?
              AND entity_id = ?
              AND kind = ?
              AND hold_reason = ?
            LIMIT 1
            """,
            (org_id, entity_id, STALE_SOURCE_REVIEW_KIND, STALE_SOURCE_REVIEW_REASON),
        )
        return await cursor.fetchone() is not None

    @staticmethod
    async def get_by_id(conn: Any, item_id: str) -> ReviewQueueItemModel | None:
        """Fetch one held record by id."""
        cursor = await conn.execute(
            f"SELECT {_SELECT_COLUMNS} FROM review_queue WHERE id = ?",
            (item_id,),
        )
        row = await cursor.fetchone()
        return _row_to_item(row) if row else None

    @staticmethod
    async def approve(conn: Any, item_id: str, *, reviewed_by: str) -> None:
        """Approve a held record: publish its entry and close the item."""
        item = await ReviewQueueCRUD.get_by_id(conn, item_id)
        if item is not None and item.status != "pending":
            return
        if item is None or item.entity_id is None:
            await ReviewQueueCRUD._close(conn, item_id, "approved", reviewed_by)
            return
        if item.proposed_changes is not None:
            await ReviewQueueCRUD._apply_published_change(conn, item)
            await ReviewQueueCRUD._close(conn, item_id, "approved", reviewed_by)
            return
        await conn.execute("UPDATE entries SET active = TRUE WHERE id = ?", (item.entity_id,))
        await ReviewQueueCRUD._close(conn, item_id, "approved", reviewed_by)

    @staticmethod
    async def _apply_published_change(conn: Any, item: ReviewQueueItemModel) -> None:
        """Apply only reviewed fields whose published baseline is still current."""
        assert item.entity_id is not None
        from atlas.domains.catalog.models.entry import EntryCRUD

        entry = await EntryCRUD.get_by_id(conn, item.entity_id)
        if entry is None or not entry.active:
            raise ReviewConflictError(_UNAVAILABLE_PROFILE)
        changes = item.proposed_changes or {}
        await ReviewQueueCRUD._validate_published_change(conn, item, entry, changes)
        await ReviewQueueCRUD._write_staged_entry_fields(conn, item.entity_id, changes)
        await ReviewQueueCRUD._write_staged_issues(conn, item.entity_id, changes)
        await ReviewQueueCRUD._refresh_staged_location(conn, item.entity_id, entry, changes)

    @staticmethod
    async def _validate_published_change(
        conn: Any,
        item: ReviewQueueItemModel,
        entry: Any,
        changes: dict[str, dict[str, Any]],
    ) -> None:
        """Refuse unsupported or stale proposals before changing any public fact."""
        if (
            item.hold_reason != PUBLISHED_CHANGE_REASON
            or not changes
            or set(changes) - (STAGED_ENTRY_FIELDS | {STAGED_ISSUE_FIELD})
        ):
            raise ReviewConflictError(_INVALID_PROPOSAL)
        if item.org_id is not None:
            cursor = await conn.execute(
                """SELECT 1 FROM resource_ownership
                   WHERE resource_id = ? AND resource_type = 'entry'
                     AND org_id = ? AND visibility = 'public' LIMIT 1""",
                (item.entity_id, item.org_id),
            )
            if await cursor.fetchone() is None:
                raise ReviewConflictError(_STALE_PROPOSAL)
        await ReviewQueueCRUD._validate_linked_candidate_source(conn, item)
        for field, change in changes.items():
            if set(change) != {"before", "after"}:
                raise ReviewConflictError(_INVALID_PROPOSAL)
            if field == STAGED_ISSUE_FIELD:
                before_issues = change["before"]
                after_issues = change["after"]
                if (
                    not isinstance(before_issues, list)
                    or not isinstance(after_issues, list)
                    or not all(isinstance(value, str) for value in [*before_issues, *after_issues])
                    or not set(before_issues) <= set(after_issues)
                ):
                    raise ReviewConflictError(_INVALID_PROPOSAL)
                cursor = await conn.execute(
                    "SELECT issue_area FROM entry_issue_areas WHERE entry_id = ?",
                    (item.entity_id,),
                )
                current_issues = sorted(str(row[0]) for row in await cursor.fetchall())
                if current_issues != change["before"]:
                    raise ReviewConflictError(_STALE_PROPOSAL)
            elif getattr(entry, field) != change["before"]:
                raise ReviewConflictError(_STALE_PROPOSAL)
        if item.kind == WEBSITE_CANDIDATE_KIND:
            if set(changes) != {"website"} or item.source_urls != [changes["website"]["after"]]:
                raise ReviewConflictError(_INVALID_PROPOSAL)
            cursor = await conn.execute(
                """
                SELECT 1 FROM entry_sources es
                JOIN sources s ON s.id = es.source_id
                WHERE es.entry_id = ? AND s.url = ? AND s.type = 'org_website'
                  AND (
                      SELECT COUNT(*) FROM entry_sources linked
                      WHERE linked.source_id = s.id
                  ) = 1
                LIMIT 1
                """,
                (item.entity_id, item.source_urls[0]),
            )
            if await cursor.fetchone() is None:
                raise ReviewConflictError(_STALE_PROPOSAL)

    @staticmethod
    async def _validate_linked_candidate_source(conn: Any, item: ReviewQueueItemModel) -> None:
        """Keep proposed public facts tied to a source still on the profile."""
        cursor = await conn.execute(
            """SELECT s.url FROM entry_sources es
               JOIN sources s ON s.id = es.source_id
               WHERE es.entry_id = ?""",
            (item.entity_id,),
        )
        linked_urls = {str(row[0]) for row in await cursor.fetchall()}
        if not linked_urls.intersection(item.source_urls):
            raise ReviewConflictError(_MISSING_CANDIDATE_SOURCE)

    @staticmethod
    async def _write_staged_entry_fields(
        conn: Any, entity_id: str, changes: dict[str, dict[str, Any]]
    ) -> None:
        """Update approved text and contact facts with a baseline guard."""
        updates: dict[str, Any] = {}
        conditions: list[str] = []
        condition_values: list[Any] = []
        for field, change in changes.items():
            if field == STAGED_ISSUE_FIELD:
                continue
            before = change["before"]
            after = change["after"]
            if field == "social_media":
                before = db.encode_json(before) if before is not None else None
                after = db.encode_json(after) if after is not None else None
            updates[field] = after
            if before is None:
                conditions.append(f"{field} IS NULL")
            else:
                conditions.append(f"{field} = ?")
                condition_values.append(before)
        if updates:
            assignments = ", ".join(f"{field} = ?" for field in updates)
            predicate = " AND ".join(conditions)
            cursor = await conn.execute(
                f"""UPDATE entries SET {assignments}, updated_at = ?
                    WHERE id = ? AND active = TRUE AND {predicate}""",
                (*updates.values(), db.now_iso(), entity_id, *condition_values),
            )
            if cursor.rowcount != 1:
                raise ReviewConflictError(_STALE_PROPOSAL)

    @staticmethod
    async def _write_staged_issues(
        conn: Any, entity_id: str, changes: dict[str, dict[str, Any]]
    ) -> None:
        """Add reviewed issue tags after their baseline has been checked."""
        issue_change = changes.get(STAGED_ISSUE_FIELD)
        if issue_change is not None:
            if len(changes) == 1:
                cursor = await conn.execute(
                    "UPDATE entries SET updated_at = ? WHERE id = ? AND active = TRUE",
                    (db.now_iso(), entity_id),
                )
                if cursor.rowcount != 1:
                    raise ReviewConflictError(_STALE_PROPOSAL)
            before_issues = set(issue_change["before"])
            for issue_area in sorted(set(issue_change["after"]) - before_issues):
                await conn.execute(
                    """INSERT INTO entry_issue_areas (entry_id, issue_area, created_at)
                    VALUES (?, ?, ?) ON CONFLICT(entry_id, issue_area) DO NOTHING""",
                    (entity_id, issue_area, db.now_iso()),
                )

    @staticmethod
    async def _refresh_staged_location(
        conn: Any,
        entity_id: str,
        entry: Any,
        changes: dict[str, dict[str, Any]],
    ) -> None:
        """Replace stale map coordinates when reviewed place facts change."""
        if not {"city", "state", "full_address"} & changes.keys():
            return
        from atlas.domains.catalog.geo import geocode_entry

        def approved_value(field: str) -> Any:
            return changes[field]["after"] if field in changes else getattr(entry, field)

        located = await geocode_entry(
            approved_value("city"),
            approved_value("state"),
            approved_value("full_address"),
            allow_remote=False,
        )
        await conn.execute(
            """UPDATE entries SET latitude = ?, longitude = ?,
               geocode_precision = ?, geocode_source = ? WHERE id = ?""",
            (
                located.latitude if located else None,
                located.longitude if located else None,
                located.precision if located else None,
                located.source if located else None,
                entity_id,
            ),
        )

    @staticmethod
    async def release_resolved(conn: Any, *, entity_id: str) -> bool:
        """Publish a record the resolution stage now finds publishable.

        The gate that held a record runs again whenever a later run resolves
        the same entity, so a person held because their return was stale
        publishes once a newer return lists them. Every pending hold that
        resolution can decide is closed as approved by ``registry``.

        Nothing changes when a curator rejected the record, because a human
        decision outranks later automated evidence, or when a possible
        duplicate is pending, because merging is a reviewer's decision.

        Parameters
        ----------
        conn
            Open database connection.
        entity_id : str
            The entry resolution found publishable.

        Returns
        -------
        bool
            True when the entry was published.
        """
        cursor = await conn.execute(
            """
            SELECT 1 FROM review_queue
            WHERE entity_id = ?
              AND (status = 'rejected' OR (status = 'pending' AND hold_reason = ?))
            LIMIT 1
            """,
            (entity_id, "dedup_suspect"),
        )
        if await cursor.fetchone() is not None:
            return False
        placeholders = ", ".join("?" for _ in RESOLVABLE_HOLD_REASONS)
        cursor = await conn.execute(
            f"""
            SELECT id FROM review_queue
            WHERE entity_id = ? AND status = 'pending' AND hold_reason IN ({placeholders})
            """,
            (entity_id, *sorted(RESOLVABLE_HOLD_REASONS)),
        )
        for row in await cursor.fetchall():
            await ReviewQueueCRUD._close(conn, row[0], "approved", "registry")
        await conn.execute("UPDATE entries SET active = TRUE WHERE id = ?", (entity_id,))
        await conn.commit()
        return True

    @staticmethod
    async def hold_for_resolution(
        conn: Any,
        *,
        entity_id: str,
        kind: str,
        hold_reason: str,
        source_urls: list[str] | None = None,
    ) -> None:
        """Queue a resolution hold for review once per entity and reason.

        A run resolves the same entities again and again. Queuing only once
        keeps an ambiguous name a curator already approved from returning to
        the queue on every run.

        Parameters
        ----------
        conn
            Open database connection.
        entity_id : str
            The entry resolution held.
        kind : str
            The entry's type.
        hold_reason : str
            Why resolution held it.
        """
        cursor = await conn.execute(
            "SELECT 1 FROM review_queue WHERE entity_id = ? AND hold_reason = ? LIMIT 1",
            (entity_id, hold_reason),
        )
        if await cursor.fetchone() is not None:
            return
        await ReviewQueueCRUD.enqueue(
            conn,
            entity_id=entity_id,
            kind=kind,
            hold_reason=hold_reason,
            score=None,
            dedup_suspect=False,
            dedup_note=None,
            source_urls=source_urls,
        )

    @staticmethod
    async def reject(conn: Any, item_id: str, *, reviewed_by: str) -> None:
        """Reject a held record: leave its entry inactive, close the item."""
        await ReviewQueueCRUD._close(conn, item_id, "rejected", reviewed_by)

    @staticmethod
    async def _close(conn: Any, item_id: str, status: str, reviewed_by: str) -> None:
        await conn.execute(
            "UPDATE review_queue SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?",
            (status, db.now_iso(), reviewed_by, item_id),
        )
        await conn.commit()
        from atlas.domains.firehose.producers import record_review_decision_observation

        await record_review_decision_observation(
            conn,
            review_item_id=item_id,
            status=status,
            reviewed_by=reviewed_by,
        )

    @staticmethod
    async def count_pending(conn: Any) -> int:
        """Count records still awaiting review."""
        cursor = await conn.execute("SELECT COUNT(*) FROM review_queue WHERE status = 'pending'")
        row = await cursor.fetchone()
        return int(row[0]) if row else 0
