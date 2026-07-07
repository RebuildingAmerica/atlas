"""Structured resource extraction helpers for entry extraction."""

from __future__ import annotations

import csv
import io
import re
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from atlas_shared import RawEntry

from atlas_scout.steps.entry_extract.roster_utils import (
    _looks_like_person_name,
    _strip_civic_title_prefix,
)

if TYPE_CHECKING:
    from atlas_shared import PageContent

_STRUCTURED_NAME_TITLE_KEYS = {
    "chair",
    "councilmember",
    "delegate",
    "dr",
    "gov",
    "governor",
    "hon",
    "judge",
    "mayor",
    "miss",
    "mr",
    "mrs",
    "ms",
    "rep",
    "representative",
    "rev",
    "sen",
    "senator",
    "speaker",
}
_STRUCTURED_NAME_CREDENTIAL_KEYS = {"dd", "do", "esq", "jd", "md", "phd"}
_STRUCTURED_NAME_CREDENTIAL_SEQUENCES = (
    ("p", "h", "d"),
    ("d", "d"),
    ("d", "o"),
    ("j", "d"),
    ("m", "d"),
)
_STRUCTURED_NAME_SUFFIX_LABELS = {
    "ii": "II",
    "iii": "III",
    "iv": "IV",
    "jr": "Jr.",
    "sr": "Sr.",
    "v": "V",
}


def _extract_structured_resource_entries(
    page: PageContent,
    *,
    city: str,
    state: str,
) -> list[RawEntry]:
    """Extract people from generic structured CSV/TSV/pipe resources."""
    if not _is_structured_resource_page(page):
        return []

    rows = _structured_resource_rows(page)
    entries: list[RawEntry] = []
    source_date = page.published_date.date() if page.published_date else None
    for row in rows:
        name = _structured_person_name(row)
        if not name or not _looks_like_person_name(name):
            continue

        context_values = _structured_context_values(row)
        if not context_values:
            continue

        entry_city = _first_structured_value(row, ("city", "mailing_city", "candidate_city"))
        entry_state = _first_structured_value(
            row,
            ("office_state", "state", "candidate_state", "mailing_state"),
        )
        source_url = _first_structured_value(row, ("source_url", "url", "profile_url")) or page.url
        entries.append(
            RawEntry(
                name=name,
                entry_type="person",
                description=_structured_person_description(name, row),
                city=entry_city or city or None,
                state=entry_state or state or None,
                geo_specificity="statewide" if entry_state and not entry_city else "local",
                issue_areas=[
                    "political_polarization_and_democratic_norms",
                    "electoral_reform",
                ],
                website=source_url if source_url != page.url else None,
                affiliated_org=_structured_affiliated_org(row, page.url),
                extraction_context=_structured_extraction_context(row),
                source_url=source_url,
                source_date=source_date,
            )
        )

    return entries


def _is_structured_resource_page(page: PageContent) -> bool:
    """Return whether a page came from a structured web resource."""
    return isinstance(page.structured_data.get("resource_format"), str)


def _structured_resource_rows(page: PageContent) -> list[dict[str, str]]:
    """Parse a structured page into normalized row dictionaries."""
    text = page.text.strip()
    if not text:
        return []

    delimiter = _detect_structured_delimiter(text)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    raw_rows = [
        [cell.strip() for cell in row] for row in reader if any(cell.strip() for cell in row)
    ]
    if not raw_rows:
        return []

    configured_columns = page.structured_data.get("structured_columns")
    if isinstance(configured_columns, list) and all(
        isinstance(column, str) for column in configured_columns
    ):
        headers = [_normalize_structured_header(column) for column in configured_columns]
        data_rows = raw_rows
    else:
        headers = [_normalize_structured_header(column) for column in raw_rows[0]]
        data_rows = raw_rows[1:]

    rows: list[dict[str, str]] = []
    for data_row in data_rows:
        if not data_row:
            continue
        row: dict[str, str] = {}
        for index, header in enumerate(headers):
            if not header or index >= len(data_row):
                continue
            value = data_row[index].strip()
            if value:
                row[header] = value
        if row:
            rows.append(row)
    return rows


