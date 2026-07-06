# Firehose Storage And Serving Model

Status: Draft Date: 2026-07-05 Owner: Rebuilding America Project

## Purpose

This document defines how Firehose should store collected artifacts, analyzed
signals, routes, review state, and downstream product outputs.

Storage must preserve the evidence chain. A visible Firehose item should always
be traceable to the source material and the decisions that made it visible.

## Current Substrate

Atlas already has useful pieces:

- `sources`: public source records.
- `entry_sources`: entry to source links with extraction context.
- `entity_identity_keys`: stable identity keys for catalog entries.
- `entity_relationship_edges`: sourced relationship edges.
- `discovery_runs` and `discovery_jobs`: durable discovery execution.
- `cost_ledger`: discovery spend metering.
- `coverage_targets`: workspace coverage scope.
- `org_watches`: workspace watches.
- `org_change_events`: workspace digest events.
- `profile_follows`: profile follow subscriptions.
- `source_flags` and moderation review queues.
- `profile_claims`: subject stewardship.

Firehose should extend this substrate additively. It should not replace the
catalog model before the broader knowledge-graph migration is ready.

## Storage Principles

- Store raw artifact metadata before analysis.
- Store normalized content pointers, not only extracted summaries.
- Store civic signals as first-class records.
- Store routes separately from signals.
- Store review state separately from source truth.
- Keep provenance attached to every public and private surface.
- Make suppression and correction additive, auditable state changes.
- Design for idempotent retries.
- Do not make customer-private records the basis for public trust.

## Proposed Tables

The exact names can change during implementation, but the model should preserve
these responsibilities.

### firehose_source_targets

Represents a fetchable source target produced by a coverage target or seed.

Important fields:

- `id`.
- `coverage_target_id`.
- `target_kind`.
- `target_label`.
- `source_class`.
- `source_url`.
- `provider`.
- `jurisdiction_place_id`.
- `issue_area`.
- `freshness_interval`.
- `backfill_window`.
- `enabled`.
- `safety_policy`.
- `budget_policy`.
- `last_checked_at`.
- `last_success_at`.
- `last_error`.
- `created_at`.
- `updated_at`.

Indexes:

- `(coverage_target_id, enabled)`.
- `(source_class, enabled)`.
- `(last_checked_at)`.

### firehose_artifacts

Represents a retrieved public artifact or artifact version.

Important fields:

- `id`.
- `source_target_id`.
- `source_id` when promoted to the shared `sources` table.
- `canonical_url`.
- `retrieved_url`.
- `provider_record_id`.
- `source_type`.
- `publisher`.
- `published_at`.
- `retrieved_at`.
- `content_hash`.
- `raw_content_uri`.
- `normalized_content_uri`.
- `media_type`.
- `language`.
- `collection_status`.
- `collection_warnings_json`.
- `connector_name`.
- `connector_version`.
- `created_at`.

Uniqueness:

- `(source_target_id, content_hash)`.
- `(provider_record_id, provider)` when provider record id exists.
- Canonical URL uniqueness should be source-class aware because one URL can
  update over time.

### firehose_signals

Represents the analyzed civic signal.

Important fields:

- `id`.
- `primary_artifact_id`.
- `signal_type`.
- `summary`.
- `public_realm_basis`.
- `event_date`.
- `place_id`.
- `issue_areas_json`.
- `source_quality_score`.
- `identity_confidence`.
- `claim_confidence`.
- `civic_relevance_score`.
- `freshness_score`.
- `novelty_score`.
- `coverage_value_score`.
- `sensitivity_score`.
- `visibility_state`.
- `review_state`.
- `analysis_version`.
- `created_at`.
- `updated_at`.

Visibility states:

- `internal`.
- `public`.
- `workspace_private`.
- `held`.
- `rejected`.
- `suppressed`.
- `archived`.

Review states:

- `not_required`.
- `pending`.
- `approved`.
- `approved_with_edits`.
- `needs_more_sources`.
- `rejected`.
- `suppressed`.

Indexes:

- `(signal_type, created_at)`.
- `(place_id, created_at)`.
- `(review_state, sensitivity_score)`.
- `(visibility_state, created_at)`.

### firehose_signal_sources

Links signals to artifacts and shared source records.

Important fields:

- `signal_id`.
- `artifact_id`.
- `source_id`.
- `passage`.
- `passage_locator`.
- `support_type`: direct, corroborating, contextual, contradiction.
- `created_at`.

Primary key:

- `(signal_id, artifact_id, passage_locator)`.

### firehose_signal_entities

Links signals to resolved or proposed Atlas actors.

Important fields:

- `signal_id`.
- `entry_id`.
- `proposed_entry_json`.
- `entity_role`: subject, speaker, organizer, sponsor, funder, grantee,
  official, mentioned, affected, source_owner.
- `resolution_state`: resolved, proposed, ambiguous, rejected.
- `resolution_confidence`.
- `resolution_explanation`.
- `created_at`.

### firehose_signal_claims

Links signals to existing or proposed claims.

Important fields:

