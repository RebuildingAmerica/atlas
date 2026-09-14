"""What one IRS Form 990, 990-EZ or 990-PF return says about the people it lists.

A return is structured: it records whether a listed name is a person or a
business, which roles the filer checked for that row, and the tax period the
return covers. This module keeps that structure instead of flattening a row to
a name, so whoever resolves a row can tell a bank from a person, a former
officer from a current one, and a stale return from a fresh one without
guessing from the text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from datetime import date
from enum import StrEnum
from typing import TYPE_CHECKING

from defusedxml.ElementTree import fromstring

if TYPE_CHECKING:
    from xml.etree.ElementTree import Element

__all__ = [
    "FilingOfficer",
    "FilingPosition",
    "FilingReturn",
    "NameField",
    "parse_return",
]

# Form 990 lists officers in Part VII, 990-EZ in Part IV, 990-PF in Part VIII.
_OFFICER_GROUPS = frozenset(
    {"Form990PartVIISectionAGrp", "OfficerDirectorTrusteeEmplGrp", "OfficerDirTrstKeyEmplGrp"}
)
_CHECKED = frozenset({"x", "true", "1"})
# Filers state a departure in the title as often as they set the former flag,
# as in "FORMER PRESI" or "Treasurer (resigned)". The title is the filer's own
# statement about the role, so reading it is reading the return.
_DEPARTED_TITLE = re.compile(r"\b(resigned|deceased|former|terminated)\b", re.IGNORECASE)


class NameField(StrEnum):
    """Which name field the filer wrote a row's name into."""

    PERSON = "person"
    BUSINESS = "business"


class FilingPosition(StrEnum):
    """A box the filer checked for a row. Form 990 Part VII has them; EZ and PF do not."""

    TRUSTEE_OR_DIRECTOR = "IndividualTrusteeOrDirectorInd"
    INSTITUTIONAL_TRUSTEE = "InstitutionalTrusteeInd"
    OFFICER = "OfficerInd"
    KEY_EMPLOYEE = "KeyEmployeeInd"
    HIGHEST_COMPENSATED = "HighestCompensatedEmployeeInd"
    FORMER = "FormerOfcrDirectorTrusteeInd"


@dataclass(frozen=True)
class FilingOfficer:
    """One name a return lists among its officers, directors, trustees and employees."""

    name: str
    """The name as the filer wrote it, with whitespace normalized."""

    title: str | None
    """The role the return gives the row, when it gives one."""

    name_field: NameField = NameField.PERSON
    """Whether the filer recorded the name as a person or a business."""

    positions: frozenset[FilingPosition] = frozenset()
    """The boxes checked for the row. Empty on forms that have none."""

    @property
    def left_role(self) -> bool:
        """Report whether the return says this row no longer holds the role."""
        if FilingPosition.FORMER in self.positions:
            return True
        return bool(self.title and _DEPARTED_TITLE.search(self.title))


@dataclass(frozen=True)
class FilingReturn:
    """The parts of a return that say who ran the filer, and when."""

    return_type: str | None
    """``990``, ``990EZ`` or ``990PF``, as the return header records it."""

    tax_period_end: date | None
    """The last day of the tax period the return covers."""

    officers: tuple[FilingOfficer, ...]
    """Every listed name, in filing order, each listed once."""


def parse_return(document: bytes) -> FilingReturn:
    """Read the header and officer rows out of a return.

    A name listed twice in one return, such as an officer who changed roles
    mid-year, becomes one row carrying every position checked for it. It counts
    as having left only when every listing says so.

    Parameters
    ----------
    document : bytes
        The return's XML.

    Returns
    -------
    FilingReturn
        The return's type, tax period and officer rows.

    Raises
    ------
    xml.etree.ElementTree.ParseError
        When the return is not well-formed XML.
    defusedxml.DefusedXmlException
        When the return tries entity expansion or an external reference.
    """
    root = fromstring(document)
    seen: dict[tuple[NameField, str], FilingOfficer] = {}
    for element in root.iter():
        if _local_name(element) not in _OFFICER_GROUPS:
            continue
        row = _officer_row(element)
        if row is None:
            continue
        key = (row.name_field, row.name.casefold())
        seen[key] = _merge(seen[key], row) if key in seen else row
    header = next((e for e in root.iter() if _local_name(e) == "ReturnHeader"), None)
    return FilingReturn(
        return_type=_child_text(header, "ReturnTypeCd") if header is not None else None,
        tax_period_end=_tax_period_end(header),
        officers=tuple(seen.values()),
    )


def _officer_row(element: Element) -> FilingOfficer | None:
    """Read one officer group, or None when it names nobody."""
    positions = frozenset(
        position
        for position in FilingPosition
        if (_child_text(element, position.value) or "").casefold() in _CHECKED
    )
    title = _child_text(element, "TitleTxt")
    person = _child_text(element, "PersonNm")
    if person is not None:
        return FilingOfficer(person, title, NameField.PERSON, positions)
    business = element.find("{*}BusinessName")
    if business is None:
        return None
    lines = (_child_text(business, f"BusinessNameLine{n}Txt") for n in (1, 2))
    name = " ".join(line for line in lines if line)
    return FilingOfficer(name, title, NameField.BUSINESS, positions) if name else None


def _merge(first: FilingOfficer, second: FilingOfficer) -> FilingOfficer:
    """Combine two listings of the same name in one return."""
    current = second if first.left_role and not second.left_role else first
    positions = first.positions | second.positions
    if not (first.left_role and second.left_role):
        positions -= {FilingPosition.FORMER}
    return replace(current, title=current.title or first.title or second.title, positions=positions)


def _tax_period_end(header: Element | None) -> date | None:
    """Read the tax period end date, or None when the header omits or garbles it."""
    text = _child_text(header, "TaxPeriodEndDt") if header is not None else None
    try:
        return date.fromisoformat(text) if text else None
    except ValueError:
        return None


def _child_text(element: Element, name: str) -> str | None:
    """Return a direct child's whitespace-normalized text, or None when blank."""
    child = element.find(f"{{*}}{name}")
    text = " ".join((child.text or "").split()) if child is not None else ""
    return text or None


def _local_name(element: Element) -> str:
    """Return an element's tag without the IRS e-file namespace."""
    return element.tag.rpartition("}")[2]
