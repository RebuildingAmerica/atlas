# Data Model Reference

[Docs](../README.md) > [Architecture](./README.md) > Data Model

Quick reference for all database tables, fields, and relationships. For complete details and design rationale, see [System Design](../../docs/the-atlas-system-design.md).

## Entry (Core Entity)

A person, organization, initiative, campaign, or event tied to a place and issue areas.

| Field | Type | Required | Notes |
|---|---|---|---|
| id | UUID | Yes | Primary key |
| type | enum | Yes | person, organization, initiative, campaign, event |
| name | Text | Yes | Name or title |
| description | Text | Yes | 1-3 sentence summary |
| city | Text | No | City name |
| state | Text | No | 2-letter state code (e.g., "KS") |
| region | Text | No | Regional identifier (e.g., "Kansas City metro") |
| geo_specificity | enum | Yes | local, regional, statewide, national |
| website | Text | No | URL to website or social media |
| email | Text | No | Contact email (public-listed only) |
| phone | Text | No | Contact phone (public-listed only) |
| social_media | JSON | No | {platform: handle} pairs (e.g., {"twitter": "handle"}) |
| affiliated_org_id | UUID | No | FK → Entry (for person→org links) |
| active | Boolean | Yes | Default true. Is this entry current? |
| verified | Boolean | Yes | Default false. Has someone confirmed this? |
| last_verified | Date | No | When was this last verified? |
| contact_status | enum | No | not_contacted, contacted, responded, confirmed, declined (admin-only) |
| editorial_notes | Text | No | Admin notes (not public) |
| priority | enum | No | high, medium, low (admin-only) |
| created_at | DateTime | Yes | When entry was created |
| updated_at | DateTime | Yes | When entry was last updated |

**Relationships:**
- Many sources (via EntrySource junction table)
- Many issue areas (via EntryIssueArea junction table)
- May affiliate with another Entry (affiliated_org_id)

## Source

A source document (news article, nonprofit website, podcast, etc.) that the pipeline processed or an entry was attributed to.

| Field | Type | Required | Notes |
|---|---|---|---|
| id | UUID | Yes | Primary key |
| url | Text | Yes | Unique URL to source |
| title | Text | No | Source title |
| publication | Text | No | Publisher (e.g., "Wichita Eagle", "NPR") |
| published_date | Date | No | When source was published |
| type | enum | Yes | news_article, op_ed, podcast, academic_paper, government_record, social_media, org_website, conference, video, report, other |
| ingested_at | DateTime | Yes | When pipeline processed it |
| extraction_method | enum | Yes | manual, ai_assisted, autodiscovery |
| raw_content | Text | No | Full source text (for re-extraction) |
| created_at | DateTime | Yes | When source was created in database |

**Relationships:**
- Many entries (via EntrySource junction table)

## EntrySource (Junction Table)

Links entries to sources. One-to-many: one source can relate to many entries, one entry can have many sources.

| Field | Type | Required | Notes |
|---|---|---|---|
| entry_id | UUID | Yes | FK → Entry |
| source_id | UUID | Yes | FK → Source |
| extraction_context | Text | No | The relevant passage from source |
| created_at | DateTime | Yes | When link was created |

**Primary Key:** (entry_id, source_id)

**Purpose:** Track which sources contributed to which entries, and preserve the context (the passage that led to this entry).

## EntryIssueArea (Junction Table)

Links entries to issue areas. Tagging system.

| Field | Type | Required | Notes |
|---|---|---|---|
| entry_id | UUID | Yes | FK → Entry |
| issue_area | Text | Yes | Slug from taxonomy (e.g., "worker_cooperatives") |
| created_at | DateTime | Yes | When tag was added |

**Primary Key:** (entry_id, issue_area)

**Purpose:** Track which issues each entry connects to. Enables filtering/searching by issue.

## DiscoveryRun (Audit Log)

Log of each autodiscovery pipeline execution. Enables re-runs, debugging, and tracking what's been discovered.

