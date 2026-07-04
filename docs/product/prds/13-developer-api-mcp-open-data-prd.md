# Developer, API, MCP, And Open Data PRD

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

## User Outcome

Developers, researchers, civic technologists, and partner organizations can
reuse Atlas data and capabilities outside the first-party app while preserving
source metadata, confidence, freshness, corrections, and safety constraints.

## Product Position

Atlas is both a product and a platform. External access must reinforce the core
public experience rather than strip Atlas records into untraceable rows. APIs,
MCP, exports, and open data should make civic discovery more useful while
keeping provenance attached.

## Users

- Civic technologist building an app or directory.
- Partner organization embedding Atlas data.
- Researcher analyzing public civic ecosystems.
- MCP client user searching Atlas through an assistant.
- Workspace customer integrating source-linked leads.
- Atlas maintainer preserving contract quality.

## Core Requirements

1. Public API
   - Public profiles, places, issues, sources, directories, and search results
     are available through documented endpoints.
   - Responses include trust summary and source metadata.
   - Pagination, rate limits, and errors follow Atlas API standards.

2. Provenance-preserving export
   - Exports include profile ids, claim ids, source ids, source URLs, source
     titles, publisher, dates, confidence, freshness, and review state.
   - Exports must not include private notes unless explicitly requested by an
     authorized workspace user.

3. MCP access
   - MCP tools expose safe search, lookup, source inspection, and place or issue
     context.
   - Tool responses carry source metadata and confidence.
   - MCP does not expose private workspace data without authorization.

4. Directory API
   - Partner directories can expose scoped public records.
   - Directory API responses include methodology, sponsor disclosure, commons
     state, and correction path.

5. Open data releases
   - Public-good datasets can be released with license, methodology, source
     metadata, confidence states, and correction contact.
   - Sensitive records, private notes, restricted-use data, and unsupported
     claims are excluded.

6. Developer documentation
   - Docs explain authentication, public endpoints, schemas, trust fields,
     correction flows, rate limits, MCP tools, and acceptable use.
   - Examples show how to display evidence and confidence, not only names.

## Data And Interfaces

Public profile API fields:

- Profile id and slug.
- Actor type.
- Display name.
- Summary.
- Places.
- Issues.
- Trust summary.
- Claims.
- Evidence.
- Relationships.
- Correction URL.
- Claim URL when eligible.

Search API fields:

- Query interpretation.
- Result list.
- Match reasons.
- Trust summary.
- Pagination.
- Filter facets.

MCP tool categories:

- Search civic actors.
- Get profile.
- Inspect evidence.
- Search place context.
- Search issue context.
- Get directory records.

Export metadata:

- Export id.
- Scope.
- Generated timestamp.
- License.
- Included private fields flag.
- Evidence and source coverage summary.

## UX And DX Requirements

- Public docs must explain why provenance matters.
- API examples should include source rendering.
- Error messages should be actionable and plain.
- Generated client changes must stay in sync with OpenAPI.
- Breaking changes require changelog and migration notes.
- Developer surfaces must not encourage stripped-provenance reuse.

## Safety And Acceptable Use

- API and MCP access can be limited or revoked for restricted use.
- Bulk exports must preserve provenance and license terms.
- Private workspace notes are never included in public APIs.
- Sensitive profiles may be excluded from public exports.
- Integrations must not market Atlas data as targeting, surveillance, or
  opposition-research datasets.

## Metrics

- Public API usage.
- MCP tool usage.
- Evidence field inclusion in downstream integrations.
- Directory API usage.
- Export downloads.
- Rate-limit and abuse events.
- Developer documentation completion paths.

## Acceptance Criteria

- Public API responses include trust and source metadata.
- MCP tools return evidence and confidence with civic actor results.
- Directory APIs expose methodology and correction paths.
- Exports preserve provenance and omit private notes by default.
- Developer docs show how to render sources and confidence.
- Generated OpenAPI and front-end clients stay synchronized when schemas change.
