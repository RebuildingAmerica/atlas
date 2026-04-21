# Atlas Scout: Pipeline & Indexer Design Spec

**Date:** 2026-04-11
**Status:** Draft

## Context

Atlas is a searchable directory for finding people, organizations, and initiatives working on contemporary American issues. The current pipeline (embedded in the Atlas API) runs a 6-step discovery process using the Anthropic Claude API. This design extracts the pipeline into a standalone tool called **Scout** that:

- Works with any LLM provider (Ollama, LM Studio, Anthropic, OpenAI, Google)
- Runs locally on a user's machine as a background daemon or on-demand CLI
- Runs in the cloud as a deployed service
- Scrapes, indexes, and extracts structured entity data from the web
- Automatically contributes quality discoveries to the central Atlas directory

The Atlas app and Scout are **separate but connected systems**. Scout feeds data into Atlas; it does not depend on Atlas to function.

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│  Scout (standalone Python CLI / daemon)                  │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Scheduler │  │ Pipeline │  │ Contrib  │──── HTTPS ───│──► Atlas API
│  │(APSched4) │─►│ (async   │─►│ (auto-   │              │   (review queue)
│  └──────────┘  │ streaming)│  │ submit)  │              │
│                └──────────┘  └──────────┘              │
│                     │                                    │
│                ┌────┴────┐                               │
│                │  Store  │  (~/.atlas-scout/scout.db)    │
│                │ (SQLite)│                               │
│                └─────────┘                               │
│                     │                                    │
│                ┌────┴────┐                               │
│                │   LLM   │                               │
│                │Provider │                               │
│                └─────────┘                               │
│                     │                                    │
│            Ollama / LM Studio / Anthropic / OpenAI / Google
└─────────────────────────────────────────────────────────┘
```

## Package Structure

```
atlas/
├── shared/                     # atlas-shared: shared types package
│   ├── pyproject.toml
│   └── src/atlas_shared/
│       ├── schemas/            # Entry, Source, DiscoveryRun Pydantic models
│       ├── taxonomy/           # Issue areas, search terms, entity types
│       └── contrib/            # Contribution request/response types
│
├── pipeline/                   # atlas-scout: standalone pipeline package
│   ├── pyproject.toml
│   └── src/atlas_scout/
│       ├── __init__.py
│       ├── cli.py              # CLI entrypoint (click or typer)
│       ├── config.py           # TOML-based configuration
│       ├── providers/          # LLM provider abstraction
│       │   ├── base.py         # Protocol definition
│       │   ├── ollama.py
│       │   ├── lmstudio.py
│       │   ├── anthropic.py
│       │   ├── openai.py
│       │   └── google.py
│       ├── scraper/            # Web scraping layer
│       │   ├── fetcher.py      # Async HTTP fetching (httpx)
│       │   ├── extractor.py    # HTML → clean text (trafilatura)
│       │   └── crawler.py      # 1-2 hop link follower
│       ├── steps/              # Pipeline steps (async generators)
│       │   ├── query_gen.py    # Step 1: Generate search queries
│       │   ├── source_fetch.py # Step 2: Fetch + extract page content
│       │   ├── entry_extract.py# Step 3: LLM-based entity extraction
│       │   ├── dedup.py        # Step 4: Deduplicate entries
│       │   ├── rank.py         # Step 5: Score and rank entries
│       │   └── gap_analysis.py # Step 6: Coverage gap analysis
│       ├── pipeline.py         # Streaming pipeline orchestrator
│       ├── scheduler.py        # APScheduler background execution
│       ├── store.py            # Local SQLite state management
│       └── contrib.py          # Auto-contribution to central Atlas
│   └── tests/
│
├── api/                        # Existing Atlas API (depends on atlas-shared)
│   └── atlas/domains/catalog/
│       └── api/contributions.py  # New: review queue endpoints
│
└── app/                        # Existing Atlas web app
```

### Package Dependencies

- `atlas-shared`: Pydantic, no I/O dependencies. Data types and constants only.
- `atlas-scout`: Depends on `atlas-shared`, `httpx`, `trafilatura`, `apscheduler`, plus one LLM SDK per provider (extras: `atlas-scout[ollama]`, `atlas-scout[anthropic]`, etc.)
- `atlas-api`: Depends on `atlas-shared` (replaces inline model definitions over time)

## LLM Provider Abstraction

### Interface

```python
class LLMProvider(Protocol):
    async def complete(
        self,
        messages: list[Message],
        response_schema: type[BaseModel] | None = None,
    ) -> Completion: ...

    @property
    def max_concurrent(self) -> int: ...

    @property
    def supports_structured_output(self) -> bool: ...