- `signal_id`.
- `claim_id`.
- `proposed_claim_json`.
- `claim_role`: new, update, corroboration, contradiction, stale.
- `confidence`.
- `review_state`.
- `created_at`.

### firehose_signal_relationships

Links signals to existing or proposed relationship edges.

Important fields:

- `signal_id`.
- `relationship_id`.
- `proposed_relationship_json`.
- `relationship_role`: new, corroboration, contradiction, stale.
- `confidence`.
- `review_state`.
- `created_at`.

### firehose_routes

Represents where a signal is allowed to appear.

Important fields:

- `id`.
- `signal_id`.
- `destination_type`: public_profile, place_page, issue_page, personal_follow,
  org_watch, brief_lead, coverage_gap, api_mcp, review_queue,
  public_graph_changelog.
- `destination_id`.
- `visibility_scope`: public, user_private, workspace_private, reviewer_only.
- `route_reason`.
- `route_state`: proposed, active, muted, expired, suppressed, rejected.
- `requires_capability`.
- `routed_at`.
- `expires_at`.

### firehose_reviews

Records human review decisions.

Important fields:

- `id`.
- `signal_id`.
- `reviewer_id`.
- `decision`.
- `decision_reason`.
- `edited_summary`.
- `safety_notes`.
- `created_at`.

Review records should never be deleted as a way of hiding a prior decision.

## Integration With Existing Tables

### sources

Firehose artifacts that become evidence should create or link to `sources`. The
shared `sources` table remains the canonical public source record.

### entry_sources

When a Firehose signal supports an existing public profile fact, it can create
or update `entry_sources` with extraction context. The extraction context should
come from `firehose_signal_sources.passage`.

### entity_relationship_edges

Approved relationship signals should create sourced relationship edges. The
relationship edge should point back to the shared `source_id` and preserve
confidence/review state if the schema supports it.

### org_change_events

Routes to workspace watches should create `org_change_events` only after a
signal is approved for that workspace scope. The change event should reference
the signal when that column exists, or use source and resource references until
the schema is expanded.

### profile_follows

Personal follow digests can read public Firehose routes for followed profiles
and places. Personal follows should not receive workspace-private signals.

### review_queue

Held Firehose signals should create review items with enough payload to inspect
source, candidate, proposed claims, proposed relationships, route proposal, and
safety state.

## Serving Model

### Public Profile Timeline

Input:

- Entry id.
- Public routes with destination `public_profile`.
- Approved or public visibility.

Output:

- Timeline item summary.
- Signal type.
- Source title and URL.
- Event or source date.
- Public realm basis.
- Trust summary.
- Linked relationships and claims.

### Place And Issue Activity

Input:

- Place id or issue area.
- Public routes to place or issue surfaces.
- Time window.
- Optional source class and signal type filters.

Output:

- Recent activity summaries.
- Emerging actors.
- New sources.
- Upcoming public events.
- Coverage gaps.
- Freshness state.

### Workspace Watch Digest

Input:

- Org id.
- Watch id.
- Time window.
- Active routes to workspace watch.

Output:

- Ranked digest items.
- Source links.
- Linked profiles.
- Suggested brief/list/coverage actions.
- Muting and route control metadata.

### API And MCP

API and MCP responses must include:

- Signal id.
- Signal type.
- Summary.
- Source metadata.
- Relevant passages or source packet references.
- Linked entries.
- Place and issue scope.
- Scores or trust summary.
- Visibility scope.
- Review state.
- Usage restrictions.

Agent-readable access does not remove governance. API and MCP endpoints should
enforce entitlements, scope, and provenance requirements.

## Retention And Suppression

Retention should distinguish:

- Raw artifact metadata.
- Raw content snapshots.
- Normalized text.
- Extracted signals.
- Visible route summaries.
- Review decisions.
- Suppression/correction history.

Suppression should hide or limit public display without destroying the audit
trail. If a source is unsafe, irrelevant, or misapplied, Atlas can suppress the
route or source presentation while preserving an internal record of why the
decision was made.

## Idempotency

Firehose should avoid duplicates with stable keys:

- Source target id plus provider record id.
- Source target id plus content hash.
- Signal type plus artifact id plus passage locator.
- Relationship tuple plus source id.
- Claim subject plus attribute plus source id plus normalized value.
- Route signal id plus destination type plus destination id.

Retries must be safe. A failed connector, analysis rerun, or routing retry
should not create multiple visible updates for the same source-backed event.

## Migration Path

1. Add Firehose tables alongside the current catalog and discovery schema.
2. Link Firehose artifacts to `sources`.
3. Link approved signals to `entry_sources`, `entity_relationship_edges`, and
   `org_change_events`.
4. Serve public profile timelines from Firehose routes.
5. Serve workspace watch digests from Firehose routes and existing watch tables.
6. Fold high-confidence signal outputs into the broader knowledge-graph data
   model as entity/claim infrastructure matures.

## Experience Outcome

A user benefits from this storage model when every signal can answer:

- What changed?
- What source proves it?
- Who or what is connected?
- Why is it visible here?
- What is the confidence and review state?
- What should I inspect next?
