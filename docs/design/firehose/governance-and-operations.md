# Firehose Governance And Operations

Status: Draft Date: 2026-07-05 Owner: Rebuilding America Project

## Purpose

This document defines the governance and operational controls Firehose needs to
remain useful, detailed, and safe. These controls are part of the architecture,
not policy paperwork added after the fact.

Firehose is powerful because it collects public activity, resolves it to real
people and organizations, and routes it to action surfaces. That power is the
reason it can help mission-aligned users. It is also the reason Firehose must
have explicit boundaries, review paths, auditability, and kill switches.

## Operating Doctrine

Firehose should be detailed, source-backed civic intelligence for the public
realm.

Allowed:

- Public civic activity.
- Public-role activity by public people.
- Source-backed names, roles, affiliations, dates, jurisdictions, public
  statements, relationships, event context, and source passages when relevant.
- Monitoring civic systems, public organizations, public campaigns, public
  institutions, public events, and public people acting in public roles.

Not allowed:

- Private-life inference.
- Hidden or non-public data collection.
- Private-person targeting.
- Doxxing, intimidation, harassment, or exposure workflows.
- Law-enforcement surveillance.
- Stripped-provenance resale.
- Custom electoral targeting.
- Details that create risk without civic value.

## Governance Layers

### Source Governance

Each source class should have a source policy:

- Collection allowed.
- Collection restricted.
- Collection disallowed.
- Requires API terms review.
- Requires snapshot retention limits.
- Requires manual source approval.

Source policy should consider:

- Public accessibility.
- Terms and licensing.
- Sensitivity.
- Likelihood of naming private individuals.
- Civic relevance.
- Expected source quality.
- Snapshot retention risk.

### Signal Governance

Each signal receives governance fields:

- Public realm basis.
- Sensitivity score.
- Identity confidence.
- Source quality.
- Public-role context.
- Review requirement.
- Allowed routes.
- Disallowed routes.
- Suppression state.

Signals about public people are not categorically unsafe. The relevant question
is whether the signal is about public-role or public civic activity, is
source-backed, is relevant to civic understanding, and can be shown without
implying more than the evidence supports.

### Customer And Use-Case Governance

Paid access must not bypass trust rules.

Each customer use case should record:

- Customer.
- Package.
- Workspace.
- Coverage targets.
- Intended use.
- Disallowed uses.
- Export permissions.
- API/MCP scope.
- Person-monitoring restrictions.
- Safety reviewer when needed.

High-risk use cases require review before Firehose routes signals into private
workflows. Examples:

- Person-centered monitoring.
- Sensitive issue areas.
- Political or campaign-adjacent use.
- Large exports of named people.
- Requests involving vulnerable communities.
- Requests with unclear public-good value.

## Review Queues

Firehose should create review items for:

- Ambiguous entity resolution.
- Public-person signals with sensitive context.
- Allegations or contested claims.
- Thinly sourced relationship edges.
- Signals about minors or vulnerable people.
- Source policy conflicts.
- Suppression requests.
- Customer route requests that exceed approved scope.
- High-volume export requests.

Review item payload should include:

- Signal.
- Source artifact.
- Relevant passage.
- Public realm basis.
- Proposed entities.
- Proposed claims.
- Proposed relationships.
- Scores.
- Proposed routes.
- Prior subject corrections or suppression history.
- Customer/requesting workspace if applicable.

## Audit Trail

Firehose should log:

- Source target creation and edits.
- Connector runs.
- Artifact captures.
- Analysis version.
- Model or rule version.
- Entity resolution decisions.
- Claim and relationship proposals.
- Safety scores.
- Route proposals and activations.
- Human review decisions.
- Suppression and correction decisions.
- Customer exports and API/MCP access.

Audit records should make it possible to answer:

- Why did Atlas collect this?
- Why did Atlas connect it to this person or organization?
- Why did Atlas show it here?
- Who approved it?
- What changed after a correction or suppression request?

## Operational Controls

### Budgets

Firehose should enforce budgets by:

- Source target.
- Coverage target.
- Workspace.
- Source class.
- Provider.
- Time window.

Budget exceedance should pause collection or analysis and create a visible
coverage status. Atlas should not silently skip important sources and then show
an overconfident field picture.

### Startup Nonprofit Cost Posture

Firehose should preserve the core architecture while keeping fixed costs low.
The MVP should use managed services only where they protect a user-visible
experience: fast signal visibility, trustworthy persistence, safe access
control, and clear operator recovery.

Default MVP production posture:

- Use Vercel for the app and Cloudflare for the public API edge.
- Use Cloud Run for the API.
- Use a separate Cloud Run Firehose worker or worker pool only for production
  hot targets that require minute-grade delivery.
- Use Cloud Scheduler to invoke a run-once Firehose endpoint for demos, staging,
  low-duty pilots, and safety jobs.
- Use Scout and `scout-dev` for local/operator-driven ingest, source discovery,
  backfills, and slow enrichment instead of moving every expensive exploratory
  task into hosted infrastructure.
- Use Neon Postgres as the default MVP production database provider through the
  standard `DATABASE_URL` contract.
