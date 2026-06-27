"""Connection computation: a ranked, scored, evidence-rich network for an actor.

Merges the meaningful links between civic actors — a shared organization,
co-mentions in the same sources, and shared issue areas within the same state —
into ONE ranked list of connected actors, each carrying a strength score and the
reasons behind it. Same-city geography is a ranking *nudge*, never a connection
on its own: otherwise everyone in a city floods the list as noise. There is no
fake cap — the true ``total`` is reported and the caller paginates — so a user
never sees "10 related" when there are a hundred.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from atlas.domains.catalog.models.entry import EntryCRUD, _row_to_entry
from atlas.domains.catalog.models.relationships import RelationshipCRUD

if TYPE_CHECKING:
    from collections.abc import Iterable

    import aiosqlite

    from atlas.domains.catalog.models.entry import EntryModel

# How much each kind of link contributes to a connection's strength.
AFFILIATION_POINTS = 5.0  # holding or sharing an organizational affiliation
SHARED_SOURCE_POINTS = 2.0  # per source two actors are co-mentioned in
SHARED_ISSUE_POINTS = 1.0  # per issue area shared within the same state
SAME_CITY_BOOST = 0.5  # nudge for an already-linked actor in the same city
SOURCED_EDGE_POINTS = 6.0  # explicit source-backed relationship edge

# Strength tiers on the 0-100 normalized scale.
STRONG_TIER_MIN = 67
MODERATE_TIER_MIN = 34

DEFAULT_LIMIT = 20
_SNIPPET_LENGTH = 120


@dataclass
class ConnectionReason:
    """One explainable reason two actors are connected."""

    kind: str
    label: str
    count: int | None = None
    source_id: str | None = None
    relationship_type: str | None = None


@dataclass
class _Candidate:
    """A connected actor accumulated across signals before ranking."""

    entry: EntryModel
    score: float = 0.0
    reasons: list[ConnectionReason] = field(default_factory=list)


@dataclass
class ConnectedActor:
    """A ranked connected actor for the public response."""

    id: str
    name: str
    type: str
    slug: str | None
    description_snippet: str | None
    score: float
    strength: int
    tier: str
    reasons: list[ConnectionReason]
    evidence: str


@dataclass
class ConnectionsResult:
    """The ranked connection set for an actor."""

    actors: list[ConnectedActor]
    total: int


def _tier_for_strength(strength: int) -> str:
    """Map a 0-100 strength to a coarse tier label."""
    if strength >= STRONG_TIER_MIN:
        return "strong"
    if strength >= MODERATE_TIER_MIN:
        return "moderate"
    return "weak"


def _snippet(entry: EntryModel) -> str | None:
    """A short description preview, or None when there is no description."""
    return (entry.description or "")[:_SNIPPET_LENGTH] or None


def _pluralize(count: int, noun: str) -> str:
    """Render ``count noun`` with a naive plural."""
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def _bump(
    candidates: dict[str, _Candidate],
    entry: EntryModel,
    points: float,
    reason: ConnectionReason,
) -> None:
    """Accumulate score and a reason onto a candidate, creating it if new."""
    candidate = candidates.get(entry.id)
    if candidate is None:
        candidate = _Candidate(entry=entry)
        candidates[entry.id] = candidate
    candidate.score += points
    candidate.reasons.append(reason)


def _rows_to_entries(cursor: Any, rows: Iterable[Any]) -> list[tuple[EntryModel, dict[str, Any]]]:
    """Turn raw rows into (entry, row_dict) pairs, preserving extra columns."""
    columns = [desc[0] for desc in cursor.description]
    pairs: list[tuple[EntryModel, dict[str, Any]]] = []
    for row in rows:
        row_dict = dict(zip(columns, row, strict=False))
        pairs.append((_row_to_entry(row_dict), row_dict))
    return pairs


async def _add_same_organization(
    conn: aiosqlite.Connection, entry: EntryModel, candidates: dict[str, _Candidate]
) -> None:
    """Add the entry's organization and its co-affiliated actors."""
    if entry.type == "person" and entry.affiliated_org_id:
        org = await EntryCRUD.get_by_id(conn, entry.affiliated_org_id)
        assert org is not None, "FK constraint guarantees affiliated_org_id resolves"
        _bump(
            candidates,
            org,
            AFFILIATION_POINTS,
            ConnectionReason(kind="same_organization", label="Their organization"),
        )
        cursor = await conn.execute(
            "SELECT * FROM entries WHERE affiliated_org_id = ? AND id != ? AND active = 1",
            (entry.affiliated_org_id, entry.id),
        )
        rows = await cursor.fetchall()
        for other, _ in _rows_to_entries(cursor, rows):
            _bump(
                candidates,
                other,
                AFFILIATION_POINTS,
                ConnectionReason(kind="same_organization", label=f"Also at {org.name}"),
            )
    elif entry.type == "organization":
        cursor = await conn.execute(
            "SELECT * FROM entries WHERE affiliated_org_id = ? AND active = 1",
            (entry.id,),
        )
        rows = await cursor.fetchall()
        for person, _ in _rows_to_entries(cursor, rows):
            _bump(
                candidates,
                person,
                AFFILIATION_POINTS,
                ConnectionReason(kind="same_organization", label=f"On the team at {entry.name}"),
            )


