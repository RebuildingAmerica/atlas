"""Elicitation clarification helpers for `atlas.platform.mcp.elicitation`."""

from __future__ import annotations

from typing import Any

from atlas.taxonomy.issue_areas import ALL_ISSUE_SLUGS

from .elicitation_core import (
    _AMBIGUOUS_PLACE_NAMES,
    _ISSUE_MATCH_AMBIGUITY_RATIO,
    _MIN_AMBIGUOUS_ISSUE_MATCHES,
    _RESULT_DEPTH_LIMITS,
    ElicitationContext,
    IssueAreaSlug,
    PlaceClarification,
    ResolveIssueAreasClarification,
    SearchEntitiesClarification,
    _request_meta_from_context,
)
from .elicitation_state import declares_form_elicitation
from .elicitation_validation import log_elicitation_event


def _has_value(value: object | None) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return bool(value)
    return True


def _normalized_ambiguous_place_key(place: str) -> str:
    return place.strip().lower()


def should_elicit_place_clarification(*, place: str) -> bool:
    """Return whether a place string needs user clarification before lookup."""
    stripped_place = place.strip()
    if "," in stripped_place:
        return False
    return _normalized_ambiguous_place_key(stripped_place) in _AMBIGUOUS_PLACE_NAMES


async def clarify_place_argument(
    ctx: ElicitationContext | None,
    *,
    place: str,
) -> str:
    """Ask for a specific place when a place-first read tool is ambiguous."""
    if not should_elicit_place_clarification(place=place):
        return place
    if not declares_form_elicitation(_request_meta_from_context(ctx)):
        await log_elicitation_event(
            interaction="place_clarification",
            mode="form",
            action="unsupported",
        )
        return place

    assert ctx is not None
    await log_elicitation_event(
        interaction="place_clarification",
        mode="form",
        action="requested",
    )
    result = await ctx.elicit(
        message="Choose the specific place for this lookup.",
        schema=PlaceClarification,
    )
    if result.action != "accept":
        await log_elicitation_event(
            interaction="place_clarification",
            mode="form",
            action=result.action,
        )
        return place
    await log_elicitation_event(
        interaction="place_clarification",
        mode="form",
        action="accept",
    )
    return result.data.place.strip() or place


def should_elicit_search_entities_clarification(  # noqa: PLR0913
    *,
    place: str | None,
    issue_areas: list[str] | None,
    text: str | None,
    entity_types: list[str] | None,
    source_types: list[str] | None,
    cursor: str | None,
    allow_place_scoped_clarification: bool = False,
) -> bool:
    """Return whether a search is broad enough to benefit from form clarification."""
    if cursor is not None:
        return False
    scoped_values = (issue_areas, text, entity_types, source_types)
    if allow_place_scoped_clarification and _has_value(place):
        return not any(_has_value(value) for value in scoped_values)
    return not any(_has_value(value) for value in (place, *scoped_values))


def _apply_search_entities_clarification(
    arguments: dict[str, Any],
    clarification: SearchEntitiesClarification,
) -> dict[str, Any]:
    clarified = {**arguments}
    if clarification.place and clarification.place.strip():
        clarified["place"] = clarification.place.strip()
    if clarification.text and clarification.text.strip():
        clarified["text"] = clarification.text.strip()
    if clarification.issue_areas:
        issue_areas = [
            issue.strip() for issue in clarification.issue_areas if issue.strip() in ALL_ISSUE_SLUGS
        ]
        if issue_areas:
            clarified["issue_areas"] = issue_areas
    if clarification.actor_types:
        actor_types = [
            actor_type.strip() for actor_type in clarification.actor_types if actor_type.strip()
        ]
        if actor_types:
            clarified["entity_types"] = actor_types
    if clarification.result_depth:
        clarified["limit"] = _RESULT_DEPTH_LIMITS[clarification.result_depth]
    if clarification.evidence_threshold == "more_source_backed":
        clarified["sort"] = "source_count"
    return clarified


def _issue_match_slug(item: object) -> str | None:
    if not isinstance(item, dict):
        return None
    slug = item.get("slug") or item.get("id")
    return slug if isinstance(slug, str) and slug in ALL_ISSUE_SLUGS else None


