# Firehose Collection Pipeline

Status: Draft Date: 2026-07-05 Owner: Rebuilding America Project

## Purpose

This document defines how Firehose collects public civic artifacts before
analysis. Collection is responsible for finding source material, retrieving it
reliably, recording provenance, deduplicating artifacts, and handing normalized
content to the analysis pipeline.

Collection does not decide what is true. It decides what public material Atlas
has captured and why the material belongs in a civic field.

## Collection Principles

- Collect from the public realm.
- Prefer source-rich, high-civic-value targets over broad scraping.
- Preserve original source context.
- Treat every artifact as evidence, not as a fact by itself.
- Record enough metadata to reproduce, audit, and explain collection.
- Fail visibly when a source class is blocked, rate-limited, stale, or too
  expensive.
- Respect scope: coverage targets drive collection.

## Source Classes

### Government Public Process

Examples:

- City council agendas.
- County commission minutes.
- School board agendas.
- Planning commission packets.
- Public comment portals.
- Hearing schedules.
- Ordinances, resolutions, and votes.
- Agency rulemaking notices.

Expected value: strong public-role context, dates, jurisdictions, public
decisions, meeting participation, public comments, and named civic actors.

### Legislative And Regulatory

Examples:

- State bill updates.
- Committee hearings.
- Sponsor and testimony records.
- Federal Register notices.
- Regulations.gov dockets.
- Ballot measure records.

Expected value: policy movement, public institutions, public testimony,
organizational positions, and issue momentum.

### Public Events And Mobilization

Examples:

- Mobilize-style public event feeds.
- Public town halls.
- Public trainings.
- Public forums.
- Public rallies.
- Candidate forums.
- Community meetings listed by organizations.

Expected value: issue activity, organizers, public speakers, event sponsors,
coalitions, and upcoming civic moments.

### News And Editorial Sources

Examples:

- Local news RSS.
- Nonprofit newsroom articles.
- Public radio stories.
- Investigative series.
- Opinion and editorial pages when clearly labeled.
- Public newsletters with archive pages.

Expected value: public mentions, issue framing, actor relationships, source
attention, and public context.

### Organizations And Coalitions

Examples:

- Nonprofit pages.
- Coalition rosters.
- Campaign pages.
- Staff and board pages.
- Press releases.
- Public blog posts.
- Partner pages.
- Public program pages.

Expected value: roles, affiliations, public statements, coalition membership,
program activity, and contact surfaces intentionally published by the
organization.

### Grants, Filings, And Registries

Examples:

- IRS EO data.
- Form 990 data.
- State charity registries.
- FEC filings.
- USAspending and public grant records.
- Foundation grant databases when accessible.
- Public corporate and nonprofit registries.

Expected value: identifiers, organizational existence, officers, funder/grantee
relationships, money movement, public roles, and legitimacy signals.

### Public Social Or Platform Sources

Examples:

- Public organization accounts.
- Public posts embedded on organization pages.
- Public event pages.
- Public announcements by public-role actors.

Expected value: recency and public announcements.

Controls: Social/platform sources should usually corroborate or route to review.
They should not become the only basis for sensitive personal claims.

## Coverage Target Expansion

Coverage targets are the planner input. A target should define:

- Target id.
- Target kind.
- Place scope.
- Issue scope.
- Actor scope.
- Source classes.
- Freshness interval.
- Backfill window.
- Budget.
- Safety policy.
- Customer or public-interest owner.
- Allowed routes.

The planner expands the target into source targets.

Example:

```text
Coverage target:
  kind: place_issue
  place: Detroit, MI
  issue: housing_affordability
  source classes:
    - city_agendas
    - county_records
    - local_news
    - nonprofit_pages
    - public_events
  freshness: weekly

Source targets:
  - detroit city council agenda index
  - detroit planning commission packets
  - wayne county meeting archive
  - local housing-news RSS queries
  - known tenant-org campaign pages
  - public mobilization searches for Detroit housing terms
```

## Scout-Seeded Source Targets

Scout-discovered sources enter Firehose as candidates, not as automatically hot
monitors. A synced Scout run, source import, direct-URL run, or trusted worker
job can suggest a public source target when the artifact has enough provenance
to explain why Atlas should watch it.

Firehose should retain:

- Origin: manual, Scout sync, API, or system.
- Remote Scout/Atlas run id when available.
- Scout worker id when available.
- Artifact hash.
- Reviewer or operator note.
- Approval state for monitoring cadence.

