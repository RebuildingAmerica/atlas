"""Low-level roster parsing helpers for entry extraction."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from atlas_shared import RawEntry

if TYPE_CHECKING:
    from atlas_shared import PageContent

_ROSTER_PARTY_LABELS = {"democrat", "democratic", "republican", "independent"}
_BOROUGH_LABELS = {"manhattan", "bronx", "queens", "brooklyn", "staten island"}
_SENATE_CONTACT_HEADER_RE = re.compile(r"^(?P<label>.+) \((?P<party>[A-Z])-(?P<state>[A-Z]{2})\)$")


def _extract_tabular_roster_entries(
    page: PageContent,
    *,
    city: str,
    state: str,
) -> list[RawEntry]:
    """Extract official roster tables rendered as tab-delimited text rows."""
    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    lines = [line.strip() for line in page.text.splitlines() if line.strip()]
    header: list[str] | None = None
    header_index: int | None = None
    section = ""

    for index, line in enumerate(lines):
        cells = _split_tabular_roster_row(line)
        lowered_cells = [cell.lower() for cell in cells]
        name_index = _optional_cell_index(lowered_cells, "name")
        if name_index is not None and (
            "district" in lowered_cells or "office" in lowered_cells or "title" in lowered_cells
        ):
            header = lowered_cells
            header_index = name_index
            section = _nearest_roster_section(lines, index)
            continue

        if header is None or header_index is None or len(cells) <= header_index:
            continue

        label = _tabular_roster_label(cells, header)
        name = _normalize_roster_name(_strip_civic_title_prefix(cells[header_index]))
        if not label or not _looks_like_person_name(name):
            continue

        context = "\n".join([section, line] if section else [line])
        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=_tabular_roster_description(name, label, section),
                city=city or None,
                state=state or None,
                geo_specificity="local",
                issue_areas=["local_government_and_civic_engagement"],
                website=page.url,
                affiliated_org=_affiliated_org_from_url(page.url),
                extraction_context=context,
                source_url=page.url,
                source_date=source_date,
            )
        )

    return entries


def _extract_plain_text_office_roster_entries(
    page: PageContent,
    *,
    city: str,
    state: str,
) -> list[RawEntry]:
    """Extract public officials from plain-text office roster blocks."""
    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    lines = [line.strip() for line in page.text.splitlines() if line.strip()]

    for index, line in enumerate(lines):
        name = _normalize_roster_name(_strip_civic_title_prefix(line))
        if not name or not _looks_like_person_name(name):
            continue

        next_line = lines[index + 1] if index + 1 < len(lines) else ""
        previous_line = lines[index - 1] if index > 0 else ""

        if _looks_like_office_label(next_line):
            context = "\n".join(lines[index : min(index + 2, len(lines))])
            entries.append(
                RawEntry(
                    name=name,
                    entry_type="person",
                    description=f"{name} is listed as {next_line} in the public office roster.",
                    city=city or None,
                    state=state or None,
                    geo_specificity="local",
                    issue_areas=["local_government_and_civic_engagement"],
                    website=page.url,
                    affiliated_org=_affiliated_org_from_url(page.url),
                    extraction_context=context,
                    source_url=page.url,
                    source_date=source_date,
                )
            )
            continue

        if previous_line.isdigit() and _looks_like_civic_jurisdiction(next_line):
            party = lines[index + 2] if index + 2 < len(lines) else ""
            if party.lower() not in _ROSTER_PARTY_LABELS:
                continue
            context_end = min(index + 4, len(lines))
            context = "\n".join(lines[index - 1 : context_end])
            entries.append(
                RawEntry(
                    name=name,
                    entry_type="person",
                    description=(
                        f"{name} is listed as a public officeholder for District "
                        f"{previous_line} in {next_line} with party marker {party}."
                    ),
                    city=city or None,
                    state=state or None,
                    geo_specificity="local",
                    issue_areas=["local_government_and_civic_engagement"],
                    website=page.url,
                    affiliated_org=_affiliated_org_from_url(page.url),
                    extraction_context=context,
                    source_url=page.url,
                    source_date=source_date,
                )
            )

    return entries


def _plain_text_roster_data_start(lines: list[str]) -> int | None:
    """Return the first data-cell index after a plain-text roster header."""
    name_headers = {"name", "member", "representative", "senator"}
    for index in range(len(lines) - 2):
        if (
            lines[index].lower() == "district"
            and lines[index + 1].lower() in name_headers
            and lines[index + 2].lower() == "party"
        ):
            data_start = index + 3
            while data_start < len(lines):
                if re.fullmatch(r"\d{1,3}[A-Za-z]?", lines[data_start]) is not None:
                    return data_start
                data_start += 1
            return None
    return None


def _split_markdown_table_row(row: str) -> list[str]:
    """Split a markdown table row while keeping only non-empty edge cells."""
    return [cell.strip() for cell in row.strip().strip("|").split("|")]


def _split_tabular_roster_row(row: str) -> list[str]:
    """Split a text-rendered table row into cells."""
    if "\t" in row:
        return [cell.strip() for cell in row.split("\t")]
    return [cell.strip() for cell in re.split(r"\s{2,}", row) if cell.strip()]


def _is_markdown_separator_row(cells: list[str]) -> bool:
    """Return whether a markdown row is the header separator."""
    return all(cell.replace("-", "").replace(":", "").strip() == "" for cell in cells)


def _looks_like_roster_header(cells: list[str]) -> bool:
    """Return whether a table header looks like a public-office roster."""
    return "district" in cells or "office" in cells or "party" in cells


def _looks_like_numbered_roster_row(cells: list[str]) -> bool:
    """Return whether a table row directly encodes district, name, place, party."""
    if len(cells) < 4:
        return False
    if not cells[0].strip().isdigit():
        return False
    if cells[3].strip().lower() not in _ROSTER_PARTY_LABELS:
        return False
    name = _strip_civic_title_prefix(cells[1])
    return _looks_like_person_name(name)


def _roster_name_column_index(cells: list[str]) -> int | None:
    """Return the column index containing a roster member's name."""
    for candidate in ("name", "member", "representative", "senator"):
        if candidate in cells:
            return cells.index(candidate)
    return None