def _detect_structured_delimiter(text: str) -> str:
    """Detect the most likely delimiter for structured text."""
    sample_lines = [line for line in text.splitlines()[:10] if line.strip()]
    consistent_counts: dict[str, int] = {}
    for delimiter in (",", "\t", "|"):
        counts = [line.count(delimiter) for line in sample_lines]
        positive_counts = [count for count in counts if count > 0]
        if positive_counts and len(set(positive_counts)) == 1:
            consistent_counts[delimiter] = positive_counts[0]
    if consistent_counts:
        return max(consistent_counts, key=lambda delimiter: consistent_counts[delimiter])

    sample = "\n".join(sample_lines)
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",\t|")
        return str(dialect.delimiter)
    except csv.Error:
        delimiter_counts = {delimiter: sample.count(delimiter) for delimiter in (",", "\t", "|")}
        return max(delimiter_counts, key=lambda delimiter: delimiter_counts[delimiter])


def _normalize_structured_header(value: str) -> str:
    """Normalize a structured column name to a stable key."""
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    aliases = {
        "candidate_name": "name",
        "cand_name": "name",
        "person_name": "name",
        "full_name": "name",
        "candidate": "name",
        "candidate_party": "party",
        "party_affiliation": "party",
        "office_district": "district",
        "candidate_office": "office",
        "candidate_office_state": "office_state",
        "candidate_election_year": "election_year",
    }
    return aliases.get(normalized, normalized)


def _structured_person_name(row: dict[str, str]) -> str:
    """Return a normalized person name from a structured row."""
    raw_name = _first_structured_value(row, ("name", "first_last", "display_name"))
    if not raw_name:
        first = _first_structured_value(row, ("first_name", "given_name"))
        last = _first_structured_value(row, ("last_name", "family_name", "surname"))
        raw_name = f"{first} {last}".strip()
    return _normalize_structured_person_name(raw_name)


def _normalize_structured_person_name(raw_name: str) -> str:
    """Normalize a person name from a machine-readable civic row."""
    name = raw_name.strip()
    if not name or "vacancy" in name.lower():
        return ""

    if "," in name:
        last, first = [part.strip() for part in name.split(",", maxsplit=1)]
        given_tokens, suffixes = _structured_name_parts(first)
        family_tokens, family_suffixes = _structured_name_parts(last)
        suffixes.extend(family_suffixes)
        return " ".join([*given_tokens, *family_tokens, *suffixes]).strip()

    body_tokens, suffixes = _structured_name_parts(_strip_civic_title_prefix(name))
    return " ".join([*body_tokens, *suffixes]).strip()


def _structured_name_parts(value: str) -> tuple[list[str], list[str]]:
    """Return display-name tokens and suffix tokens from one structured name side."""
    body_tokens: list[str] = []
    suffixes: list[str] = []
    raw_tokens = [token.strip() for token in re.split(r"\s+", value.strip()) if token.strip()]
    raw_tokens = _without_trailing_structured_credential_spellouts(raw_tokens)
    for raw_token in raw_tokens:
        token = raw_token.strip()
        key = _structured_name_token_key(token)
        if not key:
            continue
        if key in _STRUCTURED_NAME_TITLE_KEYS or key in _STRUCTURED_NAME_CREDENTIAL_KEYS:
            continue
        suffix = _STRUCTURED_NAME_SUFFIX_LABELS.get(key)
        if suffix:
            suffixes.append(suffix)
            continue
        body_tokens.append(_format_structured_name_token(token))
    return body_tokens, suffixes