| Field | Type | Required | Notes |
|---|---|---|---|
| id | UUID | Yes | Primary key |
| location_query | Text | Yes | e.g., "Kansas City, MO" |
| state | Text | Yes | 2-letter code |
| issue_areas | JSON | Yes | List of issue area slugs |
| status | enum | Yes | pending, in_progress, completed, failed |
| entries_found | Integer | Yes | Count of entries discovered |
| sources_processed | Integer | Yes | Count of sources fetched |
| started_at | DateTime | Yes | When pipeline started |
| completed_at | DateTime | No | When pipeline finished |
| error_message | Text | No | If failed, why? |

**Purpose:** Audit trail. Enables tracking what's been discovered where. Can re-run same query to see if new entries are found.

## OutreachLog (Admin-Only)

Tracks outreach attempts to entries (email, phone, in-person visits).

| Field | Type | Required | Notes |
|---|---|---|---|
| id | UUID | Yes | Primary key |
| entry_id | UUID | Yes | FK → Entry |
| date | DateTime | Yes | When outreach happened |
| method | enum | Yes | email, phone, social_media, in_person, other |
| notes | Text | Yes | What was said, what was the response? |
| response | enum | Yes | no_response, positive, negative, deferred |
| created_at | DateTime | Yes | When log created |

**Purpose:** Track outreach for admin users. Not visible in public API.

## EpisodeAssociation (Admin-Only)

Links entries to content (episodes, articles, features).

| Field | Type | Required | Notes |
|---|---|---|---|
| entry_id | UUID | Yes | FK → Entry |
| episode | Text | Yes | Episode identifier |
| role | Text | No | Free-form role description |
| created_at | DateTime | Yes | When link was created |

**Primary Key:** (entry_id, episode)

**Purpose:** Track which entries are featured in content. Enables "people in this episode/article" views.

---

## Entity-Relationship Diagram (Text)

```
Entry (1) ────────────────→ (M) EntrySource ←────────────── (1) Source
  │
  │ (1)
  └─────────→ (M) EntryIssueArea (slug)

  │ (1)
  └─────────→ (M) OutreachLog

  │ (1)
  └─────────→ (M) EpisodeAssociation

  │ (1)
  └─────affiliated_org_id─→ (1) Entry (self-reference)

DiscoveryRun (independent audit log)
```

---

## Query Patterns

### Find all entries for a location and issue
```sql
SELECT DISTINCT Entry.*
FROM Entry
JOIN EntryIssueArea ON Entry.id = EntryIssueArea.entry_id
WHERE Entry.state = 'KS'
  AND EntryIssueArea.issue_area = 'worker_cooperatives'
```

### Find all sources for an entry
```sql
SELECT Source.*
FROM Source
JOIN EntrySource ON Source.id = EntrySource.source_id
WHERE EntrySource.entry_id = ?
```

### Full-text search entries by name or description
```sql
SELECT Entry.*
FROM Entry
WHERE Entry.name MATCH 'query'
   OR Entry.description MATCH 'query'
```

### Audit: what was discovered in this location?
```sql
SELECT * FROM DiscoveryRun
WHERE state = 'KS'
ORDER BY started_at DESC
```

---

## Public vs. Admin Fields

**Visible in public API:**
- Entry: id, type, name, description, city, state, region, geo_specificity, website, active (not verified or contact_status)
- Source: id, url, title, publication, published_date, type
- EntrySource: extraction_context

**Hidden from public API (admin-only):**
- Entry: contact_status, editorial_notes, priority, email, phone (unless marked public)
- OutreachLog: entire table
- EpisodeAssociation: entire table

---

## Indexing Strategy

For performance:
- Index on Entry.state + Entry.active (common filter)
- Index on Entry.created_at (recent first)
- FTS5 virtual table on Entry (name, description) for full-text search
- Index on EntryIssueArea.issue_area (filter by issue)
- Index on EntrySource (both directions, for tracing sources)

See [System Design](../../docs/the-atlas-system-design.md) for full schema definition.

---

Last updated: March 25, 2026