def _optional_cell_index(cells: list[str], name: str) -> int | None:
    """Return the index of an optional table column."""
    return cells.index(name) if name in cells else None


def _cell_at(cells: list[str], index: int | None) -> str:
    """Return a table cell when that optional column exists."""
    if index is None or index >= len(cells):
        return ""
    return cells[index].strip()


def _nearest_roster_section(lines: list[str], header_index: int) -> str:
    """Return the nearest plain section label above a roster table header."""
    for index in range(header_index - 1, max(-1, header_index - 6), -1):
        candidate = lines[index].strip()
        if not candidate or "\t" in candidate:
            continue
        if len(candidate) <= 120:
            return candidate
    return ""


def _tabular_roster_label(cells: list[str], header: list[str]) -> str:
    """Return the office or district label for a text-rendered roster row."""
    office_index = _optional_cell_index(header, "office")
    if office_index is not None:
        return _cell_at(cells, office_index)

    title_index = _optional_cell_index(header, "title")
    if title_index is not None:
        return _cell_at(cells, title_index)

    district_index = _optional_cell_index(header, "district")
    district = _cell_at(cells, district_index)
    if district.lower() == "total":
        return ""
    if district:
        return f"District {district}"
    return ""


def _tabular_roster_description(name: str, label: str, section: str) -> str:
    """Build a concise source-grounded description for a tabular roster row."""
    if section:
        return f"{name} is listed as {label} in the {section} public roster."
    return f"{name} is listed as {label} in the public roster."


def _clean_pipe_cell(raw_value: str) -> str:
    """Remove pipe delimiters left in text-only roster cells."""
    return raw_value.strip().strip("|").strip()