def _without_trailing_structured_credential_spellouts(tokens: list[str]) -> list[str]:
    """Drop trailing spaced-out credential tokens while preserving initials."""
    trimmed = [token for token in tokens if _structured_name_token_key(token)]
    while trimmed:
        keys = [_structured_name_token_key(token) for token in trimmed]
        credential_end = len(keys)
        while credential_end > 0 and (
            keys[credential_end - 1] in _STRUCTURED_NAME_SUFFIX_LABELS
            or keys[credential_end - 1] in _STRUCTURED_NAME_TITLE_KEYS
        ):
            credential_end -= 1
        removed = False
        for sequence in _STRUCTURED_NAME_CREDENTIAL_SEQUENCES:
            credential_start = credential_end - len(sequence)
            if credential_start >= 0 and tuple(keys[credential_start:credential_end]) == sequence:
                del trimmed[credential_start:credential_end]
                removed = True
                break
        if not removed:
            break
    return trimmed


def _structured_name_token_key(value: str) -> str:
    """Return a comparison key for a structured name token."""
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _format_structured_name_token(value: str) -> str:
    """Format one structured name token for display."""
    token = value.strip(" .,\t\r\n")
    if len(token) == 1:
        return token.upper()
    if token.upper() == token:
        return token.title()
    return token


def _first_structured_value(row: dict[str, str], keys: tuple[str, ...]) -> str:
    """Return the first non-empty value from a structured row."""
    for key in keys:
        value = row.get(key)
        if value:
            return value.strip()
    return ""


def _structured_context_values(row: dict[str, str]) -> list[str]:
    """Return non-name values that make a structured person row meaningful."""
    context_keys = (
        "office",
        "position",
        "role",
        "title",
        "organization",
        "affiliated_org",
        "committee",
        "committee_id",
        "party",
        "election_year",
        "transaction_amount",
        "transaction_date",
        "amount",
        "date",
        "occupation",
        "employer",
        "district",
        "office_state",
        "city",
        "state",
    )
    return [row[key] for key in context_keys if row.get(key)]


def _structured_person_description(name: str, row: dict[str, str]) -> str:
    """Build a concise civic description from structured row fields."""
    office = _first_structured_value(row, ("office", "position", "role", "title"))
    office_state = _first_structured_value(row, ("office_state", "state"))
    district = _first_structured_value(row, ("district",))
    year = _first_structured_value(row, ("election_year", "year"))
    party = _first_structured_value(row, ("party",))
    organization = _first_structured_value(row, ("organization", "affiliated_org"))
    transaction_amount = _first_structured_value(
        row,
        ("transaction_amount", "contribution_amount", "amount"),
    )
    transaction_date = _first_structured_value(
        row, ("transaction_date", "contribution_date", "date")
    )
    occupation = _first_structured_value(row, ("occupation",))
    employer = _first_structured_value(row, ("employer",))

    if office:
        place = office_state
        if district:
            place = f"{place} District {district}".strip()
        description = f"{name} is listed as a {office} candidate"
        if place:
            description += f" for {place}"
        if year:
            description += f" in {year}"
        if party:
            description += f" with party marker {party}"
        return f"{description}."

    if organization:
        return f"{name} is listed with {organization} in the structured public source."

    if transaction_amount or transaction_date or occupation or employer:
        description = f"{name} is listed in a public campaign-finance transaction"
        if transaction_date:
            description += f" dated {transaction_date}"
        if transaction_amount:
            description += f" for {transaction_amount}"
        if occupation:
            description += f" with occupation {occupation}"
        if employer:
            if occupation:
                description += f" and employer {employer}"
            else:
                description += f" with employer {employer}"
        return f"{description}."

    return f"{name} is listed in the structured public source."


def _structured_affiliated_org(row: dict[str, str], source_url: str) -> str:
    """Return the row organization or a readable source host."""
    organization = _first_structured_value(
        row,
        ("organization", "affiliated_org", "committee", "committee_id"),
    )
    if organization:
        return organization
    hostname = urlparse(source_url).netloc.lower().removeprefix("www.")
    known_hosts = {
        "fec.gov": "Federal Election Commission",
        "query.wikidata.org": "Wikidata",
        "data.openstates.org": "OpenStates",
    }
    return known_hosts.get(hostname, hostname or "Structured public source")


def _structured_extraction_context(row: dict[str, str]) -> str:
    """Return a compact source-local row context."""
    parts = [f"{key}={value}" for key, value in row.items() if value]
    return "; ".join(parts[:12])
