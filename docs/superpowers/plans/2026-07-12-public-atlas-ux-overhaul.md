# Public Atlas UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a coherent, trustworthy, highly discoverable public Atlas
experience that lets anyone move from a civic question to people, organizations,
places, issues, events, evidence, and a useful next action.

**Architecture:** Keep the backend focused on canonical civic objects and a
small reusable public read surface. Route loaders compose those reads, pure
read-model assemblers translate them into page-specific view models, and
presentation components render only view-model props and callbacks. A singular
design foundation powers the public shell, Home, Explore, entity indexes and
details, Places, Issues, place-issue landscapes, Updates, evidence, claims, and
corrections. URL state, server rendering, source provenance, and explicit
partial-failure states remain first-class; professional workspace and operator
interfaces are outside this pass.

**Tech Stack:** React 19, TanStack Start and Router, TanStack Query, Tailwind
CSS 4, MapLibre GL, Headless UI, Lucide, FastAPI-generated Orval client, Vitest,
Testing Library, Playwright, axe-core, Lighthouse CI

**Primary references:**

- `AGENTS.md`
- `docs/experience-first.md`
- `docs/product/ui-ux-architecture.md`
- `docs/product/prds/00-experience-architecture-prd.md`
- `docs/product/prds/01-public-civic-discovery-prd.md`
- `docs/product/prds/02-profile-and-evidence-prd.md`
- `docs/product/prds/03-profile-claiming-and-stewardship-prd.md`
- `docs/product/prds/07-atproto-federated-web-prd.md`
- `docs/product/prds/12-governance-corrections-safety-prd.md`

---

## Handoff Contract

This plan is the source of truth for the public pass. The implementing agent
should not reopen settled product questions unless repository truth makes a
requirement impossible.

1. Public Atlas is the bounded product. Do not redesign the professional Index,
   customer Newsroom, Projects, general workspace, billing administration, or
   staff tools. The claimed-profile management screen is in scope only as the
   authenticated continuation of public stewardship.
2. Groundwork is an internal future-company codename. Do not add Groundwork
   branding, navigation, ownership language, legal copy, or product-suite
   chrome. Rebuilding America Project remains the public operator.
3. Maximum reach and discovery are hard constraints. A civic actor does not need
   professional credentials, an institution, a large audience, or repeated
   activity to qualify for discovery.
4. Age, employment, fame, and institutional status are not eligibility filters.
   A young person participating publicly may be discoverable on the same
   evidentiary basis, while home address, private contact, school/location
   detail, and unsafe direct-contact actions remain restricted by the
   public-record safety policy.
5. Roles such as creator, journalist, organizer, student, official, researcher,
   or service provider are searchable facets and sourced relationships. Do not
   create `/creators`, `/journalists`, or other role-directory SEO pages.
6. Dedicated pages for entity families are first-class. People, organizations,
   initiatives, campaigns, and events each need an indexable index and an
   entity-appropriate detail experience.
7. Atlas documents lawful public civic participation across viewpoints. Issue
   names describe contested fields rather than prescribing a preferred diagnosis
   or solution. Never infer ideology, religion, protected characteristics, or
   private affiliations.
8. Trust is the core experience. Sourced facts, Atlas synthesis,
   subject-provided content, and material with an open correction must remain
   visibly distinct.
9. The subject owns their voice; Atlas owns the documented record.
   Subject-authored content adds to source-backed content and never silently
   replaces or erases it.
10. No public surface may use lead-scoring or pipeline vocabulary such as
    `Partner-ready`, `Strong partner lead`, `Qualify before outreach`,
    `Actor specificity`, `Thin record`, or `profile shape`.
11. Preserve strong existing behavior where it serves users, especially map/list
    parity, MapLibre lazy isolation, map focus restoration, SSR profiles,
    provenance, claims, corrections, buffered live updates, and route state.
12. Delete dead parallel implementations after reference verification. Do not
    redesign both an active component family and an unused legacy family.
13. Presentation code must not import generated API clients, transport adapters,
    query hooks, database-shaped schemas, or raw error objects.
14. Do not add page-shaped backend endpoints such as `home`, `issue-page`, or
    `landscape-page`. Compose pages from the canonical entity, place, issue,
    relationship, source, map-point, and update reads described below.

## Definition Of World-Class

The pass is complete only when all of these are true:

- A first-time visitor understands that Atlas maps American civic life without
  reading a feature explanation.
- A visitor can search `homelessness in Las Vegas`, reach a place-issue
  landscape, inspect its documented timeline, open a person or group, and
  inspect evidence in ten minutes or less.
- A visitor can search for transit YouTubers or similar creators without needing
  a role-specific landing page.
- Search by name, place, issue, actor type, and source medium produces
  structurally correct results and never silently turns an error into an empty
  directory.
- Every public object offers evidence and meaningful onward paths. No profile,
  place, issue, event, or update is a dead end.
- Every claim shown as fact has inspectable provenance; uncertain, stale,
  single-source, open-correction, and subject-provided states are calm and
  explicit.
- Anonymous, signed-in, claimed-profile, and local-deployment states remain
  understandable without exposing workspace machinery.