def _looks_like_office_label(value: str) -> bool:
    """Return whether a line names a public office or elected seat."""
    lowered = value.lower().strip()
    if not lowered:
        return False
    if len(lowered) > 80 or "." in lowered:
        return False
    office_markers = (
        "mayor",
        "council",
        "commissioner",
        "supervisor",
        "district",
        "trustee",
        "board member",
        "chair",
        "secretary",
        "member-at-large",
        "member at-large",
        "member at large",
        "business/industry",
        "gaming",
        "physician",
    )
    return any(marker in lowered for marker in office_markers)


def _looks_like_civic_jurisdiction(value: str) -> bool:
    """Return whether a line is a civic jurisdiction in a roster row."""
    lowered = value.lower().strip()
    if not lowered:
        return False
    if lowered in _BOROUGH_LABELS:
        return True
    return "/" in lowered and all(part.strip() in _BOROUGH_LABELS for part in lowered.split("/"))


def _looks_like_person_name(value: str) -> bool:
    """Return whether a roster cell looks like a named person."""
    name = _strip_civic_title_prefix(value).strip()
    if name.lower() in {"top requests", "quick links", "city council", "board of trustees"}:
        return False
    if not name or any(char.isdigit() for char in name):
        return False
    if _looks_like_office_label(name):
        return False
    words = [word for word in re.split(r"\s+", name) if word]
    if len(words) < 2 or len(words) > 5:
        return False
    return all(_looks_like_name_word(word) for word in words)


def _looks_like_name_word(value: str) -> bool:
    """Return whether one token looks like part of a person's name."""
    cleaned = value.replace(".", "").replace("'", "").replace("-", "")
    return bool(cleaned) and cleaned[0].isupper() and all(char.isalpha() for char in cleaned)


def _strip_civic_title_prefix(value: str) -> str:
    """Remove role and honorific prefixes from roster names."""
    name = value.strip()
    role_prefixes = (
        "Speaker",
        "Majority Leader",
        "Majority Whip",
        "Minority Leader",
        "Minority Whip",
        "Deputy Speaker",
        "Chair",
        "Vice Chair",
    )
    for prefix in sorted(role_prefixes, key=len, reverse=True):
        marker = f"{prefix} "
        if name.startswith(marker):
            name = name[len(marker) :]
            break
    honorific_prefixes = ("Dr. ", "Hon. ", "The Honorable ")
    for prefix in honorific_prefixes:
        if name.startswith(prefix):
            name = name[len(prefix) :]
            break
    return name.strip()


def _affiliated_org_from_url(url: str) -> str:
    """Return a readable source organization for known roster hosts."""
    hostname = urlparse(url).netloc.lower().removeprefix("www.")
    known_hosts = {
        "clerk.lacity.gov": "Los Angeles City Clerk",
        "lacity.gov": "City of Los Angeles",
        "clarkcountynv.gov": "Clark County",
        "ccsd.net": "Clark County School District",
        "southernnevadahealthdistrict.org": "Southern Nevada Health District",
    }
    if hostname in known_hosts:
        return known_hosts[hostname]
    if "assembly.ca.gov" in url:
        return "California State Assembly"
    if "senate.ca.gov" in url:
        return "California State Senate"
    if "house.gov" in url:
        return "U.S. House of Representatives"
    if "senate.gov" in url:
        return "United States Senate"
    return "State legislature"


def _normalize_roster_name(raw_name: str) -> str:
    """Normalize roster names while rejecting vacancies and blank cells."""
    name = raw_name.strip()
    if not name or "vacancy" in name.lower():
        return ""
    if "," not in name:
        return name
    last, first = [part.strip() for part in name.split(",", maxsplit=1)]
    if _is_name_suffix(first):
        return last
    return f"{first} {last}".strip()


def _is_name_suffix(value: str) -> bool:
    """Return whether a comma-delimited name part is a credential or suffix."""
    normalized = value.lower().replace(".", "").replace(",", "").strip()
    return normalized in {"md", "do", "phd", "jr", "sr"}
