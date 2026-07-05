"""OpenAPI metadata and export helpers for the Atlas API."""

from __future__ import annotations

import importlib
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import FastAPI
    from fastapi.routing import APIRoute

OpenAPISchema = dict[str, Any]
OpenAPIOperation = dict[str, Any]
SchemaPropertyKey = tuple[str, str]

OPENAPI_TITLE = "Atlas REST API"
OPENAPI_SUMMARY = (
    "Structured civic research data for Atlas places, entities, sources, and discovery runs."
)
OPENAPI_DESCRIPTION = (
    "Atlas exposes place-first civic research data through a typed REST API. "
    "Use it to find source-backed civic actors, inspect the public evidence behind "
    "a record, understand coverage in a place, and move reviewed work into team "
    "workflows without losing provenance.\n\n"
    "Most public discovery endpoints can be read without authentication. Workspace, "
    "discovery, MCP, and profile-management endpoints require the caller to act as "
    "a user, workspace, worker, or integration with the right scope. Keep source ids, "
    "place keys, issue-area slugs, and visibility state with any data you export; "
    "those fields are what let users trust and refresh the result later.\n\n"
    "The generated reference is intentionally exact about request and response shapes. "
    "For narrative guidance, start with the human API guides in the Atlas docs."
)
OPENAPI_VERSION = "1.0.0"
OPENAPI_CONTACT = {
    "name": "Rebuilding America",
    "url": "https://atlas.rebuildingus.org",
    "email": "contact@rebuildingus.org",
}
OPENAPI_LICENSE = {
    "name": "MIT",
    "identifier": "MIT",
}
OPENAPI_TAGS = [
    {
        "name": "access",
        "description": (
            "Authentication, authorization, account verification, and operational access checks. "
            "Use these endpoints to understand whether a caller can use protected Atlas workflows "
            "before starting a workspace, MCP, discovery, or profile-management request."
        ),
    },
    {
        "name": "claims",
        "description": (
            "Profile-claim and subject-management APIs. These endpoints let a signed-in person "
            "request control of a public profile, verify ownership where possible, and update "
            "subject-controlled fields without weakening source-backed provenance."
        ),
    },
    {
        "name": "discovery-schedules",
        "description": (
            "Recurring discovery targets for research operations. Schedules describe the places "
            "and issue areas Atlas should revisit; the durable discovery worker performs the "
            "actual source search, extraction, and review workflow."
        ),
    },
    {
        "name": "discovery-runs",
        "description": (
            "Discovery pipeline runs, Scout syncs, worker leases, and pipeline observability. "
            "These endpoints create or inspect research work; completion means the pipeline ran, "
            "not that every resulting actor is ready for publication or outreach."
        ),
    },
    {
        "name": "domains",
        "description": (
            "Top-level issue domains in the Atlas taxonomy. Domains group issue areas for "
            "navigation and reporting; issue-area slugs are the filters most integrations use."
        ),
    },
    {
        "name": "entities",
        "description": (
            "Source-backed civic actors: people, organizations, initiatives, campaigns, and "
            "events. Use entity endpoints to search actors, inspect a single profile, preserve "
            "source evidence, and manage authenticated writes."
        ),
    },
    {
        "name": "feed",
        "description": (
            "Activity feed resources for signed-in users following public profiles. Feed items "
            "are source-ingest events that help a user revisit evidence changes without polling "
            "each profile manually."
        ),
    },
    {
        "name": "flags",
        "description": (
            "Anonymous correction signals for stale, incorrect, sensitive, or broken Atlas data. "
            "Flags prompt review; they do not by themselves prove that a public record should be "
            "changed, removed, or trusted."
        ),
    },
    {
        "name": "follows",
        "description": (
            "Follow-state APIs for public profiles. Use these endpoints to subscribe or "
            "unsubscribe the authenticated user from profile activity that appears in their feed."
        ),
    },
    {
        "name": "health",
        "description": (
            "Small operational health checks for clients and monitors. Health responses are "
            "intentionally minimal and do not expose user, workspace, or discovery data."
        ),
    },
    {
        "name": "issue-areas",
        "description": (
            "Atlas issue-area taxonomy and natural-language issue lookup. Issue-area slugs are "
            "stable filters for places, entities, discovery runs, coverage targets, and MCP tools."
        ),
    },
    {
        "name": "lists",
        "description": (
            "Saved-list APIs for authenticated users. Lists let a user collect source-backed "
            "actors for later review or export while preserving compact provenance."
        ),
    },
    {
        "name": "moderation",
        "description": (
            "Review-queue operations for records held back from the public directory. Moderation "
            "endpoints protect users from seeing unsupported, stale, sensitive, or unreviewed "
            "claims presented as confident public facts."
        ),
    },
    {
        "name": "org-annotations",
        "description": (
            "Workspace annotations attached to shared entries or source packets. Annotations are "
            "private team context and should not be treated as public evidence."
        ),
    },
    {
        "name": "org-briefs",
        "description": (
            "Private Atlas Brief artifacts for workspace teams. Briefs combine actors, sources, "
            "notes, confidence summaries, and exports so teams can act without separating claims "
            "from the evidence behind them."
        ),
    },
    {
        "name": "org-coverage-reports",
        "description": (
            "Workspace coverage reports for funders and customer-success review. Reports explain "
            "what public coverage improved and where the data boundary still matters."
        ),
    },
    {
        "name": "org-coverage-targets",
        "description": (
            "Workspace targets for places, issues, actor types, and source gaps. Targets help a "
            "team decide what to research next and keep review status tied to linked evidence."
        ),
    },
    {
        "name": "org-discovery-runs",
        "description": (
            "Organization-scoped discovery records. These endpoints keep private research runs "
            "inside a workspace until the team decides what, if anything, should become public."
        ),
    },
    {
        "name": "org-entries",
        "description": (
            "Organization-owned entries and public workspace directory controls. Use these "
            "endpoints to manage private records, publish reviewed records, and configure a "
            "source-linked public directory."
        ),
    },
    {
        "name": "org-quality",
        "description": (
            "Workspace data-quality summaries. These endpoints expose source coverage, duplicate "
            "risk, stale-record signals, and confidence indicators without turning them into "
            "public impact claims."
        ),
    },
    {
        "name": "org-usage",
        "description": (
            "Customer-safe usage and renewal proof for workspaces. Usage endpoints show evidence "
            "opens, exports, integration activity, and audit context without exposing private "
            "notes as public evidence."
        ),
    },
    {
        "name": "org-watch-digest",
        "description": (
            "Workspace watch digest events. Digests summarize watched resource changes so teams "
            "can revisit source-backed work without polling every actor, brief, or target."
        ),
    },
    {
        "name": "org-watches",
        "description": (
            "Workspace watch subscriptions. Watches tell Atlas which actors, briefs, targets, "
            "or other resources a workspace wants to monitor for changes."
        ),
    },
    {
        "name": "places",
        "description": (
            "Place-first public discovery resources. Place endpoints let a user resolve a local "
            "place, find source-backed actors there, inspect local sources, and understand coverage "
            "before drawing conclusions from a result set."
        ),
    },
]
OPENAPI_SERVERS = [
    {"url": "https://atlas.rebuildingus.org", "description": "Production environment"},
    {"url": "https://api.atlas.localhost", "description": "Local development"},
    {"url": "/", "description": "Relative to current host"},
]
OPENAPI_EXTERNAL_DOCS = {
    "description": "Atlas API concepts, tutorials, authentication, and trust guidance",
    "url": "https://atlas.rebuildingus.org/docs/api-reference/overview",
}
OPENAPI_TAG_GROUPS = [
    {
        "name": "Public discovery",
        "tags": ["places", "entities", "issue-areas", "domains", "flags"],
    },
    {
        "name": "Personal account workflows",
        "tags": ["access", "claims", "follows", "feed", "lists"],
    },
    {
        "name": "Workspace workflows",
        "tags": [
            "org-entries",
            "org-briefs",
            "org-coverage-targets",
            "org-coverage-reports",
            "org-annotations",
            "org-quality",
            "org-usage",
            "org-watches",
            "org-watch-digest",
            "org-discovery-runs",
        ],
    },
    {
        "name": "Discovery operations",
        "tags": ["discovery-runs", "discovery-schedules", "moderation", "health"],
    },
]