async def _add_co_mentioned(
    conn: aiosqlite.Connection, entry_id: str, candidates: dict[str, _Candidate]
) -> None:
    """Add actors co-mentioned in the same sources, weighted by shared count."""
    cursor = await conn.execute(
        """
        SELECT e.*,
               COUNT(DISTINCT es1.source_id) AS shared_sources,
               MAX(s.publication) AS sample_publication
        FROM entries e
        JOIN entry_sources es1 ON es1.entry_id = e.id
        JOIN entry_sources es2 ON es2.source_id = es1.source_id
        JOIN sources s ON s.id = es1.source_id
        WHERE es2.entry_id = ? AND e.id != ? AND e.active = 1
        GROUP BY e.id
        """,
        (entry_id, entry_id),
    )
    rows = await cursor.fetchall()
    for other, row_dict in _rows_to_entries(cursor, rows):
        shared = int(row_dict["shared_sources"])
        publication = row_dict.get("sample_publication")
        label = f"Co-mentioned in {_pluralize(shared, 'source')}"
        if publication:
            label = f"{label} ({publication})"
        _bump(
            candidates,
            other,
            SHARED_SOURCE_POINTS * shared,
            ConnectionReason(kind="co_mentioned", label=label, count=shared),
        )


async def _add_same_issue_area(
    conn: aiosqlite.Connection, entry: EntryModel, candidates: dict[str, _Candidate]
) -> None:
    """Add actors sharing issue areas in the same state, weighted by overlap."""
    issue_areas = await EntryCRUD.get_issue_areas(conn, entry.id)
    if not issue_areas or not entry.state:
        return

    placeholders = ", ".join("?" for _ in issue_areas)
    cursor = await conn.execute(
        f"""
        SELECT e.*, COUNT(DISTINCT eia.issue_area) AS overlap
        FROM entries e
        JOIN entry_issue_areas eia ON eia.entry_id = e.id
        WHERE eia.issue_area IN ({placeholders})
        AND e.state = ?
        AND e.id != ?
        AND e.active = 1
        GROUP BY e.id
        """,
        (*issue_areas, entry.state, entry.id),
    )
    rows = await cursor.fetchall()
    for other, row_dict in _rows_to_entries(cursor, rows):
        overlap = int(row_dict["overlap"])
        _bump(
            candidates,
            other,
            SHARED_ISSUE_POINTS * overlap,
            ConnectionReason(
                kind="same_issue_area",
                label=f"Shares {_pluralize(overlap, 'issue area')} in {entry.state}",
                count=overlap,
            ),
        )


