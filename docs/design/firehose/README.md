# Firehose Architecture Overview

Status: Draft Date: 2026-07-05 Owner: Rebuilding America Project

## Purpose

This document defines Firehose at a high architectural level. The companion
documents describe collection, analysis, storage, serving, governance, and
operations in more detail.

Firehose is the pipeline that turns public civic activity into source-backed
signals Atlas users can see, trust, monitor, export, and act on. It is a product
architecture, not just a data-ingestion system. Every stage exists to produce a
better end-user experience: fresher public discovery, clearer source trails,
useful field intelligence, and safer handling of public information about real
people and organizations.

## Product Contract

Firehose exists to answer:

> What changed in this civic field, who is connected to it, what source proves
> it, and what should someone inspect next?

The atomic unit is a civic signal. A signal is a source-backed observation that
something in the public civic field happened, changed, appeared, disappeared,
gained evidence, lost freshness, or became worth review.

Firehose is detailed by design. It should operate close to the public/private
boundary: names, roles, affiliations, dates, jurisdictions, public statements,
relationships, event context, and source passages are in scope when they are
public, relevant, and necessary for civic understanding. The line is
private-life inference, hidden data, disproportionate exposure, and details that
create risk without civic value.

## System Shape

```text
Coverage Targets
  -> Source Target Planner
  -> Source Connectors
  -> Raw Artifacts
  -> Source Normalization
  -> Civic Signal Candidates
  -> Classification
  -> Entity And Place Resolution
  -> Claim And Relationship Extraction
  -> Trust, Relevance, And Safety Scoring
  -> Routing
  -> Storage
  -> Product Surfaces
```

The pipeline has four responsibilities:

1. Collect public artifacts from governed source classes.
2. Analyze artifacts into source-backed civic signals.
3. Store signals, sources, claims, relationships, routes, and review state.
4. Serve the right summary to the right surface with provenance attached.

## Relationship To Scout

Scout is Atlas's local, operator-driven discovery CLI. It is still the right
tool for launch-data ingestion, source discovery, backfills, direct-URL
research, search-backed exploration, iterative deepening, browser research, and
optional trusted worker jobs.

Firehose is the hosted hot-monitoring lane. It owns the minute-grade experience
for approved configured sources. Scout can seed Firehose by syncing canonical
run artifacts through Atlas review or workspace-private import, and Firehose can
escalate slow enrichment or coverage gaps into existing Scout-compatible
discovery jobs. Scout workers must not be required for the 60-second hot path,
because local machines and volunteer workers cannot be treated as production
availability guarantees.

## Core Components

### Coverage Targets

Coverage targets tell Firehose what civic field to watch. A target can be a
place, issue, actor cluster, public organization, public person in a public
role, source class, customer workspace scope, public directory, or underwriting
scope.

Targets carry freshness expectations, source classes, budgets, safety policy,
and routing policy. They prevent Firehose from becoming an undirected crawler.

### Source Target Planner

The planner expands coverage targets into fetchable source targets. For a county
housing target, it might schedule city agendas, county board minutes, state
legislative updates, local news feeds, nonprofit campaign pages, public grant
databases, and known organization pages.

The planner should prefer high-signal, source-rich targets over broad web
scraping. It should record why each source was selected so coverage gaps are
inspectable later.

### Source Connectors

Connectors retrieve public artifacts. A connector is responsible for one source
class or provider family: government agendas, meeting minutes, legislative
feeds, public comment portals, news/RSS, organization pages, public event feeds,
grants, filings, and structured registries.

Connectors must produce normalized raw artifacts with source metadata,
fingerprints, retrieval state, and budget accounting. They must not silently
invent defaults.

### Raw Artifacts

A raw artifact is the captured public material before Atlas decides what it
means. It can be HTML, PDF text, RSS item, API record, transcript, agenda item,
calendar event, or structured filing row.

Artifacts preserve canonical URL, source URL, source type, publisher, published
date when available, retrieved timestamp, content hash, raw content pointer,
normalized text pointer, and extraction version.

### Civic Signal Candidates

A candidate is a possible signal extracted from an artifact. Candidates are not
trusted facts. They are structured leads that must pass classification,
resolution, scoring, and routing.

Candidates should preserve the exact passage or structured field that produced
them. If Atlas cannot show why a candidate exists, it should not become a
visible signal.

### Analysis And Resolution

Analysis classifies the candidate, identifies the public realm basis, resolves
people and organizations to Atlas entries, links places and issues, proposes
claims and relationships, and scores relevance, confidence, freshness, and
sensitivity.

Resolution should prefer stable identifiers and strong public context. Ambiguity
routes to review instead of silently merging people or creating duplicate
records.

### Trust And Safety Gate

The gate decides what can be published, routed, held, rejected, suppressed, or
shown only inside a workspace. It applies Atlas Trust rules to source quality,
identity confidence, sensitivity, public-role context, and requested use.

High confidence does not override safety. A true public fact can still be
dangerous or irrelevant if displayed without context.

### Routing

Routing sends signals to public and private surfaces:

- Public profile timelines.
- Place and issue activity.
- Personal follows.
- Workspace watches.
- Brief leads.
- Coverage gaps.
- Review queues.
- API and MCP responses.
- Public graph changelog.

Each route records why it exists and which visibility scope applies.

### Storage

Storage keeps the evidence chain intact. A visible signal should be traceable
back to raw artifact, source record, relevant passage, classifier output,
resolved entities, proposed claims, scores, review state, and route.

Firehose should extend the existing Atlas model rather than replace it in one
move. The first implementation can sit alongside `sources`, `entry_sources`,
`entity_relationship_edges`, `discovery_runs`, `org_watches`, and
`org_change_events`, then converge with the broader knowledge-graph redesign.

## Lifecycle States

```text
planned
  -> collected
  -> normalized
  -> candidate_extracted
  -> analyzed
  -> scored
  -> routed
  -> visible | held_for_review | rejected | suppressed | archived
```

All state transitions should be idempotent. A provider retry should not create
duplicate signals, duplicate sources, or duplicate change events.

## Surfaces

Firehose should power several product surfaces without exposing the raw feed by
default:

- Profile timelines: public-role activity, source updates, claims refreshed, new
  relationships, recent public events.
- Place pages: recent civic activity, emerging actors, source attention,
  upcoming public meetings, coverage gaps.
- Issue pages: rising actors, new campaigns, policy moments, coalition changes,
  fresh sources.
- Follow home: calm summaries of meaningful change.
- Workspace watches: monitored field intelligence with scope controls.
- Briefing Room: selected signals become source-linked brief leads.
- Coverage Workspace: targets show fresh, stale, thin, blocked, and saturated
  cells.
- API/MCP: provenance-preserving signal access with entitlement and safety
  boundaries.

## Document Map

- [Firehose Civic Intelligence PRD](../../product/prds/14-firehose-civic-intelligence-prd.md)
- [Collection Pipeline](./collection-pipeline.md)
- [Analysis And Resolution Pipeline](./analysis-and-resolution-pipeline.md)
- [Storage And Serving Model](./storage-and-serving-model.md)
- [Governance And Operations](./governance-and-operations.md)

## Non-Goals

- A raw national event stream shown directly to users.
- Private-life tracking.
- Hidden or non-public data collection.
- Law-enforcement surveillance.
- Doxxing, harassment, intimidation, or exposure tooling.
- Stripped-provenance resale.
- Custom electoral targeting.
- Replacing Atlas Directory, Trust, or Workbench. Firehose feeds them.