OPENAPI_TAG_OPERATION_GUIDANCE = {
    "access": (
        "Use this access operation before relying on protected workflows. It explains or changes "
        "the caller's ability to use authenticated Atlas features, so integrations should surface "
        "authorization failures clearly instead of treating them as empty data."
    ),
    "claims": (
        "Use this profile-claim operation when a real profile subject needs controlled access to "
        "their own Atlas presence. Keep subject-managed fields distinct from source-backed public "
        "claims so user edits do not overwrite provenance."
    ),
    "discovery-schedules": (
        "Use this schedule operation for recurring research targets. Schedules define what Atlas "
        "should revisit; review, source freshness, and publication decisions still happen through "
        "discovery runs and workspace workflows."
    ),
    "discovery-runs": (
        "Use this discovery operation to create, synchronize, lease, inspect, or cancel research "
        "work. Treat discovered actors as reviewable leads until their source evidence and "
        "visibility state are checked."
    ),
    "domains": (
        "Use this taxonomy operation to keep integrations aligned with Atlas vocabulary. Store "
        "stable slugs in code and exports, but show human labels when presenting filters to users."
    ),
    "entities": (
        "Use this entity operation to find or manage source-backed civic actors. Preserve entity "
        "ids, source ids, place context, and issue filters whenever you export or reuse results."
    ),
    "feed": (
        "Use this feed operation to help a signed-in user notice source-backed profile changes. "
        "Feed events are cues for review, not endorsements or impact claims."
    ),
    "flags": (
        "Use this flag operation to report or review possible corrections. A flag is a review "
        "signal; keep the original source context available until a moderator resolves it."
    ),
    "follows": (
        "Use this follow operation to manage a user's subscription to profile activity. Follow "
        "state controls personal notifications and feed contents, not public record visibility."
    ),
    "health": (
        "Use this health operation for uptime and dependency checks. It is intentionally minimal "
        "and should not be used as a data-readiness or discovery-quality signal."
    ),
    "issue-areas": (
        "Use this issue-area operation to translate user intent into stable Atlas filters. Fetch "
        "the taxonomy from the API instead of maintaining a second copy in an app or agent prompt."
    ),
    "lists": (
        "Use this saved-list operation to collect actors for a signed-in user's later review. "
        "Lists are personal workflow artifacts; exports should keep source counts or receipts "
        "attached to the actors they describe."
    ),
    "moderation": (
        "Use this moderation operation when a record needs human review before it appears in a "
        "public directory. The goal is to prevent unsupported, stale, or sensitive claims from "
        "being displayed with more confidence than the evidence allows."
    ),
    "org-annotations": (
        "Use this annotation operation for private workspace context attached to entries or "
        "sources. Annotations help teams decide what to do next but are not public evidence."
    ),
    "org-briefs": (
        "Use this brief operation to build or export a source-linked workspace artifact. Briefs "
        "should carry actors, sources, confidence notes, and review state together."
    ),
    "org-coverage-reports": (
        "Use this report operation to explain workspace coverage outcomes. Report data should "
        "make public coverage and data boundaries clear instead of implying complete impact."
    ),
    "org-coverage-targets": (
        "Use this coverage-target operation to track places, issues, actor types, and source gaps "
        "that a workspace intends to improve. Link evidence and review state before treating a "
        "target as complete."
    ),
    "org-discovery-runs": (
        "Use this organization discovery operation for private workspace research records. Keep "
        "private run state separate from public directory entries until publication is explicit."
    ),
    "org-entries": (
        "Use this workspace-entry operation to manage private records or publish reviewed records "
        "into a public workspace directory. Do not treat private notes as public evidence."
    ),
    "org-quality": (
        "Use this quality operation to inspect source coverage, duplicate risk, stale-record "
        "signals, and confidence indicators for a workspace. These signals guide review rather "
        "than replacing it."
    ),
    "org-usage": (
        "Use this usage operation for customer-safe renewal proof and integration monitoring. "
        "Usage counts explain how a workspace used Atlas without exposing sensitive notes."
    ),
    "org-watch-digest": (
        "Use this digest operation to review changes for watched workspace resources. Digest "
        "items should send users back to source-backed records before they act."
    ),
    "org-watches": (
        "Use this watch operation to subscribe a workspace to changes on an actor, brief, target, "
        "or related resource. Watches are monitoring preferences, not public claims."
    ),
    "places": (
        "Use this place operation when the user's question is local. Place-first results are most "
        "useful when paired with issue filters, source review, and coverage context."
    ),
}