async def _add_sourced_edges(
    conn: aiosqlite.Connection, entry_id: str, candidates: dict[str, _Candidate]
) -> None:
    """Add durable source-backed relationship edges touching the entry."""
    edges = await RelationshipCRUD.list_edges_for_entry(conn, entry_id)
    for edge in edges:
        connected_entry_id = (
            edge.target_entry_id if edge.source_entry_id == entry_id else edge.source_entry_id
        )
        connected_entry = await EntryCRUD.get_by_id(conn, connected_entry_id)
        if connected_entry is None or not connected_entry.active:
            continue
        _bump(
            candidates,
            connected_entry,
            SOURCED_EDGE_POINTS * edge.confidence,
            ConnectionReason(
                kind="sourced_edge",
                label=edge.evidence_label,
                count=edge.evidence_count,
                source_id=edge.source_id,
                relationship_type=edge.relationship_type,
            ),
        )


def _apply_city_boost(entry: EntryModel, candidates: dict[str, _Candidate]) -> None:
    """Nudge already-linked candidates that share the entry's city upward."""
    if not entry.city:
        return
    for candidate in candidates.values():
        if candidate.entry.city == entry.city and candidate.entry.state == entry.state:
            candidate.score += SAME_CITY_BOOST
            candidate.reasons.append(
                ConnectionReason(
                    kind="same_geography",
                    label=f"Both active in {entry.city}, {entry.state}",
                )
            )


def _to_actor(candidate: _Candidate, top_score: float) -> ConnectedActor:
    """Project a scored candidate into the ranked public actor shape.

    ``top_score`` is always positive here: a candidate only exists once a signal
    has added points, so the strongest connection's score is never zero.
    """
    strength = round(100 * candidate.score / top_score)
    return ConnectedActor(
        id=candidate.entry.id,
        name=candidate.entry.name,
        type=candidate.entry.type,
        slug=candidate.entry.slug,
        description_snippet=_snippet(candidate.entry),
        score=round(candidate.score, 2),
        strength=strength,
        tier=_tier_for_strength(strength),
        reasons=candidate.reasons,
        evidence=candidate.reasons[0].label,
    )


async def compute_connections(
    conn: aiosqlite.Connection,
    entry_id: str,
    *,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
) -> ConnectionsResult:
    """Compute the ranked connection network for an entry.

    Merges organizational affiliation, source co-mentions, and shared issue
    areas (same state) into one deduped, strength-ranked list, nudged by shared
    geography. The reasons are ordered strongest-first, so ``evidence`` is the
    most important reason. The full ``total`` is reported regardless of ``limit``.

    Parameters
    ----------
    conn : aiosqlite.Connection
        Database connection.
    entry_id : str
        The entry whose connections to compute.
    limit : int
        Maximum actors to return in this page.
    offset : int
        Number of top-ranked actors to skip.

    Returns
    -------
    ConnectionsResult
        Ranked connected actors plus the true total before pagination.
    """
    entry = await EntryCRUD.get_by_id(conn, entry_id)
    if entry is None:
        return ConnectionsResult(actors=[], total=0)

    candidates: dict[str, _Candidate] = {}
    await _add_same_organization(conn, entry, candidates)
    await _add_sourced_edges(conn, entry_id, candidates)
    await _add_co_mentioned(conn, entry_id, candidates)
    await _add_same_issue_area(conn, entry, candidates)
    _apply_city_boost(entry, candidates)

    ranked = sorted(candidates.values(), key=lambda c: (-c.score, c.entry.name.lower()))
    top_score = ranked[0].score if ranked else 0.0
    page = ranked[offset : offset + limit]
    return ConnectionsResult(
        actors=[_to_actor(candidate, top_score) for candidate in page],
        total=len(ranked),
    )