```

### Supported Providers

| Provider | Structured Output | Connection | Install Extra |
|----------|------------------|------------|---------------|
| Ollama | `format: json` | `http://localhost:11434` | `[ollama]` |
| LM Studio | OpenAI-compatible API | `http://localhost:1234` | `[lmstudio]` |
| Anthropic | Native tool use | API key required | `[anthropic]` |
| OpenAI | Native JSON mode | API key required | `[openai]` |
| Google | Native JSON mode | API key required | `[google]` |

### Configuration

```toml
[llm]
provider = "ollama"
model = "llama3.1:8b"
base_url = "http://localhost:11434"  # optional, provider endpoint
api_key = ""                         # optional, provider auth credential
max_concurrent = 10
```

### Minimum Capability Threshold

The pipeline requires models that can reliably produce structured JSON output matching a Pydantic schema. For providers that don't natively support structured output, the provider wrapper adds JSON extraction with validation and retry (up to 3 attempts).

No graceful degradation for weak models. If a model can't reliably extract structured entities, it's not suitable for Scout.

## Scraping & Content Extraction

### Stack

| Layer | Tool | Purpose |
|-------|------|---------|
| Search API | Brave Search | Query → result URLs (existing integration) |
| HTTP Client | `httpx` AsyncClient | Concurrent page fetching with connection pooling |
| Content Extraction | `trafilatura` | HTML → clean text, metadata extraction |
| JS Rendering | `playwright` (conditional) | For SPA pages where trafilatura returns empty |

Scout's scraping layer is commodity infrastructure. The value is in the pipeline steps above it.

### Politeness & Rate Limiting

- Per-domain rate limiting via token bucket
- `robots.txt` respect (cached per domain, refreshed daily)
- Configurable inter-request delay (default: 200ms per domain)
- User-agent: `AtlasScout/1.0 (+https://atlas.rebuildingus.org/scout)`
- Adaptive concurrency: starts at configured max, backs off on 429s/timeouts

### Page Cache

SQLite-backed, content-addressable cache to avoid re-fetching:
- Key: URL → content hash
- TTL: configurable (default 7 days)
- Enables incremental runs — Scout only fetches new or expired pages

### Link Following (Crawler)

- From discovered pages, extract outbound links
- Filter: same-domain or allow-listed domains only
- Depth limit: 2 hops maximum
- Per-seed cap: 20 pages maximum
- URL dedup before fetching

### Content Quality Filter

Before spending an LLM call, filter out:
- Pages with < 200 characters of extracted text
- Login walls / paywall indicators
- Error pages (4xx, 5xx status codes)
- Non-content pages (terms of service, privacy policy, etc.)

## Streaming Pipeline Architecture

### Design Principle: Two Dimensions of Parallelism

**Inter-step streaming (pipeline parallelism):** Steps are async generators. Step N+1 begins consuming as soon as Step N yields its first result. The pipeline doesn't wait for one step to fully complete before starting the next.

**Intra-step fan-out (task parallelism):** Within each step, multiple items are processed concurrently using `asyncio` tasks bounded by semaphores.

```
Step 1: Query Gen ──→ query1, query2, query3, ...
                         │       │       │
Step 2: Fetching    ──→ page1  page2  page3  ...  (concurrent, as queries arrive)
                         │       │       │
Step 3: Extraction  ──→ entry1 entry2 entry3 ...  (concurrent LLM calls, as pages arrive)
                         │       │       │
Step 4: Dedup       ──→ batched accumulation, emits as batches complete
Step 5: Ranking     ──→ scores each entry independently, concurrent
Step 6: Gap Analysis ─→ runs once on final materialized set
```

### Step Details

#### Step 1: Query Generation (CPU, fast)

- **Input:** `PipelineConfig(location, issues, search_depth)`
- **Output:** `AsyncIterator[SearchQuery]`
- Combines location + issue area + entity type using templates from `atlas-shared` taxonomy
- `standard` depth: ~40 queries, `deep`: ~100 queries
- Pure computation, completes in milliseconds

#### Step 2: Source Fetching (I/O-bound, highly parallel)

- **Input:** `AsyncIterator[SearchQuery]`
- **Output:** `AsyncIterator[Page]`
- For each query: hit Brave Search API, collect result URLs
- Fan out page fetches concurrently (`asyncio.Semaphore`, default 20 concurrent)
- Check page cache before fetching; store results in cache after
- Trigger link follower on pages with high relevance signals
- Stream pages to Step 3 as they complete — don't wait for all queries
- **Concurrency:** 10-50 concurrent fetches (configurable)