OPENAPI_OPERATION_NOTES = {
    "listEntities": (
        "Start broad, then narrow with place, issue-area, actor-type, source-type, or text "
        "filters. A matching entity is a lead until its source trail supports the claim you plan "
        "to repeat."
    ),
    "listPlaceEntities": (
        "This is the most natural public discovery entry point: choose a place first, then refine "
        "by issue area or actor type. Use coverage and sources before interpreting absence as a "
        "real local gap."
    ),
    "listEntitySources": (
        "Use the source trail before publishing, contacting, funding, or importing an actor. Keep "
        "the source URL, title, date, and extraction context with any exported claim."
    ),
    "listPlaceSources": (
        "Use place sources to understand which public documents are shaping a local result set. "
        "A place can look well-covered because one source family is dense, so inspect the source "
        "mix before drawing conclusions."
    ),
    "createDiscoveryRun": (
        "Starting a run creates asynchronous research work. Poll the run, then review sources and "
        "visibility receipts before using discovered actors in a public or high-stakes workflow."
    ),
    "createDiscoveryRunSync": (
        "Sync is for reviewed local Scout artifacts. Preserve local-to-remote entry links and "
        "visibility receipts so a team can tell what stayed private, what was skipped, and what "
        "became public."
    ),
    "publishOrgEntry": (
        "Publishing is a visibility decision. Only publish workspace entries whose public fields "
        "and sources are safe for the directory audience."
    ),
    "getPublicOrgDirectory": (
        "Use this endpoint for source-linked records a workspace has deliberately published. "
        "Private briefs, annotations, and planning notes are intentionally excluded."
    ),
}