- Treat Cloud SQL as a later operator choice, not an architectural requirement.
- Use Artifact Registry, Secret Manager, Cloud Logging, and Cloud Monitoring as
  the baseline Google Cloud support services.

Deferred services:

- Pub/Sub until Firehose needs event fan-out across multiple independent
  consumers.
- Cloud Tasks until source-specific retry and rate-limit behavior outgrows
  Postgres leases.
- Cloud Storage until raw artifacts are too large or too risky for Postgres.
- BigQuery until analytics, replay, revenue reporting, or source-performance
  analysis requires it.
- Redis or Memorystore until live UI fan-out or ephemeral caching cannot be
  handled with Postgres and client polling.
- Cloud SQL until GCP-only infrastructure, private networking, customer
  requirements, Google credits, HA/read replicas, or Neon operational limits
  justify the switch.

Cost controls:

- Keep Firehose disabled by default in new hosted environments.
- Approve hot targets explicitly; do not allow a workspace to turn broad source
  classes into unbounded minute-level polling.
- Use hot, warm, and cold cadence lanes.
- Keep LLM enrichment out of the hot path.
- Use Scout local providers for operator-tolerated deep research and review
  support; do not rely on volunteer/local Scout workers for minute-grade
  delivery.
- Use per-workspace, per-provider, per-source-class, and per-time-window budget
  caps.
- Add cloud budget alerts at 50%, 80%, and 100%.
- Give operators a fast path to pause the worker, disable a source class, lower
  cadence, or stop raw artifact retention during a cost spike.

### Rate Limits And Backoff

Every connector should have:

- Provider-specific rate limits.
- Exponential backoff.
- Circuit breaker.
- Max retry count.
- Stale-source status after repeated failure.

### Kill Switches

Operators need kill switches for:

- Entire Firehose pipeline.
- Source class.
- Provider.
- Coverage target.
- Workspace routes.
- Public route publication.
- API/MCP signal access.
- Person-centered signal routing.

Kill switches should fail closed for risky routes and fail visibly for coverage
status.

### Observability

Metrics:

- Artifacts collected.
- Connector failures.
- Cost per source class.
- Candidate extraction volume.
- Signal approval rate.
- Held/rejected/suppressed signals.
- Duplicate rate.
- Identity ambiguity rate.
- Review queue age.
- Public route volume.
- Workspace route volume.
- Digest mute/unfollow rate.
- Harm reports.

Alerts:

- Provider failure.
- Cost spike.
- Review queue age breach.
- Suppression spike.
- Sensitive signal route spike.
- Duplicate route spike.
- Public publication stopped.
- Workspace delivery failed.

### Evaluation

Firehose should maintain evaluation sets:

- Known meeting agenda examples.
- Known public comment examples.
- Known grant/filing examples.
- Known public-person public-role examples.
- Known ambiguous-name examples.
- Known unsafe/private-life examples.
- Known false-positive civic relevance examples.

Evaluation should measure:

- Candidate extraction recall.
- Signal classification precision.
- Entity resolution precision.
- Public realm basis correctness.
- Route correctness.
- Sensitive-signal review capture.
- Source passage preservation.

## Export And API Controls

Exports must preserve:

- Source URL.
- Source title and publisher.
- Passage or source packet reference.
- Confidence/review state.
- Public realm basis.
- Scope and usage restrictions.

Restricted export patterns:

- Bulk person lists detached from source context.
- Exports that remove provenance.
- Signals outside customer-approved coverage scope.
- Sensitive person-centered signals.
- Signals held for review.

API and MCP access must enforce:

- Workspace entitlement.
- Coverage scope.
- Route visibility.
- Public/private boundary.
- Rate limits.
- Audit logging.

## Incident Response

Firehose incidents include:

- Unsafe public exposure.
- Wrong person resolution.
- Unsupported claim displayed confidently.
- Source stripped from exported data.
- Customer misuse.
- Provider terms issue.
- Cost runaway.
- Review queue backlog causing unsafe stale state.

Incident steps:

1. Disable affected route, source class, workspace, or provider.
2. Preserve evidence and audit trail.
3. Identify affected signals, sources, entries, exports, and API responses.
4. Apply suppression, correction, or retraction.
5. Notify affected users or customers when appropriate.
6. Add a regression case to evaluation.
7. Update source, route, or review policy.

## Operational Readiness Checklist

Firehose is not production-ready until:

- Source policy exists for each enabled source class.
- Connector cost limits are enforced.
- Raw artifacts and normalized content are auditable.
- Signals preserve passage-level evidence.
- Person-centered signals have review paths.
- Public/private route scopes are enforced.
- Suppression and correction paths work.
- Export/API/MCP responses preserve provenance.
- Operators have kill switches.
- Review queues have owners and age alerts.
- Evaluation sets cover public-role people and unsafe private-life examples.

## Experience Outcome

Governance and operations are successful when a user can trust Firehose because
Atlas is both useful and bounded: detailed enough to reveal the public civic
field, careful enough not to turn public information into context-free exposure,
and auditable enough to correct mistakes when the system gets something wrong.
