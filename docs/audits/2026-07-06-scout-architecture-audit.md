# Scout Architecture Audit — SRP, LSP, DIP, and Modularization

Date: 2026-07-06

Audit target: `scout/` at commit `20a53d2` (origin/main), before the Phase 0-2
cleanup applied on branch `chore/scout-architecture-audit-cleanup`.

Raw artifacts (per-cluster findings, dependency graph, two independent structure
proposals, synthesis, completeness critique — 22 agents total): retained in this
session's workflow transcript; this document is the synthesized, human-reviewed
report.

## Why this audit

Atlas is preparing to open-source this repo. Scout's code organization is
currently a significant barrier to that: the CLI entrypoint is 4,914 lines
covering ~10 unrelated features, the persistence layer is a 1,729-line god
object imported directly by 7 unrelated modules, and several other files mix
concerns that make it hard for an external contributor to safely touch one
feature without reading through thousands of lines of unrelated code. Per this
repo's first principle, trust is the core experience — two of the findings below
are actual correctness bugs (a silently-broken verification step, dead ingestion
code), which is exactly the "wrong data shown confidently" failure mode that
matters most before external eyes are on this code.

## Method

An 22-agent audit workflow: a dependency-graph analysis plus 17 parallel cluster
audits covering every file in `scout/src` against SRP, LSP, DIP, and
file-size/modularization smells; two independent "ideal structure" proposals
generated from different angles (layered-by-architecture vs. feature-vertical);
a synthesis pass reconciling both; and a completeness critique of that synthesis
against the raw findings. Four items the critique caught as under-surfaced in
the first synthesis pass are restored below (marked in their descriptions).

## Executive summary

Scout's cross-module _direction_ is actually sound —
`cli/daemon → pipeline/scheduler → steps → scraper/providers → store/config` is
respected everywhere, and no import cycles exist anywhere in the package. But
nearly every individual file has become a multi-concern dumping ground: `cli.py`
is 4,914 lines / 261 top-level functions mixing argument parsing, direct
persistence, external HTTP calls, and non-trivial business logic for a dozen
unrelated features; `store.py` is a 1,729-line, ~46-method "god object" imported
directly by 7 unrelated modules with no narrower interface in front of it; and
`steps/entry_extract.py` (1,854 lines) and `pipeline.py` (1,169 lines, with one
875-line function) each interleave orchestration, caching, prompt-building,
parsing, and heuristic business rules in one place.

The single biggest pre-open-source risk is trust/correctness in the discovery
pipeline itself: `steps/verify.py` was dead code whose entity-verification loop
was a silent no-op (it always appended regardless of the verification result),
and `steps/contribute.py`'s `contribute_entries` has zero production callers —
exactly the "wrong data shown confidently" failure mode that undermines Atlas's
core promise, and it was invisible because nothing exercised these paths.
(`verify.py` has been removed as part of this audit's first cleanup pass — see
"Phase 0-2" below.)

The secondary risk is contributor onboarding: an external contributor cannot
safely touch one feature (worker jobs, Guardian ingestion, local-model setup,
daemon scheduling) without first reading through thousands of lines of unrelated
CLI/persistence code, which will suppress exactly the kind of community
contribution open-sourcing is meant to invite. Six flat files share a `cli_`
prefix without a real `cli/` package (plus `doctor.py`/`doctor_output.py` and
`local_models.py`/ `local_provider_bootstrap.py` pairs), and the daemon
subsystem's prior partial extraction left a ~250-line compatibility shim in
`cli.py` that exists solely to keep old monkeypatch-based tests passing — a
preview of the kind of accreted debt a full restructuring must actively remove,
not just relocate.

## Tooling drift discovered during this audit

Three things worth flagging alongside the code-organization findings, matching
the pattern the prior `2026-07-04-atlas-web-audit.md` also found ("regression
tooling has command drift"):

- **The 100% coverage gate is not actually enforced for scout in CI.**
  `pyproject.toml` declares `--cov-fail-under=100`, but `scout/package.json`'s
  `test` script (the one CI actually runs via `pnpm run test:ci` → turbo) passes
  `--no-cov`, which overrides it. Running `uv run pytest` directly (without
  `--no-cov`) currently shows 89.55% coverage — a pre-existing gap CI has never
  caught. This document's own baseline check uses the actual CI-invoked command.
- **Scout has no wired-up `typecheck` task.** `scout/package.json` defines only
  a `test` script; there is no `typecheck` script for Turbo's `typecheck` task
  to run, so `mypy` never runs against scout in CI. Running it manually surfaces
  4 pre-existing errors, all in `steps/entry_extract.py` (unrelated to this pass
  — that file was not touched).
- **The repo's `.githooks/pre-commit` Python quality gate is scoped to `api/`
  only.** Staging scout `.py` changes triggers "No Python files staged (none in
  api/), skipping api/ checks" — ruff/mypy checks on scout code are not enforced
  pre-commit either. This pass ran `ruff format`, `ruff check`, and `mypy`
  manually against every file it touched to compensate.

None of these are addressed by this pass beyond documenting them — deciding
whether to re-enable coverage/typecheck enforcement for scout is a deliberate
call for whoever owns CI, not a drive-by fix bundled into an architecture audit.

## What's already good (worth preserving, not rebuilding)