SCHEMA_DESCRIPTIONS = {
    "HTTPValidationError": "Validation failure returned when a request cannot be parsed.",
    "ValidationError": "One field-level validation problem inside an invalid request.",
}

SCHEMA_PROPERTY_DESCRIPTIONS: dict[SchemaPropertyKey, str] = {
    ("ClaimEvidenceSet", "contact"): "Contact evidence used to support the profile claim.",
    ("ClaimEvidenceSet", "issues"): "Issue-area evidence associated with the claimed profile.",
    ("ClaimEvidenceSet", "place"): "Place evidence associated with the claimed profile.",
    ("ClaimEvidenceSet", "summary"): "Short evidence summary reviewers can inspect.",
    ("CoverageReportResponse", "summary"): "Top-level coverage report metrics and context.",
    ("CoverageTargetDetailResponse", "target"): "Coverage target being reviewed or updated.",
    ("CoverageUnderwritingReportResponse", "data_boundary"): "Limits on what the report proves.",
    (
        "CoverageUnderwritingReportResponse",
        "public_impact",
    ): "Public coverage outcomes for the report.",
    ("CoverageUnderwritingReportResponse", "summary"): "Funder-facing coverage report summary.",
    (
        "DirectoryConfigRequest",
        "methodology",
    ): "Public methodology text for the workspace directory.",
    ("DirectoryConfigRequest", "scope"): "Public scope text for the workspace directory.",
    ("DirectoryConfigResponse", "methodology"): "Saved public methodology text.",
    ("DirectoryConfigResponse", "scope"): "Saved public scope text.",
    ("DirectoryTemplateResponse", "place_scope"): "Place scope seeded by this directory template.",
    ("EntityCollectionResponse", "place"): "Place context for place-scoped entity results.",
    ("EntityCreateRequest", "address"): "Public address or geography for the new actor.",
    ("EntityCreateRequest", "contact"): "Public contact channels for the new actor.",
    ("EntityDetailResponse", "actor_quality"): "Quality signals for the actor record.",
    ("EntityDetailResponse", "address"): "Normalized public address or geography for the actor.",
    ("EntityDetailResponse", "claim"): "Subject-claim state for this actor profile.",
    ("EntityDetailResponse", "claim_evidence"): "Evidence considered for the profile claim.",
    ("EntityDetailResponse", "contact"): "Public contact channels for the actor.",
    ("EntityDetailResponse", "flag_summary"): "Open correction signals on this actor.",
    ("EntityDetailResponse", "freshness"): "Source freshness and last-seen context for the actor.",
    ("EntityDetailResponse", "profile_answers"): "Subject-managed profile answers.",
    ("EntityDetailResponse", "trust"): "Trust tier and provenance summary for the actor.",
    ("EntityResponse", "actor_quality"): "Quality signals for the actor record.",
    ("EntityResponse", "address"): "Normalized public address or geography for the actor.",
    ("EntityResponse", "claim"): "Subject-claim state for this actor profile.",
    ("EntityResponse", "claim_evidence"): "Evidence considered for the profile claim.",
    ("EntityResponse", "contact"): "Public contact channels for the actor.",
    ("EntityResponse", "flag_summary"): "Open correction signals on this actor.",
    ("EntityResponse", "freshness"): "Source freshness and last-seen context for the actor.",
    ("EntityResponse", "profile_answers"): "Subject-managed profile answers.",
    ("EntityResponse", "trust"): "Trust tier and provenance summary for the actor.",
    ("EntityUpdateRequest", "address"): "Public address or geography updates for the actor.",
    ("EntityUpdateRequest", "contact"): "Public contact channel updates for the actor.",
    ("IssueSignalsResponse", "place"): "Place context for the issue-signal summary.",
    ("MapPoint", "geo_specificity"): "How local or broad the actor's geography is.",
    ("MapPoint", "geocode_precision"): "Precision tier used for the map coordinate.",
    ("MapPoint", "geocode_source"): "Source used to derive the map coordinate.",
    ("MapPoint", "latest_source_date"): "Newest source date represented on the map point.",
    ("MapPoint", "place_label"): "Human-readable place label for the map point.",
    ("MapPoint", "source_count"): "Number of sources linked to the mapped actor.",
    ("OrgBriefCreateRequest", "confidence_summary"): "Confidence notes captured with the brief.",
    ("OrgBriefCreateRequest", "scope"): "Research scope for the new brief.",
    ("OrgBriefExportResponse", "brief"): "Brief artifact being exported.",
    ("OrgBriefExportResponse", "provenance"): "Source and export provenance for the brief.",
    ("OrgBriefResponse", "confidence_summary"): "Confidence notes saved with the brief.",
    ("OrgBriefResponse", "scope"): "Research scope saved with the brief.",
    ("OrgBriefUpdateRequest", "confidence_summary"): "Updated confidence notes for the brief.",
    ("OrgIntegrationMonitoringResponse", "data_boundary"): "Limits on integration monitoring data.",
    ("OrgQualitySummaryResponse", "data_boundary"): "Limits on the workspace quality summary.",
    ("OrgQualitySummaryResponse", "duplicate_risk"): "Duplicate-risk signals for workspace data.",
    ("OrgQualitySummaryResponse", "source_coverage"): "Source coverage signals for workspace data.",
    ("OrgQualitySummaryResponse", "stale_records"): "Stale-record signals for workspace data.",
    ("OrgRenewalPacketResponse", "data_boundary"): "Limits on renewal-packet data.",
    ("OrgRenewalPacketResponse", "summary"): "Customer-safe renewal summary.",
    ("OrgUsageAuditLogResponse", "data_boundary"): "Limits on audit-log data.",
    ("OrgUsageSummaryResponse", "renewal_signals"): "Usage signals suitable for renewal review.",
    ("OrgWatchStatusResponse", "watch"): "Workspace watch state for the requested resource.",
    ("PlaceCoverageResponse", "place"): "Place context for the coverage summary.",
    ("PlaceGovernmentLinkResponse", "href"): "URL for the government or public-body link.",
    ("PlaceGovernmentLinkResponse", "label"): "Display label for the government link.",
    ("PlaceGovernmentResponse", "links"): "Public links associated with this government body.",
    ("PlaceGovernmentResponse", "name"): "Government or regional public body name.",
    ("PlaceGovernmentResponse", "role"): "Role this body plays for the place.",
    ("PlaceIdentityResponse", "place"): "Canonical Atlas place resource.",
    ("PlacePageContextResponse", "display"): "Human-readable display name for the place page.",
    ("PlacePageContextResponse", "governments"): "Relevant public bodies for the place.",
    ("PlacePageContextResponse", "kind"): "Place kind used by the public page.",
    ("PlacePageContextResponse", "name"): "Canonical place name.",
    ("PlacePageContextResponse", "place_key"): "Stable Atlas place key.",
    ("PlacePageContextResponse", "places"): "Related places shown in the page context.",
    ("PlacePageContextResponse", "resource_uri"): "Canonical resource URI for the place.",
    ("PlacePageContextResponse", "scopes"): "Broader or narrower scopes for the place.",
    ("PlaceProfileResponse", "place"): "Place context for the demographic profile.",
    ("PublicDirectoryResponse", "federation"): "Federation metadata for the public directory.",
    ("PublicDirectoryResponse", "methodology"): "Public methodology text for the directory.",
    (
        "PublicDirectoryResponse",
        "publication",
    ): "Publication state and timestamps for the directory.",
    ("PublicDirectoryResponse", "scope"): "Public scope text for the directory.",
    ("PublicDirectoryResponse", "stats"): "Published record counts for the directory.",
    (
        "PublicDirectoryResponse",
        "trust_footer",
    ): "Trust and provenance text shown with the directory.",
    ("PublicDirectoryResponse", "workspace"): "Public workspace identity for the directory.",
    ("PublicDirectoryWorkspace", "custom_domain"): "Verified custom domain for the directory.",
    ("SavedListExportItemResponse", "entry"): "Actor included in the saved-list export.",
    ("SavedListExportResponse", "list"): "Saved list metadata for the export.",
    ("SavedListExportResponse", "provenance"): "Source-count provenance for the saved-list export.",
    ("SavedListItemResponse", "entry"): "Actor included in the saved list.",
    ("SourceCollectionResponse", "place"): "Place context for place-scoped source results.",
    ("SourceResponse", "flag_summary"): "Open correction signals on this source.",
    ("SourceResponse", "freshness"): "Freshness context for this source.",
    ("WatchDigestItem", "entry"): "Actor associated with the watch digest item.",
    ("WatchDigestItem", "source"): "Source associated with the watch digest item.",
}

