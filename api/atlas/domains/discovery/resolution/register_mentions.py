"""Turn register rows and IRS returns into typed mentions.

Every decision here reads structure the IRS or the register already provides:
the EIN, the field a filer wrote a name into, the boxes checked for a row, and
the tax period a return covers. The one inference is a cross-check on names.
It can only hold a row for review, never publish one.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import TYPE_CHECKING

import probablepeople
from atlas_discovery_engine import FilingPosition, NameField
from atlas_shared import PageContent, SourceType
from nameparser import HumanName

from atlas.domains.discovery.resolution.mentions import (
    OrganizationMention,
    PersonMention,
    RoleMention,
)

if TYPE_CHECKING:
    from atlas_discovery_engine import FilingOfficer, OrganizationFiling, RegistryOrganization

__all__ = [
    "CURRENT_ROLE_WINDOW",
    "display_name",
    "organization_mention",
    "person_mentions",
]

_PUBLICATION = "ProPublica Nonprofit Explorer"
# Nonprofits file up to 10.5 months after their tax year ends, so a window
# shorter than a year would call every current board stale. Two years admits
# the latest return of a filer that is on time and drops one that stopped.
CURRENT_ROLE_WINDOW = timedelta(days=730)


def organization_mention(organization: RegistryOrganization) -> OrganizationMention | None:
    """Describe a register row, or return None when it names nobody.

    Parameters
    ----------
    organization : RegistryOrganization
        One row from the register.

    Returns
    -------
    OrganizationMention | None
        The mention, or None for a nameless row.
    """
    if not organization.name:
        return None
    where = ", ".join(part for part in (organization.city, organization.state) if part)
    context = f"Registered nonprofit filing IRS Form 990 under EIN {organization.registry_id}"
    if where:
        context += f", based in {where}"
    if organization.category_code:
        context += f", classified {organization.category_code}"
    return OrganizationMention(
        name=organization.name,
        ein=organization.registry_id,
        city=organization.city,
        state=organization.state,
        website=organization.website,
        source=PageContent(
            url=organization.source_url,
            title=f"{organization.name}: IRS Form 990 filings",
            publication=_PUBLICATION,
            source_type=SourceType.GOVERNMENT_RECORD,
        ),
        context=f"{context}.",
    )


def person_mentions(
    organization: OrganizationMention, filing: OrganizationFiling, *, today: date
) -> list[PersonMention]:
    """Describe every person a return lists.

    A row the filer wrote into the business-name field names an organization,
    such as a bank serving as trustee, so it yields no person.

    Parameters
    ----------
    organization : OrganizationMention
        The organization that filed the return.
    filing : OrganizationFiling
        The return and its officer rows.
    today : date
        The date the currency of a role is judged against.

    Returns
    -------
    list[PersonMention]
        One mention per person row, in filing order.
    """
    source = PageContent(
        url=filing.source_url,
        title=f"{organization.name}: IRS Form {_form(filing)} return {filing.object_id}",
        publication=_PUBLICATION,
        source_type=SourceType.GOVERNMENT_RECORD,
    )
    return [
        PersonMention(
            name=officer.name,
            display_name=display_name(officer.name),
            organization=organization,
            role=_role(officer, filing, today=today),
            type_conflict=_type_conflict(officer),
            source=source,
            context=_context(officer, organization, filing),
        )
        for officer in filing.officers
        if officer.name_field is NameField.PERSON
    ]


def display_name(name: str) -> str:
    """Case a filer's name for reading, leaving deliberate mixed case alone.

    ``nameparser`` knows the rules a title-case call breaks, such as McDonald,
    O'Brien and van der Berg, and it only recases a name written entirely in
    upper or lower case.

    Parameters
    ----------
    name : str
        The name as the filer wrote it.

    Returns
    -------
    str
        The name for display.
    """
    parsed = HumanName(name)
    parsed.capitalize()
    return str(parsed) or name


def _type_conflict(officer: FilingOfficer) -> bool:
    """Report whether anything about a person-name row says it is not a person.

    The institutional-trustee box contradicts the person-name field directly.
    Where a form has no boxes, ``probablepeople``, trained on campaign-finance
    donor names, flags rows like "BANK OF AMERICA N A" and names carrying
    notes such as "Sarah Stone until fall 2024".
    """
    if FilingPosition.INSTITUTIONAL_TRUSTEE in officer.positions:
        return True
    try:
        _, kind = probablepeople.tag(officer.name)
    except probablepeople.RepeatedLabelError:
        return True
    return bool(kind != "Person")


def _role(officer: FilingOfficer, filing: OrganizationFiling, *, today: date) -> RoleMention:
    """Date and type the role a row records."""
    period_end = filing.tax_period_end
    recent = period_end is not None and today - period_end <= CURRENT_ROLE_WINDOW
    label = officer.title or "Listed officer, director or trustee"
    if period_end is not None:
        label += f", Form {_form(filing)} for the period ending {period_end:%B %Y}"
    return RoleMention(
        relationship_type=_relationship_type(officer.positions),
        evidence_label=label,
        observed_on=period_end,
        current=recent and not officer.left_role,
    )


def _relationship_type(positions: frozenset[FilingPosition]) -> str:
    """Name the relationship a row's checked boxes establish."""
    if FilingPosition.OFFICER in positions:
        return "officer"
    if FilingPosition.TRUSTEE_OR_DIRECTOR in positions:
        return "board_member"
    if positions & {FilingPosition.KEY_EMPLOYEE, FilingPosition.HIGHEST_COMPENSATED}:
        return "staff"
    # Form 990-EZ and 990-PF list officers, directors and trustees together
    # with no boxes, so the return does not say which of the three a row is.
    return "officer_or_director"


def _context(
    officer: FilingOfficer, organization: OrganizationMention, filing: OrganizationFiling
) -> str:
    """State what the return asserts about a person, and nothing more."""
    role = officer.title or "an officer, director or trustee"
    period = (
        f" for the period ending {filing.tax_period_end:%B %Y}" if filing.tax_period_end else ""
    )
    return f"Listed as {role} of {organization.name} on its IRS Form {_form(filing)}{period}."


def _form(filing: OrganizationFiling) -> str:
    """Spell a return type the way the IRS names the form, as in 990-EZ."""
    code = filing.return_type or "990"
    return f"990-{code[3:]}" if len(code) > len("990") else code
