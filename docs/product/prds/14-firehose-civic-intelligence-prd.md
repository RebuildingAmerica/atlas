# Firehose Civic Intelligence PRD

Status: Draft Date: 2026-07-05 Owner: Rebuilding America Project

## User Outcome

A public user, researcher, journalist, organizer, funder, or civic team can see
meaningful public civic activity as it changes, understand who and what it is
connected to, inspect the source, and act with better context.

Firehose should make Atlas feel alive without turning it into an ungoverned
surveillance product. It should be detailed, source-backed, and close to the
public/private boundary, while staying anchored in the public realm and civic
relevance.

## Product Position

Firehose is Atlas's civic signal and change-intelligence product domain. It
collects public civic activity, analyzes it into source-backed signals, links
those signals to Atlas people, organizations, places, issues, events, claims,
and relationships, then routes them into public discovery, trust review,
watchlists, briefs, coverage workspaces, digests, APIs, and MCP tools.

Firehose is not a generic event feed. The atomic unit is a civic signal: a
source-backed observation that something in the public civic field happened,
changed, appeared, disappeared, gained evidence, lost freshness, or became worth
human review.

The product promise is:

> What changed in this civic field, who is connected to it, what source proves
> it, and what should someone inspect next?

## Users

- Public user following a local place, issue, organization, person, or civic
  concern.
- Journalist, creator, or producer watching a beat.
- Organizer or coalition staff tracking a field before acting.
- Foundation or nonprofit researcher monitoring a geography or issue.
- Civic actor watching their own profile, organization, field, or public role.
- Workspace customer receiving field intelligence, briefs, exports, and
  monitoring.
- Atlas reviewer handling safety, source quality, identity, and claim review.
- Developer or partner consuming source-linked signals through API or MCP.

## Core Requirements

1. Public civic signal capture
   - Capture public signals from meetings, hearings, agendas, votes, rulemaking,
     comment windows, public events, mobilizations, coalition announcements,
     grant awards, filings, local news, nonprofit updates, public campaign
     pages, and public-role activity by public people.
   - Treat each captured item as a lead until it has been analyzed, sourced,
     scored, and routed.
   - Preserve original source URL, publisher, source type, retrieval time,
     content hash, relevant passage, and extraction context.

2. Public realm boundary
   - Include people when their public action, public role, public comment,
     public filing, public news mention, public event participation, public
     organizational role, or public civic activity is source-backed and relevant
     to civic understanding.
   - Capture detailed public facts when they matter: names, roles, affiliations,
     dates, jurisdictions, organizations, public statements, relationships,
     event context, and source passages.
   - Exclude hidden data, private-life inference, private contact discovery,
     private-person targeting, and details that create risk without civic value.

3. Signal analysis
   - Classify signal type, civic issue, geography, actor type, source class,
     public-role context, sensitivity, freshness, and confidence.
   - Resolve the signal to existing Atlas entries when possible.
   - Propose new entries, claims, relationships, sources, and review items when
     resolution is incomplete.
   - Distinguish what the source directly says from what Atlas infers.

4. Trust and safety routing
   - Route high-confidence, low-risk organization/place/issue signals into the
     public graph or review queue according to trust policy.
   - Route public-person signals through stricter checks when they involve
     sensitive contexts, vulnerable people, thin sourcing, allegations, or
     ambiguous identity.
   - Preserve provenance and confidence in every downstream surface.
   - Deny or quarantine signals that imply private behavior, harassment,
     doxxing, intimidation, law-enforcement surveillance, stripped-provenance
     resale, or custom targeting.

5. User-facing surfaces
   - Public profiles can show meaningful source-backed timelines and freshness
     updates.
   - Place and issue pages can show recent civic activity, emerging actors, new
     sources, and coverage gaps.
   - Personal follows can show calm change summaries.
   - Workspace watches can produce field digests, team-chat-ready summaries,
     coverage reports, and brief leads.
   - Briefing Room can turn selected signals into source-linked research
     artifacts.
   - API and MCP responses can expose signals with source, trust, and scope
     metadata attached.

6. Coverage and recurrence
   - Coverage targets define what Firehose should watch by geography, issue,
     actor type, source class, customer scope, or public-interest priority.
   - Firehose should know which targets are fresh, stale, thin, saturated, or
     blocked by source/provider failure.
   - Recurring monitoring should create fewer, better summaries instead of a
     noisy event wall.

7. Review and correction
   - Atlas reviewers can inspect raw source, extracted passage, proposed signal,
     resolved actors, claims, relationships, scores, and route history.
   - Profile subjects and stewards can report, dispute, correct, or add context
     to Firehose-derived claims.
   - Suppression and correction decisions preserve audit history and avoid
     asking public users to trust hidden evidence.

