# Pipeline Architecture

[Docs](../README.md) > [Architecture](./README.md) > Pipeline Architecture

The autodiscovery pipeline is the core product. It takes a location and set of issues as input, systematically finds who's doing what there, and produces a ranked list of entries with sources.

## The 6-Step Pipeline

```
┌──────────────────────────────────────────────────────┐
│ Admin provides: Location + Issue Areas               │
│ Example: "Kansas City, MO" + [labor, housing]       │
└──────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────┐
│ Step 1: Query Generation                             │
│ Creates ~40 search queries across source types       │
└──────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────┐
│ Step 2: Source Fetching                              │
│ Searches web, returns ~200 sources (articles, etc.)  │
└──────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────┐
│ Step 3: Extraction                                   │
│ Claude API reads each source, extracts structured    │
│ data (names, orgs, what they do, issues)            │
└──────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────┐
│ Step 4: Deduplication                                │
│ Merges same entry from multiple sources              │
│ (Same person → one entry with multiple sources)     │
└──────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────┐
│ Step 5: Ranking                                      │
│ Scores by relevance (specificity, source quality)   │
│ Sorts high to low                                    │
└──────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────┐
│ Step 6: Gap Analysis                                 │
│ What's missing? (demographics, org types, areas)    │
└──────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────┐
│ Output: Ranked entries + sources + gaps              │
│ Admin can review and publish to public directory    │
└──────────────────────────────────────────────────────┘
```

## Step 1: Query Generation

**Input:** Location (Kansas City, MO) + Issue areas (labor, housing)

**Output:** ~40 search queries across different source types

**How it works:**

For each issue area, generate queries targeting different sources:
- Local news: "worker cooperatives Kansas City Missouri"
- Nonprofits: "site:guidestar.org housing Kansas City"
- Organizations: "labor advocacy site:org Kansas City"
- Government: "city council housing board site:kcmo.gov"
- Academic: "site:scholar.google.com labor economics Kansas"
- Social media: "housing affordability Kansas City twitter"

**Implementation:**
- File: `api/atlas/pipeline/query_generator.py`
- Input: DiscoveryRun (location, issue_areas)
- Output: List of query strings

**Status:** Scaffolded. Generates basic queries. Needs tuning.

---

## Step 2: Source Fetching

**Input:** ~40 queries from Step 1

**Output:** ~200 source documents (articles, websites, etc.)

**How it works:**

For each query, hit search engines and directories:
- Google News (via news.google.com or API if available)
- Google Search
- Nonprofit directories (GuideStar, etc.)
- Local news archives
- Organizational websites (archive.org)

Deduplicate URLs (same article found multiple times) before passing to Step 3.

**Implementation:**
- File: `api/atlas/pipeline/source_fetcher.py`
- Input: List of query strings
- Output: List of Source objects (with raw_content)

**Status:** Scaffolded. Currently returns empty list. Needs integration with search engines or API.

**Note:** For initial implementation, may use simple web scraping or search APIs (Google, Bing). Later may add integrations with specialized databases (news archives, nonprofit directories).

---

## Step 3: Extraction

**Input:** ~200 source documents

**Output:** Extracted entries (names, orgs, what they do, issues, locations)

**How it works:**

Feed each source to Claude API with a prompt like:

```
Extract all people, organizations, and initiatives working on
[issues] in [location] from this source.

For each entity, provide:
- Name
- Type (person, org, initiative, campaign, event)
- What they do (1-3 sentences)
- Which issues they work on
- Location (city, state, region)
- Contact info if public (website, email, phone)
- Any affiliated organizations

Return as JSON array.
```

Claude returns structured JSON. Parse and convert to Entry objects.

**Implementation:**
- File: `api/atlas/pipeline/extractor.py`
- Input: List of Source objects with raw_content
- Output: List of Entry objects (not yet in database)
- Uses: `ANTHROPIC_API_KEY` from config

**Status:** Scaffolded. API calls are stubbed. Needs implementation.

**Current behavior:** Returns empty list. Needs actual Claude integration.

---

## Step 4: Deduplication

**Input:** Extracted entries from Step 3 (raw, may have duplicates)

**Output:** Deduplicated entries merged across sources

**How it works:**

Same entry found in 3 articles = 1 entry with 3 sources. Dedup by:
1. Name similarity (fuzzy match on name field)
2. Location + type (same person in same city with same role)
3. Description similarity (semantic matching)

When duplicates are found:
- Merge fields (keep longer descriptions, combine source lists)
- Keep track of all sources that mentioned this entry
- Resolve conflicting fields (if sources disagree, take most frequent)

**Implementation:**
- File: `api/atlas/pipeline/deduplicator.py`
- Input: List of Entry objects from Step 3
- Output: Deduplicated list of Entry objects with merged source lists

