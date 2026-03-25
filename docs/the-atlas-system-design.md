# The Atlas: System Design

---

## Architecture Overview

Three layers:

1. **Autodiscovery pipeline** — takes a location + issue areas as input,
   searches the web, extracts structured entries from sources, deduplicates,
   ranks. Primary data ingestion path.

2. **Storage layer** — persists entries, sources, and their relationships.
   Supports query patterns for both internal and public interfaces.

3. **Interface layer** — internal (production) and public (Atlas) views
   over the same data, with different field visibility.

---

## Data Model

### Entry

The core entity. A person, organization, initiative, campaign, or event
tied to a place and set of issues.

```
Entry {
    id:                 uuid (primary key)
    type:               enum [person, organization, initiative, campaign, event]
    name:               text (required)
    description:        text (required, 1-3 sentences)

    -- Geography
    city:               text
    state:              text (2-letter code)
    region:             text (nullable, e.g. "Kansas City metro", "Cancer Alley")
    geo_specificity:    enum [local, regional, statewide, national]

    -- Issue mapping (many-to-many, see EntryIssueArea junction table)

    -- Source trail (one-to-many via EntrySource junction table)
    first_seen:         date
    last_seen:          date

    -- Contact surface
    website:            text (nullable)
    email:              text (nullable, public-listed only)
    phone:              text (nullable, public-listed only)
    social_media:       json (nullable, {platform: handle} pairs)
    affiliated_org_id:  uuid (nullable, FK → Entry, for person→org links)

    -- Status
    active:             boolean (default true)
    verified:           boolean (default false)
    last_verified:      date (nullable)

    -- Internal only (excluded from public views)
    contact_status:     enum [not_contacted, contacted, responded, confirmed, declined]
                        (default not_contacted)
    editorial_notes:    text (nullable)
    priority:           enum [high, medium, low] (nullable)

    -- Timestamps
    created_at:         datetime
    updated_at:         datetime
}
```

### Source

Every source the pipeline has processed or that an entry was manually
attributed to.

```
Source {
    id:                 uuid (primary key)
    url:                text (required, unique)
    title:              text
    publication:        text (nullable, e.g. "Wichita Eagle", "NPR")
    published_date:     date (nullable)
    type:               enum [news_article, op_ed, podcast, academic_paper,
                              government_record, social_media, org_website,
                              conference, video, report, other]

    -- Ingestion metadata
    ingested_at:        datetime
    extraction_method:  enum [manual, ai_assisted, autodiscovery]
    raw_content:        text (nullable, stored for re-extraction)

    -- Timestamps
    created_at:         datetime
}
```

### Junction Tables

```
EntrySource {
    entry_id:           uuid (FK → Entry)
    source_id:          uuid (FK → Source)
    extraction_context: text (nullable, the relevant passage from the source)
    created_at:         datetime
    PRIMARY KEY (entry_id, source_id)
}

EntryIssueArea {
    entry_id:           uuid (FK → Entry)
    issue_area:         text (slug from taxonomy, e.g. "worker_cooperatives")
    created_at:         datetime
    PRIMARY KEY (entry_id, issue_area)
}
```

### OutreachLog (internal only)

```
OutreachLog {
    id:                 uuid (primary key)
    entry_id:           uuid (FK → Entry)
    date:               datetime
    method:             enum [email, phone, social_media, in_person, other]
    notes:              text
    response:           enum [no_response, positive, negative, deferred]
    created_at:         datetime
}
```

### EpisodeAssociation (internal only)

```
EpisodeAssociation {
    entry_id:           uuid (FK → Entry)
    episode:            text (episode identifier)
    role:               text (nullable, free-form)
    created_at:         datetime
    PRIMARY KEY (entry_id, episode)
}
```

### DiscoveryRun

Tracks each pipeline execution for auditability and re-runs.

```
DiscoveryRun {
    id:                 uuid (primary key)
    location_query:     text (e.g. "Kansas City, MO")
    state:              text (2-letter code)
    issue_areas:        json (list of issue area slugs queried)
    queries_generated:  integer
    sources_fetched:    integer
    sources_processed:  integer
    entries_extracted:  integer
    entries_after_dedup: integer
    entries_confirmed:  integer (updated after triage)
    started_at:         datetime
    completed_at:       datetime
    status:             enum [running, completed, failed]
}
```

---

## Autodiscovery Pipeline — Technical Design

### Step 1: Query Generation

**Input:** location (city + state) and list of issue area slugs.

**Process:** For each issue area, generate search queries across source
categories:

```
Source category        Query pattern
─────────────────────  ──────────────────────────────────────────
Local journalism       "{city} {issue_keywords}"
                       "{city} {issue_keywords} {local_outlet}"
Orgs and nonprofits    "{city} {issue_keywords} nonprofit"
                       "{city} {issue_keywords} organization"
Named individuals      "{city} {issue_keywords} organizer"
                       "{city} {issue_keywords} advocate"
                       "{city} {issue_keywords} director"
Campaigns/initiatives  "{city} {issue_keywords} campaign"
                       "{city} {issue_keywords} initiative"
                       "{city} {issue_keywords} ballot measure"
Academic/policy        "{city} {issue_keywords} study"
                       "{city} {issue_keywords} university research"
```