HTTP_METHODS = {"get", "put", "post", "delete", "patch", "options", "head", "trace"}


def generate_operation_id(route: APIRoute) -> str:
    """Generate stable, human-readable operation IDs from route names."""
    return route.name


def install_openapi_enrichment(app: FastAPI) -> None:
    """Install Atlas documentation enrichment on the FastAPI OpenAPI generator."""
    default_openapi = app.openapi

    def enriched_openapi() -> OpenAPISchema:
        """Return the generated OpenAPI schema with Atlas documentation context."""
        if app.openapi_schema:
            return app.openapi_schema

        schema = default_openapi()
        enrich_openapi_schema(schema)
        app.openapi_schema = schema
        return schema

    app.openapi = enriched_openapi  # type: ignore[method-assign]


def enrich_openapi_schema(schema: OpenAPISchema) -> None:
    """Mutate a generated OpenAPI schema with Scalar-friendly explanatory docs."""
    schema["externalDocs"] = OPENAPI_EXTERNAL_DOCS
    schema["x-tagGroups"] = OPENAPI_TAG_GROUPS
    _enrich_operations(schema)
    _enrich_schema_components(schema)


def _enrich_operations(schema: OpenAPISchema) -> None:
    """Add workflow and trust context to every operation description."""
    paths = schema.get("paths")
    if not isinstance(paths, dict):
        return

    for path_item in paths.values():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method not in HTTP_METHODS or not isinstance(operation, dict):
                continue
            _enrich_operation(operation)


