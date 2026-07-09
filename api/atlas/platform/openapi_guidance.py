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
    "firehose": (
        "Use this Firehose operation to query or observe source-backed civic signals for an "
        "authenticated workspace. Preserve workspace, usage, signal, and evidence context so "
        "billing and trust stay tied to the query that produced the data."
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
        "Use this usage operation for customer-safe renewal proof and integration activity. "
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
        "Sync is for reviewed local Scout results. Preserve local-to-remote entry links and "
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