- **`providers/`** is the codebase's best existing DIP example: `base.py`
  defines a `Protocol`, `providers/__init__.py`'s factory is the only place
  (besides `local_models.py`'s constants-only import) that imports concrete
  provider classes, and all orchestration code types exclusively against the
  `Protocol`. All three providers (Anthropic/Ollama/LMStudio) implement
  `cache_identity`/`aclose()` consistently even though neither is declared on
  the `Protocol` yet (see finding #24).
- **`scraper/`** is the closest thing in the repo to a well-formed subpackage: a
  real directory (not a flat prefix scheme), a matching `tests/test_scraper/`
  subpackage, a narrow public surface via `__init__.py`, and `crawler.py` in
  particular is a clean ~100-line module using a `PageFetcher` Protocol for DI.
- **`local_models.py`**/`local_provider_bootstrap.py` cleanly separate probing
  from resolution and consistently use dependency-injected callables with real
  defaults — exactly the DIP pattern several `cli.py` wrappers around them
  should have used instead of monkeypatching.
- **`entries_commands.py`** (despite its own findings below) and the
  daemon/auth/search commands in `cli.py` are already proof that thin
  Click-wrapper-delegating-to-a-real-module is a pattern this codebase knows how
  to do — the fix for the rest of `cli.py` is "do what these already do," not
  invent a new pattern.
- **`credentials.py`**'s `CredentialStore` Protocol is clean and minimal, and
  both concrete implementations honor its contract consistently — no real LSP
  violation there today.

## Ranked findings

27 findings, high severity first (24 high, no medium omitted). Four of these
(marked in their text) were caught by a completeness critique as under-surfaced
in the first synthesis pass and are restored here; one (entries feature logic)
has its severity restored to high per the same critique.

### 1. [HIGH] ScoutStore is a 1,729-line, ~46-method god object with no narrower interface

**Principle(s):** SRP + DIP (god dependency)  
**Files:** `store.py`, `fetcher.py`, `entry_extract.py`, `pipeline.py`,
`scheduler.py`, `cli_daemon.py`, `entries_commands.py`, `cli.py`

One class bundles 9 unrelated persistence concerns (daemon lifecycle, run
tracking, page cache, articles, page tasks, extraction cache, work-claim
leasing, entries, schema DDL). Seven unrelated high-level modules import the
concrete class directly and each uses a small, largely disjoint 4-10 method
slice, with no Protocol/interface narrowing the surface — a change to any one
concern risks rippling into consumers that never touch it, and nothing can be
tested against a narrow fake.

### 2. [HIGH] cli.py is a 4,914-line, 261-function monolith mixing every concern for every command

**Principle(s):** SRP + file-size  
**Files:** `cli.py`

Click argument parsing, direct ScoutStore instantiation (~12 sites), raw httpx
usage for Guardian import, non-trivial domain logic (date-window generation,
dedup, mention extraction with ~113 lines of stopword tables), and Rich-table
presentation are all interleaved in one file across at least 10 independent
feature areas (local-model setup, login, daemon, worker, config, setup wizard,
articles, entries, pages, sync).

### 3. [HIGH] cli.py's `run()` command mixes config mutation, validation, local-model bootstrap, and presentation in one 130-line function

**Principle(s):** SRP  
**Files:** `cli.py`

run() (lines 1252-1381) is the command users invoke most, and it does config
mutation, input assembly, business validation, local-model bootstrap, banner
presentation, and dispatch all in one function. This was rated HIGH in the raw
per-cluster audit but only survived the first synthesis pass folded generically
into the catch-all "cli.py is a monolith" finding — called out here explicitly
because its fix (discovery/run_request.py, a pure assembly/validation module
with no Click/I/O) is a distinct, independently valuable extraction, not just a
side effect of shrinking cli.py.

### 4. [HIGH] `_run_pipeline` constructs concrete `ScoutStore`/`AsyncFetcher`/`LLMProvider` directly from two call sites ~1,600 lines apart

**Principle(s):** DIP  
**Files:** `cli.py`

_run_pipeline (cli.py lines 1383-1476) is the composition root that wires
persistence, fetching, and the LLM provider together for a discovery run — but
it's a private helper duplicated in spirit by the worker subsystem, which needs
the identical wiring ~1,600 lines away and currently doesn't share it. This was
rated HIGH in the raw audit and is addressed in the proposed structure by
discovery/pipeline_runner.py, called from both `run` and worker/runtime.py, but
had no standalone bullet in the first synthesis pass.

### 5. [HIGH] Daemon-lifecycle compatibility shim in cli.py is pure dead-weight duplication

**Principle(s):** duplication + testability  
**Files:** `cli.py`, `cli_daemon.py`

cli.py re-implements all 18 cli_daemon.py functions as monkeypatch-syncing
wrapper functions (_sync_daemon_module, _DAEMON_PATCH_TARGETS, ~15 _ORIGINAL_*
casts) whose only purpose is keeping legacy tests that patch atlas_scout.cli
working after the real logic moved to cli_daemon.py. This should be deleted, not
migrated, with tests rewritten to patch the daemon module directly.

### 6. [HIGH] Worker subsystem duplicates the daemon's background-process lifecycle instead of sharing it

**Principle(s):** SRP + duplication  
**Files:** `cli.py`, `cli_daemon.py`

~610 lines in cli.py (state.py-shaped JSON persistence, an ad hoc httpx
worker-API client, job-payload parsing, heartbeat/process lifecycle) reimplement
the same 'spawn detached subprocess, track PID, signal-to-stop, poll' shape
already built for the daemon in cli_daemon.py, even reusing the daemon-named
_signal_daemon_process helper cross-domain. No shared abstraction exists for the
two nearly-identical lifecycles.

### 7. [HIGH] steps/entry_extract.py (1,854 lines) bundles 9 heuristic strategies, an LLM two-pass pipeline, caching, and prompt/parsing logic in one file

**Principle(s):** SRP + file-size  
**Files:** `entry_extract.py`

The dispatcher (_run_provider_extraction) hardcodes a 9-way if-chain naming
every heuristic function instead of iterating a registry;
roster/legislature/structured-resource parsers, LLM prompt-building, response
parsing, and fingerprint caching are all interleaved in one module far larger
than any sibling step file (next largest is ~194 lines).

### 8. [HIGH] Two independently-maintained name-normalization vocabularies silently diverge

**Principle(s):** duplication  
**Files:** `entry_extract.py`

Roster-side _strip_civic_title_prefix (a hardcoded tuple of honorifics) and
structured-side _normalize_structured_person_name/_STRUCTURED_NAME_* (a richer,
separate vocabulary) both solve 'strip honorific/credential from a civic
official's name', and the structured path even partially calls the roster
helper. A future fix to one honorific list (e.g. adding 'Councilwoman') will
silently not apply to the other.

### 9. [HIGH] pipeline.py's 875-line run_pipeline function owns 7+ distinct responsibilities with 4x-duplicated deepening logic

**Principle(s):** SRP + duplication + file-size  
**Files:** `pipeline.py`

run_pipeline (lines 96-970) drives frontier scheduling, fetch/extract worker
pools nested as nine-closures-over-shared-mutable-state, a 195-line 'iterative
deepening' block that repeats the identical fetch→remember→extract sequence 4
times verbatim, finalization/ranking, artifact building, and Atlas sync — none
of which is independently unit-testable without running the whole coroutine.

### 10. [HIGH] pipeline_support.py is itself a 5-concern dumping-ground module, not just a legitimate shared-utility file

**Principle(s):** SRP  
**Files:** `pipeline_support.py`

Extraction-admission policy (decide_extraction_admission), URL/domain logic
(normalize_url, same_domain, parse_location, merge_discovered_links),
provider-identity detection, text cleanup (strip_code_fence), and async cleanup
(close_if_supported) each have a disjoint caller set and no shared reason to
change together. This was rated HIGH in the raw per-cluster audit and had no
standalone ranked_issues bullet in the first synthesis pass, even though its
remediation appears in file_mapping. Note: a completeness critique of the first
draft also flagged the proposed 3-4-way split (urls.py / text_cleanup.py /
async_utils.py / frontier.py) as a mild over-fragmentation risk —
text_cleanup.py in particular would hold one ~4-line function. A 2-way split
(url/text helpers vs. async/admission helpers) likely serves the same goal with
less sprawl; worth deciding at execution time rather than defaulting to the
maximal split.

### 11. [HIGH] steps/verify.py is dead code whose own filter is a silent no-op

**Principle(s):** correctness / dead code  
**Files:** `verify.py`

verify_entries is never imported by pipeline.py, cli.py, or steps/**init**.py,
and even if wired in, its loop computes is_verified per entity but
unconditionally appends every entry regardless of the result — contradicting its
own docstring's claim to validate that extracted entities exist. Must be
fixed-and-wired or deleted before shipping; leaving it as-is risks a maintainer
believing verification runs when it never does.

### 12. [HIGH] steps/contribute.py's contribute_entries has zero production callers

**Principle(s):** correctness / dead code  
**Files:** `contribute.py`

Only sync_run_artifacts (a different function in the same file) is actually
called from pipeline.py/cli.py; contribute_entries and its distinct HTTP
endpoint/payload shape are unreachable. Shipping two competing 'push to Atlas'
code paths, only one of which is live, invites confused external contributors.

### 13. [HIGH] Local-model onboarding subsystem (~375 lines, 21 functions) embedded in cli.py instead of beside the modules it wraps

**Principle(s):** SRP  
**Files:** `cli.py`, `local_models.py`, `local_provider_bootstrap.py`

Provider discovery, install confirmation, model resolution, interactive
selection, and persistence live as loose module-level functions in cli.py, built
directly on local_models.py/local_provider_bootstrap.py, which already exist as
scoped modules. Four one-line pass-through wrappers exist solely to give tests a
private cli.py attribute to monkeypatch instead of real dependency injection.

### 14. [HIGH] Guardian article-ingestion feature is embedded whole inside cli.py

**Principle(s):** SRP  
**Files:** `cli.py`

~600 lines covering HTTP pagination, third-party API schema mapping, NLP-ish
mention extraction (with ~113 lines of stopword/trim-word tables), date-window
math, and CSV/JSON export are embedded in a file whose only stated job is CLI
wiring — with zero store/CLI dependency in the mention-extraction portion,
proving it doesn't belong there.

### 15. [HIGH] config/setup command surface mixes 4 unrelated sub-domains and duplicates local-model persistence logic

**Principle(s):** SRP + duplication  
**Files:** `cli.py`

The single `config` Click group mixes profile-file lifecycle, generic scalar
get/set, a local-model wizard, and schedule-target CRUD; the setup wizard
(_setup_onboarding, 64 lines) serially runs 5 unrelated phases with no internal
seams; and the 'resolve→choose→apply→persist→print' local-model sequence is
duplicated near-verbatim between `config model` and `setup`.

### 16. [HIGH] Flat `cli_*` files fake a namespace instead of forming a real subpackage

**Principle(s):** modularization / fake namespacing  
**Files:** `cli_context.py`, `cli_errors.py`, `cli_output.py`,
`cli_progress.py`, `cli_select.py`, `cli_daemon.py`, `doctor.py`,
`doctor_output.py`, `local_models.py`, `local_provider_bootstrap.py`

Six files share a `cli_` prefix (and doctor.py/doctor_output.py,
local_models.py/local_provider_bootstrap.py form similar pairs) living flat in
the package root instead of real `cli/`, `doctor/`, and `local_model/`
subpackages — the naming implies cohesion the directory structure doesn't
provide, and cli_output.py (321 lines) itself mixes 4 unrelated presentation
domains (status colors, device-auth/QR rendering, local-model help text, run
reporting).

### 17. [HIGH] doctor.py bundles DTOs, orchestration, check-building, scoring, and concrete I/O adapters in one 620-line file

**Principle(s):** SRP  
**Files:** `doctor.py`

Data models, run_doctor orchestration, check-builder functions,
readiness/capability scoring, and concrete adapters (httpx probe,
SystemCredentialStore probe, local-model probe, worker-state file read, process
check) are all in one module; DoctorDependencies' default callables point at
same-file concrete implementations, so the orchestration module can't be
imported without pulling in every concrete provider.

### 18. [HIGH] scraper/fetcher.py (601 lines) bundles 5 distinct responsibilities and types against concrete ScoutStore

**Principle(s):** SRP + DIP  
**Files:** `fetcher.py`

Raw HTTP transport, a distributed work-claim/poll coordination protocol,
page-cache read/write, browser-fallback decision heuristics (pure functions with
zero HTTP dependency), and PDF extraction are all in AsyncFetcher, which also
stores `self._store: ScoutStore | None` and calls only 6 of the class's ~46
methods — the lowest layer in the stack is coupled to the largest, most
multi-purpose class in the codebase.

### 19. [HIGH] scraper/browser_researcher.py inverts the intended layering by importing steps/entry_extract

**Principle(s):** layering / SRP  
**Files:** `browser_researcher.py`

research_org_website mixes Playwright browser automation, LLM-driven link
selection, and a full entity-extraction call (extract_page_entries, imported
from atlas_scout.steps.entry_extract) inside a module nominally in the scraper/
(page-fetching) layer — a module under scraper/ reaching upward into steps/
inverts the expected dependency direction and pipeline.py imports it directly,
creating a layer-crossing dependency.

### 20. [HIGH] auth.py bundles 5 unrelated concerns including a test-only double in production code

**Principle(s):** SRP  
**Files:** `auth.py`

OAuth device-flow HTTP client + payload validation, domain dataclasses, local
session-file persistence, a Playwright-e2e-only credential-store test double
(E2EFileCredentialStore, selected via an env-var switch), and credential-store
selection policy are all in one 533-line file, coupling production session code
to test infrastructure.

### 21. [HIGH] config.py bundles 7 unrelated concerns and hardcodes provider dispatch logic in 4 separate places

**Principle(s):** SRP + DIP  
**Files:** `config.py`, `local_models.py`, `local_provider_bootstrap.py`,
`__init__.py`

OS path resolution, settings I/O, 8 Pydantic schema classes, a hand-rolled TOML
writer, a generic scalar editor, schedule-target CRUD, and secret scrubbing are
one 637-line file; LLMConfig's provider-dispatch methods hardcode literal
'ollama'/'lmstudio' strings that duplicate the canonical registry already
defined independently in local_models.py, local_provider_bootstrap.py, and
providers/**init**.py — four places encode the same domain fact with no single
source of truth.

### 22. [HIGH] cli_daemon.py mixes OS process control, persistence I/O, and console presentation in one 458-line module

**Principle(s):** SRP  
**Files:** `cli_daemon.py`

Process introspection/signaling/spawning, async polling loops, ScoutStore-backed
persistence, Click-exception validation, and Rich console rendering (including
console.print calls embedded directly inside _daemon_status/_daemon_start) are
all interleaved; _daemon_interval_metadata also reaches into scheduler.py's
private underscore-prefixed _cron_to_interval instead of a shared public
utility.

### 23. [HIGH] entries feature logic is split inconsistently between entries_commands.py and cli.py

**Principle(s):** SRP + cohesion  
**Files:** `entries_commands.py`, `cli.py`

`entries stats`/`entries purge` were extracted to entries_commands.py, but
`entries list`/`export entries` (the bulk of the feature, ~255 lines) were left
inline in cli.py, so a reader can't predict which entries logic lives where.
entries_commands.py itself also interleaves click-exception validation, direct
ScoutStore instantiation, and Rich/JSON presentation in the same functions,
duplicating a store-open pattern that cli_daemon.py already factored into a
reusable helper. A completeness critique of the first synthesis pass caught this
as a silent severity downgrade from the raw per-cluster audit (which rated it
HIGH: entries_stats_command/entries_purge_command mix CLI-framework validation,
domain I/O, business-rule threshold checks, and presentation in one 190-line
file) — restored to HIGH here.

### 24. [MEDIUM] LLMProvider Protocol omits members every concrete provider implements, forcing private-attribute duck-typing

**Principle(s):** LSP  
**Files:** `base.py`, `entry_extract.py`

All three providers (Anthropic/Ollama/LMStudio) consistently implement
cache_identity and aclose(), but neither is declared on the LLMProvider
Protocol, forcing steps/entry_extract.py's _provider_cache_key to getattr() into
the private _model attribute as a fallback. Separately, no call site ever calls
aclose() on a created provider, leaking the httpx.AsyncClient each one opens.

### 25. [MEDIUM] Brave search is a hardcoded concrete dependency duplicated verbatim in two files

**Principle(s):** DIP + duplication  
**Files:** `source_fetch.py`, `verify.py`

Unlike the LLM side (which depends on providers.base.LLMProvider), Brave
Search's endpoint URL, auth-header pattern, and error handling are duplicated
byte-for-byte between source_fetch.py's _search_brave and verify.py's
_reverse_search, with no SearchProvider protocol comparable to LLMProvider.

### 26. [MEDIUM] Fetch/extract-worker closures in pipeline.py capture ~15 shared mutable variables, making them untestable in isolation

**Principle(s):** testability  
**Files:** `pipeline.py`

fetch_worker and extract_worker are nested closures inside run_pipeline
reading/writing frontier_queue, stats, page_outcomes_by_task, seen_urls, and
more by closure capture rather than parameters; neither can be imported or
unit-tested without constructing the entire run_pipeline call frame, forcing the
966-line test_pipeline_throughput.py to drive full end-to-end runs for every
branch.

### 27. [MEDIUM] Two export writers (articles, entries) duplicate identical json/jsonl/csv dispatch logic

**Principle(s):** duplication  
**Files:** `cli.py`

_write_article_export/_article_export_csv_row and
_write_entry_export/_entry_export_csv_row have identical branching structure
differing only in which fieldnames constant/row-mapper is passed, instead of one
shared write_records() utility.

## Proposed target structure

Reconciling two independently-generated proposals — one organized by
architectural layer, one by feature vertical. The feature-vertical skeleton was
adopted as the base, because a new open-source contributor's first question is
almost always "how does feature X work end-to-end?" (worker jobs, Guardian
ingestion, daemon scheduling, local-model setup) rather than "show me the
persistence layer as a horizontal slice" — a feature-vertical layout lets that
question be answered by reading one subpackage top to bottom. Two ideas from the
layered proposal were folded in regardless: the explicit
narrow-Protocol-per-repository pattern (distributed to each protocol's owning
vertical rather than centralized, since a protocol used by only one or two
verticals is easier to find beside its implementation), and the `LLMProvider`
Protocol extension (`cache_identity` + `aclose()`). Where both proposals agreed
— the `ScoutStore` decomposition into per-aggregate repos, `entry_extract.py`'s
`heuristics/` subpackage, deleting (not migrating) the daemon monkeypatch shim,
and flagging `verify.py`/ `contribute.py` as maintainer decisions rather than
silent relocations — this structure follows both.

```
src/atlas_scout/
  __init__.py                      # package metadata, unchanged

  cli/                             # composition root ONLY — shared UI primitives + main() registration; no business logic
    __init__.py                    # main() Click group; attaches every vertical's cli_commands group (target <150 lines, replacing 4914)
    context.py                     # console/err_console singletons (was cli_context.py)
    errors.py                      # CliError dataclass (was cli_errors.py)
    output.py                      # generic status-color styling + print_cli_error only — domain-specific presentation moves to its vertical
    progress.py                    # ProgressRenderer: live pipeline-event rendering during a run
    select.py                      # arrow-key picker + one shared select_or_abort()/pick_from_list() helper, replacing 3 duplicated wrappers
    option_parsing.py              # tiny generic click-option parsers (structured columns, issue lists) with no feature-specific meaning

  config/                          # profile-file lifecycle, TOML I/O, generic scalar get/set — NOT feature business logic
    paths.py / settings.py / schema.py / toml_io.py / errors.py / scalar_editor.py / cli_commands.py
                                    # LLMConfig kept as flat data only; provider-dispatch logic moves to local_model/registry.py;
                                    # schedule-target CRUD moves to daemon/schedule_config.py since it's scheduling business logic, not config mechanics

  credentials/                     # OS-keychain secret storage, shared infra with no CLI surface of its own
    protocol.py                    # CredentialStore Protocol + CredentialStoreError (storage-agnostic)
    system_store.py                # keyring-backed SystemCredentialStore

  auth/                            # login/session vertical — owns its full stack top to bottom
    device_client.py / models.py / session_store.py / e2e_credential_store.py / login_flow.py / token_refresh.py / presentation.py / cli_commands.py
                                    # token_refresh.py is the ONE place a saved session is exchanged for an API token (kills 2 duplicated inline exchanges)

  search/                          # search-provider connection + query vertical
    keys.py                        # search API key resolution/storage (was search_keys.py)
    provider.py                    # NEW SearchProvider Protocol + BraveSearchProvider, mirroring providers/base.py's pattern; consolidates the duplicated Brave client
    cli_commands.py                # `search connect/status/disconnect`

  local_model/                     # local LLM discovery & onboarding vertical
    registry.py                    # canonical provider-name registry + provider-dispatch free functions (single source of truth, absorbs config.py's LLMConfig methods)
    probing.py                     # HTTP probes against running ollama/lmstudio servers
    resolution.py                  # resolve/apply/select + ranking business logic
    bootstrap.py                   # install/start a local provider server (was local_provider_bootstrap.py)
    onboarding.py                  # pure decide/resolve-and-persist sequencing, no console I/O; one resolve_and_persist_local_model() used by both `config model` and `setup`
    prompts.py                     # interactive pickers/tables/confirms (console I/O layer only)
    cli_commands.py                # `config model` subcommand

  setup/                           # first-run onboarding wizard vertical
    wizard.py                      # phased onboarding (profile -> session -> shell integration -> local model), each phase a named function
    profile_picker.py              # SetupProfileChoice + profile selection/creation prompts
    cli_commands.py                # `setup` command

  shell_integration/                # shell completion + man-page install
    environment.py / completion_paths.py / completion_install.py
    manpages/{collect,render,install}.py   # Click-tree walk / pure roff render / atomic file install, each independently testable

  diagnostics/                     # `scout doctor` vertical (was doctor.py + doctor_output.py)
    models.py / probes.py / checks.py / capabilities.py / report.py / output.py / cli_commands.py
                                    # probes.py isolates every concrete I/O adapter so report.py's orchestrator depends only on injected callables

  daemon/                          # local scheduler-daemon vertical
    process.py                    # generic OS process control (spawn/signal/is-running), shared with worker/process.py
    store.py                      # DaemonStateRepository — narrow slice of the old ScoutStore, only this vertical's concern
    state.py                      # claim/staleness/conflict business logic over the repo
    cron.py                       # cron-expression -> interval parsing, made public (was scheduler.py's private _cron_to_interval)
    scheduler.py                  # run_schedule_once/run_schedule_loop async orchestration
    schedule_config.py            # ScheduleConfig/ScheduleTarget CRUD (moved from config.py — this is scheduling logic, not generic config)
    lifecycle.py                  # compose process+state+scheduler into start/stop/status/run-internal; returns data, no printing
    presentation.py               # render run/tick summaries + status printing
    cli_commands.py               # `daemon` group + `schedule` group + `config schedule ...` subcommands (attaches onto config's group object for CLI-surface continuity)

  worker/                          # Atlas remote-job worker vertical
    state.py / api_client.py / jobs.py / runtime.py / process.py / cli_commands.py
                                    # api_client.py is a WorkerApiClient class mirroring auth/device_client.py's error-handling shape, not ad hoc httpx;
                                    # process.py shares its spawn/signal primitive with daemon/process.py instead of duplicating it

  discovery/                       # the core discovery-pipeline vertical — intentionally 3 levels deep, justified by where 5+ clusters of findings concentrated
    pipeline.py                    # slimmed run_pipeline: top-level sequencing only (~150-250 lines vs. current 875-line function)
    frontier.py                    # URL frontier production/admission + search-frontier fanout (via search.SearchProvider, not a private import)
    workers.py                     # fetch/extract-worker pool as an explicit state-holding class, not closures — independently unit-testable
    run_artifacts.py               # build DiscoveryRunArtifacts from run state
    entries_output.py              # rank -> bulk_save_entries mapping, via entries' narrow EntryWriter protocol
    run_request.py                 # pure assembly/validation of a `scout run` invocation, no Click/no I/O
    pipeline_runner.py             # composition root: wire store/fetcher/provider, invoke, trigger sync — the ONE place both `run` and worker call it from
    run_sync.py                   # resolve run ids + upload run artifacts to Atlas (RunSelectionError/SyncUploadError replace overloaded ScoutSyncError)
    run_sync_output.py             # sync-receipt presentation
    run_report.py                  # pre/post-run banner, duplicate-run notice, results summary + filter_visible_page_outcomes (its only caller)
    urls.py / text_cleanup.py / async_utils.py   # pure generic helpers, split out of the pipeline_support.py grab-bag by actual concern (see finding #10 for a note on right-sizing this split)
    runtime.py                     # hardware-based worker-pool sizing
    cli_commands.py                # `run`, `runs` group, bulk `sync`, `pages list`
    store/
      protocols.py                # RunStore/PageCacheStore/PageTaskStore/ExtractionCacheStore/WorkClaimStore — the DIP fix for the ScoutStore god object
      runs_repo.py / page_cache_repo.py / page_tasks_repo.py / extraction_cache_repo.py / work_claims_repo.py
    scraper/                       # already the best-structured package pre-refactor; split by concern, not rebuilt
      http_transport.py / cache_policy.py / fetch_claims.py / browser_fallback_policy.py / pdf_extract.py / fetcher.py
      html_extract.py / tabular_resource_extract.py / page_metadata.py / source_type_inference.py
      browser_render.py / browser_session.py / crawler.py   # crawler.py unchanged — the audit's own model example of good structure
    steps/
      validate.py                 # post-extraction hallucination filter, unchanged
      source_fetch.py             # query -> search -> fetch orchestration, now via search.SearchProvider
      gap_analysis.py / query_gen.py   # unchanged; query_gen kept separate (2 real internal consumers) with a comment marking it an intentional shim
      discovery_engine_adapters.py    # rank.py + dedup.py merged — both were 5-line single-consumer atlas_discovery_engine re-exports (done in Phase 2 of this pass, within steps/ for now)
      verify.py                   # REMOVED in Phase 1 of this pass (dead + silently broken no-op filter) — revisit as a dedicated feature decision if wanted
      contribute.py                # FLAGGED: dead (zero callers) — fix-and-wire-in or delete before shipping (maintainer decision)
      entity_chase/{queries,targets}.py    # LLM follow-up query generation vs. entity-chase target selection, split by decision type
      research/browser_research.py         # LLM-guided org-website research, relocated OUT of scraper/ to fix the layering violation
      entry_extract/
        pipeline.py / cache_protocol.py / llm_passes.py / prompts.py / schema.py / parsing.py / caching.py
        heuristics/{__init__,shared,roster_tables,legislature_feeds,structured_resources}.py
                                    # heuristics/__init__.py holds the ordered strategy registry (replaces the 9-way if-chain);
                                    # heuristics/shared.py is the ONE consolidated name-normalization vocabulary, replacing 2 drifting copies

  entries/                         # entries feature vertical — reunifies entries_commands.py + cli.py's scattered entries logic
    store.py / service.py / presentation.py / export.py / cli_commands.py
                                    # export.py calls shared/export_formats.py instead of duplicating articles/export.py's writer

  articles/                        # Guardian ingestion vertical
    store.py / guardian_client.py / guardian_mapping.py / mention_extraction.py / import_guardian.py / export.py / cli_commands.py
                                    # mention_extraction.py is pure text logic (stopword tables) with zero CLI/store dependency

  providers/                       # LLM provider abstraction — kept top-level, unchanged shape: already the codebase's best DIP example
    __init__.py / base.py / anthropic.py / lmstudio.py / ollama.py
                                    # base.py's Protocol extended with cache_identity + aclose(), fixing the LSP gap every provider already satisfies

  store/                           # shared DB connection infra ONLY — no per-feature business logic lives here
    db.py                          # connection lifecycle (open/close/PRAGMA), delegates schema creation to each vertical's own repo
    cli_commands.py                # `db reset`/`db path`, fixed to also remove -wal/-shm sidecar files

  shared/                          # small, genuinely cross-vertical utilities with zero business logic (started in Phase 2 of this pass with atlas_urls.py)
    export_formats.py              # one generic json/jsonl/csv record writer (entries + articles both call it)
    atomic_io.py                   # one atomic_write_text(), replacing the byte-for-byte duplicate in manpages.py and shell_integration.py
    atlas_urls.py                  # Atlas base-URL join/verify helpers (fix or remove the vestigial always-True verify_for_atlas_url stub) — relocated here in Phase 2
```

## File mapping (old → new)

Every one of the 48 files in `scout/src/atlas_scout`, grouped by destination
top-level package. Some files split into several destinations; some destinations
merge several old files.

#### `articles/`

| Old path   | New path                         | Notes                                                                                          |
| ---------- | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `cli.py`   | `articles/guardian_client.py`    | _fetch_guardian_page, _year_windows, Guardian search URL/fields constants.                     |
| `cli.py`   | `articles/guardian_mapping.py`   | _guardian_articles_from_response/_guardian_tags_from_item/_plain_article_text.                 |
| `cli.py`   | `articles/mention_extraction.py` | Pure text mention-extraction functions + stopword/trim-word tables, zero store/CLI dependency. |
| `cli.py`   | `articles/import_guardian.py`    | _import_guardian_articles split into fetch_and_import() + render_import_result().              |
| `cli.py`   | `articles/export.py`             | _write_article_export/_article_export_csv_row, calling shared/export_formats.py.               |
| `cli.py`   | `articles/cli_commands.py`       | articles group + import guardian/stats/refresh-mentions/export, thin wiring only.              |
| `store.py` | `articles/store.py`              | ArticleRepository; bulk_save_articles split into _build_article_rows() + batched runner.       |

#### `auth/`

| Old path        | New path                       | Notes                                                                                                                                                  |
| --------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cli.py`        | `auth/cli_commands.py`         | _login/_resolve_login_atlas_url (simplified per vestigial-tuple finding)/_load_session_or_exit + login/auth/logout commands.                           |
| `cli.py`        | `auth/token_refresh.py`        | Consolidates the 2 duplicated session->API-token exchange call sites into one refresh_api_token() used by discovery/run_sync.py and worker/runtime.py. |
| `auth.py`       | `auth/device_client.py`        | DeviceAuthError, payload validation, DeviceAuthClient, OAuth constants.                                                                                |
| `auth.py`       | `auth/models.py`               | DeviceCode/DeviceToken/ScoutTokenExchange/ScoutSession/UploadTarget.                                                                                   |
| `auth.py`       | `auth/session_store.py`        | FileSessionStore, load/save/delete_session, credential-store selection.                                                                                |
| `auth.py`       | `auth/e2e_credential_store.py` | E2EFileCredentialStore, isolated out of production session code.                                                                                       |
| `cli_output.py` | `auth/presentation.py`         | Device-auth/login formatting incl. QR code rendering, isolating the qrcode dependency.                                                                 |
| `login_flow.py` | `auth/login_flow.py`           | Relocated; gains poll_device_token moved from cli.py's _poll_device_token.                                                                             |

#### `cli/`

| Old path          | New path                | Notes                                                                                                       |
| ----------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `cli.py`          | `cli/__init__.py`       | main() Click group; registers every vertical's cli_commands group. Target <150 lines.                       |
| `cli.py`          | `cli/option_parsing.py` | _parse_structured_columns and other generic option parsing, moved beside its only caller's vertical import. |
| `cli_output.py`   | `cli/output.py`         | Generic STATUS_STYLES/styled_status + print_cli_error only.                                                 |
| `cli_progress.py` | `cli/progress.py`       | ProgressRenderer; dedupes the shared subset between _USER_EVENT_LABELS/_VERBOSE_EVENT_LABELS.               |
| `cli_select.py`   | `cli/select.py`         | Verbatim move plus a new select_or_abort()/pick_from_list() helper.                                         |
| `cli_errors.py`   | `cli/errors.py`         | Verbatim move — CliError dataclass.                                                                         |
| `cli_context.py`  | `cli/context.py`        | Verbatim move — console/err_console singletons.                                                             |

#### `config/`

| Old path    | New path                  | Notes                                                                              |
| ----------- | ------------------------- | ---------------------------------------------------------------------------------- |
| `cli.py`    | `config/cli_commands.py`  | config_profiles/use-profile/create-profile/show/path/set/get + validation helpers. |
| `config.py` | `config/paths.py`         | OS config/data directory resolution.                                               |
| `config.py` | `config/settings.py`      | Active-profile Settings load/save.                                                 |
| `config.py` | `config/schema.py`        | ScoutConfig + section Pydantic models; LLMConfig as pure data fields only.         |
| `config.py` | `config/toml_io.py`       | Hand-rolled TOML read/write/validate/secret-scrub.                                 |
| `config.py` | `config/errors.py`        | ConfigMutationError, structural only — CLI hint copy moves to cli_commands.py.     |
| `config.py` | `config/scalar_editor.py` | Generic reflection-based get/set backing `scout config get/set`.                   |

#### `credentials/`

| Old path         | New path                      | Notes                                                                                                                                     |
| ---------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `credentials.py` | `credentials/protocol.py`     | CredentialStore Protocol + CredentialStoreError.                                                                                          |
| `credentials.py` | `credentials/system_store.py` | KeyringModule Protocol, SystemCredentialStore. Consumer-specific account-name constants move to auth/session_store.py and search/keys.py. |

#### `daemon/`

| Old path        | New path                    | Notes                                                                                                                                      |
| --------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `cli.py`        | `daemon/cli_commands.py`    | daemon/schedule Click groups + `config schedule` subcommands, calling daemon/lifecycle.py directly (no shim).                              |
| `store.py`      | `daemon/store.py`           | DaemonStateRepository + schema migration.                                                                                                  |
| `config.py`     | `daemon/schedule_config.py` | ScheduleConfig/ScheduleTarget CRUD, relocated as scheduling business logic rather than generic config mechanics.                           |
| `cli_daemon.py` | `daemon/process.py`         | OS process control, reused by worker/process.py.                                                                                           |
| `cli_daemon.py` | `daemon/state.py`           | Store-backed claim/staleness/conflict logic.                                                                                               |
| `cli_daemon.py` | `daemon/presentation.py`    | Run/tick summary rendering + status printing, pulled out of inline console.print calls.                                                    |
| `cli_daemon.py` | `daemon/lifecycle.py`       | start/stop/status/run-internal, composing process+state+presentation+scheduler; now imports public daemon/cron.py.                         |
| `scheduler.py`  | `daemon/scheduler.py`       | run_schedule_once/loop, refactored against a narrow DaemonStateStore protocol instead of concrete ScoutStore/AsyncFetcher/create_provider. |
| `scheduler.py`  | `daemon/cron.py`            | _cron_to_interval made public, no longer imported via a private cross-module name.                                                         |

#### `diagnostics/`

| Old path           | New path                      | Notes                                                                               |
| ------------------ | ----------------------------- | ----------------------------------------------------------------------------------- |
| `cli.py`           | `diagnostics/cli_commands.py` | `doctor` command, thin.                                                             |
| `doctor.py`        | `diagnostics/models.py`       | DoctorStatus/ProbeResult/DoctorCheck/DoctorCapability/DoctorReport.                 |
| `doctor.py`        | `diagnostics/probes.py`       | Concrete adapters backing DoctorDependencies defaults.                              |
| `doctor.py`        | `diagnostics/checks.py`       | Individual DoctorCheck builders.                                                    |
| `doctor.py`        | `diagnostics/capabilities.py` | Capability/readiness scoring + remediation text.                                    |
| `doctor.py`        | `diagnostics/report.py`       | DoctorDependencies wiring + run_doctor orchestrator, reduced to one call per phase. |
| `doctor_output.py` | `diagnostics/output.py`       | Relocated verbatim alongside doctor.py's split pieces.                              |

#### `discovery/`

| Old path                        | New path                                                           | Notes                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.py`                        | `discovery/cli_commands.py`                                        | `run`, `runs` group, bulk `sync`, `pages list`.                                                                                                                                                             |
| `cli.py`                        | `discovery/run_request.py`                                         | Pure assembly/validation of a `scout run` invocation, no Click/I/O; absorbs _parse_structured_columns.                                                                                                      |
| `cli.py`                        | `discovery/pipeline_runner.py`                                     | _run_pipeline/_build_provider composition root, called by both `run` and worker/runtime.py instead of a 1600-line cross-reference.                                                                          |
| `cli.py`                        | `discovery/run_sync.py`                                            | ScoutSyncError split into RunSelectionError/SyncUploadError; _resolve_sync_run_ids/_sync_runs/_runs_sync business logic.                                                                                    |
| `cli.py`                        | `discovery/run_sync_output.py`                                     | Runtime-profile/visibility-label/receipt printing; print side effect split out of _should_sync_after_run.                                                                                                   |
| `steps/entry_extract.py`        | `discovery/steps/entry_extract/pipeline.py`                        | extract_entries_stream/extract_page_entries/_perform_extraction, dispatcher rewritten as a loop over a heuristics registry.                                                                                 |
| `steps/entry_extract.py`        | `discovery/steps/entry_extract/cache_protocol.py`                  | New ExtractionCacheStore Protocol (6 methods) replacing the concrete ScoutStore type annotation.                                                                                                            |
| `steps/entry_extract.py`        | `discovery/steps/entry_extract/llm_passes.py`                      | _pass_identify/_pass_enrich + retry/backoff constants.                                                                                                                                                      |
| `steps/entry_extract.py`        | `discovery/steps/entry_extract/prompts.py`                         | _build_system_prompt.                                                                                                                                                                                       |
| `steps/entry_extract.py`        | `discovery/steps/entry_extract/schema.py`                          | Pydantic wire schema for structured extraction responses.                                                                                                                                                   |
| `steps/entry_extract.py`        | `discovery/steps/entry_extract/parsing.py`                         | Response parsing + enum normalization + ExtractionFailedError; hoists 2 mid-file noqa:E402 imports to top.                                                                                                  |
| `steps/entry_extract.py`        | `discovery/steps/entry_extract/caching.py`                         | Fingerprint/cache-key derivation, self-contained.                                                                                                                                                           |
| `steps/entry_extract.py`        | `discovery/steps/entry_extract/heuristics/roster_tables.py`        | Generic markdown/plain-text roster-table strategies.                                                                                                                                                        |
| `steps/entry_extract.py`        | `discovery/steps/entry_extract/heuristics/legislature_feeds.py`    | senate.gov/state-legislature-specific parsers; module path now disambiguates format instead of relying only on docstrings.                                                                                  |
| `steps/entry_extract.py`        | `discovery/steps/entry_extract/heuristics/structured_resources.py` | CSV/TSV/pipe structured-resource parsing, now calling heuristics/shared.py instead of its own vocabulary.                                                                                                   |
| `steps/entry_extract.py`        | `discovery/steps/entry_extract/heuristics/shared.py`               | Consolidates the roster-side and structured-side name-normalization vocabularies into one, with a regression test covering both former inputs.                                                              |
| `steps/entry_extract.py`        | `discovery/steps/entry_extract/heuristics/__init__.py`             | New HEURISTIC_STRATEGIES ordered tuple + strategy Protocol, replacing the 9-way if-chain.                                                                                                                   |
| `store.py`                      | `discovery/store/runs_repo.py`                                     | Run lifecycle CRUD + artifacts.                                                                                                                                                                             |
| `store.py`                      | `discovery/store/page_cache_repo.py`                               | Fetched-page cache CRUD.                                                                                                                                                                                    |
| `store.py`                      | `discovery/store/page_tasks_repo.py`                               | Per-URL task-tracking CRUD.                                                                                                                                                                                 |
| `store.py`                      | `discovery/store/extraction_cache_repo.py`                         | LLM extraction cache CRUD.                                                                                                                                                                                  |
| `store.py`                      | `discovery/store/work_claims_repo.py`                              | Work-claim leasing; _run_status becomes an injected callable instead of a same-class call.                                                                                                                  |
| `store.py`                      | `discovery/store/protocols.py`                                     | New narrow Protocols so pipeline/workers/fetcher/entry_extract type against only the methods they call.                                                                                                     |
| `pipeline.py`                   | `discovery/pipeline.py`                                            | Slimmed run_pipeline sequencing only (~150-250 lines vs. 875).                                                                                                                                              |
| `pipeline.py`                   | `discovery/frontier.py`                                            | URL frontier + search-frontier fanout, now via search.SearchProvider not a private import of source_fetch._search_brave; absorbs decide_extraction_admission/extract_worker_count from pipeline_support.py. |
| `pipeline.py`                   | `discovery/workers.py`                                             | fetch_worker/extract_worker as methods on an explicit state class instead of closures over run_pipeline's locals.                                                                                           |
| `pipeline.py`                   | `discovery/steps/deepen.py`                                        | The 'AI-native deepening' pass, 4x-duplicated fetch/extract sequence collapsed into one _fetch_and_extract() helper.                                                                                        |
| `pipeline.py`                   | `discovery/run_artifacts.py`                                       | _build_run_artifacts/_can_build_run_artifacts/_outcome_int.                                                                                                                                                 |
| `pipeline.py`                   | `discovery/entries_output.py`                                      | _save_ranked_entries/_iter_items, via entries' narrow EntryWriter protocol. _parse_location vestigial re-export deleted, not moved.                                                                         |
| `scraper/fetcher.py`            | `discovery/scraper/http_transport.py`                              | Raw httpx GET + error classification.                                                                                                                                                                       |
| `scraper/fetcher.py`            | `discovery/scraper/cache_policy.py`                                | Cache read/write, typed against PageCacheStore protocol.                                                                                                                                                    |
| `scraper/fetcher.py`            | `discovery/scraper/fetch_claims.py`                                | Claim/poll/deadline loop, typed against WorkClaimStore protocol.                                                                                                                                            |
| `scraper/fetcher.py`            | `discovery/scraper/browser_fallback_policy.py`                     | Pure, independently-testable browser-render heuristics.                                                                                                                                                     |
| `scraper/fetcher.py`            | `discovery/scraper/pdf_extract.py`                                 | PDF byte extraction; fixes mid-function local import of content_quality_reason.                                                                                                                             |
| `scraper/fetcher.py`            | `discovery/scraper/fetcher.py`                                     | AsyncFetcher becomes a thin facade composing the 5 modules above, well under 200 lines.                                                                                                                     |
| `scraper/extractor.py`          | `discovery/scraper/html_extract.py`                                | trafilatura text extraction + quality gating.                                                                                                                                                               |
| `scraper/extractor.py`          | `discovery/scraper/tabular_resource_extract.py`                    | CSV/TSV/ZIP extraction, renamed extract_tabular_resource to avoid a near-synonym naming collision.                                                                                                          |
| `scraper/extractor.py`          | `discovery/scraper/page_metadata.py`                               | JSON-LD/OpenGraph/Twitter Card parsing, renamed extract_page_metadata.                                                                                                                                      |
| `scraper/extractor.py`          | `discovery/scraper/source_type_inference.py`                       | _infer_source_type; browser_render.py's equivalent delegates here for consistency.                                                                                                                          |
| `cli_output.py`                 | `discovery/run_report.py`                                          | print_run_banner/print_duplicate_run_notice/print_run_results.                                                                                                                                              |
| `cli_progress.py`               | `discovery/run_report.py`                                          | filter_visible_page_outcomes relocated beside its sole caller, print_run_results.                                                                                                                           |
| `scraper/browser_researcher.py` | `discovery/steps/research/browser_research.py`                     | research_org_website relocated OUT of scraper/ into steps/, fixing the layering violation (it calls extract_page_entries).                                                                                  |
| `scraper/browser_researcher.py` | `discovery/scraper/browser_session.py`                             | Playwright launch/close boilerplate, consolidated with browser_render.py's duplicate + inconsistent User-Agent literal.                                                                                     |
| `steps/validate.py`             | `discovery/steps/validate.py`                                      | Verbatim move, already a single cohesive concern.                                                                                                                                                           |
| `steps/contribute.py`           | `discovery/run_sync.py`                                            | sync_run_artifacts (the live path) merges into discovery/run_sync.py's other Atlas-sync logic.                                                                                                              |
| `steps/contribute.py`           | `discovery/steps/contribute.py`                                    | FLAGGED DEAD CODE: contribute_entries has zero production callers; delete or wire-in is a maintainer decision, not a default relocation.                                                                    |
| `steps/entity_chase.py`         | `discovery/steps/entity_chase/queries.py`                          | generate_followup_queries + its prompt/parser.                                                                                                                                                              |
| `steps/entity_chase.py`         | `discovery/steps/entity_chase/targets.py`                          | select_entities_to_chase + its prompt/parser.                                                                                                                                                               |
| `steps/source_fetch.py`         | `discovery/steps/source_fetch.py`                                  | fetch_sources_stream, now depending on search/provider.py's SearchProvider protocol.                                                                                                                        |
| `pipeline_support.py`           | `discovery/text_cleanup.py`                                        | strip_code_fence.                                                                                                                                                                                           |
| `pipeline_support.py`           | `discovery/urls.py`                                                | normalize_url/same_domain/parse_location/merge_discovered_links.                                                                                                                                            |
| `pipeline_support.py`           | `discovery/async_utils.py`                                         | close_if_supported/error_reason.                                                                                                                                                                            |
| `pipeline_support.py`           | `discovery/frontier.py`                                            | decide_extraction_admission/extract_worker_count, moved to their sole consumer. is_ollama_provider deleted — zero production callers.                                                                       |
| `steps/verify.py`               | `discovery/steps/verify.py`                                        | FLAGGED DEAD + BROKEN: never imported anywhere, and its filter is a no-op. Fix-and-wire-in or delete before shipping — do not silently relocate.                                                            |
| `scraper/browser_render.py`     | `discovery/scraper/browser_render.py`                              | Relocated; adopts shared browser_session.py helper.                                                                                                                                                         |
| `scraper/crawler.py`            | `discovery/scraper/crawler.py`                                     | Verbatim relocate — already clean, single-purpose, uses a PageFetcher Protocol.                                                                                                                             |
| `runtime.py`                    | `discovery/runtime.py`                                             | Relocated — sizing is specific to discovery pipeline worker pools.                                                                                                                                          |
| `steps/gap_analysis.py`         | `discovery/steps/gap_analysis.py`                                  | Verbatim move, already a small cohesive adapter.                                                                                                                                                            |
| `steps/__init__.py`             | `discovery/steps/__init__.py`                                      | Reconciled **all** so it either exports every public step consistently or is dropped for direct submodule imports (pick one convention).                                                                    |
| `scraper/__init__.py`           | `discovery/scraper/__init__.py`                                    | Relocated; export list updated to re-export from the new split modules.                                                                                                                                     |
| `steps/rank.py`                 | `discovery/steps/discovery_engine_adapters.py`                     | Merged with steps/dedup.py — both were 5-line single-consumer atlas_discovery_engine re-exports.                                                                                                            |
| `steps/query_gen.py`            | `discovery/steps/query_gen.py`                                     | Verbatim move, kept separate (2 real consumers: entity_chase, source_fetch); gains a comment marking it an intentional thin adapter.                                                                        |
| `steps/dedup.py`                | `discovery/steps/discovery_engine_adapters.py`                     | Merged with steps/rank.py (see that row).                                                                                                                                                                   |

#### `entries/`

| Old path              | New path                  | Notes                                                                                                                                                           |
| --------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.py`              | `entries/service.py`      | _load_entries/_select_entries_for_output/_dedupe_entries_by_name/_entry_score, unified with entries_commands.py's logic.                                        |
| `cli.py`              | `entries/export.py`       | _write_entry_export/_entry_export_csv_row, rewritten to call shared/export_formats.py.                                                                          |
| `cli.py`              | `entries/cli_commands.py` | entries_list/export_entries commands, joined with stats/purge moved from entries_commands.py into one `entries` group.                                          |
| `store.py`            | `entries/store.py`        | EntryRepository + narrow EntryWriter protocol; entry_stats split into named accumulator helpers.                                                                |
| `entries_commands.py` | `entries/service.py`      | _load_entry_stats + threshold validation, rewritten to depend on injected EntryRepository and raise a domain-neutral exception instead of click.ClickException. |
| `entries_commands.py` | `entries/presentation.py` | Rich Table / JSON-dump rendering.                                                                                                                               |
| `entries_commands.py` | `entries/cli_commands.py` | Thin command bodies, joined with entries_list/export moved from cli.py.                                                                                         |

#### `local_model/`

| Old path                      | New path                      | Notes                                                                                                                                               |
| ----------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.py`                      | `local_model/cli_commands.py` | `config model` command, refactored to call local_model/onboarding.py's shared helper.                                                               |
| `cli.py`                      | `local_model/onboarding.py`   | Pure decision/resolution local-model functions; deletes 4 pass-through monkeypatch-seam wrappers in favor of injected fakes.                        |
| `cli.py`                      | `local_model/prompts.py`      | Interactive local-model pickers/confirms, rewritten atop cli/select.py's new select_or_abort().                                                     |
| `config.py`                   | `local_model/registry.py`     | LLMConfig's provider-dispatch methods + save_local_model_settings become free functions, eliminating the 4-way hardcoded provider-name duplication. |
| `local_models.py`             | `local_model/registry.py`     | LocalProviderName/LOCAL_PROVIDER_NAMES/labels — merges with config.py's relocated dispatch logic.                                                   |
| `local_models.py`             | `local_model/probing.py`      | HTTP probes against running local provider servers.                                                                                                 |
| `local_models.py`             | `local_model/resolution.py`   | resolve/apply/select + ranking business logic.                                                                                                      |
| `cli_output.py`               | `local_model/prompts.py`      | print_local_model_setup_help, joined with the rest of local-model onboarding presentation.                                                          |
| `local_provider_bootstrap.py` | `local_model/bootstrap.py`    | Verbatim move; consolidates _run_install_command/_run_server_command into one _run_command().                                                       |

#### `providers/`

| Old path                 | New path                 | Notes                                                                                                                      |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `providers/lmstudio.py`  | `providers/lmstudio.py`  | Unchanged; already well-formed.                                                                                            |
| `providers/anthropic.py` | `providers/anthropic.py` | Unchanged; already well-formed.                                                                                            |
| `providers/ollama.py`    | `providers/ollama.py`    | Unchanged; already well-formed.                                                                                            |
| `providers/__init__.py`  | `providers/__init__.py`  | Unchanged; add try/finally aclose() handling at its 2 call sites once aclose() joins the Protocol.                         |
| `providers/base.py`      | `providers/base.py`      | Unchanged location; Protocol extended with cache_identity + aclose(), removing entry_extract's private-attribute fallback. |

#### `search/`

| Old path                | New path                 | Notes                                                                                                                                          |
| ----------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.py`                | `search/cli_commands.py` | `search connect/status/disconnect`, already well-factored — relocate verbatim.                                                                 |
| `steps/source_fetch.py` | `search/provider.py`     | _search_brave becomes BraveSearchProvider, consolidating the duplicate also found in steps/verify.py.                                          |
| `search_keys.py`        | `search/keys.py`         | Relocated into search/ vertical; gains its own SEARCH_API_KEY_ACCOUNT constant. Legacy-file migration shim flagged with a deprecation comment. |

#### `setup/`

| Old path | New path                  | Notes                                                                                                                                      |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `cli.py` | `setup/wizard.py`         | _setup_onboarding split into named phase functions (select profile / ensure session / install shell integrations / configure local model). |
| `cli.py` | `setup/profile_picker.py` | SetupProfileChoice + profile selection/creation prompts, gaining the non-TTY fallback other pickers already have.                          |
| `cli.py` | `setup/cli_commands.py`   | `setup` command, thin.                                                                                                                     |

#### `shared/`

| Old path        | New path               | Notes                                                                                                                                |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `atlas_urls.py` | `shared/atlas_urls.py` | Relocated; gains atlas_url_for_path from cli.py; verify_for_atlas_url's always-True stub fixed to a real per-host policy or removed. |

#### `shell_integration/`

| Old path               | New path                                  | Notes                                                                                |
| ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `manpages.py`          | `shell_integration/manpages/collect.py`   | Click-tree introspection into plain data.                                            |
| `manpages.py`          | `shell_integration/manpages/render.py`    | Pure roff rendering/escaping.                                                        |
| `manpages.py`          | `shell_integration/manpages/install.py`   | collect/install_man_pages, using shared/atomic_io.py instead of a private duplicate. |
| `shell_integration.py` | `shell_integration/environment.py`        | command-name/shell detection.                                                        |
| `shell_integration.py` | `shell_integration/completion_paths.py`   | Completion dir/filename/rc-block policy.                                             |
| `shell_integration.py` | `shell_integration/completion_install.py` | Build install plan + write completion script/rc block, using shared/atomic_io.py.    |

#### `store/`

| Old path   | New path                | Notes                                                                                      |
| ---------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `cli.py`   | `store/cli_commands.py` | `db reset`/`db path`, fixed to also remove -wal/-shm sidecar files.                        |
| `store.py` | `store/db.py`           | Connection lifecycle only (init/initialize/close), delegates schema creation to each repo. |

#### `worker/`

| Old path | New path                 | Notes                                                                                                              |
| -------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `cli.py` | `worker/state.py`        | Local JSON worker-state file read/write.                                                                           |
| `cli.py` | `worker/api_client.py`   | WorkerApiClient class replacing ad hoc httpx + bare ScoutSyncError reuse, mirroring auth/device_client.py's shape. |
| `cli.py` | `worker/jobs.py`         | Job-payload parsing/validation + new WorkerJobError type.                                                          |
| `cli.py` | `worker/runtime.py`      | Process-job loop/heartbeat/run-internal, refactored to take injected collaborators instead of module globals.      |
| `cli.py` | `worker/process.py`      | Spawn/start/stop/status; shares spawn/signal primitive with daemon/process.py.                                     |
| `cli.py` | `worker/cli_commands.py` | `worker` group, thin Click wiring only.                                                                            |

#### Deleted outright

| Old path | New path                           | Notes                                                                                                                                                                |
| -------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.py` | `DELETE (daemon monkeypatch shim)` | _DAEMON_PATCH_TARGETS, _ORIGINAL_* casts, _sync_daemon_module, 18 forwarding wrappers deleted, not relocated; tests rewritten to patch atlas_scout.daemon.lifecycle. |

#### Top-level (unchanged)

| Old path      | New path      | Notes      |
| ------------- | ------------- | ---------- |
| `__init__.py` | `__init__.py` | Unchanged. |

## Migration plan

11 phases (0 through 10), each scoped to keep the test suite green throughout.
Phases 0-2 have already been partially executed as part of this audit — see
below for exactly what ran and what was deliberately deferred and why.

**Phase 0 — Safety net** — risk: Low — no code change, establishes the rollback
point. **✅ Done** (branch `chore/scout-architecture-audit-cleanup`).

Confirmed the actual CI-invoked test command (`uv run pytest --no-cov`, matching
`scout/package.json`'s `test` script) passes cleanly: 902 tests, 0 failures.
Note: `pyproject.toml` declares `--cov-fail-under=100`, but the CI-invoked
command overrides it with `--no-cov` — see "Tooling drift discovered during this
audit" below. Running with coverage enabled shows 89.55% today, a pre-existing
gap this pass did not attempt to close.

**Phase 1 — Triage known correctness bugs before moving any code** — risk:
Low-medium. **✅ Done** (same branch), per explicit maintainer decisions:

- `steps/verify.py` — **deleted**, along with its dedicated test file. It was
  never imported outside its own tests, and its own filter was a silent no-op
  (computed `is_verified` per entity, then unconditionally appended every entry
  regardless of the result). Reviving entity re-verification correctly is its
  own product decision about verification policy, not a drive-by fix — revisit
  as a dedicated feature if/when the team wants this.
- `steps/contribute.py`'s `contribute_entries` — **left as-is**, deliberately.
  It has zero production callers (only `sync_run_artifacts`, a different
  function in the same file, is live), but is close enough to being an
  intentional unshipped feature that deleting it needs its own maintainer call,
  not a bundled cleanup decision.
- `pipeline_support.py`'s `is_ollama_provider` — **deleted**, along with its 3
  dedicated tests. Unlike `contribute_entries`, this was an orphaned helper with
  no feature shape, referenced only by its own tests.
- `atlas_urls.py`'s `verify_for_atlas_url` — **left as-is**. It unconditionally
  returns `True` (the secure default for TLS verification), so it's not a live
  bug, just a vestigial stub whose signature implies per-host policy that was
  never implemented. Low priority; noted for a future pass.

**Phase 2 — Zero-risk relocations** — risk: Low — mechanical renames with no
behavior change. **Partially done** (same branch); the rest is deliberately
deferred — see below.

Done in this pass, after mechanical verification (import-site grep + reading
each file):

- `steps/rank.py` + `steps/dedup.py` merged into
  `steps/discovery_engine_adapters.py` (both were 5-line single-function
  re-exports of `atlas_discovery_engine`; merged tests too).
- `atlas_urls.py` → new `shared/atlas_urls.py` package (auth.py, cli.py,
  doctor.py, and one test file repointed).

Deferred, not because they're risky, but because doing them now would create
confusing intermediate states:

- `cli_context.py`/`cli_errors.py`/`cli_select.py` → `cli/` package **cannot
  happen until Phase 9**. `src/atlas_scout/cli.py` still exists as a 4,914-line
  file; Python cannot have both a module `cli.py` and a package `cli/` in the
  same parent — the package would silently shadow the file. This move is only
  safe once `cli.py` itself becomes `cli/__init__.py`. **Update (2026-07-07):**
  by the end of Phases 1-2 and the follow-up cleanup tasks below, `cli.py` had
  shrunk to 12 lines and no longer collided with a `cli/` package on name alone,
  so this move was re-attempted directly. It still isn't safe, for a deeper
  reason than file/package naming: `cli.py` re-exports `main`
  (`from atlas_scout.cli_app import main`), and `cli_app.py` builds `main` by
  importing every command vertical, which collectively touch nearly every module
  in the codebase — including `console`/`err_console` (`cli_context.py`) and
  `CliError` (`cli_errors.py`), which are used almost everywhere. Once those
  three files become submodules of `cli/`, importing `atlas_scout.cli.context`
  from anywhere first requires fully executing `cli/__init__.py`, which pulls in
  `cli_app` → the entire command tree → and, for any module reached that way
  that itself imports `atlas_scout.cli.context`/`.errors`/`.select`, a circular
  import back into itself. This reproduced concretely: importing
  `atlas_scout.articles.crawl_runner` (which imports `cli.context`) walked
  through `cli/__init__.py` → `cli_app` → `articles_commands` →
  `crawl_commands`, which imports `crawl_runner` back from itself while it was
  still mid-import. This isn't fixable by reordering imports in the three files
  being moved — it requires `cli/__init__.py` to stop eagerly constructing the
  full `main` Click group at import time, which is exactly Phase 9's own stated
  scope ("reduce `cli/__init__.py` to registering every vertical's
  `cli_commands.py` group") and depends on Phases 3-8 having already split every
  command vertical out first. The attempt was reverted;
  `cli_context.py`/`cli_errors.py`/`cli_select.py` remain flat top-level modules
  until Phase 9 is reached in full, not just until `cli.py` is short.
- `runtime.py` → `discovery/runtime.py` deferred to Phase 8 (its real
  destination package doesn't meaningfully exist until then).
- `doctor_output.py` → `diagnostics/output.py` deferred to Phase 5, alongside
  `doctor.py` — moving it alone now would separate it from the file it exists to
  complement.
- `scraper/crawler.py`, `steps/validate.py`, `steps/gap_analysis.py`,
  `steps/query_gen.py` → `discovery/...` deferred to Phase 8, when the rest of
  `scraper/`/`steps/` moves too — relocating a few files alone now would split
  those packages across two locations mid-migration.

**Phase 3 — Persistence split (highest-leverage DIP fix; do early so later
phases build against narrow repos, not the god class)** — risk: Medium — touches
many call sites simultaneously; mitigate by doing one repo at a time behind the
new protocols, verifying coverage after each.

Introduce store/db.py (connection lifecycle only), then split store.py into
daemon/store.py,
discovery/store/{runs_repo,page_cache_repo,page_tasks_repo,extraction_cache_repo,work_claims_repo,protocols}.py,
entries/store.py, articles/store.py. Repoint every existing caller (cli.py,
fetcher.py, entry_extract.py, pipeline.py, scheduler.py, cli_daemon.py,
entries_commands.py) at the new modules in the same PR. Split
tests/test_store.py into per-repo test files alongside.

**Phase 4 — Small self-contained verticals** — risk: Low-medium —
auth/session_store touches credential storage; test carefully against real
keychain/e2e paths.

Extract credentials/{protocol,system_store}.py,
auth/{device_client,models,session_store,e2e_credential_store,login_flow,token_refresh,presentation,cli_commands}.py,
search/{keys,provider,cli_commands}.py,
config/{paths,settings,schema,toml_io,errors,scalar_editor,cli_commands}.py.
Delete the cli.py residue these extractions leave behind rather than
re-exporting it.

**Phase 5 — Onboarding cluster** — risk: Low — mostly presentation/onboarding
flows with existing test coverage; consolidating duplicated local-model
persistence logic is the main behavior-adjacent change.

Extract
local_model/{registry,probing,resolution,bootstrap,onboarding,prompts,cli_commands}.py,
setup/{wizard,profile_picker,cli_commands}.py,
shell_integration/{environment,completion_paths,completion_install,manpages/*}.py
(sharing new shared/atomic_io.py),
diagnostics/{models,probes,checks,capabilities,report,cli_commands}.py.

**Phase 6 — Daemon + worker** — risk: Medium-high — this is the phase most
likely to temporarily break tests since it deletes rather than relocates the
compatibility shim; budget extra review time here.

Extract
daemon/{process,state,presentation,lifecycle,cron,scheduler,schedule_config,cli_commands}.py
and worker/{state,api_client,jobs,runtime,process,cli_commands}.py. Delete the
cli.py daemon monkeypatch shim entirely in this phase and rewrite every test
that patches atlas_scout.cli's daemon internals to patch
atlas_scout.daemon/worker directly. Land as several small PRs (process.py, then
state.py, then lifecycle.py, then worker/*) each independently green.

**Phase 7 — Entries + articles verticals** — risk: Low — well-isolated features
with existing direct unit tests (tests/cli/test_articles_commands.py already
imports mention-extraction functions directly).

Extract entries/{store(from Phase
3),service,presentation,export,cli_commands}.py and articles/{store(from Phase
3),guardian_client,guardian_mapping,mention_extraction,import_guardian,export,cli_commands}.py.
Introduce shared/export_formats.py first and have both verticals' export.py call
it.

**Phase 8 — Discovery pipeline (largest, most interconnected; done once cli.py
is already much smaller so blast radius is contained)** — risk: High — largest
single change, touches the trust-critical extraction path; consolidate the
name-normalization vocabularies here with an explicit regression test covering
both former inputs before merging.

Split pipeline.py into
discovery/{pipeline,frontier,workers,run_artifacts,entries_output,run_request,pipeline_runner,run_sync,run_sync_output,run_report}.py
and pipeline_support.py into discovery/{text_cleanup,urls,async_utils}.py; split
scraper/{fetcher,extractor}.py into discovery/scraper/_; relocate
browser_researcher.py's live half to
discovery/steps/research/browser_research.py and its shared launch/close code to
discovery/scraper/browser_session.py; split steps/entry_extract.py into
discovery/steps/entry_extract/_ (pipeline, cache_protocol, llm_passes, prompts,
schema, parsing, caching, heuristics/*) and steps/entity_chase.py into
discovery/steps/entity_chase/{queries,targets}.py. Land as an ordered
sub-sequence (scraper/ first, then entry_extract/, then pipeline.py's own
split), verifying full coverage after each.

**Phase 9 — Shrink cli.py to its final composition-root shape** — risk: Low —
mostly deletion and import-path verification once all prior phases have landed.

Reduce cli/**init**.py to registering every vertical's cli_commands.py group;
delete every remaining cli.py helper superseded by a vertical module; verify no
vertical's cli_commands.py imports another vertical's internals except through
documented Protocol seams (entries.EntryWriter, search.SearchProvider,
auth.token_refresh, providers.LLMProvider).

**Phase 10 — Final cleanup and verification** — risk: Low — cleanup and
verification only, but must not be skipped or the migration leaves dead parallel
files.

Apply remaining flagged fixes (LLMProvider Protocol gains
cache_identity/aclose + provider aclose() called at both call sites; db reset
also removes -wal/-shm sidecar files; ScoutSyncError fully replaced by
RunSelectionError/SyncUploadError/WorkerJobError). Delete every now-empty legacy
file/directory (steps/, scraper/, providers-adjacent leftovers, cli_*.py,
config.py, store.py, pipeline.py, auth.py, local_models.py,
local_provider_bootstrap.py, doctor.py, doctor_output.py, manpages.py,
shell_integration.py, cli_daemon.py, scheduler.py, entries_commands.py,
pipeline_support.py, atlas_urls.py, runtime.py, credentials.py, search_keys.py,
login_flow.py). Grep the whole repo for stray old import paths, run the full
coverage gate end-to-end, and update pyproject.toml's entry point plus any docs
referencing old module paths.

## Known gaps in this draft

Carried over from a completeness critique run against the first synthesis pass,
for honesty rather than silently smoothing them over:

- **Test-suite remapping isn't fully systematized per phase.** The migration
  phases above call out test restructuring for a few specific cases (e.g.
  `test_store.py`'s split in Phase 3, daemon test rewrites in Phase 6) but don't
  give a systematic plan for remapping the rest of the test suite (`tests/cli/`,
  `tests/test_steps/`, `tests/test_pipeline*.py`, `tests/auth/`) to mirror the
  new package layout. Given the repo's (aspirational, see "Tooling drift" above)
  100%-coverage expectation, this should be made an explicit, per-phase
  requirement during execution rather than assumed.
- **Error-type consolidation is sequenced later than ideal.** Phase 10 defers
  introducing `RunSelectionError`/`SyncUploadError`/`WorkerJobError` (replacing
  the overloaded `ScoutSyncError`) to final cleanup, but
  `worker/api_client.py`/`worker/jobs.py` (built in Phase 6) and
  `discovery/run_sync.py` (Phase 8) all need distinguishable error types from
  the moment they're extracted — deferring the split to Phase 10 means those
  modules would temporarily still share a `ScoutSyncError`-equivalent across
  phases 6-9. Worth introducing the new error types alongside the modules that
  need them instead.
- **New call graph acyclicity isn't re-verified against the proposed
  structure.** The dependency-graph analysis confirmed the _current_ package has
  zero import cycles, but that wasn't re-run against the _proposed_ structure —
  e.g. `discovery/steps/research/browser_research.py` (moved out of `scraper/`
  specifically to fix a layering inversion) still needs to import
  `discovery/steps/entry_extract/pipeline.py`, and `discovery/pipeline.py` needs
  to invoke `steps/deepen.py`, which itself imports
  `research/browser_research.py`. Re-check this stays acyclic before or during
  Phase 8.
- **`pipeline_support.py`'s proposed 3-4-way split may over-fragment** (see
  finding #10) — worth deciding on a 2-way split instead at execution time.
- **`daemon/cron.py`** as proposed holds exactly one ~25-line function
  (`_cron_to_interval`, made public). Consider folding it into `daemon/state.py`
  or `daemon/lifecycle.py` instead of a dedicated file.
- **`shell_integration/manpages/`** nests the man-page install feature under the
  `shell_integration/` package name, even though man pages are a distinct
  install target from shell completion — a new contributor looking for "man
  page" code may not think to check there first. Worth a clearer name or a
  sibling top-level `manpages/` package instead.

## What's already done vs. what's future work

This audit's own Phase 0-2 cleanup is committed on branch
`chore/scout-architecture-audit-cleanup` (2 commits: dead-code removal, then the
`discovery_engine_adapters.py` merge + `shared/atlas_urls.py` relocation). All
889 tests pass (902 minus the 13 tests removed alongside the dead code they
tested). Phases 3-10 — the `ScoutStore` split into per-aggregate repos behind
narrow protocols, the full `cli.py` breakup into feature verticals, the
`entry_extract.py` → `heuristics/` subpackage split, the daemon/worker dedup,
etc. — are documented above but not executed; each is its own PR-sized, reviewed
piece of follow-up work.

**Update (2026-07-07):** most of Phases 4-7 have since landed as individual,
independently-reviewed commits on `main` (one PR-sized change per finding, each
verified against the full 100%-coverage test suite, ruff, and mypy before
merging): `config.py` → `config/`, `auth.py` → `auth/`, `doctor.py` →
`diagnostics/`, `cli_daemon.py` → `daemon/` (with the dead in-`cli.py` duplicate
shim deleted, not migrated), `worker_commands.py` → `worker/`,
`entries_commands.py` → `entries/`, the `article_*` flat-prefix cluster →
`articles/`, `runs_commands.py` → `runs/`, and `scraper/fetcher.py` narrowed to
a `FetcherStore` Protocol instead of the concrete store. `pipeline.py`'s
875-line `run_pipeline` lost its 4x-duplicated deepening logic to two extracted
closures and a `pipeline_fetch_support.py`/`pipeline_artifacts.py` split;
`scraper/browser_researcher.py`'s layering inversion is fixed
(`steps/browser_research.py` now owns the live half,
`scraper/browser_session.py` the shared Playwright launch/close code).
`ScoutSyncError` no longer covers the worker job-protocol domain
(`worker/errors.WorkerJobError` now does); Brave search duplication (finding
#25) is gone via a `SearchProvider` Protocol in `pipeline_fetch_support.py`; the
two export writers (finding #27) now share `shared/export_writer.py`;
local-model persistence duplication between `config_commands.py` and
`setup_commands.py` is gone via
`local_model_commands._apply_and_persist_local_model`; the
`'ollama'`/`'lmstudio'` literal duplication in finding #21 is narrowed —
`local_models.py`'s provider names/labels now derive from
`local_provider_bootstrap.LOCAL_PROVIDER_SPECS` rather than re-declaring them
(the `providers/__init__.py` factory dispatch and `config/schema.py`'s defaults
were deliberately left alone: unifying those would mean either a runtime import
cycle — `providers/__init__.py` already lazily imports provider submodules
specifically to dodge this — or inverting `config`'s position as a
dependency-free foundational module).

Two items were investigated and closed **without** a code change, by deliberate
decision rather than oversight:

- **`cli_*.py` → `cli/` package** (finding #16) was re-attempted directly once
  `cli.py` had shrunk to 12 lines via the splits above, since the original
  file/package name collision no longer applied. It hit a real circular import
  instead — see the "Update (2026-07-07)" note under Phase 2 above for the full
  mechanism. Reverted; `cli_context.py`/`cli_errors.py`/`cli_select.py` stay
  flat until Phase 9's full scope (making `cli_app`'s `main` construction lazy)
  is reached.
- **`cli_compat.py`'s monkeypatch-propagation facade** (the `_CliFacadeModule`/
  `_LEGACY_EXPORT_MODULES`/`_PATCH_TARGET_MODULES` machinery, ~308 lines) was
  investigated for reduction after being touched by nearly every split above. It
  exists solely so the pre-existing test suite's
  `monkeypatch.setattr(cli_module, "X", ...)` and
  `from atlas_scout.cli import X` calls keep working unchanged after 20+ files
  moved during this pass, rather than requiring every one of those test call
  sites to be rewritten to patch the new location directly. Reducing it for real
  means rewriting on the order of 50-100+ monkeypatch targets and import lines
  across `tests/cli/` and friends — a large, regression-prone change to test
  infrastructure with no end-user-visible benefit (the production code this
  facade fronts is already correctly organized into `auth/`, `config/`,
  `worker/`, `entries/`, `articles/`, `diagnostics/`, `daemon/`, `runs/`,
  `shared/`). Left in place; worth reducing incrementally the next time a test
  file in its orbit is touched for another reason, not as a dedicated pass.

`steps/entry_extract.py`'s split into a subpackage (findings #7/#8) was in
active, uncommitted progress by a concurrent contributor as of this update and
was deliberately not touched to avoid colliding with that work — still open. The
single largest remaining piece is unchanged: the `ScoutStore` split into
per-aggregate repos behind narrow protocols (finding #1, Phase 3), plus the rest
of Phase 8's discovery-pipeline relocation.