`issue_keywords` maps issue area slugs to natural-language search terms:

```python
ISSUE_SEARCH_TERMS = {
    "transportation_and_mobility": [
        "transit", "public transportation", "bus", "bike infrastructure",
        "pedestrian", "transportation planning"
    ],
    "worker_cooperatives": [
        "worker cooperative", "worker-owned", "co-op",
        "cooperative enterprise", "employee ownership"
    ],
    "housing_affordability": [
        "affordable housing", "rent", "housing crisis",
        "community land trust", "tenant organizing"
    ],
    # ... for all issue areas
}
```

**Local context enrichment:** Supplementary config maps locations to local
knowledge — news outlets, transit authorities, universities, regional terms.
Starts sparse, populated as research progresses:

```python
LOCAL_CONTEXT = {
    "Kansas City, MO": {
        "outlets": ["Kansas City Star", "KCUR", "The Beacon"],
        "transit_authority": "KCATA",
        "universities": ["UMKC", "University of Kansas"],
        "regional_terms": ["KC metro", "Johnson County"]
    },
}
```

**Output:** List of search query strings, each tagged with the issue area
and source category that generated it.

### Step 2: Source Fetching

**Input:** Search queries from Step 1.

**Process:**
1. Execute each query via web search API.
2. Collect result URLs. Deduplicate URLs across queries.
3. Fetch page content and extract text for each unique URL.
4. Filter out low-value sources:
   - Published > 2 years ago (configurable)
   - No geographic reference to the target location
   - Content < 200 words
   - Paywalled / inaccessible

**Rate limiting:** Batch and throttle to respect API limits.

**Output:** Source records with fetched content, ready for extraction.

### Step 3: AI Extraction

**Input:** A Source record with its full text content.

**Process:** Claude API call with structured extraction prompt. The prompt
includes the full issue taxonomy, target location, output schema, and
instructions to cite specific passages.

**System prompt structure:**

```
You are extracting structured data from a source document for the
Rebuilding America Atlas — a national directory of people, organizations,
and initiatives working on contemporary American issues.

Target location: {city}, {state}

Issue taxonomy:
{taxonomy as flat list of slugs with descriptions}

For each person, organization, initiative, campaign, or event mentioned
in this source that is:
  (a) connected to the target location, AND
  (b) working on one or more issues from the taxonomy

Extract:
- name
- type (person | organization | initiative | campaign | event)
- description (1-3 sentences, grounded in the source text)
- city, state, geo_specificity
- issue_areas (list of slugs from the taxonomy)
- affiliated_org (if a person, name their org if stated)
- contact_surface (website, email, social media — ONLY if explicitly
  stated in the source, do not guess or infer)
- extraction_context (the specific passage(s) that support this extraction)

Return JSON. If no relevant entries exist in this source, return an empty
list. Do not fabricate entries or details not present in the source.
```

**Example output:**

```json
{
  "source": {
    "url": "https://wichitaeagle.com/2026/01/...",
    "title": "Garden City cooperative offers new model for displaced workers",
    "publication": "Wichita Eagle",
    "date": "2026-01-15",
    "type": "news_article"
  },
  "entries": [
    {
      "name": "Maria Gonzalez",
      "type": "person",
      "description": "Former meatpacking worker who founded Prairie Workers Cooperative after plant automation displaced 200+ workers. The co-op now employs 45 people in commercial cleaning and food service.",
      "city": "Garden City",
      "state": "KS",
      "geo_specificity": "local",
      "issue_areas": ["worker_cooperatives", "automation_and_ai_displacement", "immigration_and_belonging"],
      "affiliated_org": "Prairie Workers Cooperative",
      "contact_surface": {
        "website": "https://prairieworkers.coop"
      }
    },
    {
      "name": "Prairie Workers Cooperative",
      "type": "organization",
      "description": "Worker-owned cooperative in Garden City, KS providing cleaning and food services. Founded 2024 after meatpacking plant automation.",
      "city": "Garden City",
      "state": "KS",
      "geo_specificity": "local",
      "issue_areas": ["worker_cooperatives", "automation_and_ai_displacement"],
      "contact_surface": {
        "website": "https://prairieworkers.coop",
        "email": "info@prairieworkers.coop"
      }
    }
  ]
}
```

### Step 4: Deduplication

**Input:** All extracted entries from this pipeline run + existing entries
in the database for the same location.

**Matching strategy (in order of confidence):**

1. **Exact name + same city + same type** → auto-merge
2. **Exact org name match** → auto-merge
3. **Person name + same affiliated org** → auto-merge
4. **Fuzzy name + same city** → flag for manual review
5. **Same name + different city** → flag for manual review

**When merging:**
- Union all source links
- Union all issue area tags
- Keep the longest/most detailed description (or flag for manual pick)
- Union contact surface data
- Set `last_seen` to most recent source date
- If merging with existing DB record, update rather than create