**Status:** Scaffolded. Dedup logic is stubbed. Needs implementation.

---

## Step 5: Ranking

**Input:** Deduplicated entries from Step 4

**Output:** Same entries, ranked by relevance

**How it works:**

Score each entry by:
1. **Specificity** — More specific is better. "Maria Gonzalez, founder of Prairie Workers Coop" scores higher than "The Sierra Club."
2. **Source quality** — Bylined news article scores higher than social media rumor.
3. **Recency** — Newer sources score higher than old ones.
4. **Issue match** — How well does entry match query's issue areas?
5. **Location match** — Is it in the right city/state, or national?

Sort by combined score, highest first.

**Implementation:**
- File: `api/atlas/pipeline/ranker.py`
- Input: List of Entry objects from Step 4
- Output: Same list, sorted by relevance score

**Status:** Scaffolded. Scoring is stubbed. Needs tuning.

---

## Step 6: Gap Analysis

**Input:** Ranked entries from Step 5

**Output:** Summary of gaps (what's missing from results)

**How it works:**

Analyze coverage:
1. **Geographic gaps** — Which neighborhoods or parts of the city are underrepresented?
2. **Demographic gaps** — Are leaders mostly one gender, age, race?
3. **Organizational type gaps** — Are results heavy on nonprofits and light on grassroots groups?
4. **Issue area gaps** — Are some issue areas overrepresented (easy to find) vs. underrepresented?

Recommend additional searches to fill gaps.

**Implementation:**
- File: `api/atlas/pipeline/gap_analyzer.py`
- Input: Ranked entries from Step 5 + original query
- Output: GapAnalysis object with findings and recommendations

**Status:** Scaffolded. Analysis is stubbed. Needs implementation.

---

## Pipeline Orchestration

**File:** `api/atlas/pipeline/__init__.py`

The main entry point that runs all 6 steps in sequence:

```python
async def run_discovery(location: str, issue_areas: List[str]) -> DiscoveryRun:
    run = DiscoveryRun(location, issue_areas, status="pending")

    try:
        # Step 1
        queries = generate_queries(location, issue_areas)

        # Step 2
        sources = fetch_sources(queries)

        # Step 3
        extracted = extract_entries(sources)

        # Step 4
        deduplicated = deduplicate(extracted)

        # Step 5
        ranked = rank(deduplicated)

        # Step 6
        gaps = analyze_gaps(ranked, location, issue_areas)

        # Store results in database
        for entry in ranked:
            db.create_or_update_entry(entry)

        run.status = "completed"
        run.completed_at = now()

    except Exception as e:
        run.status = "failed"
        run.error_message = str(e)

    return run
```

---

## Triggering the Pipeline

### From API

```bash
POST /api/v1/discovery
Content-Type: application/json

{
  "location": "Kansas City, MO",
  "issue_areas": ["labor", "housing"]
}
```

**Response:** Returns DiscoveryRun object with status "pending".

Then poll: `GET /api/v1/discovery/{run_id}` to check progress.

### From Frontend

Admin goes to `/admin/discovery`, fills in location and checkboxes for issue areas, clicks "Run Discovery". App POSTs to `/api/v1/discovery`, then polls for completion.

---

## Current Implementation Status

| Step | Status | Notes |
|---|---|---|
| 1. Query Generation | Scaffolded | Generates basic queries. Needs tuning for better coverage. |
| 2. Source Fetching | Stubbed | Returns empty. Needs web search integration. |
| 3. Extraction | Stubbed | Claude API calls stubbed. Needs implementation. |
| 4. Deduplication | Scaffolded | Dedup logic stubbed. Needs fuzzy matching. |
| 5. Ranking | Scaffolded | Scoring stubbed. Needs tuning. |
| 6. Gap Analysis | Scaffolded | Analysis stubbed. Needs implementation. |

**Current behavior:** Running discovery returns empty results. All steps execute but produce no real data.

---

## Key Design Decisions

### Synchronous Pipeline

Currently runs to completion (Step 1 → 2 → 3 → 4 → 5 → 6). Could be optimized later with streaming, async processing, or progressive results.

### AI-Driven Extraction

Uses Claude API for extraction instead of hand-written NER. Trades cost for flexibility and accuracy. Can improve extraction without code changes (prompt tuning).

### Deduplication as Separate Step

Rather than building dedup into extraction, it's a dedicated step. Makes the logic testable and reusable.

### Audit Trail

Every entry knows which sources it came from. Every source is timestamped. DiscoveryRun logs every pipeline execution. Enables re-runs, debugging, and understanding coverage.

---

## See Also

- [System Overview](./system-overview.md) — How pipeline fits in three-layer architecture
- [System Design](../../docs/the-atlas-system-design.md) — Complete pipeline spec
- [API Development](../development/api.md) — How to implement a pipeline step

---

Last updated: March 25, 2026
