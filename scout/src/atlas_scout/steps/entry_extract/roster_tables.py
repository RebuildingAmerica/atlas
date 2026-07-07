"""Mid-level roster extraction helpers for entry extraction."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from atlas_shared import RawEntry

from atlas_scout.steps.entry_extract.roster_utils import (
    _ROSTER_PARTY_LABELS,
    _SENATE_CONTACT_HEADER_RE,
    _affiliated_org_from_url,
    _cell_at,
    _clean_pipe_cell,
    _is_markdown_separator_row,
    _looks_like_numbered_roster_row,
    _looks_like_roster_header,
    _normalize_roster_name,
    _optional_cell_index,
    _plain_text_roster_data_start,
    _roster_name_column_index,
    _split_markdown_table_row,
    _strip_civic_title_prefix,
)

if TYPE_CHECKING:
    from atlas_shared import PageContent


def _extract_roster_table_entries(page: PageContent, *, city: str, state: str) -> list[RawEntry]:
    """Extract public-office roster rows from markdown-like tables."""
    entries: list[RawEntry] = []
    name_index: int | None = None
    district_index: int | None = None
    party_index: int | None = None
    source_date = page.published_date.date() if page.published_date else None

    for line in page.text.splitlines():
        row = line.strip()
        if not row.startswith("|") or not row.endswith("|"):
            continue

        cells = _split_markdown_table_row(row)
        if not cells or _is_markdown_separator_row(cells):
            continue

        normalized_cells = [cell.strip().lower() for cell in cells]
        header_name_index = _roster_name_column_index(normalized_cells)
        if header_name_index is not None and _looks_like_roster_header(normalized_cells):
            name_index = header_name_index
            district_index = _optional_cell_index(normalized_cells, "district")
            party_index = _optional_cell_index(normalized_cells, "party")
            continue

        if _looks_like_numbered_roster_row(cells):
            district = cells[0].strip()
            name = _normalize_roster_name(_strip_civic_title_prefix(cells[1]))
            jurisdiction = cells[2].strip()
            party = cells[3].strip()
            entries.append(
                RawEntry(
                    name=name,
                    entry_type="person",
                    description=(
                        f"{name} is listed as a public officeholder for District {district} "
                        f"in {jurisdiction} with party marker {party}."
                    ),
                    city=city or None,
                    state=state or None,
                    geo_specificity="local",
                    issue_areas=["local_government_and_civic_engagement"],
                    website=page.url,
                    affiliated_org=_affiliated_org_from_url(page.url),
                    extraction_context=row,
                    source_url=page.url,
                    source_date=source_date,
                )
            )
            continue

        if name_index is None or name_index >= len(cells):
            continue

        name = _normalize_roster_name(cells[name_index])
        if not name:
            continue

        district = _cell_at(cells, district_index)
        party = _cell_at(cells, party_index)
        description_parts = [f"{name} is listed as a public officeholder"]
        if district:
            description_parts.append(f"for {district}")
        if party:
            description_parts.append(f"with party marker {party}")
        description_parts.append("in the source roster.")

        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=" ".join(description_parts),
                city=city or None,
                state=state or None,
                geo_specificity="local",
                issue_areas=[
                    "political_polarization_and_democratic_norms",
                    "electoral_reform",
                ],
                website=page.url,
                affiliated_org=_affiliated_org_from_url(page.url),
                extraction_context=row,
                source_url=page.url,
                source_date=source_date,
            )
        )

    return entries


def _extract_senate_contact_entries(page: PageContent, *, city: str, state: str) -> list[RawEntry]:
    """Extract senators from senate.gov contact XML rendered as line blocks."""
    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    lines = [line.strip() for line in page.text.splitlines() if line.strip()]

    for index, line in enumerate(lines):
        match = _SENATE_CONTACT_HEADER_RE.match(line)
        if match is None or index + 8 >= len(lines):
            continue

        last_name = lines[index + 1]
        first_name = lines[index + 2]
        party = lines[index + 3]
        state_code = lines[index + 4]
        phone = lines[index + 6]
        website = lines[index + 8]
        if party != match.group("party") or state_code != match.group("state"):
            continue
        if not website.startswith("http"):
            continue

        name = f"{first_name} {last_name}".strip()
        context = "\n".join(lines[index : index + 9])
        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=(
                    f"{name} is listed as a United States senator for {state_code} "
                    f"with party marker {party} and phone {phone} in the Senate contact roster."
                ),
                city=city or None,
                state=state_code or state or None,
                geo_specificity="statewide",
                issue_areas=[
                    "political_polarization_and_democratic_norms",
                    "electoral_reform",
                ],
                website=website,
                affiliated_org="United States Senate",
                extraction_context=context,
                source_url=page.url,
                source_date=source_date,
            )
        )

    return entries


def _extract_member_list_entries(page: PageContent, *, city: str, state: str) -> list[RawEntry]:
    """Extract state legislative members from repeated plain-text list blocks."""
    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    lines = [line.strip() for line in page.text.splitlines() if line.strip()]

    for index, line in enumerate(lines):
        if line != "-" or index + 3 >= len(lines):
            continue

        name = _normalize_roster_name(lines[index + 1])
        district_line = lines[index + 2]
        party = lines[index + 3]
        if not name or not district_line.lower().startswith("district:"):
            continue
        if party.lower() not in _ROSTER_PARTY_LABELS:
            continue

        district = district_line.split(":", maxsplit=1)[1].strip()
        context = "\n".join(lines[index : index + 4])
        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=(
                    f"{name} is listed as a state legislative member for District {district} "
                    f"with party marker {party} in the official member roster."
                ),
                city=city or None,
                state=state or None,
                geo_specificity="statewide",
                issue_areas=[
                    "political_polarization_and_democratic_norms",
                    "electoral_reform",
                ],
                website=page.url,
                affiliated_org=_affiliated_org_from_url(page.url),
                extraction_context=context,
                source_url=page.url,
                source_date=source_date,
            )
        )

    return entries


def _extract_state_senate_entries(page: PageContent, *, city: str, state: str) -> list[RawEntry]:
    """Extract state senators from plain-text blocks with party office markers."""
    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    lines = [line.strip() for line in page.text.splitlines() if line.strip()]

    for index, line in enumerate(lines[1:], start=1):
        if line not in {"(D)Capitol Office", "(R)Capitol Office", "(I)Capitol Office"}:
            continue

        name = _normalize_roster_name(lines[index - 1])
        if not name:
            continue

        party = line[1]
        context = "\n".join(lines[index - 1 : min(index + 3, len(lines))])
        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=(
                    f"{name} is listed as a state senator with party marker {party} "
                    "and Capitol Office contact details in the official Senate roster."
                ),
                city=city or None,
                state=state or None,
                geo_specificity="statewide",
                issue_areas=[
                    "political_polarization_and_democratic_norms",
                    "electoral_reform",
                ],
                website=page.url,
                affiliated_org=_affiliated_org_from_url(page.url),
                extraction_context=context,
                source_url=page.url,
                source_date=source_date,
            )
        )

    return entries


def _extract_line_delimited_roster_entries(
    page: PageContent,
    *,
    city: str,
    state: str,
) -> list[RawEntry]:
    """Extract rosters scraped as repeated pipe-delimited line blocks."""
    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    lines = [line.strip() for line in page.text.splitlines() if line.strip()]
    index = 0

    while index + 5 < len(lines):
        if _clean_pipe_cell(lines[index]) != "" or _clean_pipe_cell(lines[index + 2]) != "":
            index += 1
            continue

        name = _normalize_roster_name(lines[index + 1])
        district = _clean_pipe_cell(lines[index + 3])
        term = _clean_pipe_cell(lines[index + 4])
        party = _clean_pipe_cell(lines[index + 5])
        if (
            not name
            or re.fullmatch(r"\d+[A-Za-z]?", district) is None
            or " to " not in term
            or party.lower() not in _ROSTER_PARTY_LABELS
        ):
            index += 1
            continue

        context = "\n".join(lines[index : index + 6])
        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=(
                    f"{name} is listed as a state legislative member for District {district} "
                    f"with party marker {party} for term {term} in the public roster."
                ),
                city=city or None,
                state=state or None,
                geo_specificity="statewide",
                issue_areas=[
                    "political_polarization_and_democratic_norms",
                    "electoral_reform",
                ],
                website=page.url,
                affiliated_org=_affiliated_org_from_url(page.url),
                extraction_context=context,
                source_url=page.url,
                source_date=source_date,
            )
        )
        index += 6

    return entries


def _extract_plain_text_roster_table_entries(
    page: PageContent,
    *,
    city: str,
    state: str,
) -> list[RawEntry]:
    """Extract roster tables scraped as one plain-text cell per line."""
    lines = [line.strip() for line in page.text.splitlines() if line.strip()]
    data_start = _plain_text_roster_data_start(lines)
    if data_start is None:
        return []

    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    row_starts = [
        index
        for index in range(data_start, len(lines))
        if re.fullmatch(r"\d{1,3}[A-Za-z]?", lines[index]) is not None
    ]

    for offset, row_start in enumerate(row_starts):
        row_end = row_starts[offset + 1] if offset + 1 < len(row_starts) else len(lines)
        cells = lines[row_start:row_end]
        if len(cells) < 3:
            continue

        district = cells[0]
        name = _normalize_roster_name(cells[1])
        party = cells[2]
        if not name or party.lower() not in _ROSTER_PARTY_LABELS:
            continue

        context = "\n".join(cells)
        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=(
                    f"{name} is listed as a state legislative member for District {district} "
                    f"with party marker {party} in the public roster."
                ),
                city=city or None,
                state=state or None,
                geo_specificity="statewide",
                issue_areas=[
                    "political_polarization_and_democratic_norms",
                    "electoral_reform",
                ],
                website=page.url,
                affiliated_org=_affiliated_org_from_url(page.url),
                extraction_context=context,
                source_url=page.url,
                source_date=source_date,
            )
        )

    return entries