- Every archetype passes WCAG 2.2 AA automated checks, keyboard journeys, 200
  percent zoom, 320 CSS pixel reflow, and visible focus checks. Target 44px
  controls even where WCAG permits smaller targets. See
  [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
- Deterministic lab runs meet the LCP and CLS budgets in this plan, production
  RUM is instrumented at launch, and the post-launch 75th-percentile target is
  LCP at or below 2.5s, INP at or below 200ms, and CLS at or below 0.1. See
  [Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds).
- The production build stays inside explicit route and total-asset budgets.
- Playwright visual comparisons cover every archetype across the deliberate
  viewport/theme matrix below, with targeted reduced-motion and extreme-width
  checks. See
  [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots).
- No tested route has horizontal document overflow, overlapping UI, clipped
  text, blank primary media, nested interactive elements, raw exceptions,
  console errors, hydration warnings, or unexpected failed first-party requests.

## Target Product Architecture

### Dependency Rule

```text
FastAPI canonical records
  -> generated transport client
  -> public catalog gateway
  -> query options and application services
       -> TanStack route loader/head
       -> React page controller
            -> pure view-model assembler
            -> presentational page and components
```

Dependencies move only from left to right. Presentation never reaches back into
transport or persistence, and the API never contains display composition that
belongs to a particular page.

| Layer               | Owns                                                                                                                                      | May import                                               | Must not own                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Canonical API data  | Entities, places, issue areas, relationships, sources, map points, updates, pagination, privacy rules                                     | Domain models and database access                        | Page layouts, card labels, responsive behavior, display ordering, presentation fallbacks |
| App gateway         | The smallest typed interface over generated public operations; transport-to-domain mapping; abort signals; canonical query keys           | Generated client and colocated adapters                  | JSX, route navigation, prose, view-specific grouping                                     |
| Application service | The exact logical reads for one page and pure ready-data assembly                                                                         | Gateway, canonical domain records, formatting helpers    | React, transport DTOs, route mutation, hidden inference                                  |
| Route container     | URL validation, SSR prefetch, redirects, head metadata, and primary error/404 selection                                                   | Query options, application service, route APIs           | Repeated visual markup, client interaction state                                         |
| Page controller     | Hydrated queries, session capabilities, URL actions, lazy sections, live subscriptions, typed-failure-to-section-state mapping, callbacks | Query options, application service, router/session hooks | Repeated visual markup, generated DTOs, raw error display                                |
| Presentation        | Layout, responsive composition, interactions, focus, copy, loading/empty/error rendering                                                  | View-model interfaces, primitives, Lucide icons          | Generated clients, API schemas, query hooks, raw transport errors                        |

Use these ownership folders as the target, adapting existing names only where a
wholesale move would add churn:

```text
app/src/domains/catalog/data/
  public-catalog-gateway.ts
  api-public-catalog-gateway.ts
  public-stewardship-gateway.ts
  api-public-stewardship-gateway.ts
  public-query-options.ts
  public-query-keys.ts

app/src/domains/catalog/model/
  civic-record.ts
  place.ts
  issue.ts
  activity.ts
  evidence.ts

app/src/domains/catalog/application/
  explore.ts
  home.ts
  entity-detail.ts
  place-detail.ts
  issue-detail.ts
  landscape.ts
  updates.ts

app/src/domains/catalog/controllers/
  explore-controller.tsx
  home-controller.tsx
  entity-controller.tsx
  place-controller.tsx
  issue-controller.tsx
  landscape-controller.tsx
  updates-controller.tsx

app/src/domains/catalog/pages/          # presentational page compositions
app/src/domains/catalog/components/     # reusable presentational parts
app/src/routes/_public/                 # route containers and loaders only
```

Types stay in the file that owns the behavior. Do not create a general
`types.ts` bucket.

### Minimal Public Data Surface

The redesign adds one new public read endpoint: searchable place summaries.
Existing read and stewardship operations receive the bounded projection, filter,
pagination, and write fields needed below. No page-shaped endpoint is added. Do
not expose operator, scoring, discovery-run, private annotation, or workspace
contracts to public page code.

| Capability     | Canonical operation                                      | Purpose                                                                      |
| -------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Entity search  | `GET /api/entities`                                      | Paginated summary records for Explore and family indexes                     |
| Map search     | `GET /api/entities/map`                                  | Lightweight viewport points; never full entity records                       |
| Entity detail  | `GET /api/entities/by-slug/{entity_type}/{slug}`         | One canonical public record                                                  |
| Evidence       | `GET /api/entities/{entity_id}/sources`                  | Paginated source evidence, fetched on demand beyond the summary              |
| Relationships  | `GET /api/entities/{entry_id}/connections`               | Typed public graph edges                                                     |
| Issue taxonomy | `GET /api/issue-areas` and `GET /api/issue-areas/{slug}` | Canonical neutral issue vocabulary and definitions                           |
| Place search   | **New:** `GET /api/places`                               | Bounded canonical place autocomplete and index summaries                     |
| Place context  | `GET /api/places/{place_key}/page-context`               | Canonical place identity, sourced public facts, hierarchy, and relationships |
| Updates        | `GET /api/firehose/public` and `/events`                 | Compact chronological public activity and live transport                     |

Do not delete overlapping public place operations during this pass unless
current consumers and generated contracts prove the removal is safe. Public UI
code uses `page-context` as its single place-detail read. Extend that existing
response with missing canonical values rather than calling both `profile` and
`page-context`; stop importing the overlapping operation into the new gateway.

The gateway exposes this logical surface, not every HTTP path:

```ts
interface PublicCatalogGateway {
  searchEntities(
    query: CatalogQuery,
    signal?: AbortSignal,
  ): Promise<CivicRecordSearchPage>;
  searchMapPoints(query: MapQuery, signal?: AbortSignal): Promise<MapPointPage>;
  getEntity(ref: EntityRef, signal?: AbortSignal): Promise<CivicRecordDetail>;
  getEntityEvidence(
    id: string,
    page: PageRequest,
    signal?: AbortSignal,
  ): Promise<EvidencePage>;
  getEntityConnections(
    id: string,
    page: PageRequest,
    signal?: AbortSignal,
  ): Promise<ConnectionPage>;
  listIssues(signal?: AbortSignal): Promise<IssueRecord[]>;
  getIssue(slug: string, signal?: AbortSignal): Promise<IssueRecord>;
  searchPlaces(
    query: PlaceQuery,
    signal?: AbortSignal,
  ): Promise<PlaceSearchPage>;
  getPlace(key: string, signal?: AbortSignal): Promise<PlaceRecord>;
  getActivity(
    query: ActivityQuery,
    signal?: AbortSignal,
  ): Promise<ActivityPage>;
}

interface PublicActivityStream {
  subscribe(query: ActivityQuery, handlers: ActivityHandlers): () => void;
}

interface PublicStewardshipGateway {
  startClaim(ref: EntityRef, request: ClaimRequest): Promise<ClaimStatus>;
  updateSubjectProfile(
    ref: EntityRef,
    patch: SubjectProfilePatch,
  ): Promise<SubjectProfile>;
  submitEntityCorrection(
    ref: EntityRef,
    request: CorrectionRequest,
  ): Promise<PublicReportReceipt>;
  submitSourceCorrection(
    sourceId: string,
    request: CorrectionRequest,
  ): Promise<PublicReportReceipt>;
}

interface CorrectionRequest {
  category:
    | "factual-error"
    | "harmful-defamatory"
    | "outdated"
    | "privacy-safety"
    | "source-concern"
    | "suggest-source"
    | "wrong-identity";
  challengedClaim?:
    "contact" | "identity" | "issues" | "place" | "relationship" | "summary";
  details: string;
  evidenceUrl?: string;
  idempotencyKey: string;
}
```

Live WebSocket, SSE, and polling mechanics belong to `PublicActivityStream`;
they never enter a page component or the general catalog gateway.
Claim/manage/correction controllers use `PublicStewardshipGateway`; presentation
receives capability flags and actions only. Claim and profile updates require an
authenticated verified identity and server-side ownership authorization.
Correction details are 20-4,000 characters; evidence URLs are optional HTTPS
URLs at most 2,048 characters. Anonymous correction/source-suggestion/harm
reports use existing anonymous-write rate limiting, structured validation, and
opaque public receipts; clients never set moderation status or verified DID
values. Reusing the same `Idempotency-Key` for 24 hours returns the original
receipt without creating another review item.

The complete public contract delta is:

| Operation                                  | Change                                                                                                                                                                                                                        | Why                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **New** `GET /api/places`                  | Search/list by query, kind, canonical issue, minimum source count, minimum independent publisher count, entity-presence flag, cursor, and limit; compact place projection                                                     | Autocomplete, Places index, issue active-place lists, and deterministic landscape sitemap enumeration              |
| `GET /api/entities`                        | Return compact `EntitySummaryResponse`; add repeatable canonical place, documented-activity, activity-medium, and platform filters/facets                                                                                     | One reusable collection for Explore, family indexes, Place, Issue, and Landscape                                   |
| `GET /api/entities/map`                    | Accept the same canonical place, activity, medium, platform, issue, entity-family, source-type, and source-pattern eligibility filters                                                                                        | List/map semantic parity without full records                                                                      |
| Entity detail                              | Add documented activities, additive subject contributions, evidence summaries/source IDs, and opaque correction status; stop embedding full source pages and remove actor-quality/raw-flag diagnostics from the public schema | Complete detail with bounded lazy evidence and no operator leakage                                                 |
| Entity/place source records                | Add public access state, lawful archive URL when known, and an opaque public correction status; do not expose raw flag aggregates                                                                                             | Honest evidence/correction states without moderation internals                                                     |
| Issue taxonomy                             | Add taxonomy version and updated timestamp to list/detail records                                                                                                                                                             | Methodology and cache invalidation without a page endpoint                                                         |
| `GET /api/places/{place_key}/page-context` | Return canonical hierarchy, raw sourced facts/units, public centroid, related-place relations, and provenance; remove presentation concepts from the new mapper                                                               | One place-detail read                                                                                              |
| `GET /api/firehose/public` and `/events`   | Add cursor/next cursor, optional `from`, `to`, and entity filters; normalize entity/place/issue/source references                                                                                                             | One activity source for Home, Updates, Place, Issue, and Landscape                                                 |
| Claim request                              | Require entity family or stable entity ID in addition to slug                                                                                                                                                                 | Collision-safe claiming without a new endpoint                                                                     |
| Profile manage patch                       | Require entity family or stable entity ID; add bounded subject contributions; remove direct `suppressed_source_ids` mutation                                                                                                  | Attributed subject voice without source deletion                                                                   |
| Entity/source flag create                  | Add structured category, challenged claim/source, evidence URL, opaque public status reference, and `Idempotency-Key` handling                                                                                                | Corrections, source suggestions, privacy/safety, and harmful-content reports through existing moderation resources |

New UI state no longer models city, state, and region as independent backend
filters; compatibility parsing translates old URLs into canonical place keys.
`GET /api/places` landscape-candidate filtering is generic coverage filtering,
not a page bundle: for each issue, the sitemap requests places meeting the exact
source/publisher/entity threshold and constructs typed canonical landscape URLs.

Entity collections must return a compact `EntitySummaryResponse`, not the
current detail-like shape. Summary payloads include identity, optional image,
canonical place references, issue IDs, documented activities, source forms,
source count/latest date, a public trust summary, entity family, and slug. They
exclude application URLs, contact details, claim evidence internals, profile
answers, actor-quality diagnostics, flags, full sources, and private/operator
fields. Entity detail retains only the extra public fields needed on the detail
route plus evidence summaries/source IDs; full source records come from the
bounded evidence operation after evidence intent.

Place responses return canonical values and provenance, not formatted fact
strings, active navigation state, application colors, or Tailwind-like
categories. View-model assemblers own URLs, formatting, selection, color, and
display order.

### View-Model Contract

Pure assemblers decide presentation labels, ready-data ordering, relationship
phrasing, and limitation language. They may not create facts absent from the
canonical records. Controllers map typed query outcomes into `SectionState`; an
assembler never receives a transport exception and never turns a failure into
empty data.

```ts
type SectionState<T> =
  | { status: "ready"; value: T }
  | { status: "empty"; message: string }
  | { status: "error"; message: string; retryKey: string };

interface PublicDataFailure {
  code:
    | "forbidden"
    | "not-found"
    | "offline"
    | "rate-limited"
    | "timeout"
    | "unavailable"
    | "unauthorized"
    | "unknown";
  retryable: boolean;
  status?: number;
}

interface RecordSummaryViewModel {
  canonicalUrl: string;
  entityFamily: "person" | "organization" | "initiative" | "campaign" | "event";
  id: string;
  issues: LinkViewModel[];
  latestSupportLabel?: string;
  limitation?: "correction-open" | "single-source" | "stale" | "unverified";
  matchReasons: string[];
  name: string;
  places: LinkViewModel[];
  sourceCount: number;
  summary?: string;
}
```

The public page models are `HomeViewModel`, `ExploreViewModel`,
`EntityPageViewModel`, `PlacePageViewModel`, `IssuePageViewModel`,
`LandscapePageViewModel`, and `UpdatesViewModel`. Each owns only the fields its
presentation needs. Never pass the full API response into JSX "just in case."

Presentation components accept a view model plus callbacks such as
`onOpenEvidence`, `onRetrySection`, or `onChangeFilters`. Controllers own those
callbacks and any hooks. Presentations do not call `useQuery`, inspect route
search parameters, subscribe to live transport, read session state, or format
raw API fields.

The gateway converts transport failures into `PublicDataFailure` and logs
internal detail server-side. Controllers map codes to approved plain public
copy; they never pass exception messages, stack traces, response bodies, or
internal operation names into a view model.

### Query And Payload Policy

- The validated URL is the canonical discovery state. Do not duplicate it into
  long-lived React state.
- Route loaders prefetch opening-viewport reads and dehydrate them. Hydration
  must cause zero duplicate initial requests.
- All independent reads start in parallel. No entity -> sources -> connections
  waterfall is permitted when IDs are already available.
- Search and autocomplete abort stale requests. Place autocomplete uses a 250ms
  debounce, requires two characters, returns at most 20 summaries, and never
  loads full place context.
- Lists and indexes fetch summary records. Full details load only on detail
  routes.
- Maps fetch map points only. Selecting a point loads one summary/detail panel;
  it never inflates every point into an entity.
- Evidence drawers initially use source summary fields already present, then
  fetch a bounded source page on open. Further sources paginate.
- Below-fold relationship, timeline, and update sections may defer, but their
  reserved geometry and error states must be explicit.
- Use stable canonical query keys so Home, Explore, indexes, and detail routes
  share cached reads.
- Cache taxonomy and place dictionary reads longer than changing records;
  updates remain live. Declare actual stale times in `public-query-options.ts`
  and test them instead of relying on TanStack defaults.
- A failed secondary read produces a failed section, not an empty statement and
  not a whole-page failure. A failed primary identity read produces the route
  error boundary.
- Log payload size and request count in browser verification. Budgets are
  specified in the final release gate.

Use these client stale times: issue taxonomy 24 hours; place search/context 1
hour; entity detail/evidence/connections 5 minutes; entity lists and map
projections 60 seconds; activity snapshot 15 seconds. Garbage-collection time is
at least four times stale time and at most seven days. Successful SSR data uses
the same query key/time policy on hydration. Idempotent reads retry once for
network/5xx failures and never retry 4xx; mutations never retry automatically.
Live reconnect uses jittered exponential delay capped at 30 seconds and resets
after a stable connection.

### Page Orchestration Budget

| Surface             | Opening reads                                                                                                  | Deferred reads                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Home                | Map projection, one entity summary query, one activity query, cached issue taxonomy                            | Selected map entity detail                                              |
| Explore list        | One entity summary query plus cached issue taxonomy                                                            | Place autocomplete after input; map projection after view intent        |
| Explore map         | One map projection plus cached issue taxonomy                                                                  | Selected entity detail; list query after view intent                    |
| Entity detail       | One entity detail plus cached issue taxonomy                                                                   | Evidence page and connections when their section enters intent/viewport |
| Entity-family index | One entity summary query with a fixed family filter plus cached issue taxonomy                                 | Next cursor page                                                        |
| Place               | One place record, one entity query by canonical place, one activity query by place, plus cached issue taxonomy | Additional entity/activity pages                                        |
| Issue               | One issue record, one entity query by issue, one activity query by issue                                       | Map projection only when visible; additional pages                      |
| Landscape           | Place record, issue record, one entity query with both filters, one activity query with both filters           | Additional timeline/evidence pages                                      |
| Updates             | One activity snapshot plus cached issue taxonomy                                                               | Live stream and additional cursor pages                                 |

Request-budget tests inject a fake gateway and assert this exact logical read
set. Browser tests assert zero duplicate first-party reads after hydration, no
map projection while list-only Explore remains idle, no evidence/connection
request before intent, and no N+1 requests per result row.

Payload budgets are measured on deterministic 20-item collections: entity
summaries average at most 6KB uncompressed per item, activity records average at
most 4KB, and map points average at most 350 bytes. The compact entity
collection must be at least 35 percent smaller than the baseline detail-like
collection. Any exception requires measured proof that a user-visible
opening-viewport field cannot be deferred.

### Ranking Contract

Structured place, issue, family, activity, medium, and source filters decide
eligibility and never add ideological or institutional weight. Within the
eligible set, ordering is deterministic and lexicographic:

1. Exact normalized public name or stored alias match.
2. Normalized name/alias prefix match.
3. Existing full-text relevance score for residual query text.
4. Latest qualifying source date, newest first; unknown dates last.
5. Independent qualifying publisher count, highest first.
6. Case-folded public name, then stable entity ID.

When there is no residual text, begin at step 4. Claimed status, organization
size, audience/follower count, payment status, institutional form, viewpoint,
political direction, and subject contribution count are never ranking inputs.
Home `recent` shelves use steps 4-6. Issue and Place pages use the same ordering
after their fixed eligibility filters. Match-reason copy names the highest
explicit criterion that actually matched and never converts source type into
documented activity.

Test exact, prefix, free-text, tied-date, tied-publisher, missing-date,
sparse-record, differing-viewpoint, and claimed/unclaimed pairs at the API and
application layers.

## Public Information Architecture

### Primary Navigation

Use this exact order:

```text
Explore | People | Organizations | Places | Issues | Updates
```

The Atlas brand returns Home. Global search is available from every public page.
Sign in or the user avatar is the final action. Pricing, About, Methodology,
Safety, Docs, API, legal pages, and discount access belong in secondary
navigation or the footer.

### Canonical Route Contract

| Route                                                 | Purpose                                                                        | Indexing                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `/`                                                   | Search and map-led public start surface                                        | Index                                                                 |
| `/explore`                                            | Unified list/map discovery with URL-backed filters                             | Index base route; query states canonicalize to base and use `noindex` |
| `/profiles/people`                                    | People index                                                                   | Index                                                                 |
| `/profiles/people/:slug`                              | Person detail                                                                  | Index records meeting the public-record threshold below               |
| `/profiles/organizations`                             | Organization and informal-group index                                          | Index                                                                 |
| `/profiles/organizations/:slug`                       | Organization detail                                                            | Index records meeting the public-record threshold below               |
| `/profiles/initiatives`                               | Initiative index                                                               | Index                                                                 |
| `/profiles/initiatives/:slug`                         | Initiative detail                                                              | Index records meeting the public-record threshold below               |
| `/profiles/campaigns`                                 | Campaign index                                                                 | Index                                                                 |
| `/profiles/campaigns/:slug`                           | Campaign detail                                                                | Index records meeting the public-record threshold below               |
| `/profiles/events`                                    | Event index                                                                    | Index                                                                 |
| `/profiles/events/:slug`                              | Event detail                                                                   | Index records meeting the public-record threshold below               |
| `/places`                                             | Place index and national geographic entry point                                | Index                                                                 |
| Typed place route such as `/places/cities/:placeSlug` | Canonical place detail                                                         | Index records meeting the place threshold below                       |
| `/issues`                                             | Neutral issue taxonomy index                                                   | Index                                                                 |
| `/issues/:issueSlug`                                  | National issue page                                                            | Index                                                                 |
| `/places/:placeKind/:placeSlug/issues/:issueSlug`     | Collision-safe place-issue landscape, such as Homelessness in Las Vegas        | Index records meeting the landscape threshold below                   |
| `/updates`                                            | Public chronological update stream                                             | Index                                                                 |
| `/claim/:entityFamily/:slug`                          | Collision-safe ATProto-backed profile claim                                    | `noindex`                                                             |
| `/feedback/:entityFamily/:slug`                       | Correction and harmful-exposure report                                         | `noindex`                                                             |
| `/manage/:entityFamily/:slug`                         | Authenticated claimed-profile stewardship                                      | `noindex`                                                             |
| `/directories/:orgId`                                 | Published partner directory                                                    | Index when public                                                     |
| `/about`                                              | Mission, operator, public purpose, and product boundaries                      | Index                                                                 |
| `/methodology`                                        | Sources, synthesis, taxonomy, corrections, and limitations                     | Index                                                                 |
| `/safety`                                             | Public-record safety, harmful-content response, privacy, and correction policy | Index                                                                 |
| `/pricing`, `/request-discount`                       | Product access                                                                 | Index                                                                 |
| `/privacy`, `/terms`, `/security`                     | Public policy and safety commitments                                           | Index                                                                 |

Indexing thresholds are deterministic:

- An entity detail is indexable when it is public, has a canonical name and
  entity family, and has at least one accessible public source supporting
  identity or documented work. Sparse but valid records remain indexable;
  unsupported generated shells do not.
- A typed place detail is indexable when it has a canonical public place
  identity plus either one source-backed public fact, one public entity, or one
  documented issue signal.
- Every canonical issue definition is indexable because the neutral taxonomy
  entry is durable editorial content. A data-empty issue page states the absence
  without fabricating national activity.
- A landscape is indexable when it has at least two accessible public sources
  from two publishers or custodians and at least one related public entity,
  initiative, campaign, or event. Below that threshold it still renders a useful
  place/issue orientation with `noindex,follow` and links to the broader place
  and issue.
- `/updates` is indexable. Filtered, live-cursor, density, and pagination states
  use `noindex,follow` and canonicalize to `/updates`; this pass defines no
  update-detail route.
- Pricing and public policy pages are indexable; claim, correction,
  discount-verification, auth, workspace, and private directory states are not.

For indexing, a qualifying source has a public source or archive URL,
identifiable publisher/custodian, and an explicit relationship to the indexed
record. Duplicate URLs, syndications of the same underlying report, subject
contributions, and Atlas synthesis do not add to the count. Independent
publisher count uses registrable domain; government/public-record sources use
the issuing custodian. Paywalled metadata may provide context but does not
satisfy the inspectable-source threshold without an accessible archive or public
record.

Each place has one canonical typed route determined by the canonical place kind.
The generic `/places/:placeSlug` resolver permanently redirects to that route
after resolving the place. Alternate typed paths return the same redirect rather
than duplicate HTML.

The URL segment mapping is fixed: `polity -> polities`, `borough -> boroughs`,
`city -> cities`, `county -> counties`, `metro -> metros`,
`neighborhood -> neighborhoods`, `district -> districts`,
`service_area -> service-areas`, and `state -> states`. Landscape routes use the
same plural segment as `:placeKind`. Territory-like records use the canonical
kind returned by the place model rather than a presentation guess.

The place API owns a slug that is unique within kind and stable for the
canonical place key. It includes state/parent disambiguation or a stable suffix
when names collide; presentation code never manufactures it from the display
name.

Compatibility routes are implementation details, not alternate experiences:

All permanent compatibility redirects use HTTP 308 so query strings and request
semantics are preserved.

- `/browse` permanently redirects to `/explore` and preserves supported search
  parameters.
- `/map` permanently redirects to `/explore?view=map` and preserves
  viewport/filter parameters.
- `/firehose` permanently redirects to `/updates` and preserves supported
  filters.
- `/profiles` redirects to `/explore?entry_types=person,organization`.
- Legacy `/claim/:slug`, `/feedback/:slug`, and `/manage/:slug` resolve across
  entity families and permanently redirect only when there is exactly one public
  match. Ambiguous or missing slugs render a disambiguation/not-found response
  and never select a family silently.
- Canonical tags, internal links, structured data, and the sitemap always use
  the canonical routes above.

`entityFamily` uses the same URL segments as profile routes: `people`,
`organizations`, `initiatives`, `campaigns`, and `events`. Routes translate that
segment to the canonical singular API enum before loading or writing.

### Public Experience Loop

```text
Arrive
  -> search or explore the national map
  -> see Atlas's interpretation of place, issue, entity type, and medium
  -> scan list or map results
  -> open an entity, place, issue, landscape, event, or update
  -> inspect source support without losing context
  -> move through documented relationships
  -> contact, follow, share, claim, or correct
```

### Required Transition Grammar

Every object page uses specific, sourced relationship verbs. Prefer
`works with`, `reported on`, `organized`, `participated in`, `funded`,
`governs`, `provides services`, `created`, `opposed`, or `responded to`. Use
`related` only when evidence supports no more precise relationship.

Every detail page must provide:

- A breadcrumb or contextual return path.
- Links to every displayed place and issue.
- At least one next-step section drawn from connected objects when data exists.
- Source inspection in place on desktop and in a full-height sheet on mobile.
- Correct, claim, share, and contact actions only when applicable.
- Error states that distinguish failed retrieval from documented absence.

## Visual And Interaction Standard

### Motif: Civic Field Guide

Atlas should feel like a living civic field guide: cartographic, editorial,
calm, direct, and human. It must not feel like a marketing landing page, CRM,
military-intelligence console, generic SaaS dashboard, or archival nostalgia
exercise.

Use these motifs consistently:

- Actual maps and geographic context, never fake map illustrations.
- Fine cartographic rules and locator marks where they convey structure.
- Source-receipt dividers and dates to signal evidence.
- Issue swatches paired with text and shapes.
- Entity geometry: circle for person, square for organization, diamond for
  initiative/campaign/event. Never rely on geometry alone.
- Editorial serif only for important names, quotations, and landscape leads.
- Stable panels and sheets with modest radii and borders.

Do not use:

- Gradients, decorative blobs, bokeh, or atmospheric orbs.
- Nested cards or page sections styled as floating cards.
- Oversized marketing headlines below the Home opening experience.
- Tiny uppercase overlines or tracked eyebrow text.
- Rounded text containers when a standard icon communicates the action.
- CSS `transform: scale()`.
- Decorative maps that do not support selection, navigation, or context.

### Page Composition Grammar

- **Object detail:** breadcrumb/context return, unframed masthead,
  entity/place/issue identity, concise documented summary, place/issue links,
  trust/evidence summary, relevant actions, then a two-column content/context
  layout above 1024px and one ordered column below. The context rail is not a
  card and becomes inline on mobile.
- **Indexes:** compact H1/definition, search and filters, result count/sort,
  then stable records. Do not use a marketing hero or showcase carousel.
- **Explore:** application-height search/filter/result/map region followed by
  the normal footer. List and map are presentations of one state, not separate
  page identities.
- **Landscapes:** place + issue masthead, coverage statement, documented
  timeline, actors/work/perspectives, map, sources/limits, and broadening links.
  The timeline is the dominant visual motif, not a dashboard of counters.
- **Updates:** compact chronological reading surface with a stable filter
  toolbar; record density changes spacing/content detail, not information
  hierarchy.
- **Stewardship/forms:** one task per page, explicit identity/context,
  persistent validation geometry, and a short completion state. Do not put the
  form inside a decorative card on top of another card.
- **Repeated records:** use rows on dense application surfaces and modest
  4px/8px cards only where a grid genuinely aids comparison. A whole card may be
  one link, but it cannot contain nested links/buttons inside that link;
  secondary actions sit outside the primary link target.
- **Section rhythm:** one H1, then H2 page sections and H3 repeated groups.
  Avoid duplicate summaries, repeated action clusters, and multiple competing
  sticky regions.

### Token Contract

Replace the duplicated token/type definitions in `app.css` and `app-runtime.css`
with four focused files imported by `app.css`:

```text
app/src/styles/tokens.css
app/src/styles/typography.css
app/src/styles/base.css
app/src/styles/motion.css
```

Use this light palette as the starting contract; adjust only when automated
contrast checks require it:

```css
:root {
  color-scheme: light;
  --atlas-canvas: #f5f6f3;
  --atlas-surface: #ffffff;
  --atlas-surface-subtle: #eef0ec;
  --atlas-ink: #171a1f;
  --atlas-ink-secondary: #4b5563;
  --atlas-ink-muted: #5f6875;
  --atlas-border: #cfd4da;
  --atlas-border-strong: #9ca5b1;
  --atlas-civic: #14589a;
  --atlas-civic-hover: #0d4175;
  --atlas-terracotta: #a94f3d;
  --atlas-green: #23705a;
  --atlas-ochre: #94620d;
  --atlas-red: #a8322d;
  --atlas-focus: #0b63ce;
}

@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --atlas-canvas: #121416;
    --atlas-surface: #1a1e22;
    --atlas-surface-subtle: #242a30;
    --atlas-ink: #f4f5f6;
    --atlas-ink-secondary: #c3c9d1;
    --atlas-ink-muted: #aeb6c0;
    --atlas-border: #46505b;
    --atlas-border-strong: #6b7682;
    --atlas-civic: #7cb7ff;
    --atlas-civic-hover: #a9d0ff;
    --atlas-terracotta: #ff9a88;
    --atlas-green: #78c6a3;
    --atlas-ochre: #edbe68;
    --atlas-red: #ff9a94;
    --atlas-focus: #9ec5ff;
  }
}
```

Semantic aliases such as `background`, `surface`, `ink-strong`, `link`,
`success`, `warning`, and `error` may remain so existing Tailwind utilities
migrate incrementally. Hard-coded component colors are prohibited after
migration.

Every token pair used for normal text meets 4.5:1, large text and meaningful UI
boundaries meet 3:1, and focus indication has at least 3:1 contrast against
adjacent colors in both themes. Issue categories and trust states always pair
color with text and shape/icon; forced-color mode preserves their meaning
without the palette.

### Dimensions

| Property               | Standard                                                              |
| ---------------------- | --------------------------------------------------------------------- |
| Base spacing           | 4px, with primary rhythm at 8px                                       |
| Page gutters           | 16px mobile, 24px tablet, 32px desktop                                |
| Reading width          | 48rem                                                                 |
| Standard content width | 76rem                                                                 |
| Wide application width | 88rem                                                                 |
| Section rhythm         | 48px mobile, 72px desktop                                             |
| Card/panel radius      | 4px or 8px only                                                       |
| Fully round            | Avatars, status dots, tags, and icon controls only                    |
| Default target         | 44x44px                                                               |
| Compact target         | 40x40px only where adjacent spacing preserves a 44px effective target |
| Borders                | 1px semantic border                                                   |
| Shadows                | One subtle surface shadow and one overlay shadow                      |

Fixed-format controls, map panels, result rows, avatars, counters, and toolbars
must use stable dimensions so loading and interaction states cannot shift
layout.

### Typography

- Public Sans: interface and body text.
- Libre Baskerville: important proper names, quotations, and editorial landscape
  leads only.
- JetBrains Mono: dates, coordinates, source identifiers, and machine-readable
  provenance only.
- Self-host subset WOFF2 files with `font-display: swap`; remove the
  render-blocking Google Fonts import.
- Use discrete responsive roles, not viewport-scaled font sizes.
- Letter spacing is always `0`.
- Body text is at least 16px on reading surfaces and 14px only for compact
  metadata.
- Long names, URLs, issue labels, and source titles wrap without clipping.

### Controls And Surfaces

- Use Lucide icons; do not draw replacement SVG icons.
- Use `IconButton` plus tooltip for familiar icon actions.
- Use segmented controls for list/map and density modes.
- Use checkboxes or toggles for binary state.
- Use a sheet on mobile for filters, evidence, and contextual detail.
- Use real links for navigation and real buttons for commands. Never nest
  either.
- Cards represent repeated records only. Page sections remain unframed bands.
- Public data tables use sticky headers, readable row density, horizontal
  containment, and a mobile list equivalent.

### Motion

- Interaction transitions use 140-220ms durations and standard easing tokens.
- Motion may use opacity and position but never scale-based resizing.
- Map camera movement, drawers, and view transitions honor
  `prefers-reduced-motion`.
- No transition may overlap controls, obscure focus, or cause layout shift.
- Loading skeletons reserve final geometry and never shimmer when reduced motion
  is requested.

### Content And Trust

- Loading copy is silent, a spinner, or the single word `Loading`.
- Empty copy states the plain fact, such as `No people listed.`
- Errors say what failed and offer one recovery action; never mention internal
  pipeline work.
- `Claimed` means identity stewardship, not importance or truth. It never
  changes ranking.
- Subject-provided biography and updates are labeled and displayed alongside,
  not instead of, source-backed summaries.
- Atlas synthesis is never shown as an independent source.
- The public profile shows `Documented work`, `Sources`, and `Limitations`, not
  internal quality scoring.
- Timeline headings use `Documented timeline`; never imply Atlas contains the
  complete history.
- Coverage claims are computed from current data. Do not say `all 50 states`,
  `every corner`, or similar unless the data supports it.

## Architecture Ownership Map

The implementation may split files when complexity warrants it, but these
ownership boundaries are fixed.

| Concern                   | Primary location                                                                                     | Contract                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Public transport          | `app/src/domains/catalog/data/`                                                                      | Only layer importing generated API code or server API configuration; maps DTOs into canonical domain records                |
| Query policy              | `app/src/domains/catalog/data/public-query-*.ts`                                                     | Canonical keys, abort signals, pagination, stale times, retry, SSR dehydration                                              |
| Civic domain records      | Colocated in `data/` mappers or a focused `model/` module                                            | Semantic values and provenance only; no JSX, Tailwind, icons, formatted labels, or route state                              |
| Page application services | `app/src/domains/catalog/application/`                                                               | Executes the read budget and builds serializable page view models                                                           |
| Page controllers          | `app/src/domains/catalog/controllers/`                                                               | Query/session/router hooks, lazy reads, live subscriptions, section states, and actions; renders one pure page presentation |
| Presentation              | `app/src/domains/catalog/pages/` and `components/`                                                   | View-model props and callbacks only; no query hooks, transport, generated DTOs, or trust inference                          |
| Routes                    | `app/src/routes/_public/`                                                                            | URL validation, loaders, redirects, metadata, error boundary selection, and rendering one page presentation                 |
| Live activity transport   | `app/src/domains/firehose/` behind `PublicActivityStream`                                            | Snapshot/live normalization, buffering, reconnect, polling fallback, unsubscribe                                            |
| Public shell              | `app/src/platform/layout/` and `_public.tsx`                                                         | Navigation, global search access, single main landmark, footer, session variants                                            |
| Design foundation         | `app/src/styles/` and `app/src/platform/ui/`                                                         | One token/type/motion source and accessible interaction primitives                                                          |
| SEO                       | `app/src/platform/seo.ts` and discovery routes                                                       | Canonical metadata, escaped JSON-LD, sitemap/robots policy, migration redirects                                             |
| Verification              | `app/tests/acceptance/domains/public/`, `app/playwright.public-ux.config.ts`, `app/lighthouserc.cjs` | Journeys, axe, visual baselines, request budgets, browser smoke, Lighthouse                                                 |
| Evidence report           | `docs/reports/public-atlas-ux-verification.md`                                                       | Reproducible final results and residual risk                                                                                |

Existing `app/src/lib/api-entry.ts`, `api-entry-mappers.ts`, and `api-place.ts`
responsibilities migrate into the gateway, canonical mappers, or application
view models. Do not leave a second public data path after migration. Existing
catalog/map components may remain in place when they obey the presentation
boundary; folder movement by itself is not a goal.

The style foundation resolves the current duplication explicitly:

- `app.css` becomes the import/Tailwind entry point.
- `tokens.css`, `typography.css`, `base.css`, and `motion.css` become the
  singular sources.
- `app-runtime.css` and unused `typography.ts` are removed after reference
  verification.
- `platform/ui` is the only app primitive family. Unused parallel
  `app/src/components/*`, legacy claim, and inactive Browse families are removed
  only after production-import verification.

The expected page applications are Home, Explore, entity index, entity detail,
Place, Issue, Landscape, and Updates. Landscapes live in
`application/landscape.ts`; there is no server/page-shaped landscape loader.

### Executable Work-Package Convention

Every new dynamic surface has four primary artifacts and mirrored tests:

```text
application/<surface>.ts                 # read plan + pure assemblers + view-model types
controllers/<surface>-controller.tsx    # hooks, SectionState, URL/session/actions
pages/<surface>-page.tsx                 # pure presentation
routes/_public/<route>.tsx               # URL, SSR loader/head, controller render

tests/unit/domains/catalog/application/<surface>.test.ts
tests/unit/domains/catalog/controllers/<surface>-controller.test.tsx
tests/unit/domains/catalog/pages/<surface>-page.test.tsx
tests/unit/routes/_public/<route>.test.tsx
```

Split components only when a repeated primitive or independently testable
interaction justifies it. This avoids a monolithic page without pre-creating a
folder for every visual fragment.

| Workstream        | Required primary artifacts                                                                                                                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5 Data/search     | `data/public-catalog-gateway.ts`, HTTP mapper, query keys/options, `model/{civic-record,place,issue,activity,evidence}.ts`, search-intent application module; shared/discovery extraction contracts; API entity/place/activity schemas, search models, record builder, normalized activity migrations, generated contracts |
| 6 Explore         | `application/explore.ts`, `controllers/explore-controller.tsx`, `pages/explore-page.tsx`, `_public/explore.tsx`; reuse audited map modules                                                                                                                                                                                 |
| 7 Home            | `application/home.ts`, `controllers/home-controller.tsx`, `pages/home-page.tsx`, `_public/index.tsx`                                                                                                                                                                                                                       |
| 8 Evidence        | `model/evidence.ts`, evidence application mapper, controller-owned evidence state, reusable evidence presentation                                                                                                                                                                                                          |
| 9 Entity indexes  | One entity-index application/controller/page plus five thin family route configurations                                                                                                                                                                                                                                    |
| 10 Entity details | One entity-detail application/controller shell, person/org/event/initiative/campaign presentation variants, five routes                                                                                                                                                                                                    |
| 11 Places         | `application/place-detail.ts`, place controller/page, `/places` index application/controller/page, typed place routes                                                                                                                                                                                                      |
| 12 Issues         | `application/issue-detail.ts`, issue controller/page, issue-index application/page, issue routes                                                                                                                                                                                                                           |
| 13 Landscapes     | `application/landscape.ts`, landscape controller/page, typed place-kind landscape route; no new API page module                                                                                                                                                                                                            |
| 14 Updates        | `model/activity.ts`, `PublicActivityStream`, `application/updates.ts`, updates controller/page/route, canonical RSS route                                                                                                                                                                                                  |
| 15 Stewardship    | `PublicStewardshipGateway`, claim/manage/feedback controllers and presentations, family-qualified routes, contribution model/migration, existing moderation resources                                                                                                                                                      |
| 16 Secondary      | About, Methodology, Safety, directories, pricing, policy, error and 404 presentations using the shared shell/primitives                                                                                                                                                                                                    |

For each package, first add mapper/application/controller/page/route behavior
tests, then implement the package, then run the focused unit tests plus the
owning Playwright journey. The final workstream runs all packages together;
there is no per-package source-control ceremony in this plan.

## Required Viewport Matrix

Use the matrix deliberately instead of multiplying every test across every mode.

| Purpose                         | Sizes and modes                                   |
| ------------------------------- | ------------------------------------------------- |
| Full Chromium journeys          | 390x844 light and 1440x900 light                  |
| Stable visual baselines         | 390x844, 768x1024, and 1440x900 in light and dark |
| Reflow and extreme-width checks | 320x568 and 1920x1080 light                       |
| Reduced motion                  | 390x844 and 1440x900                              |
| Firefox and WebKit smoke        | 390x844 and 1440x900 critical journeys only       |
| Forced colors and 200% zoom     | One mobile and one desktop critical journey       |

Dynamic timestamps are frozen or masked. Map tiles are deterministically
fulfilled during visual tests, while separate acceptance checks prove that real
light and dark tile URLs load and the rendered canvas contains nonbackground
pixels. Whole-page snapshots are reserved for stable editorial pages;
application surfaces also capture focused component and interaction states.

### Deterministic Performance And Resilience Profile

Use a cold Chromium context with cache disabled, 4x CPU throttling, 150ms
round-trip latency, 1.6 Mbps download, and 750 Kbps upload. The representative
fixtures contain 20 entity summaries, 2,000 map points, 50 activity records, 20
evidence records, and long names/source titles at the maximum supported lengths.
Deterministic tile responses wait 100ms so map readiness is measurable without
external-network variance.

- Home LCP and CLS use this profile. Capture PerformanceObserver entries and the
  trace; LCP must be at most 2.5 seconds and CLS at most 0.1.
- After keyboard focus or pointer activation of the reserved Home map region,
  its controls and a nonblank deterministic canvas must be ready within 2
  seconds on this profile.
- A bundle/import test proves MapLibre is absent from the Home entry chunk and
  remains a separately requested chunk. The trace proves the SSR
  identity/search/result summary renders before map activation.
- A JavaScript-disabled browser context must render the Home H1, purpose, GET
  search form, result summary/list, and canonical directory links from SSR.
  Submitting the GET form must reach useful server-rendered Explore results.
- Shared resilience fixtures cover offline, timeout, 429, 500, broken image,
  unavailable/paywalled/archived source, empty page, sparse record,
  maximum-length content, and a live-stream disconnect. Each archetype opts into
  the states it renders rather than inventing ad hoc mocks.

---

## Execution Order

The workstreams are one program, not independent redesigns:

```text
0 Baseline
  -> 1 Verification harness
  -> 2 Foundation and primitives
  -> 3 Public shell
  -> 4 Route/SEO contract + 5 Data boundary/search semantics
  -> 6 Explore + 7 Home
  -> 8 Evidence/trust
  -> 9 Entity indexes + 10 Entity details + 11 Places + 12 Issues
  -> 13 Landscapes + 14 Updates
  -> 15 Stewardship + 16 Secondary surfaces
  -> 17 Full verification and release decision
```

Workstreams joined with `+` may proceed in parallel only after their shared
contract is passing. Each surface adds its canonical route and metadata when the
full page is ready; Workstream 4 does not publish placeholders. Do not begin
page styling against raw API types while the Workstream 5 gateway/read models
are still unsettled.

## Workstream 0: Preflight And Baseline

**Outcome:** The implementer has current repo truth and a comparison artifact
without spending the handoff on source-control choreography.

- [ ] Confirm the implementation checkout starts from current local `main`,
      preserves unrelated work, and uses the repository Node/pnpm versions.
- [ ] Install with `pnpm install --frozen-lockfile` and record any pre-existing
      gate failure in `docs/reports/public-atlas-ux-verification.md`.
- [ ] Run the current app typecheck, lint, unit suite, production build,
      bundle-budget check, and public Playwright suite.
- [ ] Capture the existing public routes at 390x844, 1280x800, and 1440x900 for
      before/after comparison.
- [ ] Record current route-level JavaScript, request count, transferred bytes,
      LCP, CLS, accessibility score, console errors, and hydration warnings for
      Home, Browse, Map, one entity, one place, and Firehose.

**Gate:** The report distinguishes baseline defects from regressions introduced
by this pass. No existing failing gate is weakened or hidden.

## Workstream 1: Build The Public UX Verification Harness

**Files:**

- Modify: `pnpm-workspace.yaml`
- Modify: `app/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `app/playwright.public-ux.config.ts`
- Create: `app/tests/acceptance/helpers/public-ux.ts`
- Create: `app/tests/acceptance/domains/public/public-foundations.spec.ts`
- Create: `app/tests/acceptance/domains/public/public-accessibility.spec.ts`
- Create: `app/tests/acceptance/domains/public/public-visual.spec.ts`
- Create: `app/lighthouserc.cjs`
- Modify: `app/scripts/screenshots.mjs`
- Test: `app/tests/unit/playwright-public-ux-config.test.ts`

- [ ] **Step 1: Add pinned accessibility and Lighthouse tooling with pnpm**

Run:

```bash
pnpm --filter @rebuildingamerica/atlas-app add -D @axe-core/playwright @lhci/cli
```

Then move the resolved versions into the root `catalog` and set both app
dependency values to `catalog:` so Atlas keeps one dependency policy.

Expected: `pnpm-workspace.yaml`, `app/package.json`, and `pnpm-lock.yaml`
change; no unrelated package versions move.

- [ ] **Step 2: Write the failing public UX config unit test**

Test the exported project builder rather than source text:

```ts
expect(buildPublicUxProjects()).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ name: "chromium-mobile-light" }),
    expect.objectContaining({ name: "chromium-tablet-dark" }),
    expect.objectContaining({ name: "chromium-desktop-light" }),
    expect.objectContaining({ name: "chromium-wide-light" }),
    expect.objectContaining({ name: "firefox-functional" }),
    expect.objectContaining({ name: "webkit-functional" }),
  ]),
);
```

Run:

```bash
pnpm --filter @rebuildingamerica/atlas-app exec vitest run tests/unit/playwright-public-ux-config.test.ts
```

Expected: FAIL because `playwright.public-ux.config.ts` does not exist.

- [ ] **Step 3: Create the public Playwright project matrix**

Export `buildPublicUxProjects()` and configure:

```ts
interface PublicUxViewport {
  colorScheme: "dark" | "light";
  height: number;
  name: string;
  reducedMotion?: "reduce";
  width: number;
}
```

Use the required viewport matrix in this plan. Visual projects use Chromium and
`testMatch: /public-visual\.spec\.ts/`; functional browser projects run
discovery and accessibility specs. Reuse the same deterministic API/app/mail web
servers and environment contract from `playwright.config.ts` instead of starting
a second bespoke stack.

Run the unit test again. Expected: PASS.

- [ ] **Step 4: Add reusable browser assertions**

Implement helpers with these public contracts:

```ts
export async function expectNoHorizontalOverflow(page: Page): Promise<void>;
export async function expectNoConsoleFailures(
  page: Page,
  run: () => Promise<void>,
): Promise<void>;
export async function expectPrimaryLandmarks(page: Page): Promise<void>;
export async function expectVisibleFocus(
  page: Page,
  locator: Locator,
): Promise<void>;
export async function stubDeterministicMapTiles(page: Page): Promise<void>;
export async function runAxeAudit(page: Page): Promise<void>;
```

`runAxeAudit` runs the WCAG 2.2 A/AA tags and fails on every in-scope violation,
not only serious violations. It does not treat experimental/AAA rules as launch
requirements and does not replace keyboard tests or manual review. Follow
Playwright's official
[axe integration guidance](https://playwright.dev/docs/accessibility-testing).

- [ ] **Step 5: Add foundations assertions as their owning workstream lands**

Cover Home, Browse, Map, person profile, organization profile, place detail,
Firehose, Claim, Feedback, Pricing, and 404. For each route assert:

- One banner, one main, and no nested main landmarks.
- No horizontal document overflow.
- No console error or hydration warning.
- A nonempty page title and description.
- A visible H1.

Do not mark redesign requirements `skip` or `fixme` merely to keep the harness
green. Keep known baseline failures in the verification report, then add each
assertion to the executable suite in the workstream that makes it pass.

- [ ] **Step 6: Add the visual spec skeleton**

Use `expect(page).toHaveScreenshot()` with `animations: "disabled"`,
deterministic data, and stable masks for live timestamps. Capture whole-page and
key interactive-state screenshots. Do not create baselines until the
corresponding task has reached its final design.

- [ ] **Step 7: Add Lighthouse budgets**

Configure a parameterized route list and add Home, Explore, one representative
entity, and one substantive landscape as those surfaces become available. Use
three runs and evaluate the median. Set minimum scores:

```js
assertions: {
  "categories:accessibility": ["error", { minScore: 1 }],
  "categories:best-practices": ["error", { minScore: 1 }],
  "categories:seo": ["error", { minScore: 1 }],
  "categories:performance": ["error", { minScore: 0.9 }],
  "largest-contentful-paint": ["error", { maxNumericValue: 2500 }],
  "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
}
```

INP is a field metric; verify it through Speed Insights/RUM after deployment
rather than fabricating a lab result.

- [ ] **Step 8: Add package scripts**

Expose:

```json
{
  "test:public-ux": "playwright test --config playwright.public-ux.config.ts",
  "test:public-ux:update": "playwright test --config playwright.public-ux.config.ts --update-snapshots",
  "audit:lighthouse": "lhci autorun --config lighthouserc.cjs"
}
```

- [ ] **Step 9: Verify the harness**

```bash
pnpm --filter @rebuildingamerica/atlas-app run format
pnpm --filter @rebuildingamerica/atlas-app run lint
pnpm --filter @rebuildingamerica/atlas-app run typecheck
pnpm --filter @rebuildingamerica/atlas-app exec vitest run tests/unit/playwright-public-ux-config.test.ts
```

**Gate:** Project selection is deterministic, the pre-redesign smoke suite runs
without skipped requirements, and the harness itself does not add a second dev
stack or duplicate fixture system.

## Workstream 2: Reconcile Tokens, Typography, Primitives, And Legacy UI

**Files:**

- Modify/Create/Delete: foundation and primitive files defined by the
  Architecture Ownership Map and visual token contract
- Delete after `rg` verification: unused
  `app/src/components/{ui,entries,discovery,layout}` and unused
  `app/src/hooks/*`
- Delete after `rg` verification: `app/src/routes/_public/claim/claim-page.tsx`,
  `claim-page-panels.tsx`, `claim-page-rail.tsx`, and their legacy-only tests
- Consolidate after `rg` verification: inactive Browse derivation/hero/surface
  modules not imported by the surviving Explore composition
- Test: `app/tests/unit/platform/styles/theme-tokens.test.ts`
- Test: `app/tests/unit/platform/styles/typography.test.ts`
- Test: `app/tests/unit/platform/ui/*.test.tsx`

- [ ] **Step 1: Write failing rendered-behavior tests for the primitive
      contract**

Cover:

- Button forwards native props and refs.
- `ButtonLink` or exported styles produce a link without nesting a button.
- `IconButton` has a stable 44px target and accessible name.
- `Card` cannot render as a clickable `div`.
- Field controls forward `id`, `name`, `required`, autocomplete,
  `aria-describedby`, and invalid state.
- Sheet traps focus, closes on Escape, returns focus, and respects reduced
  motion.
- Segmented control exposes one selected option and arrow-key navigation.
- Empty, loading, and error states expose correct semantics.

Run the focused primitive suite. Expected: FAIL on missing contracts.

- [ ] **Step 2: Split and normalize the CSS foundation**

Create the four style files using the contracts above. Remove the duplicate
runtime import, undefined variables, negative letter spacing, permanent
`will-change`, and duplicated type utilities. Keep `app.css` as the
Tailwind/source/import entry point.

Self-host font subsets under:

```text
app/public/fonts/public-sans-latin-variable.woff2
app/public/fonts/libre-baskerville-regular.woff2
app/public/fonts/libre-baskerville-bold.woff2
app/public/fonts/jetbrains-mono-latin-variable.woff2
```

Use only properly licensed upstream font assets and retain their license files
under `app/public/fonts/licenses/`.

- [ ] **Step 3: Implement the primitive contract**

Use Headless UI for focus-managed sheets/popovers. Do not introduce a second
component framework. Keep component types colocated and prohibit `any`.

- [ ] **Step 4: Replace invalid nested interactions in touched public code**

At minimum fix:

- `domains/catalog/components/map/map-detail-panel.tsx`
- `domains/catalog/components/entries/entry-list.tsx`
- `platform/pages/not-found-page.tsx`
- `platform/pages/error-page.tsx`

Search for all remaining instances:

```bash
rg -n -U '<Link[\s\S]{0,300}<Button|<a[\s\S]{0,300}<button' app/src
```

Expected: no matches after migration.

- [ ] **Step 5: Remove dead parallel component families**

Use `rg` to prove no production import reaches each candidate. Delete
implementation and legacy-only tests together. Do not remove
`packages/entity-widgets`; remove only unresolved app-side scanning/imports when
the app has no production consumer.

- [ ] **Step 6: Run the foundation gate**

```bash
pnpm --filter @rebuildingamerica/atlas-app run format
pnpm --filter @rebuildingamerica/atlas-app run lint
pnpm --filter @rebuildingamerica/atlas-app run typecheck
pnpm --filter @rebuildingamerica/atlas-app exec vitest run tests/unit/platform/styles tests/unit/platform/ui
pnpm --filter @rebuildingamerica/atlas-app run build
```

Expected: PASS with no unresolved Tailwind token warnings.

- [ ] **Step 7: Review the rendered foundation**

Create the test-only route `app/src/routes/__e2e/public-ux-foundations.tsx` at
`/__e2e/public-ux-foundations`. It returns 404 unless the existing E2E fixture
environment is enabled and is excluded from the sitemap/robots. Render every
primitive with normal, hover/focus, active, disabled, loading, required,
invalid, long-label, long-error, light, and dark fixtures. Capture it at 320px,
390px, 768px, and 1440px in `public-visual.spec.ts`; add targeted forced-color
and reduced-motion assertions. Verify pointer and keyboard behavior before any
product surface migrates.

**Gate:** There is one token source, one typography source, one active primitive
family, no invalid nested controls, and no presentation component needs a
hard-coded color or radius to reproduce the approved motif.

## Workstream 3: Rebuild The Public Shell, Navigation, Search, And Footer

**Files:**

- Modify: `app/src/routes/_public.tsx`
- Modify: `app/src/platform/layout/public-nav.tsx`
- Modify: `app/src/platform/layout/top-nav-chrome.tsx`
- Modify: `app/src/platform/layout/public-footer.tsx`
- Modify: `app/src/platform/layout/page-layout.tsx`
- Create: `app/src/platform/layout/public-breadcrumbs.tsx`
- Test: `app/tests/unit/routes/_public.test.tsx`
- Test: `app/tests/unit/platform/layout/public-nav.test.tsx`
- Test: `app/tests/unit/platform/layout/public-footer.test.tsx`
- Test: `app/tests/acceptance/domains/public/public-foundations.spec.ts`

- [ ] **Step 1: Write failing shell behavior tests**

Test anonymous, signed-in, and local-mode shells. Require:

- Exact primary nav order from this plan.
- Search available at every viewport, using the Home search on `/` and a
  header/search-sheet entry elsewhere.
- `aria-current` on the active destination.
- Mobile menu closes on Escape, outside click, route change, and focus
  departure.
- Focus returns to the menu trigger.
- One banner, one main, and one contentinfo landmark.
- Skip link targets `#main-content`.
- Footer uses natural height and every link remains reachable at `390x667` and
  `844x390`.

Run focused tests. Expected: FAIL against current eight-link navigation and
viewport footer.

- [ ] **Step 2: Implement the stable public header**

Use a stable sticky header instead of the scroll-morph shell. Desktop navigation
renders only where all items and search fit without shrinkage. Tablet/mobile use
a menu and search sheet. Keep the Atlas brand prominent but compact.

Header and mobile-sheet search use the same GET form, intent controller,
accessible combobox semantics, and canonical parameter names as Home/Explore. Do
not maintain a third search parser in navigation.

- [ ] **Step 3: Establish the sole main landmark**

The route shell renders:

```tsx
<a className="skip-link" href="#main-content">Skip to content</a>
<PublicTopNav />
<main id="main-content" tabIndex={-1}>
  <Outlet />
</main>
<PublicFooter />
```

Explore map mode uses a viewport-height application region inside the main
landmark. The footer remains after that region in normal document flow so it is
reachable by scrolling and the route still has one `contentinfo` landmark.

- [ ] **Step 4: Rebuild the footer**

Use a natural-height, responsive footer with:

- Atlas and Rebuilding America Project identity.
- Explore, entity, place, issue, and update links.
- About, methodology, safety, corrections, claims, pricing, docs, API, and legal
  links.
- No Groundwork reference.
- No full-viewport height lock.

- [ ] **Step 5: Run browser shell checks**

```bash
pnpm --filter @rebuildingamerica/atlas-app exec vitest run tests/unit/platform/layout tests/unit/routes/_public.test.tsx
pnpm --filter @rebuildingamerica/atlas-app exec playwright test --config playwright.public-ux.config.ts --grep "public shell"
```

Expected: PASS at mobile, tablet, desktop, dark, and keyboard settings with no
document overflow.

- [ ] **Step 6: Review every shell state**

Inspect anonymous, signed-in, local-deployment, menu-open, search-open,
long-localized-label, dark, reduced-motion, and short-landscape states in the
browser.

**Gate:** Search and all six primary destinations are reachable at every width;
there is one banner, one main, and one footer; focus never disappears behind
sticky chrome; the footer never clips.

## Workstream 4: Establish The Route, Metadata, And Migration Contract

**Files:**

- Create/Modify: all canonical route files in the Public Information
  Architecture
- Modify: `app/src/platform/seo.ts`
- Modify: `app/src/domains/catalog/components/profiles/profile-head.tsx`
- Modify: `app/src/routes/sitemap[.]xml.ts`
- Modify: `app/src/routes/robots[.]txt.ts`
- Modify: `app/src/routes/llms[.]txt.ts`
- Generated: `app/src/routeTree.gen.ts`
- Test: `app/tests/unit/platform/seo.test.ts`
- Test: `app/tests/unit/routes/sitemap-xml.test.ts`
- Test: `app/tests/unit/routes/robots-txt.test.ts`
- Test: `app/tests/unit/routes/llms-txt.test.ts`
- Create: `app/tests/unit/routes/public-route-matrix.test.tsx`

- [ ] **Step 1: Define the route and canonical matrix**

For every route in the canonical route table assert:

- SSR returns a non-error status.
- HTML contains one H1 and the expected main landmark.
- Title, description, canonical URL, OpenGraph URL, and social image exist.
- Query/filter states use `noindex` and canonicalize to the base/indexable
  object.
- Compatibility paths permanently redirect and preserve supported state.
- No public canonical URL points at `/browse`, `/map`, `/firehose`, or the
  generic `/entries/:id` fallback.

- [ ] **Step 2: Migrate routes with their complete surfaces**

Do not publish or test indexable placeholder shells. Create each canonical route
when its owning page, primary loader, error boundary, metadata, and internal
links are ready. Keep the route matrix as the contract and make its rows
executable incrementally.

- [ ] **Step 3: Harden shared SEO helpers**

Add typed helpers for:

```ts
export function buildBreadcrumbJsonLd(items: BreadcrumbItem[]): JsonLd;
export function buildWebSiteJsonLd(): JsonLd;
export function buildEntityJsonLd(entry: CivicRecordDetail): JsonLd;
export function buildPlaceJsonLd(place: PlaceRecord): JsonLd;
export function buildEventJsonLd(entry: CivicRecordDetail): JsonLd;
export function serializeJsonLd(value: JsonLd): string;
```

`serializeJsonLd` must escape `<` as `\u003c`. Structured data describes only
visible content and never claims an inferred role or affiliation.

- [ ] **Step 4: Expand sitemap coverage**

Include all indexable entity indexes/details, places, issues, substantive
landscapes, public directories, About, Methodology, Updates, and policy pages.
Exclude search parameters, claims, feedback, auth, workspace, operator, thin
landscapes, and private data.

Enumerate landscapes deterministically: for each canonical issue, paginate
`GET /api/places` with that issue, `min_source_count=2`,
`min_independent_publisher_count=2`, and `has_entities=true`; emit the typed
place-kind/slug plus issue slug returned by the canonical records. Contract
tests compare this candidate set to the threshold evaluator, reject duplicate
URLs, and prove that thin pairs are excluded without issuing one request per
place.

Use a sitemap index and split child sitemaps before any file reaches 50,000 URLs
or 50MB uncompressed. `lastmod` comes only from a canonical record update/source
date; omit it when unknown. Do not emit guessed `priority` or `changefreq`
values.

Serve sitemap index/children with
`Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`.
Cache candidate enumeration per taxonomy version so sitemap requests do not
repeatedly scan every issue/place pair.

Google emphasizes logical site structure and internal links, not a sitemap
alone. See
[Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview)
and
[sitelink guidance](https://developers.google.com/search/docs/appearance/sitelinks).

- [ ] **Step 5: Generate the route tree and run the completed-route SEO gates**

```bash
pnpm --filter @rebuildingamerica/atlas-app run generate:route-tree
pnpm --filter @rebuildingamerica/atlas-app exec vitest run tests/unit/platform/seo.test.ts tests/unit/routes/sitemap-xml.test.ts tests/unit/routes/robots-txt.test.ts tests/unit/routes/llms-txt.test.ts tests/unit/routes/public-route-matrix.test.tsx
pnpm --filter @rebuildingamerica/atlas-app run typecheck
```

Expected: PASS for completed routes; `routeTree.gen.ts` changes only through
generation. The full matrix becomes mandatory in the final release workstream.

- [ ] **Step 6: Validate migrations with real state**

Verify `/browse`, `/map`, `/firehose`, `/firehose.rss`, `/profiles`,
generic/incorrect typed place paths, and legacy family-less
claim/feedback/manage paths with representative query, viewport, filter,
selection, and ambiguous-slug cases. Every supported parameter survives its
redirect; unsupported parameters are deliberately dropped and documented.
Internal links never depend on the compatibility paths.

**Gate:** No canonical route serves placeholder content, no duplicate route
serves the same indexable document, JSON-LD describes only visible facts, and
every completed public object is reachable through a crawlable internal link.

## Workstream 5: Build The Thin Public Data Boundary And Trustworthy Search Semantics

**User outcome:** Search resolves places, issues, entity families, documented
activities, and media without treating mere mention as identity.
`homelessness in Las Vegas` opens the correct landscape, and `transit YouTubers`
finds people documented as video creators working on transit rather than anyone
mentioned in a video.

**Architecture outcome:** Public presentation has a read gateway, stewardship
write gateway, canonical query model, application services, controllers, and
pure view-model assemblers. The backend adds only the place search/list
endpoint; all other data needs are explicit extensions to existing operations in
the contract-delta table. It does not gain page-specific endpoints.

### Canonical Query

```ts
interface CatalogQuery {
  activities: string[];
  cursor?: string;
  entryTypes: EntryType[];
  issueAreas: string[];
  media: string[];
  platforms: string[];
  places: string[];
  query?: string;
  sourcePatterns: SourcePattern[];
  sourceTypes: SourceType[];
}
```

`sourceTypes` describes the evidence form in which an entity appears.
`activities` describes what the entity is documented as doing. `media` and
`platforms` qualify that same activity. These are not interchangeable.

### Documented Activity Contract

Extend the existing entity/search response rather than create a role endpoint:

```ts
interface DocumentedActivity {
  activity:
    | "advocates"
    | "creates"
    | "funds"
    | "governs"
    | "litigates"
    | "organizes"
    | "participates"
    | "reports"
    | "researches"
    | "serves"
    | "studies"
    | "teaches";
  media: Array<
    | "audio"
    | "data"
    | "newsletter"
    | "photography"
    | "print"
    | "social"
    | "video"
    | "web"
  >;
  platforms: Array<
    | "apple-podcasts"
    | "bluesky"
    | "facebook"
    | "instagram"
    | "mastodon"
    | "spotify"
    | "substack"
    | "tiktok"
    | "twitch"
    | "vimeo"
    | "youtube"
  >;
  sourceIds: string[];
  supportedAt?: string;
}
```

`DocumentedActivity` describes what an entity is documented as doing and powers
role/media discovery. `ActivityRecord` describes a dated public signal in
Updates/timelines. They are separate domain models and filters.

The controlled activity is a public action, not an ideology, protected
characteristic, private membership, or personality label. It must have at least
one source ID. Human labels such as `Video creator` are derived in the
application view model from the controlled activity/media values, not stored by
the API. Subject contributions never enter this source-backed activity model and
cannot satisfy its filters.

For example, `YouTuber` resolves to `activity=creates`, `media=video`, and
`platform=youtube`, and the match is valid only when one activity record has all
three values. A generic YouTube video mentioning someone does not qualify.
`Video creator` omits the platform constraint. `journalist` resolves to
`activity=reports`; being quoted by journalism does not qualify. In this pass,
`faith organization` remains residual free text matched against explicit public
names/descriptions; Atlas does not infer religious identity from a name, place,
issue, or relationship.

`Across the country`, `nationwide`, and `nationally` explicitly mean no place
constraint; they are removed from residual free text and shown as
`United States` scope without inventing a place record.

- [ ] Add source-linked documented activities to the canonical entity model,
      persistence/query path, public Pydantic schema, `_entity_record()`,
      frontend mapping, filters, facets, and generated client. Keep it additive
      on `GET /api/entities` and entity detail.
- [ ] Store activities in normalized `entity_documented_activities`,
      `entity_documented_activity_media`,
      `entity_documented_activity_platforms`, and
      `entity_documented_activity_sources` tables with foreign keys and indexes
      on `(activity, entity_id)`, `(medium, activity_id)`,
      `(platform, activity_id)`, and `(source_id, activity_id)`. Filter entity
      search with indexed `EXISTS` clauses so combined
      `creates + video + youtube` must match the same activity row.
- [ ] Extend `atlas-shared` Raw/Deduplicated entry contracts and
      `atlas-discovery-engine` structured extraction with controlled activity,
      media, and a verbatim evidence quote. Validate that the quote exists in
      the source, reject protected/private inference, retain evidence per source
      through deduplication, and map source URLs to stored source IDs during
      API/Scout sync. An entity mention with no explicit activity produces no
      activity record.
- [ ] Assign a platform only when the source URL host or verbatim evidence
      explicitly identifies that platform. Normalize known hosts through one
      shared table; an unrecognized host leaves platform empty rather than
      guessing.
- [ ] Add `GET /api/places` with `query`, `kind`, `issue`, `min_source_count`,
      `min_independent_publisher_count`, `has_entities`, `cursor`, and `limit`
      using standardized canonical places. Query length is at most 200; counts
      are nonnegative; limit defaults to 20 and is 1-100. Return only key, slug,
      display name, kind, parent/state context, public centroid when available,
      and result cursor. Do not return application URLs, full profiles, or
      private coordinates; the application view model builds canonical hrefs
      from kind and slug.
- [ ] Replace entity collection records with the compact summary projection, add
      canonical place/activity/media filtering to entity list and map, and
      accept old city/state/region parameters only in the documented
      compatibility parser. New application code and generated examples use
      canonical place keys exclusively.
- [ ] Extend place `page-context`, source access/correction state, and public
      activity cursor/filter contracts exactly as listed in the contract-delta
      table. Do not add a second frontend adapter for their old shapes.
- [ ] Implement `PublicCatalogGateway` and query-key/options modules. The
      concrete HTTP gateway is the only public-catalog layer that imports
      `app/src/lib/generated/`; migrate the live responsibilities from
      `api-entry.ts` and `api-place.ts` into it and remove the parallel path.
- [ ] Add ESLint overrides in the existing app config: `pages/**` and
      `components/**` reject generated/data/query/router/session imports;
      `application/**` rejects React, TanStack Query, router, and generated
      imports; `controllers/**` rejects generated clients and concrete HTTP
      gateways; public routes reject generated clients and repeated visual
      composition. The HTTP gateway is the only catalog module allowed to import
      generated API code.
- [ ] Create pure search-intent parsing that recognizes only exact aliases from
      canonical issue, place, entity-family, activity, and media dictionaries.
      Unrecognized text remains free text. Ambiguity opens a suggestion choice;
      it never silently selects a place or identity.
- [ ] Return recognized intent as removable tokens with a plain explanation. The
      resolver may recommend a destination but navigation occurs only on submit
      or explicit selection.
- [ ] Replace the bundled-city and viewport-only search behavior with the place
      operation. State names and abbreviations resolve through the same
      canonical place index; do not keep a static place fallback that can drift
      or imply complete coverage.
- [ ] Add deterministic source-backed fixtures for a transit video creator,
      local reporter, Las Vegas housing organization, connected
      initiative/campaign/event, contested issue perspectives, a sparse valid
      actor, and a young public civic participant whose unsafe private/contact
      details are absent.
- [ ] Regenerate OpenAPI and Orval clients, then run API schema, contract,
      gateway, assembler, and intent tests.

**Acceptance:**

- `homelessness in Las Vegas` resolves the canonical issue and place and offers
  the landscape.
- `transit YouTubers across the country` resolves `person`, transit, `creates`,
  `video`, and `youtube`, then returns only a fixture with evidence for that
  combined activity.
- A person merely mentioned in a YouTube video does not match the creator
  filter.
- A reporter and a person reported about produce different match reasons.
- City, county, metro, neighborhood, district, polity, ambiguous-name,
  no-result, pagination, and invalid-kind place cases behave explicitly.
- Empty and transport failure are distinct all the way through gateway, read
  model, and rendered state.
- Presentation-layer lint rules reject imports from generated clients, gateway
  implementations, and query hooks.
- SQLite and PostgreSQL integration fixtures produce the same eligibility, match
  tier, tie-break ordering, place/activity/media/platform facets, and cursors
  for the canonical queries.

**Verification:** Run focused API tests with `uv run --extra dev pytest`, app
gateway/read-model/search tests with Vitest, `pnpm run openapi`, app client
generation, `pnpm run contract:test`, typecheck, and a network trace showing no
duplicate hydration requests.

## Workstream 6: Replace Browse And Map With One Explore Experience

**Files:**

- Create: `app/src/routes/_public/explore.tsx`
- Modify: `app/src/routes/_public/browse.tsx`
- Modify: `app/src/routes/_public/map.tsx`
- Create: `app/src/domains/catalog/components/explore/explore-page.tsx`
- Create: `app/src/domains/catalog/components/explore/explore-search.tsx`
- Create: `app/src/domains/catalog/components/explore/explore-filters.tsx`
- Create: `app/src/domains/catalog/components/explore/explore-results.tsx`
- Create: `app/src/domains/catalog/components/explore/explore-context.tsx`
- Create: `app/src/domains/catalog/components/explore/explore-map-view.tsx`
- Reuse: `app/src/domains/catalog/components/map/*`
- Modify: `app/src/domains/catalog/search-state.ts`
- Delete after migration: obsolete `app/src/domains/catalog/components/browse/*`
- Test: migrate focused Browse tests to
  `app/tests/unit/domains/catalog/components/explore/`
- Test: `app/tests/acceptance/domains/public/public-discovery.spec.ts`

- [ ] **Step 1: Write the failing Explore route and state tests**

The URL is the source of truth. The validated contract supports:

```ts
interface ExploreSearchState {
  activities: string[];
  query?: string;
  view: "list" | "map";
  places: string[];
  issueAreas: string[];
  entryTypes: EntryType[];
  media: string[];
  platforms: string[];
  sourceTypes: SourceType[];
  sourcePatterns: SourcePattern[];
  cursor?: string;
}
```

Require compatible legacy parameter normalization without maintaining two UI
implementations.

Changing query or any eligibility filter clears cursor and selected record.
Switching list/map preserves the last list cursor in URL state but map ignores
it; returning to list restores it. Invalid enum/cursor values are rejected into
the canonical base state with a visible plain filter error rather than silently
sent to the API.

The validated absent `view` value means `list`; the canonical base URL omits
`view=list` and emits `view=map` only for map mode.

The route container validates the URL, prefetches the canonical catalog/map
queries, and assembles `ExploreViewModel`. The presentational `ExplorePage`
receives that model and callbacks. It must not call `useEntries`,
`useMapPoints`, `useTaxonomy`, or a generated client directly.

- [ ] **Step 2: Build the desktop Explore composition**

- Sticky global search and interpreted-intent row.
- Filter controls for place, issue, entity type, documented activity, activity
  medium/platform, source type, and source pattern.
- List is the default for text searches.
- Map mode is a full spatial canvas with the accessible result rail visible.
- List/map is a segmented control, not two navigation destinations.
- Results preserve stable dimensions while loading.
- The result count, cap state, and active context are announced accessibly.
- A clear issue-plus-place match offers the canonical landscape as the primary
  destination.
- The initial list request and map-point request are mutually selected by view;
  do not download full list and map payloads when only one is visible. Prefetch
  the alternate view only after idle or explicit hover/focus intent.

- [ ] **Step 3: Build the mobile Explore composition**

- Search remains fixed within the public header region, not the viewport bottom.
- Filters open in the shared Sheet.
- List/map parity is visible; map detail uses a bottom sheet with a reachable
  parallel list.
- Closing filters/detail restores focus.
- The page never relies on hover.

- [ ] **Step 4: Redesign result records**

Each result shows only sourced or plainly labeled fields:

- Name and entity family.
- Place relationships.
- Issue relationships.
- Concise summary.
- Explainable match reason.
- Source count and latest source date.
- Calm trust/limitation state.
- Open detail and inspect evidence actions.

Delete lead-scoring labels and internal quality diagnostics from public results.

- [ ] **Step 5: Preserve mature map behavior**

Retain lazy MapLibre loading, viewport URL state, clustering, focus restoration,
Escape behavior, reduced motion, light/dark tile parity, cap disclosure, and
keyboard results. Restore required map attribution. Use the shared issue/entity
token contract and 44px controls.

- [ ] **Step 6: Add complete Explore journeys**

Playwright must prove:

1. `homelessness in Las Vegas` resolves to the landscape destination.
2. `transit YouTubers` produces person/transit/creates/video/youtube intent and
   a seeded creator.
3. Place-only search returns records from the place even when the free-text name
   does not contain the place.
4. List-to-map and map-to-list preserve filters and selection.
5. Profile open and browser Back restore query, filters, view, scroll position,
   and focused result.
6. Empty and API error states are different and recoverable.
7. All issue taxonomy options are searchable, not only the first ten.

- [ ] **Step 7: Remove obsolete Browse composition**

Use `rg` to identify the surviving imports. Delete inactive Browse
hero/derivation/surface families and their legacy-only tests. Keep
domain-neutral helpers only when Explore imports them.

- [ ] **Step 8: Verify the complete Explore contract**

```bash
pnpm --filter @rebuildingamerica/atlas-app exec vitest run tests/unit/domains/catalog/components/explore tests/unit/domains/catalog/components/map tests/unit/domains/catalog/hooks tests/unit/domains/catalog/search-state.test.ts
pnpm --filter @rebuildingamerica/atlas-app exec playwright test --config playwright.public-ux.config.ts --grep "Explore|map"
pnpm --filter @rebuildingamerica/atlas-app run typecheck
pnpm --filter @rebuildingamerica/atlas-app run lint
```

Inspect network traces for list and map modes. Initial hydration performs no
duplicate request, map mode receives lightweight map points rather than full
records, stale searches abort, and switching views preserves canonical state
without a full navigation reload.

**Gate:** One URL model, one controller, and two presentations replace
Browse/Map duplication. Every result explanation is derivable from the view
model, and list/map/back navigation never loses filters, selection, scroll, or
focus.

## Workstream 7: Rebuild Home As The Living Public Atlas

**Files:**

- Modify: `app/src/routes/_public/index.tsx`
- Refactor: `app/src/platform/pages/home-page.tsx`
- Refactor/Delete: `app/src/platform/pages/home-page-data.ts`,
  `home-page-discovery.tsx`, `home-page-sections.tsx`
- Create: `app/src/domains/catalog/components/home/home-search.tsx`
- Create: `app/src/domains/catalog/components/home/home-map.tsx`
- Create: `app/src/domains/catalog/components/home/home-current-activity.tsx`
- Create: `app/src/domains/catalog/components/home/home-directory-links.tsx`
- Test: `app/tests/unit/routes/public-home-page.test.tsx`
- Test: `app/tests/acceptance/domains/public/public-discovery.spec.ts`
- Test: `app/tests/acceptance/domains/public/public-visual.spec.ts`

- [ ] **Step 1: Write failing Home behavior tests**

Require:

- H1 is `Atlas`.
- A concise supporting line describes the civic field, not product features.
- Search is the dominant action and uses the shared intent resolver.
- Search is a real `GET /explore` form. JavaScript enhances
  interpretation/autocomplete but is not required to submit a query.
- The first viewport contains a real interactive national map with list parity.
- A hint of the next content band is visible at every required viewport.
- Coverage totals and labels come from live data.
- Errors do not render as empty catalog facts.
- Entity and place links are real canonical links, not free-text Browse queries.
- The loader performs only the Home reads in the orchestration budget, and the
  presentational page renders entirely from `HomeViewModel`.

- [ ] **Step 2: Build the opening viewport**

Use the actual map as the visual asset and spatial context. Do not place the H1
or search in a decorative card. Search may sit over the map on a legible solid
scrim/panel with modest radius; the map remains inspectable and interactive.

SSR renders the Atlas identity, search, live result count, and an accessible
geographic result summary before MapLibre loads. The MapLibre chunk begins after
the primary text/search render and upgrades the reserved map region without
changing its dimensions. Keyboard or pointer intent on the map region triggers
immediate loading; otherwise it may start during the first idle period. The map
must become selectable within 2 seconds on the deterministic mid-tier Playwright
profile, but its failure cannot block search or list navigation.

The opening content order is:

1. Atlas name and one-sentence purpose.
2. Search.
3. Live national map/list context.
4. Current activity strip.

- [ ] **Step 3: Build the rest of Home as direct entry points**

Use unframed sections for:

- Explore by place.
- Explore by issue.
- People and organizations recently supported by sources.
- Current public updates.

Do not add marketing feature explanations, pricing blocks, or unsupported
national coverage claims.

- [ ] **Step 4: Prove performance and fallback behavior**

Map code remains route-split and lazily loaded. Home uses the lightweight map
projection and never loads full entity records for its markers. When WebGL or
tile loading fails, the parallel list and search remain usable and the map
region states the failure plainly.

- [ ] **Step 5: Verify visual framing, requests, and activation**

Capture every required viewport in light and dark mode. Inspect the screenshots
at original resolution and assert the map canvas is nonblank, search never
obscures map controls, no text overlaps, and the next band remains visible.

```bash
pnpm --filter @rebuildingamerica/atlas-app exec vitest run tests/unit/routes/public-home-page.test.tsx tests/unit/routes/_public/index.test.tsx
pnpm --filter @rebuildingamerica/atlas-app exec playwright test --config playwright.public-ux.config.ts --grep "Home"
```

**Gate:** The opening frame identifies Atlas, provides working search, shows
actual civic geography, hints at the next band, and remains useful with
JavaScript, WebGL, or map tiles unavailable. SSR hydration duplicates no data
reads, the map canvas is nonblank after activation, and its chunk does not delay
the primary LCP element.

## Workstream 8: Build The Shared Evidence And Trust Experience

**Files:**

- Create: `app/src/domains/catalog/components/evidence/evidence-trigger.tsx`
- Create: `app/src/domains/catalog/components/evidence/evidence-panel.tsx`
- Create: `app/src/domains/catalog/components/evidence/evidence-list.tsx`
- Create: `app/src/domains/catalog/components/evidence/provenance-label.tsx`
- Create: `app/src/domains/catalog/components/evidence/limitation-status.tsx`
- Modify:
  `app/src/domains/catalog/components/profiles/profile-research-context.tsx`
- Modify: `app/src/domains/catalog/components/profiles/profile-history.tsx`
- Modify: `app/src/domains/catalog/components/entries/entry-card.tsx`
- Test:
  `app/tests/unit/domains/catalog/components/profile-evidence-accessibility.test.tsx`
- Create: `app/tests/unit/domains/catalog/components/evidence-panel.test.tsx`
- Test: `app/tests/acceptance/domains/public/public-accessibility.spec.ts`

- [ ] **Step 1: Define evidence semantics and focus behavior**

Require desktop drawer and mobile sheet behavior, source
title/publisher/date/type, captured context when present, source link,
freshness, open-correction state, report-source action, focus trap/return,
Escape, and distinguishable source-backed and subject-provided content.

- [ ] **Step 2: Implement a source-evidence model with claim-group association**

The gateway maps API sources into a canonical domain record before any
presentation mapping:

```ts
interface EvidenceRecord {
  access: "available" | "archived" | "paywalled" | "unavailable" | "unknown";
  archiveUrl?: string;
  capturedContext?: string;
  correctionStatus?: "open";
  freshness: Freshness;
  id: string;
  ingestedAt?: string;
  publisher?: string;
  publishedAt?: string;
  sourceUrl: string;
  sourceType: string;
  title?: string;
}
```

`buildEvidenceViewModel()` formats that record and associates it with the
existing claim evidence groups (`summary`, `place`, `issues`, `contact`) by
source ID. Do not claim that a source supports or disputes an individual
sentence unless the backend stores that relationship. Public
`correctionStatus: open` may be presented only as `Correction under review`; it
is not proof that the source is false. Raw flag counts/categories and
removed/suppressed moderation state never enter the public model; an
inaccessible source remains listed as unavailable with any lawful archive.
`EvidenceRecord` never represents subject content: subject-provided material is
rendered in a separate provenance block and is not converted into a source.

- [ ] **Step 3: Replace public pipeline diagnostics**

Remove public rendering of `lead-quality-signals.tsx` and
`data-quality-block.tsx`. Replace the user-relevant portions with `Evidence`,
`Last supported`, `Single source`, `Correction under review`,
`Subject provided`, or `No source linked` states. Do not show `Disputed`; the
current public contract does not support that claim. Leave operator-only
diagnostics untouched where they still have operator consumers, but remove every
public import.

- [ ] **Step 4: Make evidence one interaction away**

The named entity claim groups (`summary`, `place`, `issues`, `contact`), sourced
place facts, timeline items, events, and public activities use the shared
trigger and panel. Broader editorial prose links to its section source list; do
not imply sentence-level support when only entity-level sources exist. Opening
evidence never discards the current query or page position.

- [ ] **Step 5: Run evidence architecture and accessibility tests**

```bash
pnpm --filter @rebuildingamerica/atlas-app exec vitest run tests/unit/domains/catalog/components/evidence-panel.test.tsx tests/unit/domains/catalog/components/profile-evidence-accessibility.test.tsx
pnpm --filter @rebuildingamerica/atlas-app exec playwright test --config playwright.public-ux.config.ts --grep "evidence"
```

Mapper tests use generated DTO fixtures, view-model tests use domain fixtures
with no network, and component tests use view-model fixtures only.

**Gate:** Evidence is one interaction away for every named claim group and
explicitly sourced record, while section-level synthesis points to its source
list. The UI never invents claim-level support, review, or dispute semantics
absent from the data contract. Opening evidence performs one bounded request and
preserves route, scroll, and focus context.

## Workstream 9: Ship Dedicated Entity-Family Indexes

**Files:**

- Create: `app/src/domains/catalog/pages/profiles/index/entity-index-page.tsx`
- Create: `app/src/domains/catalog/pages/profiles/index/entity-index-config.ts`
- Create: `app/src/domains/catalog/components/profiles/entity-index-header.tsx`
- Create: `app/src/domains/catalog/components/profiles/entity-index-results.tsx`
- Modify: existing People and Organizations index routes
- Create: `app/src/routes/_public/profiles/initiatives/index.tsx`
- Create: `app/src/routes/_public/profiles/campaigns/index.tsx`
- Create: `app/src/routes/_public/profiles/events/index.tsx`
- Modify or retire: `profiles-overview-page.tsx` and showcase-only primitives
- Test: entity index route/component tests
- Test: `app/tests/acceptance/domains/public/public-discovery.spec.ts`

- [ ] **Step 1: Write a failing shared index contract**

Each family index must have:

- Distinct H1, description, title, canonical, and useful body content.
- Search within the entity family.
- Place and issue filters.
- List/grid choice only when both modes remain equally usable.
- Latest supported activity and source context.
- Empty, error, pagination, and long-name states.
- Canonical links to every record.

- [ ] **Step 2: Implement one shared read model and presentation with
      family-specific configuration**

Every index calls the same `searchEntities()` gateway operation with a fixed
entity-family filter. A pure index assembler owns family label, description,
route, icon/shape, valid sort options, and result view models. The page
presentation never receives raw collection DTOs. Do not add family-specific
endpoints or fork five near-identical page implementations.

- [ ] **Step 3: Preserve meaningful differences**

- People emphasize public work, place, issues, media/source forms, and
  relationships.
- Organizations include formal and informal groups without implying
  incorporation.
- Initiatives emphasize ongoing work, sponsors/participants, place, and issue.
- Campaigns emphasize goals, participants, timeframe, positions, and documented
  outcomes.
- Events emphasize date/status, place, organizer/participants, issue, and
  supporting source.

Do not create role-based index pages.

- [ ] **Step 4: Add internal transitions**

Every family index links to related places and issues. Detail pages link back to
the correct family index. Search engines and users must reach every important
detail through normal `<a href>` links, consistent with
[Google link guidance](https://developers.google.com/search/docs/crawling-indexing/links-crawlable).

- [ ] **Step 5: Verify all five index variants**

```bash
pnpm --filter @rebuildingamerica/atlas-app exec vitest run tests/unit/routes/_public/profiles tests/unit/domains/catalog/components/profiles.test.tsx
pnpm --filter @rebuildingamerica/atlas-app exec playwright test --config playwright.public-ux.config.ts --grep "entity index"
```

**Gate:** Five indexable family pages share one query/read-model/presentation
path, retain their meaningful anatomy, and expose no detail-only or operator
fields in collection payloads.

## Workstream 10: Rebuild Entity Detail Pages As Connected Public Records

**Files:**

- Modify:
  `app/src/domains/catalog/pages/profiles/detail/person-profile-page.tsx`
- Modify: `app/src/domains/catalog/pages/profiles/detail/org-profile-page.tsx`
- Replace:
  `app/src/domains/catalog/pages/profiles/detail/non-actor-profile-page.tsx`
- Refactor: active `app/src/domains/catalog/components/profiles/*`
- Modify: canonical entity mapper, entity application service, and
  `EntityPageViewModel`
- Test: existing profile redesign unit tests
- Test: `app/tests/acceptance/domains/public/profiles.spec.ts`
- Test: `app/tests/acceptance/domains/public/public-visual.spec.ts`

- [ ] **Step 1: Rewrite profile acceptance expectations before implementation**

Delete tests that bless lead labels or internal diagnostics. Require:

- Correct entity family and sourced role language.
- Identity, place, issues, source count/date, and trust state in the opening
  viewport.
- Contact, evidence, share, follow, claim, and correction actions near the
  relevant content.
- Subject-provided biography shown alongside documented summary.
- Work/activity, relationships, documented timeline, sources, and stewardship
  sections.
- Error states for failed relationship/affiliation reads that do not claim
  `none` or `0`.
- A contextual return to the originating Explore/index/landscape state.

The route loads one `CivicRecordDetail`, assembles `EntityPageViewModel`, and
renders an entity-specific presentation. Evidence and connections load through
bounded lazy sections. Presentation does not read TanStack Query state or the
generated entity schema.

- [ ] **Step 2: Rebuild the person template**

Never hard-code `Community organizer`. Derive contextual role/activity labels
only from supported fields; otherwise use the plain entity family `Person`. A
sparse person profile remains dignified and useful without invented biography.

- [ ] **Step 3: Rebuild the organization template**

Treat legal organization, publication, collective, and informal group status
accurately. Do not imply incorporation from the `organization` entity family.
Show public representatives and affiliations only when sourced.

- [ ] **Step 4: Replace the generic initiative/campaign/event detail**

Use a shared public-record shell but entity-specific anatomy. Event pages
receive valid Event JSON-LD only when visible date/location fields satisfy the
schema contract. Campaigns and initiatives show timeframe and relationships
without inventing outcomes.

- [ ] **Step 5: Keep subject voice additive**

When `custom_bio` exists, render it as `From <name>` or equivalent
subject-provided content and keep the documented description visible. Update the
API field description that currently says it overrides generated description;
the product contract is additive. The profile-management API may continue
storing the field, but public rendering must not silently replace sourced
synthesis.

- [ ] **Step 6: Improve onward transitions**

Relationship rows use sourced verbs and link to canonical objects. Place/issue
chips are links, not inert labels. Preserve browser Back state and focus from
the originating result.

- [ ] **Step 7: Verify all five archetypes**

```bash
pnpm --filter @rebuildingamerica/atlas-app exec vitest run tests/unit/domains/catalog/components/profile-redesign.test.tsx tests/unit/domains/catalog/components/profile-redesign-action-cluster.test.tsx tests/unit/domains/catalog/components/profile-redesign-connection-list.test.tsx tests/unit/domains/catalog/pages
pnpm --filter @rebuildingamerica/atlas-app exec playwright test --config playwright.public-ux.config.ts --grep "profile|initiative|campaign|event"
```

**Gate:** All five detail archetypes use canonical detail data, pure entity view
models, the shared evidence/relationship primitives, and entity-specific
presentation. Sparse records remain dignified; failed secondary reads never
masquerade as absence.

## Workstream 11: Make Places A First-Class Discovery System

**User outcome:** A visitor can begin with any supported city, county, metro,
neighborhood, borough, district, state, territory, or polity; understand its
civic context; and move naturally to local actors, issues, work, updates, and
evidence.

**Architecture:** `getPlace()` returns one canonical `PlaceRecord`. The route
also issues one entity query with the canonical place filter, one activity query
with the same filter, and the shared cached taxonomy query.
`buildPlacePageViewModel()` assembles the presentation. Do not retain manual
fetch state in `place-page-actors.tsx` or `place-page-latest.tsx`, and do not
call separate actor/latest/source endpoints when the three place-specific reads
plus shared taxonomy provide the same experience.

```ts
interface PlaceRecord {
  centroid?: { latitude: number; longitude: number };
  facts: PlaceFact[];
  key: string;
  kind: PlaceKind;
  name: string;
  parents: PlaceRef[];
  relatedPlaces: PlaceRelation[];
  slug: string;
  sourceRefs: SourceRef[];
}

interface PlaceFact {
  asOf?: string;
  metric: string;
  sourceIds: string[];
  unit?: string;
  value: boolean | number | string;
}
```

Facts retain raw values, units, dates, and source references. Every fact has at
least one source ID. The application layer maps controlled metrics to labels and
formats values for the locale; the API does not return presentation-ready prose
or accent colors.

- [ ] Build `/places` as a searchable, paginated national place index using
      `searchPlaces()`. It supports kind and parent/state filters, keyboard
      autocomplete, a map/list switch, explicit ambiguity, and alphabetical
      browsing without implying that listed places are the only places in
      America.
- [ ] Standardize all typed place routes on the same route container, place
      application service, and presentational template. Place kind changes
      labels and relevant sections, not the entire component tree.
- [ ] Compose the opening place view from name, kind, parent geography, locator
      map, current activity summary, actor count, issue count, source coverage,
      and last supported date.
- [ ] Present sections in this order: current activity; people and
      organizations; initiatives, campaigns, and events; issues; sourced public
      facts/institutions; documented timeline preview; related/parent places;
      sources and limitations.
- [ ] Derive people/work/issue groupings from the one entity result and its
      facets. Do not issue one request per entity family.
- [ ] Link every issue to its national issue page and, when the landscape
      threshold is met, to the place-issue landscape. Link every entity, event,
      source, parent, and related place to its canonical object.
- [ ] Give each sourced fact an evidence trigger. If a displayed fact lacks an
      accessible source reference, omit the fact rather than present it
      confidently.
- [ ] Preserve a sparse place page: identity, hierarchy, locator, available
      records, and plain absence states remain useful without invented context.
- [ ] Canonicalize generic and mistyped place URLs according to the route
      contract. Unknown slugs return a real 404, not an empty place page.

**Acceptance journeys:**

1. Search `Las Vegas`, choose the city rather than nearby/ambiguous
   alternatives, open its place page, then open housing work and evidence.
2. Browse a county, metro, neighborhood, borough, district, state, territory,
   and polity fixture through the shared template.
3. Move place -> actor -> evidence -> Back and return to the same place section
   and focus.
4. Move place -> issue -> landscape and broaden back to the place or national
   issue.
5. Load a sparse place, a place with a failed activity read, and a nonexistent
   place; each state is semantically different.

**Verification:** Mapper tests cover canonical values and provenance;
application tests inject a fake gateway and assert three place-specific reads
plus the shared taxonomy read; component tests use `PlacePageViewModel`;
Playwright covers typed routes, ambiguity, keyboard use, maps, source drawers,
sparse/error states, canonical redirects, screenshots, and no duplicate
hydration requests.

**Gate:** Places are no longer SEO or navigation orphans, every typed geography
uses one architecture, and the page requires no place-specific presentation
fields from the backend.

## Workstream 12: Ship Neutral, Useful Issue Pages

**User outcome:** A visitor can understand how Atlas defines an issue, discover
civic activity across viewpoints, see where it is documented, and move into
local landscapes without Atlas prescribing a political diagnosis.

**Architecture:** The shared issue taxonomy is the only canonical vocabulary.
`getIssue()`, one entity query by issue, and one activity query by issue compose
`IssuePageViewModel`; the map projection loads only when the map enters the
viewport or the visitor selects it. There is no issue-page endpoint and no
duplicated frontend taxonomy.

```ts
interface IssueRecord {
  aliases: string[];
  definition: string;
  domain: { name: string; slug: string };
  name: string;
  slug: string;
  updatedAt: string;
  version: string;
}
```

The definition is Atlas taxonomy content, not a sourced claim about current
conditions. The page labels it as the issue definition and links to
Methodology/version context; current conditions come only from sourced
entities/activity.

- [ ] Build `/issues` from the shared issue-area/domain records. Provide plain
      search, domain grouping, alphabetical access, and definitions. Do not rank
      issues by political desirability or current Atlas coverage.
- [ ] Build `/issues/:issueSlug` with: neutral definition and aliases;
      documented national activity; map/list of places; people and
      organizations; initiatives/campaigns/events; documented positions or
      approaches when explicitly sourced; recent updates; sources, methodology,
      and coverage limits.
- [ ] Use place facets from the canonical entity query to build the active-place
      list. Do not fetch every place page or perform client-side N+1 counting.
- [ ] Describe competing perspectives with precise sourced verbs and quotations
      within copyright limits. Never infer `supports`, `opposes`, ideology,
      religion, or partisan alignment from issue membership alone.
- [ ] Rank records by explicit relevance, source recency, and corroboration.
      Claimed status, institutional size, follower count, and viewpoint do not
      boost ranking.
- [ ] Treat user language as search vocabulary, not automatically as the
      canonical issue name. For example, `lack of religiosity` may resolve to a
      neutral field such as `Religion and public life` and remain as residual
      query text or a documented perspective; Atlas must not encode the premise
      that religiosity is inherently lacking or inherently desirable.
- [ ] Show an empty canonical issue page as a durable definition plus
      `No public activity listed.` Do not manufacture examples or coverage
      promises.
- [ ] Put a direct `How this issue is defined` link to Methodology beside the
      definition, not a long taxonomy lecture inside every page.

**Viewpoint-fairness fixtures:** For one contested issue, include sourced actors
with differing stated approaches, a non-progressive civic group, a faith-linked
public organization whose religious identity is explicit in its own public
material, an unaffiliated resident, and a source that reports on the issue
without making its subject an advocate. Tests must prove that all remain
discoverable and accurately labeled.

**Acceptance:** Search aliases resolve to the canonical neutral issue; issue
membership alone never produces role or position copy; both documented
perspectives appear under the same relevance rules; place links open landscapes
only when their records meet the threshold; data-empty and failed states differ;
long issue names wrap at 320px and 200 percent zoom.

**Gate:** Every issue page uses the shared taxonomy, contains no directional
ideological assumption, makes source support inspectable, and composes from the
same canonical entity/activity resources used elsewhere.

## Workstream 13: Build Place-Issue Landscapes And Documented Timelines

**User outcome:** `Homelessness in Las Vegas` is a coherent public record: what
is documented now, how the record developed over time, who is involved, what
work exists, where evidence comes from, what remains uncertain, and where to go
next.

**Architecture:** `application/landscape.ts` starts exactly four independent
reads in parallel: place, issue, entities filtered by both, and activity
filtered by both. It partitions the entity result into people, organizations,
initiatives, campaigns, and events and builds one serializable
`LandscapePageViewModel`. Do not add `/api/landscapes`, a page bundle, or
`server/landscape-loader.ts`.

### Timeline Model

```ts
interface TimelineItem {
  canonicalUrl?: string;
  date?: string;
  datePrecision: "day" | "month" | "year" | "unknown";
  entityLinks: LinkViewModel[];
  evidence: EvidenceSummaryViewModel;
  id: string;
  kind: "event" | "public-update" | "source-observation";
  placeLinks: LinkViewModel[];
  summary?: string;
  title: string;
}
```

- `event` is a canonical Atlas event entity.
- `public-update` is a normalized activity record with a documented occurrence
  date.
- `source-observation` means Atlas observed a source on a date but does not know
  when the described activity occurred.
- Sort by occurrence date when known, then observation date; items with neither
  sort last in stable title/ID order. Show date precision honestly.
- Deduplicate only by canonical event ID or a stable source/date/title identity.
  Similar wording is not enough.
- Never infer causality. `Followed by` is chronological; `led to`, `caused`,
  `responded to`, or `resulted in` requires an explicit sourced relationship.
- A thread is created only by a shared canonical initiative, campaign, event
  series, organization, or explicitly stored relationship. Do not use opaque
  semantic clustering to imply a storyline.
- With the test clock frozen, `Upcoming` means a known start after now,
  `Current` means now falls within a known start/end range, `Past` means a known
  occurrence/end before now, and undated items remain in `Date unknown` rather
  than being guessed into a segment.

### Page Anatomy

1. Place and issue context, coverage window, source count, and limitation state.
2. Sourced `At a glance` statements with evidence triggers. If no claim-level
   evidence exists, use factual counts instead of prose synthesis.
3. `Documented timeline` with Past, Current, and Upcoming segments when dates
   permit.
4. People and organizations, grouped by precise sourced relationship.
5. Initiatives, campaigns, services, and events.
6. Documented perspectives/positions when explicit.
7. Map/list context.
8. Sources, corrections, and coverage gaps.
9. Broaden to the place, national issue, or Explore.

- [ ] Consume the Workstream 5 cursor/date/entity/place/issue activity contract
      and prove landscape pagination without adding another loader or endpoint.
- [ ] Build landscape route, application service, pure timeline assembler,
      presentation, metadata, JSON-LD breadcrumbs, internal links, and
      threshold-aware indexing.
- [ ] Paginate the full documented sequence; the first page is not presented as
      complete. State
      `Documented from <earliest> to <latest> across <n> sources` when those
      facts are known.
- [ ] Preserve disagreements and corrections beside the affected record. Do not
      collapse contradictory sources into one confident synthesis.
- [ ] Use factual empty copy: `No dated activity listed.` The surrounding place
      and issue context remains available.

**Acceptance journeys:**

1. `homelessness in Las Vegas` -> landscape -> earlier timeline page -> event ->
   organization -> evidence -> Back with state preserved.
2. Switch among timeline, map, and people views without refetching shared
   canonical reads.
3. Inspect two documented perspectives without either receiving a warning/color
   hierarchy that implies Atlas endorsement.
4. Load a thin landscape and verify useful orientation plus `noindex,follow`;
   add the threshold fixtures and verify it becomes indexable.
5. Show unknown date, month precision, corrected source, duplicate observation,
   upcoming event, and partial activity failure accurately.

**Gate:** A landscape is an application-layer composition of four canonical
reads, every timeline item retains kind/date/evidence, and the UI calls the
sequence `documented` rather than complete or causal.

## Workstream 14: Turn Firehose Into Connected Public Updates

**User outcome:** Visitors can follow what has changed, filter by
place/issue/entity, pause live movement, open the people and work involved,
inspect the source, and return without losing their place.

**Architecture:** Keep firehose ingestion and transport internals in
`domains/firehose`, but normalize both snapshot and live messages into the same
`ActivityRecord`. `PublicActivityStream` owns WebSocket/SSE/poll fallback,
buffering, reconnect, and unsubscribe. `UpdatesPage` receives `UpdatesViewModel`
and callbacks only.

```ts
interface ActivityRecord {
  entityRefs: EntityRef[];
  id: string;
  issueSlugs: string[];
  kind: string;
  observedAt: string;
  occurredAt?: string;
  placeRefs: PlaceRef[];
  source: EvidenceRecord;
  summary?: string;
  title: string;
}
```

The record contains canonical refs and ISO dates, never JSX, formatted time,
chips, colors, or hrefs. Every public activity has an `EvidenceRecord`, whose
access may be available, archived, paywalled, unavailable, or unknown. A signal
with no public source identity is not published as activity.

- [ ] Make `/updates` canonical and keep `/firehose` as a state-preserving
      permanent redirect. Add canonical `/updates.rss`; redirect `/firehose.rss`
      while preserving supported filters.
- [ ] Consume and verify the Workstream 5 snapshot contract with `cursor`,
      `next_cursor`, optional `from`, `to`, entity, place, and issue filters.
      Keep the page size bounded at 50.
- [ ] Preserve compact, standard, and expanded density in a segmented control.
      Density changes presentation only and never changes data semantics.
- [ ] Make place, issue, entity, event, initiative, campaign, and source
      references real canonical links. Inert chips are prohibited.
- [ ] Buffer incoming records while the reader is away from the top. Announce
      the count without shifting content; `Show updates` inserts them and
      restores the reader predictably.
- [ ] Expose calm live, reconnecting, offline/polling, and paused states.
      Transport names and retry implementation do not appear in public copy.
- [ ] Preserve filter and cursor state in the URL. Back from a detail page
      returns to the same record, density, and scroll position.
- [ ] Reach the footer after the finite snapshot; live updates may not create an
      unreachable infinite document. Load older records only through an explicit
      `Load earlier` action.
- [ ] Keep events as canonical event detail links. Do not add update-detail
      pages until the activity model has durable public identity and enough
      content to justify them.

**Acceptance:** Snapshot-to-live deduplication, buffered insertion, offline
fallback, reconnection, paused mode, filters, cursor pagination, RSS output,
old-route redirects, footer reachability, keyboard use, evidence transition, and
mobile density all pass. The same normalized activity fixture renders
consistently on Home, Place, Issue, Landscape, and Updates.

**Gate:** There is one activity model and one live adapter across Atlas; no page
component knows whether a record came from SSR, WebSocket, SSE, or polling.

## Workstream 15: Complete Claiming, Contribution, Corrections, And Safety

**User outcome:** A person or organization can claim an autogenerated profile
through Atlas's ATProto-backed identity, add clearly attributed information, and
challenge errors. Any visitor can report incorrect, outdated, harmful, or
defamatory material without being able to overwrite the documented record.

### Stewardship Policy In The UI

- Atlas's sourced record remains the default documented account.
- A verified subject may directly manage subject-authored biography, image/logo,
  public contact preferences, social links, and a small set of attributed
  current-work links or statements.
- Subject content is published as `Provided by <name>` with ATProto
  identity/time provenance. It does not silently replace documented description,
  satisfy source-backed search facets, or change ranking.
- A verified subject proposes changes to sourced identity, place, issue,
  relationship, and source claims through the correction path. They do not
  directly delete or suppress public sources.
- Any visitor may submit a factual correction, source suggestion, identity
  concern, privacy/safety concern, or harmful/defamatory report. The report is a
  moderation input, not a public verdict.
- High-severity privacy, safety, and defamation reports receive the repository's
  rapid moderation path. Pending status may say `Under review`; Atlas does not
  publish the reporter's allegations.
- Claimed status establishes stewardship identity only. It is not a truth badge
  and does not affect discovery rank.

### Subject Contribution Contract

Extend the existing profile-management/detail contract rather than create a
public content service:

```ts
interface SubjectContribution {
  atprotoUri?: string;
  body?: string;
  createdAt: string;
  id: string;
  kind: "current-work" | "link" | "statement";
  title: string;
  url?: string;
  verifiedDid: string;
}
```

Store contributions in a normalized `subject_contributions` table keyed to
entity and verified DID. Permit at most 6 active items per entity; title is
1-120 characters, body at most 1,000 characters, URL at most 2,048 characters
and HTTPS, and `atprotoUri` must parse as an AT URI owned by the verified DID.
The server derives `verifiedDid` and timestamps rather than trusting client
values. Profile manage PATCH carries `expected_profile_version` and returns
`409` on conflicting edits. The public entity detail receives active
contributions as an additive field; no new read endpoint is needed.

**Implementation artifacts:**

- API schema and mapping:
  `api/atlas/domains/catalog/schemas/public_profiles.py`, `public_common.py`,
  `public_entities.py`, `api/atlas/platform/mcp/data.py`.
- API behavior: `api/atlas/domains/catalog/api/profiles.py`,
  `profile_claims.py`, existing claim helpers, and
  `api/atlas/domains/moderation/api.py`.
- Persistence: new catalog model plus matching PostgreSQL/SQLite schema parts
  and database migration for `subject_contributions`.
- App boundary: `public-stewardship-gateway.ts`, HTTP implementation,
  stewardship controller, family-qualified claim/feedback/manage routes, and
  pure claim/manage/feedback presentations.
- Tests: existing profile claim/manage/ATProto suites, moderation API suite, new
  contribution mapper/model/API tests, route/controller/component tests, and
  public acceptance journeys.

- [ ] Consolidate the active `-claim-*` implementation and remove the unused
      claim page family after import verification.
- [ ] Make ATProto the primary claim path while retaining only currently
      supported recovery/organization proof methods that remain product
      requirements.
- [ ] Rebuild `/claim/:entityFamily/:slug` around identity, what stewardship
      changes, what it does not change, verification state, recovery, and
      privacy. Preserve focus and route context through external identity
      return.
- [ ] Split verified management into `Your information` and `Documented record`.
      Direct edits exist only in the first; the second launches a correction
      with the challenged claim/source preselected.
- [ ] Remove direct `suppressed_source_ids` control from profile management.
      Convert source challenges into source flags/correction requests and show
      their status without exposing moderation internals.
- [ ] Migrate existing suppressed-source selections into
      `subject_requested_restriction` review items and preserve their current
      visibility restriction until moderation resolves them; do not suddenly
      republish previously suppressed material during migration.
- [ ] Add bounded subject contributions to the existing manage/detail schema and
      render them as attributed additions beside documented content.
- [ ] Rebuild `/feedback/:entityFamily/:slug` with factual error, outdated,
      wrong person/organization, source concern, privacy/safety,
      harmful/defamatory, and suggest-a-source paths. Fix return links for all
      five entity families. Move claimed editing to
      `/manage/:entityFamily/:slug` with the same stable identity.
- [ ] Put Claim, Correct, Suggest a source, and Report harmful content in
      consistent relevant locations without turning the profile into an action
      toolbar.

**Acceptance journeys:** anonymous correction; anonymous harmful-content report;
idempotent repeat; anonymous-write rate limit; source suggestion; signed-in
ATProto claim; failed/cancelled claim; verified direct subject edit; version
conflict; attributed contribution; invalid/over-limit contribution; proposed
sourced-record correction; open correction status; and all five entity-family
return paths.

**Gate:** Subjects have a meaningful voice without erasing sourced records,
other users can challenge harm without rewriting pages, direct source
suppression is gone, and every public provenance state is visually and
semantically distinct.

## Workstream 16: Align Secondary Public Surfaces

**User outcome:** Mission, methodology, pricing, public directories, policies,
and failure states feel like the same Atlas and answer the trust questions
created by the core experience.

- [ ] Build `/about` around Atlas, its public purpose, Rebuilding America
      Project, broad eligibility for civic actors, and the distinction between
      public Atlas and later professional tools. Do not mention Groundwork.
- [ ] Build `/methodology` with: inclusion criteria; sources; autogenerated
      records; documented activities; issue naming and viewpoint neutrality;
      place modeling; synthesis limits; timelines; subject-provided content;
      claiming; corrections; freshness; and known coverage limits. This is where
      system behavior is explained; empty/loading/error UI remains plain.
- [ ] Build `/safety` with the public-record privacy standard, correction
      categories, harmful/defamatory escalation, provisional restriction policy,
      response expectations, appeals, and contact route. Keep technical platform
      security on `/security`.
- [ ] Align Pricing and discount access to the visual system, keep them out of
      primary navigation, and distinguish what public discovery remains
      available without payment.
- [ ] Rebuild public directories as reader-facing civic directories. Remove
      `Commons exchange`, federation status, ingestion policy, confidence gates,
      private-note assurances, and operator vocabulary from public presentation.
- [ ] Align Privacy, Terms, Security, 404, root error, and request-discount
      pages to the shared shell, typography, forms, state primitives, and copy
      standard.
- [ ] Keep Docs and API in secondary navigation and preserve their existing
      product boundaries.
- [ ] Audit every public string for self-referential pipeline copy, lead/scoring
      vocabulary, unsupported coverage claims, generic SaaS language,
      Groundwork, hard-coded roles, and invented certainty.

**Acceptance:** Every secondary route has one H1, accurate
title/description/canonical policy, reachable footer, correct main landmark, no
nested control, and mobile/dark/zoom coverage. Public directory data failure
differs from an empty directory. About and Methodology answer who runs Atlas,
who may be included, how issues are determined, how claims are sourced, and how
a person can correct harm.

**Gate:** A visitor never has to enter Docs or a workspace to understand Atlas's
mission, inclusion, evidence, taxonomy, stewardship, pricing boundary, or safety
process.

## Workstream 17: Final SEO, Architecture, Accessibility, And Release Verification

This is not a cleanup pass. It is the proof that the design, architecture, data
surface, and complete public journeys meet the plan.

### Automated Gates

- [ ] Run API format, lint, mypy, and the full API suite with the dev extra.
- [ ] Regenerate OpenAPI and the app client, run contract tests, and verify no
      unexpected public operation or field entered the presentation dependency
      graph.
- [ ] Run app format, lint, typecheck, full Vitest suite with required coverage,
      production build, and bundle-budget check.
- [ ] Run mapper tests proving generated DTO -> canonical domain conversion for
      missing, unknown, stale, flagged, subject-provided, and sparse fields.
- [ ] Run application tests with an injected fake gateway and assert the exact
      logical read set in the Page Orchestration Budget.
- [ ] Run ESLint import-boundary rules: routes may import application/loaders
      and views; presentational pages/components may import view
      models/primitives only; only transport adapters import generated clients.
- [ ] Run full Chromium public journeys at mobile and desktop, then
      Firefox/WebKit critical-path smoke.
- [ ] Run axe for every page archetype using WCAG A/AA tags and document any
      tool limitation; zero unwaived violations is the release requirement.
- [ ] Run stable visual comparisons at the defined widths/themes and targeted
      reduced-motion, forced-colors, 200 percent zoom, long-text, empty, error,
      dialog, menu, map-detail, evidence, and footer states.
- [ ] Run Lighthouse CI three times for Home, Explore list, one entity, and one
      substantive landscape; use the median. Accessibility, SEO, and Best
      Practices must score 100 and Performance at least 90. LCP must be at most
      2.5s and CLS at most 0.1 in the deterministic lab profile.
- [ ] Validate every canonical route as SSR HTML with H1, title, nonempty
      description, canonical, Open Graph, robots policy, JSON-LD where
      applicable, crawlable internal links, and no hydration warning.
- [ ] Validate redirects and parameter preservation for Browse, Map, Firehose,
      Firehose RSS, Profiles, generic place, and incorrect typed place paths.
- [ ] Validate the sitemap against the indexing thresholds and ensure no claim,
      feedback, query, cursor, auth, workspace, operator, or thin-landscape URL
      appears.

### Request And Payload Gates

- [ ] Hydrated opening views make zero duplicate API requests.
- [ ] Every route stays within its logical opening-read budget.
- [ ] Entity lists return compact summaries and exclude contact, claim
      internals, profile answers, actor-quality data, flags, and source bodies.
- [ ] List-only Explore does not load map points; map-only Explore does not load
      a full result page until intent.
- [ ] Evidence and connections do not load per row or before
      interaction/viewport intent.
- [ ] Search and place autocomplete cancel superseded requests.
- [ ] Entity summary, activity, and map-point payloads meet the per-item budgets
      and the entity collection achieves the required baseline reduction.
- [ ] Home's MapLibre chunk remains isolated from primary SSR/LCP and map
      failure leaves search/list useful.
- [ ] The existing repository bundle budget passes, no public route's initial
      JavaScript grows more than 10 percent over its recorded baseline without
      replacing equivalent capability, and no second UI/map/query library
      duplicates the chosen stack.

### Manual Product Review

Review at original resolution on real desktop and mobile browsers. For each
critical journey, check visual hierarchy, spacing, content fit, focus, touch
targets, scroll restoration, perceived speed, map framing, evidence context, and
whether the next action is obvious without helper copy.

Required journeys:

1. Home -> `homelessness in Las Vegas` -> Landscape -> Timeline -> Person ->
   Evidence -> Contact/Share.
2. Home -> `transit YouTubers` -> interpreted filters -> Creator ->
   Subject-provided statement -> source evidence.
3. Explore place ambiguity -> choose county -> Map -> Result -> Back with exact
   state.
4. Issue -> differing documented perspectives -> Place -> Landscape -> broaden
   to national issue.
5. Updates live buffer -> filter -> Event -> source -> Back to exact update.
6. Anonymous person -> correction/harm report.
7. Profile subject -> ATProto claim -> direct subject edit -> proposed sourced
   correction.
8. Search engine entry -> sparse profile/place/issue -> meaningful onward path.
9. Keyboard-only desktop/tablet navigation, search, filters, map-list, evidence,
   dialog, and claim flow.
10. Touch-only mobile menu, search sheet, filters, map detail, evidence sheet,
    correction, and Back flow.
11. Offline or failed secondary data on Home, Explore, Entity, Place, Issue,
    Landscape, and Updates.

### Verification Report

Complete `docs/reports/public-atlas-ux-verification.md` with:

- Final IA and route table.
- Architecture diagram and dependency-boundary evidence.
- Public API operations added or changed, with payload before/after
  measurements.
- Request-count table for every archetype.
- Accessibility, browser, performance, SEO, and test results.
- Before/after contact sheets at the required viewports.
- Canvas-pixel proof for real map rendering in light and dark modes.
- Copy/trust audit results.
- Known residual risks, each with severity, owner, and launch disposition.
- Post-deployment RUM plan for 75th-percentile LCP, INP, and CLS. Field metrics
  are not claimed complete at handoff; monitor them after sufficient real
  traffic and treat regressions as launch follow-up work.

### Release Decision

Severity definitions: severity 1 exposes harmful/private/defamatory data
incorrectly, misidentifies a real person, loses correction/claim input, or makes
a critical route unusable; severity 2 blocks a primary
discovery/evidence/stewardship journey for a supported viewport/input method or
presents failure as factual absence; severity 3 is a nonblocking polish or
secondary-route defect.

The pass is ready only when:

- There are no open severity-1 or severity-2 user-experience defects.
- All canonical routes and critical journeys pass.
- Automated accessibility has zero unwaived A/AA violations and manual
  keyboard/zoom/forced-color checks pass.
- Visual diffs are intentionally approved and contain no overflow, overlap,
  clipping, blank map, or incoherent state.
- Architecture boundary, request, payload, build, and Lighthouse budgets pass.
- Every visible factual claim is sourced at the level the data contract actually
  supports, and subject-provided material is attributed.
- Groundwork, lead scoring, public operator diagnostics, unsupported roles, and
  false coverage claims are absent.
- The app is running locally after implementation and the verification report
  gives the exact URL and commands needed to reproduce the evidence.
