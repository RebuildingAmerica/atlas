"""Typed mentions: what a source asserts about an actor, before Atlas stores it.

A mention keeps every signal resolution needs, such as a stable identifier, the
organization a person was named by, and the date a role was last evidenced.
The previous pipeline flattened each of these into a name and a sentence of
description, and then tried to recover them with heuristics.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import date

    from atlas_shared import PageContent

__all__ = ["OrganizationMention", "PersonMention", "RoleMention"]


@dataclass(frozen=True)
class OrganizationMention:
    """A register row naming one organization by its EIN."""

    name: str
    ein: str
    city: str | None
    state: str | None
    website: str | None
    source: PageContent
    """The register page that lists the organization."""
    context: str
    """What the register asserts, in words a visitor can check against it."""


@dataclass(frozen=True)
class RoleMention:
    """A role a source says a person holds at an organization."""

    relationship_type: str
    """``officer``, ``board_member``, ``staff`` or ``officer_or_director``."""
    evidence_label: str
    """The role as the source states it, shown on both profiles' connections."""
    observed_on: date | None
    """The date the source's evidence applies to, such as a tax period end."""
    current: bool
    """True when the evidence is recent and does not say the role ended."""


@dataclass(frozen=True)
class PersonMention:
    """A person a filing names in a role at an organization it also names."""

    name: str
    """The name as the filer wrote it."""
    display_name: str
    """The name cased for reading."""
    organization: OrganizationMention
    role: RoleMention
    type_conflict: bool
    """True when the row's signals disagree about whether it names a person."""
    source: PageContent
    """The return that names the person."""
    context: str
    """What the return asserts about the person."""
