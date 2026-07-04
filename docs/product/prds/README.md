# Atlas Experience-First PRD Suite

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

## Purpose

This suite turns Atlas's product direction into implementation-ready product
requirements. It is organized around user journeys, not internal systems or
sales packages, because Atlas's moat is the experience of finding people,
trusting what is shown, understanding civic context, and acting on it.

The governing rule is simple:

> No feature ships unless it makes Atlas easier to use, easier to trust, or
> easier to act on.

Revenue, workspace, API, and research operations features are valid only when
they fund, improve, or protect the public civic discovery experience. The
Rebuilding America show is a flagship use case and distribution path for Atlas,
not the exclusive home of the product.

## Product Contract

Atlas must satisfy the "random American" test. A first-time public user should
be able to search by place, issue, person, organization, initiative, or civic
concern; understand what was found; inspect sources; and leave with a clearer
sense of who is doing work in their community.

Every PRD in this suite answers four questions:

1. What can the user now see, trust, understand, or do?
2. What is the smallest product surface that delivers that outcome?
3. What data, API, or workflow support is necessary to make it real?
4. What safety guardrails prevent Atlas from becoming a surveillance, targeting,
   or generic enterprise software product?

## PRDs

| PRD | Primary outcome |
| --- | --- |
| [Experience Architecture](./00-experience-architecture-prd.md) | Public-first information architecture and UI guardrails. |
| [Public Civic Discovery](./01-public-civic-discovery-prd.md) | Search and browse that normal people can use. |
| [Profile And Evidence](./02-profile-and-evidence-prd.md) | Source-linked profiles that feel trustworthy. |
| [Profile Claiming And Stewardship](./03-profile-claiming-and-stewardship-prd.md) | People and organizations can claim and improve profiles. |
| [Find My People / Alignment](./04-find-my-people-alignment-prd.md) | Users find aligned civic actors by public work, not profiling. |
| [Place, Issue, And Map Explorer](./05-place-issue-map-explorer-prd.md) | Place and issue exploration that works as map and list. |
| [Rebuilding America Show Companion](./06-rebuilding-america-show-companion-prd.md) | Episode experiences built on reusable Atlas primitives. |
| [ATProto Federated Web](./07-atproto-federated-web-prd.md) | Federated identity, profile claims, provenance, and contribution paths. |
| [Public Directories / Atlas For X](./08-public-directories-atlas-for-x-prd.md) | Partner directories without weakening Atlas trust standards. |
| [Research Runs To Briefing Room](./09-research-runs-briefing-room-prd.md) | Research outputs become useful, source-linked artifacts. |
| [Follow, Watch, And Personal Civic Home](./10-follow-watch-personal-civic-home-prd.md) | Lightweight civic awareness without surveillance dynamics. |
| [Workspace For Teams](./11-workspace-for-teams-prd.md) | Quiet team utility that does not overtake public discovery. |
| [Governance, Corrections, And Safety](./12-governance-corrections-safety-prd.md) | Correction, dispute, moderation, and misuse boundaries. |
| [Developer, API, MCP, And Open Data](./13-developer-api-mcp-open-data-prd.md) | Reuse outside the app while preserving provenance and safety. |

## Shared Product Language

- **Actor:** A person, organization, initiative, campaign, event, or other civic
  entity represented in Atlas.
- **Claim:** A factual statement about an actor, place, issue, source, or
  relationship.
- **Evidence:** A public source or reviewed record supporting a claim.
- **Trust summary:** A compact user-facing explanation of evidence count,
  confidence, freshness, review state, and known gaps.
- **Steward:** A verified person or organization representative who can manage
  subject-provided profile fields.
- **Alignment lens:** A search or recommendation lens based on shared public
  work, issue area, place, organization type, or source-backed relationship.
- **Workspace:** A private layer for saved lists, briefs, notes, coverage
  targets, and team workflows.

## Shared Requirements

- Public discovery must remain available without enterprise workspace context.
- Source metadata must travel with profiles, search results, exports, APIs, and
  federated contribution records.
- Weak, stale, disputed, suppressed, or unreviewed claims must be visually
  distinct from corroborated claims.
- User-facing copy must avoid pipeline explanations, operational jargon, and
  self-conscious product narration.
- Empty states state the plain fact and offer a useful next path.
- Loading states are quiet.
- Error states name what failed in user language.
- Alignment and monitoring features must never infer private ideology,
  personality, vulnerability, or susceptibility.
- Rebuilding America surfaces must link back to reusable Atlas profiles, places,
  issues, sources, and directories.
- Workspace and business features must not add clutter to public routes.

## Success Metrics

- A first-time user can complete a place-plus-issue search and open a trusted
  profile without help.
- Public search result clicks lead to source inspection, profile exploration,
  follow, claim, correction, or share actions.
- Profile pages show fewer unsupported or stale claims over time.
- Claimed profiles increase the accuracy and humanity of subject representation.
- Rebuilding America viewers continue into Atlas exploration after episode
  surfaces.
- Workspace customers produce more source-linked outputs without changing the
  public product into a B2B dashboard.

## Related Docs

- [Experience First](../../experience-first.md)
- [Atlas Roadmap](../../roadmap.md)
- [The Atlas Product](../../the-atlas-product.md)
- [Business Plan Toolkit](../../plans/atlas-business/README.md)
