"""Place and query helpers for the MCP data service."""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

_WORD_RE = re.compile(r"[a-z0-9]+")
MIN_PLACE_KEY_PARTS = 2
PLACE_KEY_STATE_PARTS = 2
_STATE_NAMES = {
    "alabama": "AL",
    "alaska": "AK",
    "arizona": "AZ",
    "arkansas": "AR",
    "california": "CA",
    "colorado": "CO",
    "connecticut": "CT",
    "delaware": "DE",
    "district of columbia": "DC",
    "florida": "FL",
    "georgia": "GA",
    "hawaii": "HI",
    "idaho": "ID",
    "illinois": "IL",
    "indiana": "IN",
    "iowa": "IA",
    "kansas": "KS",
    "kentucky": "KY",
    "louisiana": "LA",
    "maine": "ME",
    "maryland": "MD",
    "massachusetts": "MA",
    "michigan": "MI",
    "minnesota": "MN",
    "mississippi": "MS",
    "missouri": "MO",
    "montana": "MT",
    "nebraska": "NE",
    "nevada": "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    "north carolina": "NC",
    "north dakota": "ND",
    "ohio": "OH",
    "oklahoma": "OK",
    "oregon": "OR",
    "pennsylvania": "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    "tennessee": "TN",
    "texas": "TX",
    "utah": "UT",
    "vermont": "VT",
    "virginia": "VA",
    "washington": "WA",
    "west virginia": "WV",
    "wisconsin": "WI",
    "wyoming": "WY",
}


def _place_context_lookup_key(base_place_key: str, kind: str | None) -> str:
    if kind is None or kind == "polity":
        return base_place_key
    return f"{kind}:{base_place_key}"


def _normalize_place(place: str | Mapping[str, str | None] | None) -> dict[str, str | None]:
    if place is None:
        return {"city": None, "state": None, "region": None, "display": None}

    if isinstance(place, Mapping):
        city = _clean_string(place.get("city"))
        state = _normalize_state(place.get("state"))
        region = _clean_string(place.get("region"))
        display = _clean_string(place.get("display")) or _format_place(city, state, region)
        return {"city": city, "state": state, "region": region, "display": display}

    raw_place = place.strip()
    if re.fullmatch(r"[A-Za-z]{2}", raw_place):
        state = _normalize_state(raw_place)
        return {"city": None, "state": state, "region": None, "display": state}

    parts = [part.strip() for part in raw_place.split(",") if part.strip()]
    city = parts[0] if parts else raw_place or None
    state = _normalize_state(parts[1]) if len(parts) > 1 else None
    return {
        "city": _clean_string(city),
        "state": state,
        "region": None,
        "display": _format_place(city, state, None),
    }


def normalize_place_key(place_key: str) -> dict[str, str | None]:
    """Parse an Atlas place key like `gary-in` or `ut`."""
    cleaned = place_key.strip().lower()
    if re.fullmatch(r"[a-z]{2}", cleaned):
        state = _normalize_state(cleaned)
        return {"city": None, "state": state, "region": None, "display": state}

    parts = [part for part in cleaned.split("-") if part]
    if len(parts) < MIN_PLACE_KEY_PARTS:
        raise _unsupported_place_key(place_key)
    state = _normalize_state(parts[-1])
    city = " ".join(part.title() for part in parts[:-1])
    return {
        "city": city,
        "state": state,
        "region": None,
        "display": _format_place(city, state, None),
    }


def _validate_issue_areas(issue_areas: list[str] | None) -> list[str]:
    from atlas.domains.catalog.taxonomy import get_issue_area_by_slug

    validated = issue_areas or []
    invalid = [issue_area for issue_area in validated if get_issue_area_by_slug(issue_area) is None]
    if invalid:
        raise _invalid_issue_areas(invalid)
    return validated


def _validate_entity_sort(sort: str | None) -> str:
    validated = sort or "relevance"
    if validated not in {"relevance", "source_count", "recent", "name"}:
        raise _invalid_entity_sort(validated)
    return validated


