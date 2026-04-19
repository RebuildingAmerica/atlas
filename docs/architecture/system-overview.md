# System Overview

[Docs](../README.md) > [Architecture](./README.md) > System Overview

The Atlas has three layers working together to build a national directory of people and organizations working on transformative change.

## The Three Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    INTERFACE LAYER                              │
│  React App (TanStack Start) + REST API                     │
│  - Public directory (searchable, browsable)                     │
│  - Internal admin interface                                      │
│  - Real-time updates via API polling                            │
└─────────────────────────────────────────────────────────────────┘
                            ↕ HTTP
┌─────────────────────────────────────────────────────────────────┐
│                    BUSINESS LOGIC LAYER                          │
│  FastAPI + Python                                                │
│  - REST endpoints for entries, sources, discovery               │
│  - Autodiscovery pipeline (6 steps)                             │
│  - Database access layer (CRUD operations)                      │
└─────────────────────────────────────────────────────────────────┘
                            ↕ SQL
┌─────────────────────────────────────────────────────────────────┐
│                    STORAGE LAYER                                 │
│  SQLite Database with FTS5                                      │
│  - Entries (people, orgs, initiatives)                          │
│  - Sources (articles, websites, etc.)                           │
│  - Entry-Source relationships                                    │
│  - Outreach logs, episode associations (internal)               │
└─────────────────────────────────────────────────────────────────┘
```

## Layer Details

### Storage Layer (SQLite + FTS5)

**What it stores:**

- **Entries** — The core entity. A person, organization, initiative, campaign, or event tied to a place and issues.
- **Sources** — Every source the pipeline has processed or entries are linked to (news articles, nonprofit websites, podcasts, etc.).
- **Entry-Source relationships** — Which entries came from which sources and the extraction context.
- **Entry-Issue relationships** — Which issues each entry is tagged with.
- **DiscoveryRun** — Log of each pipeline execution (request, results, timestamp).
- **Admin data** — Outreach logs, content associations (excluded from public API).

**Why SQLite?**

Simplicity. No separate database server to manage. No external dependencies. FTS5 provides full-text search without Elasticsearch. Perfect for early-stage product where you want zero operational overhead.

**See also:** [Data Model](./data-model.md), [System Design](../../docs/the-atlas-system-design.md)

### Business Logic Layer (FastAPI + Python)

**What it does:**

- **REST API** — HTTP endpoints for CRUD operations and triggering discovery.
  - `/api/v1/entries` — List/search entries
  - `/api/v1/entries/{id}` — Get single entry
  - `/api/v1/discovery` — Start autodiscovery pipeline
  - `/api/v1/taxonomy` — Get issue areas and search terms

- **Autodiscovery Pipeline** — 6-step process to find entries.
  1. Query Generation — Create search queries from location + issues
  2. Source Fetching — Search web (news, nonprofits, organizations, etc.)
  3. Extraction — Use Claude API to extract structured data from sources
  4. Deduplication — Merge duplicate entries (same person in multiple articles)
  5. Ranking — Rank by relevance to original query
  6. Gap Analysis — Identify underrepresented areas

- **Database Access Layer** — Read/write operations to SQLite.

**Why FastAPI?**

Fast startup, great performance, automatic API documentation (Swagger). Type hints provide runtime validation via Pydantic. Easy testing. Good async support if we add async operations later.

**See also:** [Pipeline Architecture](./pipeline.md), [API Reference](./api-reference.md)

### Interface Layer (React + TanStack Start)

**What it does:**

- **Public Directory** — Browse and search for people and organizations.
  - Home page with stats and featured entries
  - Search page (full-text or issue-based)
  - Entry detail pages with all sources and related entries
  - Issue area pages (see all entries for a topic)

- **Admin Interface** — For teams managing the directory.
  - Trigger discovery runs manually
  - Review and edit entries before publishing
  - See outreach status
  - View gap analysis results

- **HTTP Client** — Calls the FastAPI API.

**Why TanStack Start?**

Meta-framework built on Vite and React Router. Provides file-based routing, selective SSR (some routes render on server, some in browser), and TypeScript first. Cleaner than Next.js for our use case.

**See also:** [App Architecture](./app.md)

## Data Flow

### Reading (User browsing)

```
1. User opens homepage → App requests /api/v1/entries
2. API queries SQLite → returns latest entries (with sources)
3. App renders entry cards in a list
4. User clicks search → App calls /api/v1/entries?q=query
5. API does FTS search in SQLite → returns results
6. App renders in real-time as user types
```

### Writing (Pipeline discovery)

```
1. Admin triggers discovery run on app
2. App POSTs to /api/v1/discovery with location + issue areas
3. API starts pipeline:
   a. Generate ~40 search queries
   b. Fetch ~200 sources from web
   c. Extract entries from each source using Claude API
   d. Deduplicate (merge same entries from different sources)
   e. Rank by relevance
   f. Analyze gaps (what's missing?)
4. API stores all new/updated entries in SQLite
5. App polls /api/v1/discovery/{run_id} to see progress
6. When complete, app shows admin the results
7. Admin can publish entries to public directory
```

## Key Design Decisions

### Autodiscovery as Product Core

The pipeline is not a back-office tool. It's the product. Everything else (database, API, UI) exists to support what the pipeline finds. This is why we focus on extraction quality and deduplication accuracy.

### Source-Linked Directory

Every entry traces back to where it came from. Users can follow the link to the original article/website. This builds trust and credibility. Sources are first-class entities in the database.

### Location + Issues as Query Dimensions

The pipeline takes two inputs: a location (city/state/region) and a set of issue areas (housing, labor, climate, etc.). This drives all downstream filtering and ranking.

### SQLite for Simplicity

We chose SQLite over PostgreSQL for early stage. It reduces operational complexity when you're scaling the code, not the data. FTS5 handles full-text search. If we ever need more, migrating to PostgreSQL is mechanical — just rerun schema in a new database.

### Selective SSR for Performance

Most routes are SPAs (rendered in browser) for interactivity. Home page and entry detail pages use SSR for:
- Faster initial page load (no waterfall of API calls)
- SEO (search engines see content immediately)
- Better UX for slow connections

### Type Safety Across Stacks

Pydantic schemas on API → TypeScript types on app. Same type, different syntax. Means when you add a field to an Entry, it automatically shows up in the app type-checking.

---

## Next Steps

- Understand the full design: [System Design](../../docs/the-atlas-system-design.md)
- Deep dive on pipeline: [Pipeline Architecture](./pipeline.md)
- REST API details: [API Reference](./api-reference.md)
- App details: [App Architecture](./app.md)

---

Last updated: March 25, 2026