#### Step 3: Entry Extraction (LLM-bound, parallel)

- **Input:** `AsyncIterator[Page]`
- **Output:** `AsyncIterator[RawEntry]`
- For each page: send to LLM with extraction prompt requesting structured output
- LLM returns: `list[Entity(name, type, location, description, contact_info, source_url)]`
- Fan out LLM calls concurrently (bounded by `provider.max_concurrent`)
- Pages yielding no entities are dropped silently
- **Concurrency:** 5-20 concurrent LLM calls (provider-dependent)

#### Step 4: Deduplication (CPU, batch-parallel)

- **Input:** `AsyncIterator[RawEntry]`
- **Output:** `AsyncIterator[DeduplicatedEntry]`
- Accumulates entries in batches (default batch size: 50)
- Within batch: locality-sensitive hashing on `name + location` for candidate pairs
- Pairwise fuzzy string matching (name similarity, location proximity)
- Merge duplicates: combine source lists, keep best metadata per field
- Running cross-batch index: `content_hash → canonical_entry` to catch cross-batch dupes
- Emits deduplicated entries as each batch completes

#### Step 5: Ranking (CPU, embarrassingly parallel)

- **Input:** `AsyncIterator[DeduplicatedEntry]`
- **Output:** `AsyncIterator[RankedEntry]`
- Score each entry independently on:
  - Source quality (number + diversity of corroborating sources)
  - Specificity (detailed description, contact info present, location precision)
  - Recency (source publication date)
  - Issue relevance (alignment with configured issue areas)
- Normalize to 0.0–1.0 range
- Filter below configurable threshold (default: 0.3)

#### Step 6: Gap Analysis (LLM, batch)

- **Input:** All ranked entries (materialized from stream)
- **Output:** `GapReport`
- Analyzes coverage across dimensions:
  - Geographic (which areas of the location are underrepresented?)
  - Demographic (missing perspectives?)
  - Issue area (which configured issues have few results?)
  - Entity type (all orgs but no individuals? no initiatives?)
- Suggests follow-up search queries to fill gaps
- Optional: feed suggestions back to Step 1 for iterative deepening

### Multi-Run Parallelism

Multiple discovery runs (different locations/topics) can execute concurrently as independent pipeline instances. A `RunManager` enforces system-wide resource limits:

- Max concurrent runs (default: 2)
- Shared semaphores for HTTP and LLM calls across runs
- Per-run progress tracking

## Scheduling & Background Execution

### Daemon Mode

Scout runs as a long-lived background process using APScheduler v4 with SQLite job store.

```bash
scout daemon start    # Start background scheduler
scout daemon stop     # Stop gracefully
scout daemon status   # Show next run, active runs, recent results
```

### On-Demand Execution

```bash
scout run --location "Austin, TX" --issues housing,education
scout run --location "Houston, TX" --issues healthcare --depth deep
scout runs list       # List past/active runs
scout runs inspect <run-id>   # Detailed results
scout runs cancel <run-id>    # Cancel in-flight run
```

### Configuration

```toml
[schedule]
enabled = true
cron = "0 2 * * *"            # Daily at 2am
max_concurrent_runs = 2
retry_failed_after = "6h"

[[schedule.targets]]
location = "Austin, TX"
issues = ["housing", "education"]
search_depth = "standard"

[[schedule.targets]]
location = "Houston, TX"
issues = ["healthcare", "infrastructure"]
search_depth = "deep"
```

### Run Lifecycle

States: `PENDING` → `RUNNING` → `COMPLETED` | `FAILED` | `PARTIAL`

- Each run gets a UUID
- Progress tracked per-step (e.g., "fetching: 30/42 pages")
- Runs are cancellable mid-flight
- Failed runs can be retried

## Local Storage

Scout maintains its own SQLite database at `~/.atlas-scout/scout.db`:

| Table | Purpose |
|-------|---------|
| `runs` | Run history: id, config, status, timestamps, stats |
| `pages` | Page cache: url, content_hash, text, metadata, fetched_at, ttl |
| `entries` | Discovered entries: id, run_id, name, type, location, description, sources, score |
| `contributions` | Submission log: entry_id, submitted_at, status, central_entry_id |
| `schedule_jobs` | APScheduler job store |

Scout's local DB is its complete source of truth. It does not depend on the Atlas API to function.

## Contribution to Central Atlas

### Design Goal: Set Once, Forget

Contribution is **opt-in once, then fully automatic**. After a user enables it, every run automatically submits quality entries to the central Atlas review queue. No per-run manual approval.

### Configuration