def _rows_to_dicts(cursor: Any, rows: Iterable[Any]) -> list[dict[str, Any]]:
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row, strict=False)) for row in rows]


def _place_resource_slug(place: Mapping[str, str | None]) -> str:
    if place.get("city") is None and place.get("state") is not None:
        return str(place["state"]).lower()
    parts = [part for part in [place.get("city"), place.get("state"), place.get("region")] if part]
    return "-".join(str(part).lower().replace(" ", "-") for part in parts)


def _place_resource_uri(place: Mapping[str, str | None], suffix: str) -> str:
    """Build a resource URI using atlas://states/ or atlas://cities/ as appropriate."""
    if place.get("city") is None and place.get("state") is not None:
        return f"atlas://states/{str(place['state']).upper()}/{suffix}"
    slug = _place_resource_slug(place)
    return f"atlas://cities/{slug}/{suffix}"


def _append_source_place_clauses(
    *,
    clauses: list[str],
    params: list[Any],
    normalized_place: Mapping[str, str | None],
    place_filters: Sequence[Mapping[str, str | None]] | None,
) -> None:
    """Append geography predicates for source search."""
    if place_filters is not None:
        clauses.append(_source_place_filter_clause(place_filters, params) or "0 = 1")
        return

    if normalized_place["state"]:
        clauses.append("e.state = ?")
        params.append(normalized_place["state"])
    if normalized_place["city"]:
        clauses.append("e.city = ?")
        params.append(normalized_place["city"])
    if normalized_place["region"]:
        clauses.append("e.region = ?")
        params.append(normalized_place["region"])


def _source_place_filter_clause(
    place_filters: Sequence[Mapping[str, str | None]],
    params: list[Any],
) -> str | None:
    """Build exact source place-scope filters without city/state cross products."""
    filter_clauses: list[str] = []
    for place_filter in place_filters:
        filter_parts: list[str] = []
        if place_filter.get("state"):
            filter_parts.append("e.state = ?")
            params.append(place_filter["state"])
        if place_filter.get("city"):
            filter_parts.append("e.city = ?")
            params.append(place_filter["city"])
        if place_filter.get("region"):
            filter_parts.append("e.region = ?")
            params.append(place_filter["region"])
        if filter_parts:
            filter_clauses.append("(" + " AND ".join(filter_parts) + ")")
    return " OR ".join(filter_clauses) or None


def _tokenize(text: str) -> list[str]:
    return _WORD_RE.findall(text.lower())


def _normalize_state(state: str | None) -> str | None:
    if state is None:
        return None
    cleaned = state.strip().lower()
    if not cleaned:
        return None
    if len(cleaned) == PLACE_KEY_STATE_PARTS:
        return cleaned.upper()
    return _STATE_NAMES.get(cleaned)


def _entity_not_found(entity_id: str) -> ValueError:
    return ValueError(f"Entity not found: {entity_id}")


def _discovery_run_not_found(run_id: str) -> ValueError:
    return ValueError(f"Discovery run not found: {run_id}")


def _invalid_issue_areas(invalid: list[str]) -> ValueError:
    return ValueError(f"Invalid issue area(s): {', '.join(sorted(invalid))}")


def _invalid_entity_sort(sort: str) -> ValueError:
    return ValueError(f"Invalid entity sort: {sort}")


def _place_profile_not_found(place_display: str) -> ValueError:
    return ValueError(f"Place profile not found: {place_display}")


def _place_page_context_not_found(place_key: str) -> ValueError:
    return ValueError(f"Place page context not found: {place_key}")


def _unsupported_place_key(place_key: str) -> ValueError:
    return ValueError(f"Unsupported place key: {place_key}")


def _clean_string(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _format_place(city: str | None, state: str | None, region: str | None) -> str | None:
    if city and state:
        return f"{city}, {state}"
    if city:
        return city
    if region:
        return region
    return state
