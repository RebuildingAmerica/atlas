# Architecture Documentation

[Docs](../README.md) > Architecture

How the system is built. Reference these docs when understanding data flow, designing features, or debugging.

## Core Architecture Docs

### System Overview
High-level diagram and description of the three-layer architecture: autodiscovery pipeline, storage, and interface.

→ [Read: System Overview](./system-overview.md)

### Data Model
Quick reference for all database tables, fields, and relationships. For design details, see the full system design.

→ [Read: Data Model](./data-model.md)

### Pipeline Architecture
Deep dive into the 6-step autodiscovery pipeline. What each step does, what it takes as input, what it produces.

→ [Read: Pipeline Architecture](./pipeline.md)

### App Architecture
How the app is organized. TanStack Start, selective SSR, component structure, type safety.

→ [Read: App Architecture](./app.md)

### Organization And Enterprise SSO
How Atlas uses Better Auth organizations and Better Auth SSO together, including
workspace metadata, pre-auth provider resolution, and progressive enhancement rules.

→ [Read: Organization And Enterprise SSO](./organization-and-enterprise-sso.md)

### API Reference
REST API endpoints, schemas, pagination, error handling, versioning strategy.

→ [Read: API Reference](./api-reference.md)

## Reference Documents

For the complete design including problem statement, vision, and constraints, see:

- [Product Vision](../design/README.md) — What problem are we solving? Who is it for?
- [System Design](../../docs/the-atlas-system-design.md) — Full architecture and constraints
- [Issue Area Taxonomy](../../docs/the-atlas-taxonomy.md) — All issue areas and search terms

## Quick Reference

### Data Flow

```
User Input
    ↓
App UI
    ↓
REST API (/api/v1/...)
    ↓
Business Logic (Pipeline, CRUD)
    ↓
SQLite Database
    ↓
Results back through API
    ↓
App Display
```

### When to Reference Each Doc

| I need to... | Read this |
|---|---|
| Understand what the system does | [Product Vision](../design/README.md) |
| See the three-layer architecture | [System Overview](./system-overview.md) |
| Design a new database table | [Data Model](./data-model.md) + System Design |
| Improve the autodiscovery pipeline | [Pipeline Architecture](./pipeline.md) |
| Add a new page/component | [App Architecture](./app.md) |
| Add a new API endpoint | [API Reference](./api-reference.md) |
| Add a new issue area | Issue Area Taxonomy + [Pipeline Architecture](./pipeline.md) |

## Key Concepts

### Entry
The core entity. A person, organization, initiative, campaign, or event tied to a place and set of issues. Has many sources (the articles/pages it was found in).

### Source
A piece of content (news article, nonprofit website, podcast, etc.) that the pipeline processed or that an entry was manually attributed to.

### Pipeline
A 6-step process: Query Generation → Source Fetching → Extraction → Deduplication → Ranking → Gap Analysis. Takes a location + issue areas, returns ranked, deduplicated entries.

### Discovery Run
A single execution of the pipeline. Stores the request (location, issues) and results for auditability.

## Architecture Principles

1. **Three Layers** — Pipeline (discovery logic) → Storage (database) → Interface (REST + app). Separation of concerns makes each layer testable and replaceable.

2. **Type Safety** — TypeScript types on app mirror Pydantic schemas on API. Ensures app and API stay in sync.

3. **Selective SSR** — Most routes are SPAs for interactivity. Some routes (home, entry detail) use SSR for initial page load performance and SEO.

4. **Full-Text Search** — SQLite with FTS5 extension for searching entries and sources. No external search engine required.

5. **Auditability** — Every entry traces back to its sources. Every source was processed by which step of the pipeline. DiscoveryRun tracks each pipeline execution.

---

Last updated: March 25, 2026