This lets operators answer why Atlas is watching a source and keeps local
`scout-dev` ingest useful without allowing Scout to bypass source governance or
person-centered review.

## Connector Contract

Each connector should implement the same conceptual contract even if the first
implementation is plain Python functions.

Input:

- Source target.
- Cursor or since timestamp.
- Budget envelope.
- Rate-limit policy.
- Authentication policy when a public API key is required.

Output:

- Raw artifact records.
- Retrieval logs.
- Provider errors.
- Next cursor.
- Cost events.

Connector result states:

- `fetched`: artifact retrieved.
- `unchanged`: fingerprint matches prior artifact.
- `not_found`: target no longer exists.
- `blocked`: robots, terms, paywall, or provider restriction blocks retrieval.
- `rate_limited`: provider throttled the request.
- `failed`: transient or unknown failure.
- `disabled`: source target manually disabled.

## Raw Artifact Contract

Every collected artifact should carry:

- Artifact id.
- Source target id.
- Connector name and version.
- Source URL.
- Canonical URL.
- Provider record id when available.
- Source type.
- Publisher or owner.
- Jurisdiction when available.
- Published or event date when available.
- Retrieved timestamp.
- Content hash.
- Raw content pointer.
- Normalized text pointer.
- Original media type.
- Language.
- License or terms note when available.
- Collection status.
- Error status when applicable.

Artifacts should be immutable by hash. If source content changes, Firehose
stores a new artifact version and links it to the same canonical source target.

## Normalization

Normalization converts raw artifacts into content analysis can consume:

- HTML to readable text with links preserved.
- PDF to text with page numbers.
- Agenda packets to item-level records when possible.
- RSS/API items to structured text.
- Calendar records to event records.
- Filing rows to structured fields.
- Transcripts to timestamped text.

Normalization must preserve:

- Source URL.
- Passage offsets or page references.
- Table row identifiers where relevant.
- Link targets.
- Original dates.
- Extraction warnings.

## Deduplication And Fingerprinting

Firehose should deduplicate at several levels:

- Canonical URL.
- Provider record id.
- Content hash.
- Title plus date plus publisher.
- Structured source id, such as bill id, docket id, meeting id, grant id, or
  filing accession.

Deduplication should prevent repeated provider fetches from creating new signals
unless the content changed or a new extraction version finds a new candidate.

## Scheduling

Schedules should be target-aware:

- Upcoming public meetings: frequent until event date, then one post-event
  follow-up.
- News feeds: daily or weekly depending on target priority.
- Organization pages: weekly, monthly, or change-detected.
- Filings and registries: monthly or source-specific cadence.
- Coverage-underwriting targets: customer contract cadence.
- Public-interest targets: roadmap or editorial cadence.

The scheduler should pause or degrade targets when:

- Cost budget is exceeded.
- Provider error rate is too high.
- Source class is blocked.
- Safety policy requires review before continued collection.

## Cost And Rate Limits

Collection must write cost events for:

- Search provider calls.
- API calls with paid quotas.
- Browser rendering.
- LLM-assisted extraction during normalization.
- Storage-heavy snapshots.

Budget checks should happen before source target execution and after connector
completion. A target that exceeds budget should be marked `blocked_by_budget`
and visible in coverage status.

## Failure Handling

Collection failures should be visible to operators and coverage users:

- `blocked_source`: source cannot be legally or technically collected.
- `stale_source`: source has not updated within expected freshness window.
- `provider_error`: provider returned repeated failures.
- `normalization_error`: artifact fetched but not parseable.
- `budget_exceeded`: cost guard stopped collection.

Failures can become coverage gaps. A user should understand that Atlas failed to
collect a source class, not that civic activity does not exist.

## Handoff To Analysis

Collection emits normalized artifacts into the analysis queue only when:

- The artifact is new or changed.
- The artifact belongs to an active coverage target.
- The artifact has source metadata.
- The artifact is public and allowed by source policy.
- The artifact is parseable or reviewable.

The analysis queue receives:

- Artifact id.
- Coverage target ids.
- Source target id.
- Normalized content pointer.
- Source metadata.
- Collection warnings.
- Suggested source class.
- Budget metadata.

## Experience Outcome

A user benefits from collection when Atlas can say:

- This source was checked.
- This source changed.
- This source was blocked or stale.
- This public signal came from this exact source.
- This coverage target is fresh, thin, or blocked for a clear reason.
