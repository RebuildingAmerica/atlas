"""OpenAPI metadata constants for the Atlas API."""

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
        "name": "firehose",
        "description": (
            "Live civic-intelligence query APIs. Firehose lets a workspace ask what changed in a "
            "public civic field, receive source-backed signals with billing context attached, "
            "and observe the same query through standards-based HTTP streams."
        ),
    },
    {
        "name": "firehose-internal",
        "description": (
            "Trusted Firehose production endpoints for workers, schedulers, and message-bus "
            "deliveries. These routes keep stored observations as the canonical evidence record "
            "while creating idempotent signal resources that can later power user-facing feeds."
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
    "url": "https://atlas.rebuildingus.org/docs/api/overview",
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
        "tags": ["discovery-runs", "discovery-schedules", "firehose", "moderation", "health"],
    },
]