def _issue_match_score(item: object) -> float:
    if not isinstance(item, dict):
        return 0.0
    score = item.get("match_score")
    return float(score) if isinstance(score, int | float) else 0.0


def _should_elicit_issue_area_selection(payload: dict[str, Any]) -> bool:
    items = payload.get("items")
    if not isinstance(items, list) or len(items) < _MIN_AMBIGUOUS_ISSUE_MATCHES:
        return False
    scored_items = [item for item in items if _issue_match_slug(item) is not None]
    if len(scored_items) < _MIN_AMBIGUOUS_ISSUE_MATCHES:
        return False
    top_score = _issue_match_score(scored_items[0])
    return (
        top_score > 0
        and _issue_match_score(scored_items[1]) >= top_score * _ISSUE_MATCH_AMBIGUITY_RATIO
    )


def _filter_issue_area_payload(
    payload: dict[str, Any],
    selected_slugs: list[IssueAreaSlug],
) -> dict[str, Any]:
    selected = {slug for slug in selected_slugs if slug in ALL_ISSUE_SLUGS}
    if not selected:
        return payload
    items = payload.get("items")
    if not isinstance(items, list):
        return payload
    filtered_items = [
        item for item in items if isinstance(item, dict) and _issue_match_slug(item) in selected
    ]
    if not filtered_items:
        return payload
    return {**payload, "items": filtered_items, "total": len(filtered_items), "next_cursor": None}


async def clarify_resolve_issue_areas_result(
    ctx: ElicitationContext | None,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Ask the user to choose issue areas when resolver matches are ambiguous."""
    if not _should_elicit_issue_area_selection(payload):
        return payload
    if not declares_form_elicitation(_request_meta_from_context(ctx)):
        await log_elicitation_event(
            interaction="issue_area_clarification",
            mode="form",
            action="unsupported",
        )
        return payload

    assert ctx is not None
    await log_elicitation_event(
        interaction="issue_area_clarification",
        mode="form",
        action="requested",
    )
    result = await ctx.elicit(
        message="Choose the issue areas that match this request.",
        schema=ResolveIssueAreasClarification,
    )
    if result.action != "accept":
        await log_elicitation_event(
            interaction="issue_area_clarification",
            mode="form",
            action=result.action,
        )
        return payload
    await log_elicitation_event(
        interaction="issue_area_clarification",
        mode="form",
        action="accept",
    )
    return _filter_issue_area_payload(payload, result.data.issue_areas)


async def clarify_search_entities_arguments(  # noqa: PLR0913
    ctx: ElicitationContext | None,
    *,
    place: str | None,
    issue_areas: list[str] | None,
    text: str | None,
    entity_types: list[str] | None,
    source_types: list[str] | None,
    limit: int,
    cursor: str | None,
    allow_place_scoped_clarification: bool = False,
) -> dict[str, Any]:
    """Ask for optional search narrowing when the client supports form elicitation."""
    arguments: dict[str, Any] = {
        "place": place,
        "issue_areas": issue_areas,
        "text": text,
        "entity_types": entity_types,
        "source_types": source_types,
        "limit": limit,
        "cursor": cursor,
    }
    if not should_elicit_search_entities_clarification(
        place=place,
        issue_areas=issue_areas,
        text=text,
        entity_types=entity_types,
        source_types=source_types,
        cursor=cursor,
        allow_place_scoped_clarification=allow_place_scoped_clarification,
    ):
        return arguments
    if not declares_form_elicitation(_request_meta_from_context(ctx)):
        await log_elicitation_event(
            interaction="search_entities_clarification",
            mode="form",
            action="unsupported",
        )
        return arguments

    assert ctx is not None
    await log_elicitation_event(
        interaction="search_entities_clarification",
        mode="form",
        action="requested",
    )
    result = await ctx.elicit(
        message="Choose a place, search phrase, or source-backing preference for the results.",
        schema=SearchEntitiesClarification,
    )
    if result.action != "accept":
        await log_elicitation_event(
            interaction="search_entities_clarification",
            mode="form",
            action=result.action,
        )
        return arguments
    await log_elicitation_event(
        interaction="search_entities_clarification",
        mode="form",
        action="accept",
    )
    return _apply_search_entities_clarification(arguments, result.data)