def _enrich_operation(operation: OpenAPIOperation) -> None:
    """Append tag-level and operation-specific guidance to one operation."""
    description = str(operation.get("description") or "").strip()
    sections = [description] if description else []

    tags = operation.get("tags")
    tag = tags[0] if isinstance(tags, list) and tags else None
    if isinstance(tag, str):
        _append_unique_section(sections, OPENAPI_TAG_OPERATION_GUIDANCE.get(tag))

    operation_id = operation.get("operationId")
    if isinstance(operation_id, str):
        _append_unique_section(sections, OPENAPI_OPERATION_NOTES.get(operation_id))

    if sections:
        operation["description"] = "\n\n".join(sections)


def _append_unique_section(sections: list[str], section: str | None) -> None:
    """Append a section when it exists and is not already represented."""
    if not section:
        return
    normalized = section.strip()
    if normalized and normalized not in sections:
        sections.append(normalized)


def _enrich_schema_components(schema: OpenAPISchema) -> None:
    """Ensure response and request schemas expose helpful Scalar field descriptions."""
    schemas = schema.get("components", {}).get("schemas")
    if not isinstance(schemas, dict):
        return

    for schema_name, component in schemas.items():
        if not isinstance(component, dict):
            continue
        component.setdefault("description", _fallback_schema_description(str(schema_name)))
        if schema_name in SCHEMA_DESCRIPTIONS:
            component["description"] = SCHEMA_DESCRIPTIONS[str(schema_name)]

        properties = component.get("properties")
        if not isinstance(properties, dict):
            continue

        for property_name, property_schema in properties.items():
            if not isinstance(property_schema, dict):
                continue
            key = (str(schema_name), str(property_name))
            property_schema.setdefault(
                "description",
                SCHEMA_PROPERTY_DESCRIPTIONS.get(
                    key,
                    _fallback_property_description(str(schema_name), str(property_name)),
                ),
            )


