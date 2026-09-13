"""Link a mention to the actor Atlas already holds, or decide it is new.

The order follows docs/design/firehose/analysis-and-resolution-pipeline.md:
stable identifiers first, then a name inside strong context, and never a name
on its own. An organization resolves on its EIN. A person resolves only inside
the organization whose return names them, so two people who share a name stay
two records, and the chance that they are one person reaches a reviewer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from atlas_discovery_engine import ProPublicaRegistryProvider

from atlas.domains.catalog.models.relationships import RelationshipCRUD
from atlas.models import EntryCRUD

if TYPE_CHECKING:
    from aiosqlite import Connection

    from atlas.domains.catalog.models.entry import EntryModel
    from atlas.domains.discovery.resolution.mentions import OrganizationMention, PersonMention

__all__ = ["PersonMatch", "match_organization", "match_person"]


@dataclass(frozen=True)
class PersonMatch:
    """Where a person mention resolved."""

    entry: EntryModel | None
    """The existing person, or None when the mention is a new person."""
    ambiguous: bool
    """True when another person of the same name in the state could be them."""


async def match_organization(conn: Connection, mention: OrganizationMention) -> EntryModel | None:
    """Find the organization a register row describes.

    The EIN decides. A record with no EIN yet, such as one found on the web
    before the register, matches on its exact name and place, and only when it
    does not already carry a different EIN.

    Parameters
    ----------
    conn : Connection
        Database connection.
    mention : OrganizationMention
        The register row.

    Returns
    -------
    EntryModel | None
        The existing organization, or None when it is new to Atlas.
    """
    keyed = await RelationshipCRUD.resolve_identity_key(conn, key_type="ein", key_value=mention.ein)
    if keyed is not None:
        return await EntryCRUD.get_by_id(conn, keyed)
    named = await EntryCRUD.find_by_name(
        conn, entry_type="organization", name=mention.name, state=mention.state, city=mention.city
    )
    if named is None or await RelationshipCRUD.has_identity_key(
        conn, entry_id=named.id, key_type="ein"
    ):
        return None
    return named


async def match_person(
    conn: Connection, mention: PersonMention, *, organization_id: str
) -> PersonMatch:
    """Find the person a return names, within the organization that filed it.

    A person matches when they already hold a relationship to the organization,
    or when they already cite one of its returns, which is how people stored
    before relationships existed are found again. Any other person with the
    same name in the same state makes the mention ambiguous.

    Parameters
    ----------
    conn : Connection
        Database connection.
    mention : PersonMention
        The person the return names.
    organization_id : str
        The resolved organization that filed the return.

    Returns
    -------
    PersonMatch
        The matched person, if any, and whether the name is ambiguous.
    """
    names = sorted({mention.name.strip().lower(), mention.display_name.strip().lower()})
    returns_prefix = f"{ProPublicaRegistryProvider.ORGANIZATION_URL}/{mention.organization.ein}/%"
    cursor = await conn.execute(
        f"""
        SELECT
            e.id,
            e.state,
            EXISTS (
                SELECT 1 FROM entity_relationship_edges r
                WHERE r.source_entry_id = e.id AND r.target_entry_id = ?
            ),
            EXISTS (
                SELECT 1 FROM entry_sources es JOIN sources s ON s.id = es.source_id
                WHERE es.entry_id = e.id AND s.url LIKE ?
            )
        FROM entries e
        WHERE e.type = 'person' AND LOWER(TRIM(e.name)) IN ({", ".join("?" for _ in names)})
        ORDER BY e.updated_at DESC
        """,
        (organization_id, returns_prefix, *names),
    )
    rows = await cursor.fetchall()
    linked = [row for row in rows if row[2]] or [row for row in rows if row[3]]
    matched_id = str(linked[0][0]) if linked else None
    others = [
        row for row in rows if str(row[0]) != matched_id and row[1] == mention.organization.state
    ]
    entry = await EntryCRUD.get_by_id(conn, matched_id) if matched_id else None
    return PersonMatch(entry=entry, ambiguous=bool(others))