```toml
[contribution]
enabled = true
api_key = "sk-..."                     # Issued from Atlas web UI
atlas_url = "https://atlas.rebuildingus.org"
min_score = 0.7                        # Only submit entries scoring above this
```

### Flow

1. After each pipeline run completes, entries scoring ≥ `min_score` are serialized using `atlas-shared` schemas
2. Authenticated POST to `{atlas_url}/api/v1/contributions` (batch endpoint)
3. Atlas API creates entries in the **review queue** (not the public directory)
4. Operator reviews and approves/rejects via Atlas web UI
5. Scout stores submission status locally in `contributions` table
6. Background sync periodically checks contribution status (approved/rejected/merged)
7. On failure (network, auth, server error): retry with exponential backoff, log locally

### Deduplication at Submission

- Each entry includes a `content_hash` (based on normalized name + location)
- Central Atlas deduplicates across submissions from different Scout instances
- If an entry was already submitted (by this or another Scout), the submission is acknowledged without creating a duplicate review item

### CLI Overrides

```bash
scout contributions list              # See what was submitted and status
scout contributions list --pending    # See what's awaiting review
scout contribute --run <id>           # Manually submit a specific run's entries
scout contribute --dry-run            # Preview what would be submitted
```

## Configuration Summary

### Directory Layout

Scout stores configuration and data in OS-standard locations:

| Platform | Config dir | Data dir |
|----------|-----------|----------|
| macOS | `~/Library/Application Support/atlas-scout/` | (same) |
| Linux | `$XDG_CONFIG_HOME/atlas-scout/` (default `~/.config/atlas-scout/`) | `$XDG_DATA_HOME/atlas-scout/` (default `~/.local/share/atlas-scout/`) |
| Windows | `%APPDATA%\atlas-scout\` | `%LOCALAPPDATA%\atlas-scout\` |

Key paths within the config dir:

```
<config-dir>/
├── settings.toml             # Persistent settings (active profile, etc.)
└── configs/
    ├── default.toml           # The initial/default profile
    ├── laptop.toml            # Example: conservative local settings
    └── studio.toml            # Example: beefy remote machine via Tailscale
```

### Profiles

Configuration profiles are TOML files in the `configs/` directory. Each profile
is a standalone configuration — any profile can be renamed freely.

The **active profile** is tracked in `settings.toml`, not by filename:

```toml
# settings.toml
active_profile = "studio"
```

When no `--config` or `--profile` flag is given, Scout loads whichever profile
is named in `settings.toml` (defaulting to `"default"` if the file is missing).

**Managing profiles:**

```bash
# List available profiles and see which is active
scout config profiles

# Switch the active profile
scout config use-profile studio

# One-off override without changing the active profile
scout --profile laptop run ...

# Load an arbitrary config file
scout --config /path/to/custom.toml run ...
```

### Example Profile

```toml
[llm]
provider = "ollama"
model = "llama3.1:8b"
base_url = "http://localhost:11434"
api_key = ""
max_concurrent = 10

[scraper]
max_concurrent_fetches = 20
page_cache_ttl_days = 7
follow_links = true
max_link_depth = 2
max_pages_per_seed = 20
request_delay_ms = 200

[pipeline]
dedup_batch_size = 50
min_entry_score = 0.3
gap_analysis = true
iterative_deepening = false   # Feed gap queries back to step 1

[schedule]
enabled = true
cron = "0 2 * * *"
max_concurrent_runs = 2

[[schedule.targets]]
location = "Austin, TX"
issues = ["housing", "education"]
search_depth = "standard"

[contribution]
enabled = false               # Opt-in
api_key = ""
atlas_url = "https://atlas.rebuildingus.org"
min_score = 0.7

[store]
path = "~/.atlas-scout/scout.db"
```

## Verification Plan

### Unit Tests
- Each pipeline step tested independently with mock inputs
- Provider abstraction tested with mock LLM responses
- Scraper tested against recorded HTTP fixtures
- Dedup tested with known duplicate/non-duplicate pairs
- Config parsing and validation

### Integration Tests
- Full pipeline run with a mock LLM provider and recorded HTTP responses
- Scheduler creates and executes runs correctly
- Contribution submission and status sync against a test Atlas API
- Page cache hit/miss behavior
- Multi-run concurrency with shared resource limits

### End-to-End Verification
1. Install `atlas-scout` locally
2. Configure with Ollama (running locally) and Brave Search API key
3. Run: `scout run --location "Austin, TX" --issues housing`
4. Verify: entries discovered, stored in local SQLite, scores assigned
5. Enable contribution, verify entries appear in Atlas review queue
6. Start daemon, verify scheduled runs execute on time