def _fallback_schema_description(schema_name: str) -> str:
    """Create a readable schema description when Pydantic did not emit one."""
    label = _humanize_schema_name(schema_name)
    return f"Schema for {label}."


def _fallback_property_description(schema_name: str, property_name: str) -> str:
    """Create a readable property description when a field does not define one."""
    property_label = _humanize_identifier(property_name)
    schema_label = _humanize_schema_name(schema_name)
    return f"{property_label} for this {schema_label}."


def _humanize_schema_name(schema_name: str) -> str:
    """Convert a schema class name into a short human label."""
    stripped = schema_name
    for suffix in ("Response", "Request", "Create", "Update"):
        if stripped.endswith(suffix):
            stripped = stripped.removesuffix(suffix)
    return _humanize_identifier(stripped)


def _humanize_identifier(value: str) -> str:
    """Convert snake_case or PascalCase into lowercase words."""
    words: list[str] = []
    current = ""
    previous = ""

    for char in value.replace("_", " "):
        if char == " ":
            if current:
                words.append(current)
                current = ""
            previous = char
            continue
        if char.isupper() and current and (not previous.isupper()):
            words.append(current)
            current = char.lower()
        else:
            current += char.lower()
        previous = char

    if current:
        words.append(current)

    return " ".join(words)


def export_openapi_schema(app: FastAPI, output_path: Path) -> Path:
    """Export the app OpenAPI schema to a deterministic JSON artifact."""
    app.openapi_schema = None  # Force regeneration
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return output_path


def main() -> None:
    """CLI entrypoint for exporting the Atlas OpenAPI schema."""
    create_app = importlib.import_module("atlas.main").create_app
    project_root = Path(__file__).resolve().parents[3]
    output_path = project_root / "openapi" / "atlas.openapi.json"
    export_openapi_schema(create_app(), output_path)
    print(output_path)


if __name__ == "__main__":  # pragma: no cover
    main()
