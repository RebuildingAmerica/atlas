# Atlas Discovery Platform: Redesign Toward a Civic Knowledge Graph

**Date:** 2026-06-23
**Status:** Proposed
**Scope:** The autonomous civic-actor discovery pipeline (`scout/`, `libs/discovery-engine/`, `api/atlas/domains/discovery/`, and the catalog data model in `api/atlas/models/schema.sql`).

> This document defines where the discovery pipeline is today, why its current shape cannot become a reliable national-scale service, and the architecture that gets us there. It is grounded in a full subsystem audit; file:line references point at the specific code that motivates each claim. It is a direction, not a final implementation plan — the Phase 0/1 implementation plan is a separate follow-up.

> [!IMPORTANT]
> **This redesign serves one thing: the end-user experience** (Atlas's [first principle](../experience-first.md)). Every change below is justified only by what it lets a user *see, trust, or do* — see **§3 · Experience accountability** for the change → user-outcome mapping. Anything not traceable there is out of scope.

---

## 1. Context

Atlas finds people, organizations, and initiatives working on social issues across America, traces each to public sources, and presents them as a searchable, source-linked directory. The discovery pipeline is the engine that populates it.

Today that engine exists in two divergent forms:

- **Scout** (`scout/src/atlas_scout/`) — a concurrency-native CLI runner with web search, crawling, LLM extraction, dedup, ranking, gap analysis, and an LLM-driven "iterative deepening" loop (follow-up queries, entity-chasing, browser research). This is the strong path, and it is operator-driven.
- **The API job worker** (`api/atlas/domains/discovery/`) — a durable, lease-claimed worker that runs the *same shared engine* (`libs/discovery-engine/`) for scheduled/autonomous runs. This is the path meant to cover America continuously.

The honest verdict: **this is a clever single-city demo wearing the costume of a service.** Three of its gaps are structural, not "needs hardening," and the autonomous path is the weakest variant of the two.

This redesign was reviewed against three independent design lenses (knowledge-graph-first, coverage-engine-first, reliable-platform-first). They converge on one system, described in §4.

### Decisions locked for this initiative

1. **Sequencing:** Stop-the-bleeding and lay the spine first (Phase 0 + Phase 1 below) before expanding recall. The live system currently publishes unverified named-person data and duplicates it on every re-run; that is the first thing to fix.
2. **Trust posture:** **Hybrid publication gate.** Registry-backed organizations (EIN/990-corroborated) may auto-publish; **individual people always route through a review queue**; uncorroborated web-only claims are held below the high-trust display threshold.
3. **Migration style:** Additive / strangler. The schema is already idempotent-additive (`schema.sql` uses `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`); new tables sit alongside `entries` and are populated by the same persist path that today drops data.

---

## 2. Diagnosis: why the current shape can't scale

### 2.1 The three structural failures

**A. The production path is the weakest path.**
Every recall multiplier — link-following, iterative deepening, follow-up queries, entity-chasing, browser research — lives *only* in the Scout CLI (`scout/src/atlas_scout/pipeline.py:609-780`). The autonomous runner (`api/atlas/domains/discovery/pipeline/runner.py`) is a flat `generate → Brave → fetch → extract` loop. It is capped at the **first 5 Brave results per query** (API hardcodes `count=5`), and the production `_search_brave` (`api/atlas/domains/discovery/pipeline/source_fetcher.py:130`) has **no try/except**, so a single 429 raises into the runner's broad `except → fail` and zeroes out an entire city's run. Recall in the path meant to scale is all-or-nothing and shallow.

**B. We publish unverified facts about real, named people.**
`validate_entries` (`scout/src/atlas_scout/steps/validate.py`, `libs/discovery-engine/.../extraction.py:344-390`) only checks that a name's tokens appear *somewhere* on the source page. Every structured attribute — `email`, `website`, `city`, `state`, `affiliated_org`, `issue_areas` — passes through **completely unchecked**. Discovery writes entries with `active=TRUE, verified=FALSE` (`schema.sql:20-21`) and the public search filters on `active=TRUE` only (`api/atlas/domains/catalog/models/entry.py`), with **no review gate** between an LLM's guess and a public, named profile. A wrong email/website on a real person is a misattribution and potential defamation vector — this is the most dangerous failure, not the most academic.

**C. We extract the crown jewels and discard them.**
The extraction prompt instructs the model to emit typed relationships — `founder, board_member, funder, coalition_member, staff, partner, ally` (`libs/discovery-engine/.../extraction.py:159-163`) — and `RawEntry.mentioned_entities` carries them (`libs/shared/.../schemas.py:71-74`). Then `_upsert_entry` (`runner.py:318-362`) **drops every edge.** The only stored relationship is a single self-FK `affiliated_org_id` (`schema.sql:19`), which the autonomous pipeline never even sets. The "connections" feature (`api/atlas/domains/catalog/models/connections.py`) fakes the entire graph at read time from four crude SQL heuristics with `LIMIT 10` and no `ORDER BY`. The product's stated reason to exist — "trace connections between civic actors" — has no persistent substrate.

### 2.2 The operational floor

- **Non-atomic job claim.** `claim_next` does a `SELECT` then a separate `UPDATE` with no `FOR UPDATE SKIP LOCKED` / no conditional-update rowcount guard / no `RETURNING` (`api/atlas/domains/discovery/models.py:686-727`). Running two instances or doing a rolling deploy **double-claims jobs and double-spends** on search + LLM. The whole "durable" story is silently coupled to a single-instance constraint documented nowhere.
- **Zombie jobs.** The worker flips a job to `running` *before* the long pipeline, but `claim_next` only reclaims `queued` or expired `claimed` — never `running`. Any crash/OOM/deploy mid-run **strands the job forever** with no reaper.
- **No cost ceiling at all.** A grep for `cost|budget|rate_limit|circuit|throttle` across the discovery path returns only stub doc-comments. A fat schedule list or retry storm maps directly to **unbounded API spend with no kill switch.**
- **Single un-abstracted search vendor.** Brave's endpoint is inlined in ~4 files with no `SearchProvider` interface and no fallback. An outage/quota/ToS change takes **100% of discovery offline.**
- **No cross-run entity resolution.** The streaming dedup (`libs/discovery-engine/.../dedup.py:99-126`) only dedupes within the current run's in-memory list and never loads the existing catalog; identity is `difflib.SequenceMatcher` on names (blind to `Bob`≠`Robert`, `St. Louis`≠`Saint Louis`). **Re-running a city mints duplicates** of people already in the DB. The computed `DeduplicationFlag` stream is never consumed.
- **No observability.** Log lines plus a `/summary` endpoint that counts via `len(list_by_status(...))` capped at 50, so queued/running/failed **silently undercount**. No metrics, tracing, error tracking, or alerting.
- **No geography substrate.** Nothing enumerates US places; "national coverage" requires hand-POSTing thousands of `discovery_schedules` rows. `LOCAL_CONTEXT` (`api/atlas/domains/discovery/pipeline/local_context.py`) contains exactly **one** city.

### 2.3 The one-line summary

> Atlas is a **directory of strings** pretending to be a knowledge graph, fed by a **single keyword-search vendor**, run by a **single-instance in-process loop**, publishing **unverified claims about real people** with no gate.

Each clause is a thing to invert.

---

## 3. North star

The boldest, highest-leverage move — and the one all three design lenses arrived at independently — is to **invert the substrate**:

> **Stop minting rows from web pages. Resolve evidence into a persistent, typed, evidence-backed graph of the civic ecosystem — anchored by authoritative public registries, with web extraction demoted to one corroborating source among many.**

This single inversion fixes our three hardest problems together:

- **Recall** — find the unsearchable grassroots organizer *through the org they run, the grant they receive, the board they sit on* — not by hoping they rank in Brave's top 5.
- **Identity** — entities resolve on stable keys (EIN, FEC ID, normalized domain, social handle, Wikidata QID), not fuzzy name+city strings.
- **Trust** — every attribute and edge carries per-source provenance and confidence; "source-linked" finally means a *claim* is sourced, not merely that a name appeared.

### Success metrics

| Metric | Definition | Today |
|---|---|---|
| **Entity recall** | Fraction of real civic actors present for sampled (county × issue), vs. an authoritative roster (e.g., IRS BMF for that county/NTEE) | ~0, unmeasurable |
| **Edge precision** | Precision on a labeled sample of known funder→grantee / board / coalition edges | 0 (no edges stored) |
| **Coverage saturation** | Population-weighted % of (US place × issue) cells with ≥N corroborated, non-stale actors | Uncomputable (no geography, no coverage state) |
| **Duplicate rate on re-run** | New duplicate entities created when re-discovering a covered place | High (no cross-run resolution) |
| **Publication safety** | % of published records that cleared the trust gate with traceable corroboration | 0 (no gate) |
| **Operational** | p99 per-target cost under enforced budget; stuck/over-budget pages an operator < 5 min | No budget, no alerting |

### Experience accountability — what each layer gives the end user

This redesign is backend-heavy, which is exactly why every part of it must trace to a concrete end-user outcome (see [Experience First](../experience-first.md)). Each architectural change below earns its place only through the column on the right. **If any item in this redesign cannot be traced to a row in this table, it is out of scope.**

| Architectural change | What the end user gets |
|---|---|
| Knowledge graph + persisted edges | A profile shows *how this person connects* — their org, funders, coalitions, board — instead of a dead-end card. "Show me who's connected to this organizer" finally works. |
| Identifier-anchored resolution (no duplicates) | One trustworthy profile per real person, not three conflicting partial copies. Search results stop being littered with dupes. |
| Per-claim provenance + trust gate (hybrid) | Every fact on a profile shows where it came from and how confident we are; a wrong email or affiliation never ships about a real, named person. The directory becomes trustworthy enough to act on. |
| Structured authoritative sources (990s / FEC / Census) | The grassroots organizer with no website still appears — found through the org they run or the grant they received. Coverage people can feel, especially in rural and immigrant communities. |
| Signal-based scoring + LLM judge | Search surfaces genuinely relevant, active civic actors first, not whoever is best-SEO'd. |
| Coverage engine | "Who's working on housing in my city?" returns real, non-stale results everywhere — not just in the handful of cities someone hand-scheduled. |
| Reliability chassis (atomic claim, reaper, cost kill-switch, observability) | The directory stays fresh and available and doesn't silently go stale or blow up — invisible when it works, devastating to the experience when it doesn't. |

---

## 4. Target architecture

Four layers on a reliable chassis. Structured registries and web extraction both emit **one canonical artifact** (claims + edges + provenance), which converges in a single resolution layer before anything reaches the graph or the public directory.

```
┌─────────────────────────────────────────────────────────────────────┐
│  COVERAGE ENGINE  (the brain — "what to discover next")              │
│  places × issues × source-types → coverage_cells → priority frontier │
│  → saturation detection → continuous re-discovery on a freshness SLA │
└───────────────────────────────┬─────────────────────────────────────┘
                                 │ drives targets
┌───────────────────────────────▼─────────────────────────────────────┐
│  SOURCE PORTFOLIO  (cast a wide, smart net)                          │
│  Structured: IRS BMF + 990s (ProPublica) · FEC · Census/TIGER ·      │
│    Wikidata · Candid / USAspending                                   │
│  Web: multi-vendor search (provider interface + fallback) + crawl +  │
│    browser research                                                  │
│  News / social: GDELT or news API, social-native ingestion           │
└───────────────────────────────┬─────────────────────────────────────┘
                                 │ emit ONE canonical artifact: claims + edges + provenance
┌───────────────────────────────▼─────────────────────────────────────┐
│  RESOLUTION & EVIDENCE LAYER  (identity + trust)                     │
│  identifier-first entity resolution · per-claim provenance ·         │
│  corroboration scoring · dedup-flag review · TRUST GATE (hybrid)     │
└───────────────────────────────┬─────────────────────────────────────┘
                                 │ promotes
┌───────────────────────────────▼─────────────────────────────────────┐
│  KNOWLEDGE GRAPH  (system of record)                                 │
│  entities + typed edges + signals + places + identifiers + claims    │
└──────────────────────────────────────────────────────────────────────┘

  Chassis under all of it: durable step-typed workflow · atomic claim ·
  orphan reaper · cost ledger + kill switch · observability · golden-set eval
```

- **Coverage Engine** decides *what* to discover and *when to re-check*, replacing hand-typed schedules.
- **Source Portfolio** breaks the single-vendor dependency and reaches the long tail through authoritative registries, not just web ranking.
- **Resolution & Evidence Layer** is where identity is established and trust is enforced — the gate that protects the public directory.
- **Knowledge Graph** is the system of record: entities, the typed edges we already extract, signals over time, and per-claim provenance.

---

## 5. Data model redesign

The flat `entries` table — five fundamentally different concepts (`person`, `organization`, `initiative`, `campaign`, `event`) in one identical column set distinguished only by a `type` enum (`schema.sql:5-34`) — is the root constraint. The redesign is **additive**: new tables sit alongside `entries`, and `entries` becomes a (eventually generated) projection of the graph for the existing read paths during migration.

### 5.1 Entity core + per-kind attributes

```sql
-- Polymorphic identity row; replaces the flat entries catch-all over time.
CREATE TABLE entities (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL CHECK (kind IN ('person','organization','funder','event','coalition','initiative','campaign')),
    canonical_name TEXT NOT NULL,
    place_id      TEXT REFERENCES places(id),
    status        TEXT NOT NULL DEFAULT 'active',
    confidence    REAL NOT NULL DEFAULT 0.0,
    score         REAL,                  -- persisted relevance score (today computed then dropped)
    created_at    TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL
);

-- First-class organizations: the attributes that distinguish a 3-person mutual-aid
-- group from a $50M nonprofit from a corporate PAC — today all identical rows.
CREATE TABLE org_attrs (
    entity_id     TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
    ein           TEXT,                  -- IRS EIN (identity + legitimacy)
    org_subtype   TEXT,                  -- 501c3 / 501c4 / LLC / gov_agency / coalition / fiscal_sponsor
    ntee_code     TEXT,                  -- maps to issue areas
    founding_date DATE,
    annual_revenue NUMERIC,
    staff_size_band TEXT,
    parent_org_id TEXT REFERENCES entities(id)
);
-- Analogous person_attrs, funder_attrs, event_attrs (start/end, organizer, venue).
```

> Note: EIN/990 lookup logic already exists in the codebase (`api/atlas/domains/access/.../irs_lookup.py`) but only to vet a *signing-up account* — it is never attached to a catalog org. The redesign wires the same capability into discovery.

### 5.2 The edges we already extract and discard

```sql
CREATE TABLE edges (
    id                 TEXT PRIMARY KEY,
    src_entity_id      TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    dst_entity_id      TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    edge_type          TEXT NOT NULL,    -- founder | board_member | staff | officer | funds |
                                         -- coalition_member | fiscal_sponsor | parent_org | partner | ally
    asserted_by_source_id TEXT REFERENCES sources(id),
    confidence         REAL NOT NULL DEFAULT 0.0,
    valid_from         DATE,
    valid_to           DATE,
    created_at         TIMESTAMPTZ NOT NULL
);
```

- Persist `mentioned_entities` as edges in the **same transaction** as the entity upsert; resolve the named counterpart to an `entity_id`, else store the raw name with `pending_resolution` and let a resolver job link it later.
- `funds` edges (funder→grantee, with amount/year/program) come straight from **990 Schedule I** — money flow, currently unrepresentable.
- Derived edges (`co_mentioned`, `shared_place`, `shared_issue`) are **materialized nightly** with strength scores, replacing the per-request heuristics in `connections.py`.

### 5.3 Identity backbone

```sql
CREATE TABLE entity_identifiers (
    entity_id  TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    scheme     TEXT NOT NULL,            -- ein | fec_id | wikidata_qid | normalized_domain | email | social_handle | ror_id
    value      TEXT NOT NULL,
    source_id  TEXT REFERENCES sources(id),
    confidence REAL NOT NULL DEFAULT 1.0,
    PRIMARY KEY (entity_id, scheme, value),
    UNIQUE (scheme, value)               -- for authoritative schemes; the resolution backbone
);
```

Resolution-on-write matches on strong identifiers **first** (EIN, FEC ID, Wikidata QID, normalized domain, social handle), falls back to normalized-name + `place_id` + fuzzy blocking only when no identifier exists, and **emits a review-queue candidate on ambiguity** instead of silently merging or duplicating.

### 5.4 Canonical places (geography backbone)

```sql
CREATE TABLE places (
    id          TEXT PRIMARY KEY,        -- keyed to Census/FIPS
    name        TEXT NOT NULL,
    county_fips TEXT,
    state       TEXT NOT NULL,
    cbsa_code   TEXT,                    -- metro
    place_type  TEXT NOT NULL CHECK (place_type IN ('city','county','cbsa','state')),
    population  INTEGER,
    urban_rural TEXT,
    lat         REAL,
    lng         REAL
);
```

`entities.place_id` (and, during migration, `entries.place_id`) reference this, so geography stops being free-text that fragments (`San José`/`San Jose`/`San Jose, CA`) and we gain a denominator for coverage. The existing `place_profiles.py` ACS-provenanced dict (currently one city) is the schema sketch for the demographic/economic context blocks.

### 5.5 Per-claim provenance

```sql
CREATE TABLE claims (
    id            TEXT PRIMARY KEY,
    entity_id     TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    attribute     TEXT NOT NULL,         -- website | email | city | revenue | ntee | ...
    value         TEXT NOT NULL,
    source_id     TEXT NOT NULL REFERENCES sources(id),
    asserter_kind TEXT NOT NULL CHECK (asserter_kind IN ('self','third_party','registry')),
    confidence    REAL NOT NULL,
    extraction_model_version TEXT,
    asserted_at   TIMESTAMPTZ NOT NULL
);
```

A node's displayed attribute is the **highest-confidence corroborated claim**, not last-writer-wins (fixing the unconditional `description`/`region` clobber at `runner.py:355-356`). Conflicting claims are stored side-by-side. Registry assertions (EIN→tax status from BMF, board seat from a 990) carry the highest weight; a single uncorroborated web LLM claim is the lowest and is publishable only as "single-source unverified."

### 5.6 Signals (observations over time)

```sql
CREATE TABLE signals (
    id          TEXT PRIMARY KEY,
    entity_id   TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL,           -- news_mention | award | testimony | endorsement |
                                         -- board_appointment | grant_award | 990_financials | coalition_roster
    source_id   TEXT REFERENCES sources(id),
    observed_at DATE NOT NULL,           -- when the thing HAPPENED, not when Atlas saw a page
    payload     JSONB
);
```

Today the only temporal fields are `first_seen`/`last_seen`, which record when *Atlas saw a mention*. Signals record when civic activity actually occurred — the basis for real recency and activity-based scoring.

### 5.7 Referential integrity cleanup (carried along)

Promote the free-TEXT identity columns to real tables with FKs: `users`, `organizations`, and a DB-backed `taxonomy` table with a real FK from `entry_issue_areas.issue_area` (today a bare TEXT slug with no constraint — a taxonomy rename silently orphans every tag). These are not new scope; they are integrity debt the new model must not inherit.

---

## 6. The information we are NOT capturing today

This section answers the explicit question: *what data, including data not about an individual person, are we ignoring?* All of it is either already extracted-and-dropped or available from authoritative sources.

| Class | What it is | Why it matters | Where it comes from |
|---|---|---|---|
| **Typed relationships** | founder / board / staff / funder / coalition / partner edges | The product's whole premise; also a recall multiplier (traverse to neighbors) | Already extracted (`extraction.py:159-163`), then dropped |
| **Money flow** | funder→grantee grants with amount/year | Highest-signal civic dimension; *follow the funder to find grantees* | 990 Schedule I, USAspending, Candid |
| **Organization attributes** | EIN, NTEE, subtype, revenue, size, founding, parent | Tells grassroots apart from incumbent apart from PAC; legitimacy signal | IRS BMF, 990s |
| **Signals over time** | news velocity, awards, testimony, endorsements, roster changes, 990s YoY | Real activity/recency, not "when we saw a page" | News API, 990s, FEC, web |
| **Coalitions / networks** | coalition entities + membership edges | "Who belongs to X / which coalitions is Y in" | Web + registry |
| **Events as data** | date, organizer, venue, participants | An event is currently shape-identical to a person | Web, Eventbrite/Meetup |
| **Places** | FIPS, population, county/metro hierarchy, demographics | A denominator for coverage; kills geo fragmentation; population weighting | Census/TIGER/ACS |
| **Coverage state** | (place × issue × source-type) saturation, yield, freshness | Makes "what's left" a computed number, not a wish | Internal, written by the persist path |
| **Per-claim provenance** | which source asserts which attribute, with confidence | "Source-linked" that backs claims, not just existence | Internal |
| **External identifiers** | EIN, FEC ID, Wikidata QID, domain, handles | Entity resolution backbone *and* recall seeds | Registries |

---

## 7. Finding good people reliably at scale

Two changes beyond the graph itself.

### 7.1 A source portfolio, not a single vendor

- Put Brave behind a `SearchProvider` interface with a fallback (SerpAPI / Bing / SearXNG) + circuit breaker + pagination beyond the first page.
- Add **structured ingesters** that fill the graph directly, each running as its own durable job and emitting the same canonical artifact:
  - **IRS Exempt-Org BMF** — every registered 501(c) per county with EIN + NTEE + revenue; a near-complete org universe no keyword search can match, plus the canonical EIN identity key.
  - **ProPublica Nonprofit Explorer (990s)** — officers (→ board/officer edges), financials, Schedule I grants (→ `funds` edges).
  - **FEC** — committees/PACs/candidates with stable IDs and dated contribution signals.
  - **Wikidata** — official websites, handles, board/founder relationships, stable QIDs for resolution.
  - **Census/TIGER + ACS** — the places backbone and population weights.
- Add multilingual query vocabulary and news/social-native ingestion to reach immigrant-serving, rural, and thin-web-presence actors that English-keyword web search structurally misses.
- **Bring the autonomous path to parity** with Scout's deepening/chasing, or make an explicit decision that Scout is the real ingestion path and bound the API runner's weakness.

### 7.2 Score on real signals, not word count

Today's score (`libs/discovery-engine/.../scoring.py:16-22`) is ~68% source-count plus contact-surface, with `description_quality = word_count / 25`. It structurally ranks **down** the obscure local organizer Atlas exists to surface, and the contribution gate (0.7) then prunes exactly those actors. Replace it with:

- independent-source-**domain** count (not raw mentions — a press release syndicated 5× is one source),
- registry presence (BMF/FEC) as a legitimacy signal,
- relationship density in the graph,
- recency of **real activity** (from `signals`, not page-fetch dates),
- an **LLM-as-judge** relevance/legitimacy pass (we already have the model in hand during deepening; we just never use it to adjudicate quality).

Persist the score on `entities` so the directory can rank/threshold without recomputation.

---

## 8. Production readiness (the chassis)

In priority order — this is Phase 0.

- **Atomic claim:** `UPDATE discovery_jobs SET status='claimed', claimed_by=?, claimed_until=? WHERE id = (SELECT id FROM discovery_jobs WHERE status='queued' OR (status='claimed' AND claimed_until < ?) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`. Add an `idempotency_key UNIQUE` column. Safe horizontal scaling and rolling deploys.
- **Self-healing:** orphan reaper that requeues jobs stuck in `running` past a deadline; periodic lease renewal during long steps; switch lease comparison off ISO-string compare (`models.py:698`) to a real `TIMESTAMPTZ`; exponential backoff + jitter via `next_attempt_at`; a **dead-letter** status + failure taxonomy (transient/permanent/poison); wire the dead `cancelled` status to a real cancel path.
- **Cost governance:** meter every search + LLM call into a `cost_ledger` (run/cycle/global); enforce per-run token + call ceilings and a global daily cap with an **automatic kill switch**.
- **Async durable `/scheduled`:** convert `api.py:314-379` from synchronous fan-out to enqueue-only (return 202) with per-target idempotency keys and per-target timeouts.
- **Observability:** OpenTelemetry traces over a target's step graph; metrics (queue depth, claim latency, step success/failure, lease expiries, zombie-running count, per-run cost); Sentry; alerting. Fix `/summary` to use SQL `COUNT` aggregates instead of `len(list_by_status(...))` capped at 50.
- **Golden-set eval:** a curated labeled ground-truth set run nightly, computing precision/recall/dedup-rate over time so regressions **page** instead of silently shipping.

---

## 9. Trust & publication model (the decision)

**Hybrid gate.** Introduce a `review_queue` staging table between discovery and `entries`. Discovery no longer writes `active=TRUE` rows directly.

```
discovered record ──► resolution & corroboration ──► review_queue
                                                         │
        ┌────────────────────────────────────────────────┤
        ▼                                                ▼
  AUTO-APPROVE                                     HOLD FOR REVIEW
  - kind = organization                            - kind = person  (always)
  - corroborated by a registry (EIN/990/FEC)       - uncorroborated web-only claims
  - attribute-grounding passed                     - dedup-suspect (DeduplicationFlag)
  - not dedup-suspect                              - low confidence / conflicting claims
        │                                                │
        ▼                                                ▼
     entries (public)                          reviewer promotes / merges / rejects
```

- **Registry-backed organizations auto-publish** — an org with an EIN and a 990 is high-precision and low personal-risk.
- **Individual people always route through review** — wrong facts about a named person are the real liability.
- **Uncorroborated web-only claims** are held below the high-trust display threshold regardless of kind.
- The `review_queue` item carries full provenance, computed score, attribute-grounding flags, and dedup-suspect links; consume the existing-but-ignored `DeduplicationFlag` stream into it. Extend the existing `moderation/` domain (today only reactive `entity_flags`/`source_flags`) into this proactive pre-publication queue.
- Every published entry then has an auditable, reversible trail: *corroborated by N sources, scored X, grounded on these attributes, promoted by Y on date Z.*

---

## 10. Roadmap

Sequencing reflects the locked decision: make the live system safe and non-duplicating before expanding recall.

### Phase 0 — Stop the bleeding *(highest priority)*
**Goal:** the autonomous service is safe to run continuously and safe to publish from.
- Trust gate: `review_queue` staging table + hybrid auto-approve/hold rules (§9).
- Atomic claim (`FOR UPDATE SKIP LOCKED` + `RETURNING`) + `idempotency_key`.
- Orphan reaper + real `TIMESTAMPTZ` leases + backoff + dead-letter.
- Cost ledger + per-run/global ceilings + kill switch.
- `SearchProvider` interface + Brave error handling (429/Retry-After) + one fallback provider.
- Async `/scheduled` (enqueue, return 202).

### Phase 1 — The spine
**Goal:** identity is stable; the graph lights up; re-runs upsert instead of duplicate.
- `places` (Census/FIPS) + `entities.place_id`.
- `entity_identifiers` + identifier-first **entity-resolution-on-write**; consume `DeduplicationFlag` into review.
- `edges` table + **persist the relationships we already extract** (`mentioned_entities`).
- `claims` table + per-claim provenance; persist the relevance score.

### Phase 2 — Authoritative ingestion
**Goal:** recall and money-flow come online; web extraction becomes corroboration.
- `connectors/` package in `atlas-discovery-engine` with a `StructuredConnector` interface.
- IRS BMF + ProPublica 990s + FEC + Wikidata connectors emitting the canonical artifact.
- 990 Schedule I → `funds` edges; officers → board/staff edges.

### Phase 3 — Coverage engine
**Goal:** "national coverage" becomes a driven queue with a real percentage.
- `coverage_cells` (place × issue × source-type) + append-only history.
- `discovery_targets` frontier with computed priority + `next_due_at`.
- Saturation detection (marginal-yield) + continuous re-discovery on a freshness SLA.
- The persist path writes back into cells (replacing the discarded `GapReport`).

### Phase 4 — Quality & scale-out
**Goal:** measurable quality, no silent regressions, throughput.
- Signal-based scoring + LLM-as-judge relevance/legitimacy.
- Golden-set eval harness, nightly.
- Worker pool + bounded-concurrency parallel extraction; full observability.

---

## 11. Risks & open questions

- **Migration of the existing catalog.** `entries` is live and user-facing (claims, slugs, follows). The strangler path needs `entries` to remain a valid read projection while the graph fills underneath; the cutover sequence is itself a design task.
- **Structured-source licensing & rate limits.** ProPublica/Candid/FEC have terms and quotas; connectors need the same budget governance as web search.
- **Reviewer throughput.** The hybrid gate is only viable if auto-approve covers the bulk (registry-backed orgs) and the human queue stays small; we need to monitor hold-rate and tune the corroboration threshold.
- **Edge resolution quality.** `mentioned_entities` names must resolve to entities; a bad resolver creates wrong edges, which are worse than no edges. The `pending_resolution` + review path must be conservative.
- **Cost of LLM-as-judge at national scale.** Quality adjudication per entity is expensive; it likely runs only at promotion time, not per extraction.

---

## 12. Evidence index

Key code references behind the diagnosis (for reviewers who want to verify):

- Weakest-path autonomous runner: `api/atlas/domains/discovery/pipeline/runner.py`; recall multipliers only in `scout/src/atlas_scout/pipeline.py:609-780`.
- Production Brave client, no error handling: `api/atlas/domains/discovery/pipeline/source_fetcher.py:130`.
- Attribute-blind validation: `scout/src/atlas_scout/steps/validate.py`, `libs/discovery-engine/src/atlas_discovery_engine/extraction.py:344-390`.
- Edges extracted then dropped: `extraction.py:159-163`, `libs/shared/src/atlas_shared/schemas.py:71-74`, dropped at `runner.py:318-362`.
- Read-time fake graph: `api/atlas/domains/catalog/models/connections.py`.
- Non-atomic claim + no reaper: `api/atlas/domains/discovery/models.py:686-727`.
- Citation-count scoring: `libs/discovery-engine/src/atlas_discovery_engine/scoring.py:16-22`.
- No cross-run dedup: `libs/discovery-engine/src/atlas_discovery_engine/dedup.py:99-126`.
- One-city geography: `api/atlas/domains/discovery/pipeline/local_context.py`; flat schema: `api/atlas/models/schema.sql:5-34`.
- EIN/990 capability that exists but isn't wired to the catalog: `api/atlas/domains/access/` (irs_lookup).

---

*Related: [Atlas Scout: Pipeline & Indexer Design Spec](2026-04-11-atlas-scout-pipeline-design.md) · [System Design](../the-atlas-system-design.md) · [Data Model Reference](../architecture/data-model.md) · [Pipeline Architecture](../architecture/pipeline.md)*
