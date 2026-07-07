"""Step 3: entry extraction entrypoint and compatibility re-exports."""

from __future__ import annotations

import asyncio

from atlas_scout.steps.entry_extract.cache import _prompt_key, _provider_cache_key
from atlas_scout.steps.entry_extract.models import (
    ExtractionFailedError,
    _coerce_dict,
    _coerce_mention_list,
    _coerce_str_list,
)
from atlas_scout.steps.entry_extract.prompt import (
    _build_system_prompt,
    _normalize_entity_type,
    _normalize_geo_specificity,
    _parse_extraction_response,
    _parse_identify_response,
    _pass_identify,
    _strip_code_fence,
)
from atlas_scout.steps.entry_extract.runtime import extract_entries_stream, extract_page_entries

_CLAIM_POLL_SECONDS = 0.25
_CLAIM_LEASE_SECONDS = 60.0
_CLAIM_WAIT_SECONDS = 60.0
_MAX_EXTRACTION_ATTEMPTS = 5
_RETRY_BACKOFF_SECONDS = 1.0

__all__ = [
    "ExtractionFailedError",
    "_build_system_prompt",
    "_coerce_dict",
    "_coerce_mention_list",
    "_coerce_str_list",
    "_normalize_entity_type",
    "_normalize_geo_specificity",
    "_parse_extraction_response",
    "_parse_identify_response",
    "_pass_identify",
    "_prompt_key",
    "_provider_cache_key",
    "_strip_code_fence",
    "asyncio",
    "extract_entries_stream",
    "extract_page_entries",
]