**Output:** Deduplicated entries, some auto-merged, some flagged for review.

### Step 5: Ranking

**Input:** Deduplicated entry list.

**Ranking criteria (weighted):**

1. **Source density** (highest weight): distinct source count.
2. **Recency**: most recent source date.
3. **Geographic specificity**: local > regional > statewide > national.
4. **Contact surface completeness**: website + email > website only > nothing.
5. **Description specificity**: detailed descriptions of specific work
   rank above generic org descriptions.

**Output:** Ranked list, ready for triage.

### Step 6: Gap Analysis

**Input:** Confirmed entries for a location after triage.

**Process:** Compare confirmed entries' issue area tags against the full
taxonomy. Report:

- Issue areas with zero entries
- Issue areas with only 1 entry (thin coverage)
- Issue areas with 3+ entries (strong coverage)
- Entire domains with no coverage

**Output:** Gap report with optional follow-up query suggestions for
missing areas.

---

## Query Patterns

### Internal (production)

```sql
-- All entries in a state, filtered by issue area
SELECT e.* FROM entries e
JOIN entry_issue_areas eia ON e.id = eia.entry_id
WHERE e.state = 'MO' AND eia.issue_area = 'transportation_and_mobility';

-- Entries ranked by source count
SELECT e.*, COUNT(es.source_id) as source_count FROM entries e
JOIN entry_sources es ON e.id = es.entry_id
WHERE e.state = 'MO'
GROUP BY e.id ORDER BY source_count DESC;

-- Uncontacted high-priority entries
SELECT * FROM entries
WHERE contact_status = 'not_contacted' AND priority = 'high'
AND state IN ('MO', 'KS', 'NE');

-- Gap analysis: issue areas with no entries for a state
SELECT ia.slug FROM issue_areas ia
WHERE ia.slug NOT IN (
    SELECT DISTINCT eia.issue_area FROM entry_issue_areas eia
    JOIN entries e ON eia.entry_id = e.id
    WHERE e.state = 'MO'
);

-- Cross-cutting: entries tagged with multiple issues
SELECT e.* FROM entries e
JOIN entry_issue_areas eia1 ON e.id = eia1.entry_id
JOIN entry_issue_areas eia2 ON e.id = eia2.entry_id
WHERE eia1.issue_area = 'housing_affordability'
AND eia2.issue_area = 'environmental_justice_and_pollution';
```

### Public

- Browse by state → entries grouped by issue area
- Browse by issue area → entries grouped by state
- Search by name (full-text on name + description)
- Filter by entity type

Full-text search via SQLite FTS5.

---

## Technical Stack

- **Language:** Python
- **Database:** SQLite (FTS5) for Phase 1-2. Postgres when the public
  Atlas needs concurrent access.
- **Web framework:** FastAPI
- **AI extraction:** Anthropic Claude API (claude-sonnet-4-20250514),
  structured JSON output.
- **Web search:** Search API for pipeline query execution.
- **Web fetching:** httpx + trafilatura (or similar) for HTML-to-text.
- **Frontend:** React (Phase 2-3). Phase 1 triage can be CLI.

---

## File Structure (Phase 1)

```
the-atlas/
├── pipeline/
│   ├── __init__.py
│   ├── query_generator.py      # Step 1: location + issues → search queries
│   ├── source_fetcher.py       # Step 2: queries → fetched source content
│   ├── extractor.py            # Step 3: source content → structured entries
│   ├── deduplicator.py         # Step 4: merge duplicate entries
│   ├── ranker.py               # Step 5: rank entries
│   └── gap_analyzer.py         # Step 6: report missing coverage
├── models/
│   ├── __init__.py
│   ├── database.py             # SQLite setup, connection management
│   ├── entry.py                # Entry CRUD
│   ├── source.py               # Source CRUD
│   └── discovery_run.py        # Pipeline run tracking
├── taxonomy/
│   ├── issue_areas.py          # Taxonomy definition
│   └── search_terms.py         # Issue area → search keyword mappings
├── config/
│   ├── local_context.py        # City/state → local knowledge
│   └── settings.py             # API keys, thresholds, rate limits
├── cli.py                      # CLI for pipeline runs + triage
├── requirements.txt
└── README.md
```

---

## Open Technical Questions

1. **Web search API.** Need programmatic search at volume. Options:
   SerpAPI, Brave Search API, or Claude's built-in web search via API.
   Cost and rate limits are the deciding factors.

2. **Content extraction quality.** HTML-to-text varies by source type.
   Trafilatura is good for articles, less so for structured org pages.
   May need multiple extraction strategies.

3. **AI extraction cost.** ~50 sources/city × ~50 cities = ~2500 API calls
   for a first pass. Sonnet is the right model. Need token cost estimate.

4. **Dedup confidence thresholds.** Too aggressive = merging different
   people. Too conservative = drowning in review flags. Needs tuning
   with real data.

5. **Local context bootstrapping.** LOCAL_CONTEXT starts empty. Could
   pre-populate from journalism directories (local outlets per state)
   and NTD (transit authorities). Worth the upfront effort.
