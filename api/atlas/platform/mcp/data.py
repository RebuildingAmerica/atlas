"""Place-first Atlas data service for MCP tools and public APIs."""

from __future__ import annotations

from .data_db import DatabaseSession
from .data_place_helpers import (
    _STATE_NAMES,
    PlaceQueryFilter,
    _append_source_place_clauses,
    _clean_string,
    _discovery_run_not_found,
    _entity_not_found,
    _format_place,
    _invalid_entity_sort,
    _invalid_issue_areas,
    _normalize_place,
    _normalize_state,
    _place_context_lookup_key,
    _place_page_context_not_found,
    _place_profile_not_found,
    _place_resource_slug,
    _place_resource_uri,
    _source_place_filter_clause,
    _tokenize,
    _unsupported_place_key,
    _validate_entity_sort,
    _validate_issue_areas,
    normalize_place_key,
)
from .data_record_helpers import (
    AGING_DAYS,
    FRESHNESS_DAYS,
    EntityRecordContext,
    _coerce_date,
    _discovery_run_record,
    _entity_freshness,
    _entity_record,
    _entity_type_label,
    _format_answer_date,
    _format_answer_evidence,
    _humanize_identifier,
    _latest_source_date,
    _profile_answers,
    _relationship_ids,
    _rows_to_dicts,
    _source_freshness,
    _source_linked_entities_by_id,
    _source_linked_entity_record,
    _source_record,
    _staleness,
    _string_or_none,
)
from .data_service_entities import AtlasDataServiceEntityMixin
from .data_service_places import AtlasDataServicePlaceMixin
from .data_service_search import _EXHAUSTIVE_SCAN_PAGE_SIZE, AtlasDataServiceSearchMixin
from .data_trust_helpers import (
    _claim_confidence,
    _claim_evidence_set,
    _contact_claim_confidence,
    _contact_claim_source_count,
    _contact_source_ids,
    _host_grounded,
    _registrable_domain,
    _trust_inputs_from_sources,
    _trust_level,
)


class AtlasDataService(
    AtlasDataServiceSearchMixin,
    AtlasDataServiceEntityMixin,
    AtlasDataServicePlaceMixin,
):
    """Structured place/entity retrieval service for agents and APIs."""

    def __init__(self, database_url: str, *, public_url: str | None = None) -> None:
        self._database_url = database_url
        self._public_url = public_url


__all__ = [
    "AGING_DAYS",
    "FRESHNESS_DAYS",
    "_EXHAUSTIVE_SCAN_PAGE_SIZE",
    "_STATE_NAMES",
    "AtlasDataService",
    "DatabaseSession",
    "EntityRecordContext",
    "PlaceQueryFilter",
    "_append_source_place_clauses",
    "_claim_confidence",
    "_claim_evidence_set",
    "_clean_string",
    "_coerce_date",
    "_contact_claim_confidence",
    "_contact_claim_source_count",
    "_contact_source_ids",
    "_discovery_run_not_found",
    "_discovery_run_record",
    "_entity_freshness",
    "_entity_not_found",
    "_entity_record",
    "_entity_type_label",
    "_format_answer_date",
    "_format_answer_evidence",
    "_format_place",
    "_host_grounded",
    "_humanize_identifier",
    "_invalid_entity_sort",
    "_invalid_issue_areas",
    "_latest_source_date",
    "_normalize_place",
    "_normalize_state",
    "_place_context_lookup_key",
    "_place_page_context_not_found",
    "_place_profile_not_found",
    "_place_resource_slug",
    "_place_resource_uri",
    "_profile_answers",
    "_registrable_domain",
    "_relationship_ids",
    "_rows_to_dicts",
    "_source_freshness",
    "_source_linked_entities_by_id",
    "_source_linked_entity_record",
    "_source_place_filter_clause",
    "_source_record",
    "_staleness",
    "_string_or_none",
    "_tokenize",
    "_trust_inputs_from_sources",
    "_trust_level",
    "_unsupported_place_key",
    "_validate_entity_sort",
    "_validate_issue_areas",
    "normalize_place_key",
]