## Data And Interfaces

Firehose source target:

- Target id.
- Target kind: place, issue, organization, person, event, source, directory,
  coverage target, workspace watch, or public-interest seed.
- Scope definition.
- Source classes enabled.
- Freshness interval.
- Budget policy.
- Safety policy.

Raw artifact:

- Artifact id.
- Source target id.
- Source URL or provider id.
- Source type.
- Retrieval timestamp.
- Content hash.
- Canonical URL.
- Raw or normalized content pointer.
- Snapshot policy.
- Provider metadata.

Civic signal:

- Signal id.
- Signal type.
- Summary.
- Public realm basis.
- Source ids.
- Relevant passages.
- Linked entry ids.
- Proposed entry ids.
- Linked claim ids.
- Proposed claim ids.
- Linked relationship ids.
- Issue tags.
- Place ids.
- Confidence score.
- Relevance score.
- Sensitivity score.
- Review state.
- Visibility state.
- Created and updated timestamps.

Signal route:

- Signal id.
- Destination: public graph, profile timeline, place page, issue page, personal
  follow, workspace watch, brief lead, coverage gap, API/MCP, or review queue.
- Destination id.
- Route reason.
- Route state.
- Routed timestamp.

Digest item:

- Digest id.
- Signal ids.
- User or workspace id.
- Watch or follow id.
- Time window.
- Summary.
- Trust summary.
- Delivery state.

## UX Requirements

- Use plain civic language: "new public source," "public meeting," "new
  coalition link," "coverage gap," "fresh activity," and "source updated."
- Avoid dense intelligence-dashboard framing on public routes.
- Do not show a raw firehose to normal users by default.
- Every visible signal links to the public source or source packet.
- Timelines and digests should say what changed and why it matters.
- Thin, uncertain, disputed, or sensitive signals should be visibly different
  from high-confidence signals.
- Users can tune follows and watches without managing complex alert logic.
- Workspace surfaces can be more operational, but they must preserve trust
  context and safety boundaries.

## Safety And Governance

Firehose must support serious civic intelligence without becoming a private
tracking system.

Allowed by default:

- Public meetings, hearings, agendas, votes, comment windows, public filings,
  public events, public campaigns, public organizational roles, public news,
  public grant awards, public coalition activity, and public-role activity by
  public people.
- Monitoring places, issues, organizations, initiatives, campaigns, public
  events, coverage targets, and public people acting in public roles.
- Capturing detailed public facts when they are source-backed, relevant, and
  necessary for civic understanding.

Restricted or review-gated:

- Person-centered monitoring outside clear public-role context.
- Signals involving vulnerable people, minors, allegations, harassment risk,
  sensitive communities, or thin identity resolution.
- High-volume exports of named people.
- Customer requests that use Firehose for targeting rather than civic
  understanding.

Disallowed:

- Private-life inference.
- Hidden or non-public data collection.
- Doxxing, intimidation, harassment, or exposure workflows.
- Law-enforcement surveillance.
- Stripped-provenance resale.
- Custom electoral targeting.
- Unsupported claims about named people.

## Metrics

- Source coverage by target and source class.
- Signal capture volume by source class.
- Signal-to-source inspection rate.
- Signal-to-profile, signal-to-brief, and signal-to-watch conversion.
- Precision of routed signals on reviewer sample.
- Duplicate signal and duplicate entity rate.
- Average source freshness by coverage target.
- Digest open and mute rate.
- Harm reports and suppression decisions per visible signal.
- Firehose-sourced public graph improvements.
- Workspace renewal artifacts that reference Firehose signals.

## Acceptance Criteria

- A coverage target can define public source classes to monitor.
- Firehose can capture source-backed public civic signals.
- Firehose can classify, score, and route a signal with source context intact.
- Firehose can link signals to existing Atlas entries, places, issues, and
  relationships when confidence allows.
- Firehose can hold ambiguous, sensitive, or person-centered signals for review.
- Public and workspace users can see meaningful change summaries without raw
  feed noise.
- Every displayed signal links to source, evidence, confidence, and review
  state.
- API and MCP consumers receive provenance and scope with every signal.
- Restricted use cases are denied or routed to review.

## Related Docs

- [The Atlas Product](../../the-atlas-product.md)
- [Experience First](../../experience-first.md)
- [Firehose Architecture Overview](../../design/firehose/README.md)
- [Collection Pipeline](../../design/firehose/collection-pipeline.md)
- [Analysis And Resolution Pipeline](../../design/firehose/analysis-and-resolution-pipeline.md)
- [Storage And Serving Model](../../design/firehose/storage-and-serving-model.md)
- [Governance And Operations](../../design/firehose/governance-and-operations.md)
