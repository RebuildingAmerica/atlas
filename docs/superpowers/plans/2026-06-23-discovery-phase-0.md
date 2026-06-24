# Discovery Phase 0 — "Stop the Bleeding" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the autonomous discovery service safe to run continuously and safe to publish from — it must stop publishing unverified facts about real named people, stop double-claiming/stranding jobs, and stop being able to spend without a ceiling.

**Architecture:** Six independent workstreams on the existing FastAPI + raw-SQL stack. **Workstream A (trust gate) is the led item and is built first** — it is the change that makes the trust tiers already shipped on the profile UI actually honest. The five reliability workstreams (B–F) each produce working, testable software on their own and can be executed in any order after A. Every change is additive (new tables alongside `entries`/`discovery_jobs`; new modules alongside existing ones) so nothing already live regresses.

**Tech stack:** Python 3.12, FastAPI, raw SQL via `aiosqlite` (dev) / `psycopg` (prod) through `api/atlas/platform/database.py`'s `?`→`%s` adapter, Pydantic schemas, pytest + pytest-asyncio. 100% statement+branch coverage gate for `api/`, `libs/discovery-engine/`, `libs/shared/`.

---

## Grounding facts the implementer MUST know

These are load-bearing conventions discovered in the current code. Violating them breaks the build.

1. **Two schemas, kept in lockstep.** A new table must be added in BOTH:
   - `api/atlas/models/schema.sql` (Postgres dialect: `TIMESTAMPTZ`, `BOOLEAN ... DEFAULT TRUE`, `JSONB` where useful).
   - the embedded `DB_SCHEMA` string inside `api/atlas/models/database.py` (lines ~228–566; SQLite dialect: `DATETIME`, `BOOLEAN ... DEFAULT 1`, `TEXT` for JSON).
   Both use `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` (idempotent-additive). `init_db()` applies the right one per backend.
2. **DB access pattern.** Always raw SQL with `?` placeholders (the adapter translates to `%s` for Postgres). Use `await conn.execute(sql, params)`, `await cursor.fetchone()`/`fetchall()`, `await conn.commit()`. Helpers on the `db` singleton (`from atlas.platform.database import db`): `db.generate_uuid()`, `db.now_iso()`, `db.encode_json()`, `db.decode_json()`.
3. **Dialect detection at runtime.** A Postgres connection is `PostgresConnection` and exposes `.backend == "postgres"`; the SQLite connection is a bare `aiosqlite.Connection` (no `.backend`). Detect with `getattr(conn, "backend", "sqlite") == "postgres"`.
4. **CRUD lives in `models.py`, HTTP in `api.py`, Pydantic in `schemas/`** per domain. Mirror the existing `moderation/` domain (`FlagCRUD`/`FlagModel`/router) when adding the review queue.
5. **Test conventions.** Fixtures from `api/tests/conftest.py`: `db_url` (temp SQLite, schema applied), `test_db` (a connection), `test_client` (`httpx.AsyncClient` over `ASGITransport`), plus `sample_entry`, `sample_source`, `sample_discovery_run`. HTTP/search is mocked with `monkeypatch` + hand-written `FakeClient`/`FakeResponse` (no respx). Every new branch needs a test — coverage gate is 100%.
6. **Run quality gates before each commit:** `cd api && uv run ruff format . && uv run ruff check . && uv run mypy atlas && uv run pytest`. For shared-lib changes also run the lib's tests.

---

## File-structure map (all of Phase 0)

**Workstream A — Trust gate (build first)**
- Modify: `api/atlas/models/schema.sql` + `api/atlas/models/database.py` (DB_SCHEMA) — add `review_queue` table.
- Create: `api/atlas/domains/discovery/trust_gate.py` — pure decision function `evaluate_publication(...)` (no I/O).
- Create: `api/atlas/domains/moderation/review_queue.py` — `ReviewQueueCRUD` + `ReviewQueueItemModel`.
- Modify: `api/atlas/domains/discovery/pipeline/runner.py` — `_upsert_entry` writes `active` per the gate and enqueues held records; consume `DeduplicationFlag`s.
- Modify: `api/atlas/domains/moderation/api.py` + `api/atlas/domains/catalog/schemas/public.py` — review-queue list/approve/reject endpoints + schemas.
- Test: `api/tests/domains/discovery/test_trust_gate.py`, `api/tests/domains/moderation/test_review_queue.py`, additions to `api/tests/domains/discovery/test_models.py`/`test_pipeline.py`.

**Workstream B — Atomic claim + idempotency**
- Modify: `api/atlas/models/schema.sql` + `database.py` (DB_SCHEMA) — add `idempotency_key TEXT UNIQUE` and `next_attempt_at` to `discovery_jobs`.
- Modify: `api/atlas/domains/discovery/models.py` — dialect-aware `claim_next` (Postgres `FOR UPDATE SKIP LOCKED ... RETURNING`; SQLite guarded conditional UPDATE).
- Test: `api/tests/domains/discovery/test_models.py`.

**Workstream C — Reaper + backoff + dead-letter**
- Modify: `api/atlas/domains/discovery/models.py` — reap `running` zombies; `fail()` sets backoff `next_attempt_at`; `cancel()`; lease renewal on `update_progress`.
- Modify: `api/atlas/domains/discovery/worker.py` — periodic reaper pass.
- Test: `api/tests/domains/discovery/test_models.py`, `test_worker.py`.

**Workstream D — Cost ledger + ceilings + kill switch**
- Modify: schema (both) — add `cost_ledger` table.
- Create: `api/atlas/domains/discovery/cost.py` — `CostLedgerCRUD`, `record_cost`, `assert_within_budget`, `CostCeilingExceeded`.
- Modify: `api/atlas/platform/config.py` — `discovery_max_run_cost`, `discovery_max_daily_cost`, `discovery_cost_kill_switch`.
- Modify: `api/atlas/domains/discovery/pipeline/source_fetcher.py` + `extractor.py` — meter calls.
- Test: `api/tests/domains/discovery/test_cost.py`.

**Workstream E — SearchProvider interface + Brave hardening + fallback**
- Create: `libs/discovery-engine/src/atlas_discovery_engine/search.py` — `SearchProvider` ABC, `SearchResult`, `BraveSearchProvider`, `FallbackSearchProvider`.
- Modify: `api/atlas/domains/discovery/pipeline/source_fetcher.py` — build a provider, use it; delete the bare `_search_brave`.
- Test: `libs/discovery-engine/tests/test_search.py`, updates to `api/tests/domains/discovery/test_pipeline.py`.

**Workstream F — Async `/scheduled`**
- Modify: `api/atlas/domains/discovery/api.py` — `/scheduled` enqueues jobs (idempotency keys) and returns 202.
- Modify: `api/atlas/domains/discovery/schemas` — response shape.
- Test: `api/tests/domains/discovery/test_schedule_api.py` (or the scheduled-run test module).

---

# Workstream A — Trust gate (LED ITEM, build first)

**Goal:** discovery stops writing public (`active=TRUE`) rows for anything risky. A person is always held; an uncorroborated web-only org is held; a dedup-suspect record is held. Held records land in a `review_queue` a curator works. Auto-approve is reserved for registry-corroborated orgs — a path that is wired now but stays dormant until Phase 2 supplies registry data, so **in Phase 0 essentially everything holds**, which is exactly the safe posture.

**Why this is the led item:** the trust tiers already shipped on profiles are only honest if the backend stops publishing unverified claims. This is the backend half of that promise.

### Task A1: `review_queue` table (both schemas)

**Files:**
- Modify: `api/atlas/models/schema.sql`
- Modify: `api/atlas/models/database.py` (the `DB_SCHEMA` string)
- Test: `api/tests/domains/moderation/test_review_queue.py`

- [ ] **Step 1: Write the failing test** (`api/tests/domains/moderation/test_review_queue.py`)

```python
import pytest
from atlas.models.database import get_db_connection


@pytest.mark.asyncio
async def test_review_queue_table_exists(db_url: str) -> None:
    """init_db must create the review_queue table with the expected columns."""
    conn = await get_db_connection(db_url)
    try:
        cursor = await conn.execute("PRAGMA table_info(review_queue)")
        rows = await cursor.fetchall()
    finally:
        await conn.close()

    columns = {row[1] for row in rows}
    assert columns >= {
        "id",
        "entity_id",
        "kind",
        "status",
        "hold_reason",
        "score",
        "dedup_suspect",
        "created_at",
        "reviewed_at",
        "reviewed_by",
    }
```

- [ ] **Step 2: Run it, expect FAIL** — `cd api && uv run pytest tests/domains/moderation/test_review_queue.py -v` → fails (no such table, empty PRAGMA).

- [ ] **Step 3: Add the table to `schema.sql`** (Postgres dialect), placed near the moderation tables:

```sql
CREATE TABLE IF NOT EXISTS review_queue (
    id TEXT PRIMARY KEY,
    entity_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    hold_reason TEXT NOT NULL,
    score REAL,
    dedup_suspect BOOLEAN NOT NULL DEFAULT FALSE,
    dedup_note TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_entity_id ON review_queue(entity_id);
```

- [ ] **Step 4: Add the same table to `DB_SCHEMA` in `database.py`** (SQLite dialect — `DATETIME` for the timestamp columns, `BOOLEAN ... DEFAULT 0`):

```sql
CREATE TABLE IF NOT EXISTS review_queue (
    id TEXT PRIMARY KEY,
    entity_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    hold_reason TEXT NOT NULL,
    score REAL,
    dedup_suspect BOOLEAN NOT NULL DEFAULT 0,
    dedup_note TEXT,
    created_at DATETIME NOT NULL,
    reviewed_at DATETIME,
    reviewed_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_entity_id ON review_queue(entity_id);
```

- [ ] **Step 5: Run it, expect PASS** — `cd api && uv run pytest tests/domains/moderation/test_review_queue.py -v`.

- [ ] **Step 6: Commit** — `git restore --staged . && git add api/atlas/models/schema.sql api/atlas/models/database.py api/tests/domains/moderation/test_review_queue.py && git commit -m "feat: Add review_queue staging table for the discovery trust gate"`

### Task A2: The pure trust-gate decision function

A side-effect-free function so the rules are trivially testable. Lives in the discovery domain (it needs no shared-lib reuse in Phase 0).

**Files:**
- Create: `api/atlas/domains/discovery/trust_gate.py`
- Test: `api/tests/domains/discovery/test_trust_gate.py`

- [ ] **Step 1: Write the failing tests** (`api/tests/domains/discovery/test_trust_gate.py`)

```python
from atlas.domains.discovery.trust_gate import GateDecision, evaluate_publication


def test_person_is_always_held() -> None:
    decision = evaluate_publication(
        kind="person", registry_corroborated=True, dedup_suspect=False, score=0.99
    )
    assert decision == GateDecision(publish=False, hold_reason="person_requires_review")


def test_registry_corroborated_org_auto_publishes() -> None:
    decision = evaluate_publication(
        kind="organization", registry_corroborated=True, dedup_suspect=False, score=0.8
    )
    assert decision.publish is True
    assert decision.hold_reason is None


def test_uncorroborated_org_is_held() -> None:
    decision = evaluate_publication(
        kind="organization", registry_corroborated=False, dedup_suspect=False, score=0.8
    )
    assert decision == GateDecision(publish=False, hold_reason="uncorroborated_web_only")


def test_dedup_suspect_is_held_even_if_corroborated() -> None:
    decision = evaluate_publication(
        kind="organization", registry_corroborated=True, dedup_suspect=True, score=0.8
    )
    assert decision == GateDecision(publish=False, hold_reason="dedup_suspect")
```

- [ ] **Step 2: Run it, expect FAIL** — `cd api && uv run pytest tests/domains/discovery/test_trust_gate.py -v` → ImportError.

- [ ] **Step 3: Implement `trust_gate.py`**

```python
"""Hybrid publication gate for discovered records.

Pure decision logic (no I/O) so the rules are exhaustively testable. The
caller supplies the few signals the rules need; this module decides whether a
record may be published directly or must be held for human review.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class GateDecision:
    """Outcome of the publication gate.

    Parameters
    ----------
    publish : bool
        True if the record may be written active/public immediately.
    hold_reason : str | None
        Machine-readable reason the record is held; None when published.
    """

    publish: bool
    hold_reason: str | None


def evaluate_publication(
    *,
    kind: str,
    registry_corroborated: bool,
    dedup_suspect: bool,
    score: float,
) -> GateDecision:
    """Decide whether a discovered record may auto-publish.

    Rules (in priority order):
    1. A possible duplicate is always held — merging is a reviewer decision.
    2. A person is always held — wrong facts about a named individual are the
       core liability.
    3. An organization auto-publishes only when corroborated by an authoritative
       registry (EIN/990/FEC). In Phase 0 no registry connectors exist yet, so
       ``registry_corroborated`` is effectively always False and orgs hold too —
       the intended conservative posture.
    4. Everything else is held as uncorroborated web-only.
    """
    if dedup_suspect:
        return GateDecision(publish=False, hold_reason="dedup_suspect")
    if kind == "person":
        return GateDecision(publish=False, hold_reason="person_requires_review")
    if kind == "organization" and registry_corroborated:
        return GateDecision(publish=True, hold_reason=None)
    return GateDecision(publish=False, hold_reason="uncorroborated_web_only")
```

- [ ] **Step 4: Run it, expect PASS** — `cd api && uv run pytest tests/domains/discovery/test_trust_gate.py -v`.

- [ ] **Step 5: Commit** — `git restore --staged . && git add api/atlas/domains/discovery/trust_gate.py api/tests/domains/discovery/test_trust_gate.py && git commit -m "feat: Add the hybrid publication gate decision logic"`

### Task A3: `ReviewQueueCRUD`

**Files:**
- Create: `api/atlas/domains/moderation/review_queue.py`
- Test: append to `api/tests/domains/moderation/test_review_queue.py`

- [ ] **Step 1: Write failing tests** (append)

```python
import pytest
from atlas.domains.catalog.models.entry import EntryCRUD
from atlas.domains.moderation.review_queue import ReviewQueueCRUD
from atlas.models.database import get_db_connection


@pytest.mark.asyncio
async def test_enqueue_and_list_pending(db_url: str) -> None:
    conn = await get_db_connection(db_url)
    try:
        entity_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Jane Organizer",
            description="A community organizer.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
        )
        item_id = await ReviewQueueCRUD.enqueue(
            conn,
            entity_id=entity_id,
            kind="person",
            hold_reason="person_requires_review",
            score=0.42,
            dedup_suspect=False,
            dedup_note=None,
        )
        pending = await ReviewQueueCRUD.list_pending(conn)
    finally:
        await conn.close()

    assert item_id is not None
    assert [item.entity_id for item in pending] == [entity_id]
    assert pending[0].status == "pending"


@pytest.mark.asyncio
async def test_approve_marks_entry_active_and_item_approved(db_url: str) -> None:
    conn = await get_db_connection(db_url)
    try:
        entity_id = await EntryCRUD.create(
            conn,
            entry_type="organization",
            name="Held Org",
            description="Held pending review.",
            city="Kansas City",
            state="MO",
            geo_specificity="local",
            active=False,
        )
        item_id = await ReviewQueueCRUD.enqueue(
            conn, entity_id=entity_id, kind="organization",
            hold_reason="uncorroborated_web_only", score=0.5,
            dedup_suspect=False, dedup_note=None,
        )
        await ReviewQueueCRUD.approve(conn, item_id, reviewed_by="curator@atlas")
        entry = await EntryCRUD.get_by_id(conn, entity_id)
        pending = await ReviewQueueCRUD.list_pending(conn)
    finally:
        await conn.close()

    assert entry is not None and entry.active is True
    assert pending == []


@pytest.mark.asyncio
async def test_reject_keeps_entry_inactive(db_url: str) -> None:
    conn = await get_db_connection(db_url)
    try:
        entity_id = await EntryCRUD.create(
            conn, entry_type="organization", name="Bad Org",
            description="Rejected.", city="KC", state="MO",
            geo_specificity="local", active=False,
        )
        item_id = await ReviewQueueCRUD.enqueue(
            conn, entity_id=entity_id, kind="organization",
            hold_reason="uncorroborated_web_only", score=0.1,
            dedup_suspect=False, dedup_note=None,
        )
        await ReviewQueueCRUD.reject(conn, item_id, reviewed_by="curator@atlas")
        entry = await EntryCRUD.get_by_id(conn, entity_id)
    finally:
        await conn.close()

    assert entry is not None and entry.active is False
```

> Note: this assumes `EntryCRUD.create` accepts an `active: bool = True` keyword. If it does not yet (it currently relies on the schema default), Task A4 adds it; write that signature change first if these tests need it to compile.

- [ ] **Step 2: Run, expect FAIL** — ImportError / unexpected `active` kwarg.

- [ ] **Step 3: Implement `review_queue.py`** mirroring `FlagCRUD` (dataclass model + static async CRUD using `?` placeholders, `db.generate_uuid()`, `db.now_iso()`):

```python
"""Pre-publication review queue.

Extends the moderation domain from reactive entity/source flags into a
proactive queue of discovered records held back from the public directory.
"""

from dataclasses import dataclass
from typing import Any

from atlas.platform.database import db


@dataclass
class ReviewQueueItemModel:
    """A discovered record held for human review before publication."""

    id: str
    entity_id: str | None
    kind: str
    status: str
    hold_reason: str
    score: float | None
    dedup_suspect: bool
    dedup_note: str | None
    created_at: str
    reviewed_at: str | None
    reviewed_by: str | None


def _row_to_item(row: tuple[Any, ...]) -> ReviewQueueItemModel:
    return ReviewQueueItemModel(
        id=row[0],
        entity_id=row[1],
        kind=row[2],
        status=row[3],
        hold_reason=row[4],
        score=row[5],
        dedup_suspect=bool(row[6]),
        dedup_note=row[7],
        created_at=row[8],
        reviewed_at=row[9],
        reviewed_by=row[10],
    )


_SELECT_COLUMNS = (
    "id, entity_id, kind, status, hold_reason, score, dedup_suspect, "
    "dedup_note, created_at, reviewed_at, reviewed_by"
)


class ReviewQueueCRUD:
    """CRUD for the pre-publication review queue."""

    @staticmethod
    async def enqueue(
        conn: Any,
        *,
        entity_id: str | None,
        kind: str,
        hold_reason: str,
        score: float | None,
        dedup_suspect: bool,
        dedup_note: str | None,
    ) -> str:
        """Insert a held record and return its id."""
        item_id = db.generate_uuid()
        created_at = db.now_iso()
        await conn.execute(
            """
            INSERT INTO review_queue (
                id, entity_id, kind, status, hold_reason, score,
                dedup_suspect, dedup_note, created_at
            ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)
            """,
            (
                item_id, entity_id, kind, hold_reason, score,
                1 if dedup_suspect else 0, dedup_note, created_at,
            ),
        )
        await conn.commit()
        return item_id

    @staticmethod
    async def list_pending(
        conn: Any, *, limit: int = 50, offset: int = 0
    ) -> list[ReviewQueueItemModel]:
        cursor = await conn.execute(
            f"""
            SELECT {_SELECT_COLUMNS} FROM review_queue
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        )
        rows = await cursor.fetchall()
        return [_row_to_item(row) for row in rows]

    @staticmethod
    async def get_by_id(conn: Any, item_id: str) -> ReviewQueueItemModel | None:
        cursor = await conn.execute(
            f"SELECT {_SELECT_COLUMNS} FROM review_queue WHERE id = ?",
            (item_id,),
        )
        row = await cursor.fetchone()
        return _row_to_item(row) if row else None

    @staticmethod
    async def approve(conn: Any, item_id: str, *, reviewed_by: str) -> None:
        """Approve a held record: publish its entry and close the item."""
        item = await ReviewQueueCRUD.get_by_id(conn, item_id)
        if item is None or item.entity_id is None:
            await ReviewQueueCRUD._close(conn, item_id, "approved", reviewed_by)
            return
        await conn.execute(
            "UPDATE entries SET active = TRUE WHERE id = ?", (item.entity_id,)
        )
        await ReviewQueueCRUD._close(conn, item_id, "approved", reviewed_by)

    @staticmethod
    async def reject(conn: Any, item_id: str, *, reviewed_by: str) -> None:
        """Reject a held record: leave its entry inactive, close the item."""
        await ReviewQueueCRUD._close(conn, item_id, "rejected", reviewed_by)

    @staticmethod
    async def _close(conn: Any, item_id: str, status: str, reviewed_by: str) -> None:
        await conn.execute(
            "UPDATE review_queue SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?",
            (status, db.now_iso(), reviewed_by, item_id),
        )
        await conn.commit()

    @staticmethod
    async def count_pending(conn: Any) -> int:
        cursor = await conn.execute(
            "SELECT COUNT(*) FROM review_queue WHERE status = 'pending'"
        )
        row = await cursor.fetchone()
        return int(row[0]) if row else 0
```

> Note on `entries.active = TRUE`: in SQLite `TRUE` is accepted (alias for 1) under modern SQLite; if the existing code writes `active = 1` elsewhere, mirror that literal to stay consistent — grep `entry.py` for the existing convention and match it.

- [ ] **Step 4: Run, expect PASS.** **Step 5: Commit** — `git restore --staged . && git add api/atlas/domains/moderation/review_queue.py api/tests/domains/moderation/test_review_queue.py && git commit -m "feat: Add review-queue CRUD with approve/reject promotion"`

### Task A4: `EntryCRUD.create` accepts `active`

**Files:** Modify `api/atlas/domains/catalog/models/entry.py`; Test `api/tests/domains/catalog/...` (existing entry-model test file).

- [ ] **Step 1: Failing test** — assert `await EntryCRUD.create(..., active=False)` produces an entry with `active is False` and that it is excluded from `_search_public_ids`.
- [ ] **Step 2: Run, FAIL** (unexpected kwarg).
- [ ] **Step 3:** Add `active: bool = True` param to `EntryCRUD.create`, include `active` in the INSERT column list and values (store `1 if active else 0` for SQLite parity). Default preserves all existing callers.
- [ ] **Step 4: Run, PASS.** **Step 5: Commit** — `feat: Let EntryCRUD.create persist an explicit active flag`.

### Task A5: Route `_upsert_entry` through the gate

This is the behavioral core: discovery stops auto-publishing risky records.

**Files:** Modify `api/atlas/domains/discovery/pipeline/runner.py`; Test `api/tests/domains/discovery/test_pipeline.py`.

- [ ] **Step 1: Failing test** — drive `_upsert_entry` (or its caller) with a `person` deduped entry and assert the created entry is `active=False` AND a `review_queue` row exists with `hold_reason="person_requires_review"`. Add a second test: an `organization` with no registry corroboration is also held.

```python
@pytest.mark.asyncio
async def test_discovered_person_is_held_not_published(test_db: object) -> None:
    from atlas.domains.discovery.pipeline.runner import _upsert_entry
    from atlas.domains.moderation.review_queue import ReviewQueueCRUD
    # build a SharedDeduplicatedEntry for a person (use the existing test factory
    # in this module for deduped entries; set entry_type="person")
    entry = _make_deduped_entry(entry_type="person", name="Sam Organizer", city="KC", state="MO")

    entity_id = await _upsert_entry(test_db, entry)

    stored = await EntryCRUD.get_by_id(test_db, entity_id)
    pending = await ReviewQueueCRUD.list_pending(test_db)
    assert stored is not None and stored.active is False
    assert [item.entity_id for item in pending] == [entity_id]
    assert pending[0].hold_reason == "person_requires_review"
```

- [ ] **Step 2: Run, FAIL** (entry is active, queue empty).
- [ ] **Step 3: Modify `_upsert_entry`** (runner.py ~318–362):
  - Compute `decision = evaluate_publication(kind=str(entry.entry_type), registry_corroborated=False, dedup_suspect=<from dedup flags, see A6>, score=<entry score or 0.0>)`. In Phase 0 `registry_corroborated` is always `False` (no connectors); pass it explicitly so Phase 2 can flip it.
  - On the **create** path, pass `active=decision.publish` to `EntryCRUD.create`.
  - When `not decision.publish`, after creating the entry call `ReviewQueueCRUD.enqueue(conn, entity_id=<new id>, kind=..., hold_reason=decision.hold_reason, score=..., dedup_suspect=..., dedup_note=...)`.
  - On the **update** path of an already-active entry, do not silently flip it inactive (don't unpublish live data); only newly-created records are gated. (Document this: re-discovery of an already-published record is out of Phase 0 scope; Phase 1 resolution handles merges.)
- [ ] **Step 4: Run, PASS.** **Step 5: Commit** — `feat: Hold discovered people and uncorroborated orgs for review instead of publishing`.

### Task A6: Consume `DeduplicationFlag` into the gate

**Files:** Modify `api/atlas/domains/discovery/pipeline/runner.py` (the dedup step, ~146–155); Test `test_pipeline.py`.

- [ ] **Step 1: Failing test** — when the dedup step returns a `DeduplicationFlag` touching a discovered entry, that entry is held with `dedup_suspect=True`, `hold_reason="dedup_suspect"`, and `dedup_note` set from the flag's `reason`.
- [ ] **Step 2: Run, FAIL.**
- [ ] **Step 3:** Build a set of dedup-flagged entry indices from `deduped.flags` (currently dropped at runner.py:146–155); thread `dedup_suspect`/`dedup_note` into the `_upsert_entry` call for those records.
- [ ] **Step 4: Run, PASS.** **Step 5: Commit** — `feat: Route dedup-suspect discoveries into the review queue`.

### Task A7: Review-queue HTTP endpoints

**Files:** Modify `api/atlas/domains/moderation/api.py`; add schemas in `api/atlas/domains/catalog/schemas/public.py`; Test `api/tests/domains/moderation/test_review_queue_api.py`.

- [ ] **Step 1: Failing tests** with `test_client`: `GET /api/review-queue` returns pending items with `total`; `POST /api/review-queue/{id}/approve` flips the entry active and returns 200; `POST /api/review-queue/{id}/reject` keeps it inactive; unknown id → 404.
- [ ] **Step 2: Run, FAIL.**
- [ ] **Step 3:** Add `ReviewQueueItemResponse` + `ReviewQueueListResponse` Pydantic models; add three routes mirroring the flag endpoints (same `get_db` dependency, `apply_no_store_headers`, `operation_id`, `tags=["moderation"]`). Gate approve/reject behind the existing admin permission used by `verification_admin` (`require_actor_permission(...)`) so only operators can promote. Register the router (it is already included via `flags_router`/the moderation router — confirm the prefix; add `/api/review-queue` routes there).
- [ ] **Step 4: Run, PASS.** Regenerate OpenAPI if the gate surfaces publicly: `pnpm run openapi`. **Step 5: Commit** — `feat: Expose the discovery review queue to operators`.

### Task A8: Wire-through / coverage sweep

- [ ] Run full gate: `cd api && uv run ruff format . && uv run ruff check . && uv run mypy atlas && uv run pytest`. Fix any sub-100% coverage by adding tests for untested branches (e.g., the `entity_id is None` branch in `approve`). Commit `chore(api): Close coverage on the trust gate`.

---

# Workstream B — Atomic claim + idempotency

**Goal:** safe horizontal scaling / rolling deploys — no double-claim, no double-spend.

### Task B1: Schema — `idempotency_key` + `next_attempt_at`

- [ ] Add to `discovery_jobs` in BOTH schemas: `idempotency_key TEXT` with `CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_jobs_idempotency ON discovery_jobs(idempotency_key)` (partial/unique; NULLs allowed for legacy rows), and `next_attempt_at TIMESTAMPTZ` (SQLite `DATETIME`). Test: PRAGMA shows the columns. Commit `feat: Add idempotency_key and next_attempt_at to discovery_jobs`.
- [ ] Modify `DiscoveryJobCRUD.create` to accept `idempotency_key: str | None = None` and insert it; on `UNIQUE` violation, treat as a no-op returning the existing job id (so re-enqueue is safe). Test both the fresh-insert and duplicate-key paths.

### Task B2: Dialect-aware `claim_next`

**Files:** Modify `api/atlas/domains/discovery/models.py` (`claim_next`, ~686–727); Test `test_models.py`.

- [ ] **Step 1: Failing test** — two concurrent `claim_next` calls on a one-job queue yield exactly one non-None job (no double-claim). On SQLite, simulate by claiming, then asserting a second claim returns None while the first lease is live and the job is `claimed`.

```python
@pytest.mark.asyncio
async def test_claim_next_does_not_double_claim(db_url: str) -> None:
    conn = await get_db_connection(db_url)
    run_id = await DiscoveryRunCRUD.create(conn, location_query="KC", state="MO", issue_areas=["x"])
    await DiscoveryJobCRUD.create(conn, run_id=run_id)
    first = await DiscoveryJobCRUD.claim_next(conn, claimed_by="w1")
    second = await DiscoveryJobCRUD.claim_next(conn, claimed_by="w2")
    await conn.close()
    assert first is not None
    assert second is None
```

- [ ] **Step 2: Run, FAIL** if the current SELECT-then-UPDATE lets `w2` re-claim (it can, since the SELECT sees `claimed` only-if-expired, so this specific test may already pass — extend it to the real race: claim, then a guarded re-claim of the SAME row must fail). Add a test that asserts the UPDATE is guarded: after a manual `claimed`, a claim attempt that targets that row by id only succeeds if status is still claimable.
- [ ] **Step 3: Implement dialect branch:**

```python
is_postgres = getattr(conn, "backend", "sqlite") == "postgres"
now = db.now_iso()
lease_until = (datetime.now(UTC) + timedelta(seconds=lease_seconds)).isoformat()

if is_postgres:
    cursor = await conn.execute(
        """
        UPDATE discovery_jobs SET status='claimed', claimed_by=?, claimed_until=?,
            started_at=COALESCE(started_at, ?)
        WHERE id = (
            SELECT id FROM discovery_jobs
            WHERE (status='queued' OR (status='claimed' AND claimed_until < ?))
              AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        """,
        (claimed_by, lease_until, now, now, now),
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    columns = [c[0] for c in cursor.description]
    job = _row_to_discovery_job(dict(zip(columns, row, strict=False)))
    await conn.commit()
    return job

# SQLite: serialized writer; SELECT a candidate then guard the UPDATE by status.
cursor = await conn.execute(
    """
    SELECT * FROM discovery_jobs
    WHERE (status='queued' OR (status='claimed' AND claimed_until < ?))
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    ORDER BY created_at ASC LIMIT 1
    """,
    (now, now),
)
row = await cursor.fetchone()
if row is None:
    return None
columns = [c[0] for c in cursor.description]
job = _row_to_discovery_job(dict(zip(columns, row, strict=False)))
update = await conn.execute(
    """
    UPDATE discovery_jobs SET status='claimed', claimed_by=?, claimed_until=?,
        started_at=COALESCE(started_at, ?)
    WHERE id=? AND status=?
    """,
    (claimed_by, lease_until, now, job.id, job.status),
)
await conn.commit()
if getattr(update, "rowcount", 0) != 1:
    return None  # lost the race; caller polls again
job.status, job.claimed_by, job.claimed_until = "claimed", claimed_by, lease_until
return job
```

- [ ] **Step 4: Run, PASS** (both the no-double-claim and guarded-update tests). **Step 5: Commit** — `feat: Make discovery job claiming atomic and idempotent`.

---

# Workstream C — Reaper + backoff + dead-letter

**Goal:** a crash mid-run no longer strands a job forever; retries back off; cancels work.

### Task C1: Reap `running` zombies

- [ ] Lease running jobs: in `update_progress` (the claimed→running transition), also set `claimed_until = now + lease`. Test it sets the lease.
- [ ] Add `DiscoveryJobCRUD.reap_orphans(conn, *, now=None) -> int` that requeues jobs in `running` (or `claimed`) whose `claimed_until < now`: set `status='queued', claimed_by=NULL, claimed_until=NULL` and bump `retry_count`; if `retry_count` would exceed `max_retries`, set `status='failed'` instead (dead-letter). Return count reaped. Test: a `running` job with an expired lease becomes `queued` (or `failed` past max retries).
- [ ] In `worker.py`, call `reap_orphans` once per poll cycle (cheap UPDATE) before `claim_next`. Test via the existing worker harness that a stranded `running` job is reclaimed.
- [ ] Commit — `feat: Reap stranded discovery jobs so a crash never strands work`.

### Task C2: Backoff on retry

- [ ] Modify `fail()` (models.py ~753–787): on requeue, set `next_attempt_at = now + backoff(retry_count)` where `backoff` is capped exponential with jitter, e.g. `min(300, 2 ** retry_count) ` seconds plus a small deterministic jitter derived from the job id (avoid `random` for test determinism — derive jitter from `hash(job_id) % 5`). `claim_next` already filters `next_attempt_at <= now` (Task B2). Test: a failed-then-requeued job has a future `next_attempt_at` and is not claimed before it.
- [ ] Commit — `feat: Back off discovery retries instead of hot-looping`.

### Task C3: Real cancel path

- [ ] Add `DiscoveryJobCRUD.cancel(conn, job_id) -> bool` setting `status='cancelled'` only from non-terminal states; `claim_next` already ignores `cancelled`. Add `POST /api/discovery-runs/{run_id}/cancel` (admin permission) cancelling the run's queued/claimed jobs. Tests for both. Commit — `feat: Wire a real cancel path for discovery runs`.

---

# Workstream D — Cost ledger + ceilings + kill switch

**Goal:** discovery can never spend without a bound; an operator can stop it instantly.

### Task D1: Settings + `cost_ledger` table

- [ ] Add to `config.py`: `discovery_max_run_cost: float` (default e.g. `5.0`), `discovery_max_daily_cost: float` (default e.g. `50.0`), `discovery_cost_kill_switch: bool = Field(default=False, validation_alias="DISCOVERY_COST_KILL_SWITCH")`. Test defaults + env override.
- [ ] Add `cost_ledger` table (both schemas): `id TEXT PK, run_id TEXT REFERENCES discovery_runs(id) ON DELETE CASCADE, kind TEXT (search|llm), provider TEXT, units REAL, estimated_cost REAL, created_at TIMESTAMPTZ/DATETIME`. Index on `(run_id)` and `(created_at)`. Test PRAGMA.

### Task D2: `cost.py`

- [ ] Create `api/atlas/domains/discovery/cost.py` with:
  - `class CostCeilingExceeded(Exception)` with a `.scope` ("run" | "daily" | "kill_switch").
  - `async def record_cost(conn, *, run_id, kind, provider, units, estimated_cost) -> None` (insert + commit).
  - `async def run_cost(conn, run_id) -> float` and `async def daily_cost(conn, *, since_iso) -> float` (SUM aggregates).
  - `async def assert_within_budget(conn, *, run_id, settings) -> None` raising `CostCeilingExceeded` if the kill switch is on, or run/daily sums exceed ceilings.
- [ ] Tests for each: recording accumulates; ceilings raise with the right scope; kill switch raises immediately.

### Task D3: Meter the calls

- [ ] In `source_fetcher.py` (Workstream E gives it a provider) and `extractor.py`, after each search/LLM call, `await record_cost(...)` (units = #results or #tokens; `estimated_cost` from a simple per-unit constant in `cost.py`). Before each call, `await assert_within_budget(...)`. Catch `CostCeilingExceeded` in the runner's pipeline and end the run as a controlled stop (mark run `failed` with reason `cost_ceiling`) rather than an exception storm. Tests: a run that crosses the ceiling stops and records the reason.
- [ ] Commit per task — `feat: Meter and cap discovery spend with a kill switch`.

---

# Workstream E — SearchProvider interface + Brave hardening + fallback

**Goal:** a 429 or vendor outage degrades gracefully instead of zeroing out a city; search is swappable. The interface lives in the **shared lib** so Scout and the API worker both use it.

### Task E1: Interface + `SearchResult` (shared lib)

- [ ] Create `libs/discovery-engine/src/atlas_discovery_engine/search.py`:

```python
from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class SearchResult:
    url: str
    title: str | None
    publication: str | None
    published: str | None  # ISO date string or None


class SearchProvider(ABC):
    @abstractmethod
    async def search(self, queries: Sequence[str]) -> list[SearchResult]:
        """Run each query and return normalized results. Must not raise on a
        single query's transient failure — degrade to fewer results."""
```

- [ ] Test: a trivial in-memory `SearchProvider` subclass returns its canned results (proves the contract). Commit — `feat: Add a vendor-neutral SearchProvider interface`.

### Task E2: `BraveSearchProvider` with 429/error handling

- [ ] Implement `BraveSearchProvider(api_key, count=5, timeout=20.0, max_retries=2)` whose `search`:
  - wraps each query in `try/except httpx.HTTPStatusError/httpx.RequestError`;
  - on 429 reads `Retry-After`, sleeps (bounded), retries up to `max_retries`;
  - on exhaustion logs and **skips that query** (returns partial results) instead of raising;
  - maps Brave's `web.results[]` → `SearchResult` (reuse the `profile.name` / `age` parsing).
- [ ] Tests with the `FakeClient`/`FakeResponse` pattern: success maps fields; a 429-then-200 retries and succeeds; a persistent 429 yields `[]` for that query without raising. Commit — `feat: Harden Brave search against rate limits and outages`.

### Task E3: `FallbackSearchProvider`

- [ ] Implement `FallbackSearchProvider(primary, fallback)` whose `search` tries `primary`; if it returns empty or raises, uses `fallback`. Provide a second concrete provider stub for the fallback (a documented `SerpApiSearchProvider` skeleton or a `StaticSearchProvider` for environments without a second key) so the composition is real and tested. Tests: fallback used when primary empties/raises. Commit — `feat: Add search fallback with circuit-breaker semantics`.

### Task E4: Use the provider in `source_fetcher.py`

- [ ] Replace `_search_brave` usage: build a provider from settings (`BraveSearchProvider` wrapped in `FallbackSearchProvider` when a fallback key exists), pass it into `fetch_sources`, delete the bare inline function. Update `test_pipeline.py` to mock the provider instead of `httpx.AsyncClient`. Confirm a search failure now yields partial/empty results without failing the whole run. Commit — `feat: Route discovery search through the provider abstraction`.

---

# Workstream F — Async `/scheduled`

**Goal:** the Cloud Scheduler trigger returns immediately (202) and the durable worker does the work, instead of a synchronous fan-out that blocks the request and fails a whole batch on one error.

### Task F1: Enqueue instead of run inline

**Files:** Modify `api/atlas/domains/discovery/api.py` (`execute_scheduled_runs`, ~302–379); Test `api/tests/domains/discovery/test_schedule_api.py`.

- [ ] **Step 1: Failing test** — `POST /api/discovery-runs/scheduled` with two enabled schedules returns **202**, creates two `discovery_runs` and two **queued** `discovery_jobs` (one per schedule, each with a per-target `idempotency_key`), and does NOT run the pipeline inline (monkeypatch `run_discovery_pipeline_for_run` to raise — the endpoint must still succeed because it no longer calls it).
- [ ] **Step 2: Run, FAIL** (current handler runs inline, returns 200).
- [ ] **Step 3:** Rewrite the loop body to: create the run, then `DiscoveryJobCRUD.create(db, run_id=run_id, idempotency_key=f"sched:{schedule.id}:{day}")` where `day` is `db.now_iso()[:10]` (one job per schedule per day; the unique index makes a same-day re-trigger a no-op). Update `last_run_at`. Return `status_code=202` with the enqueued run/job ids. Remove the inline `run_discovery_pipeline_for_run` call and its try/except. Update `ScheduledRunResponse`/`ScheduledRunResult` to report `enqueued` counts rather than per-run `entries_confirmed`.
- [ ] **Step 4: Run, PASS.** Regenerate OpenAPI (`pnpm run openapi`). **Step 5: Commit** — `feat: Make scheduled discovery enqueue durable jobs and return 202`.

### Task F2: Fix `/summary` undercount (carried along)

- [ ] Replace `len(list_by_status(...))` (capped at 50) with SQL `COUNT(*)` GROUP BY status in the `/summary` handler so queued/running/failed counts are accurate. Test with >50 jobs in one status. Commit — `fix: Count discovery jobs by status with SQL aggregates`.

---

## Self-review (run before handing off)

**Spec coverage (§8 + §10 Phase 0):**
- Trust gate (`review_queue` + hybrid rules, §9) → Workstream A ✓
- Atomic claim (`FOR UPDATE SKIP LOCKED` + `RETURNING` + `idempotency_key`) → Workstream B ✓
- Orphan reaper + real lease + backoff + dead-letter → Workstream C ✓
- Cost ledger + per-run/global ceilings + kill switch → Workstream D ✓
- `SearchProvider` + Brave 429/error handling + one fallback → Workstream E ✓
- Async `/scheduled` (enqueue, 202) → Workstream F ✓
- The §2.2 `/summary` undercount → Task F2 ✓ (carried along)

**Open decision resolved in-plan:** Registry-corroborated auto-approve (§9) depends on registry connectors that are Phase 2. The gate is built now with `registry_corroborated` passed explicitly as `False`, so Phase 0 holds conservatively and Phase 2 flips the flag — no rework, no premature publishing.

**Dialect consistency:** every new table is added to BOTH `schema.sql` and `DB_SCHEMA`; `claim_next` branches on `getattr(conn, "backend", "sqlite")`; timestamps stored as ISO strings via `db.now_iso()` (comparison-safe in UTC isoformat) with TIMESTAMPTZ/DATETIME column types per dialect.

**Type consistency:** `GateDecision(publish, hold_reason)`, `ReviewQueueItemModel` fields, and `SearchResult(url,title,publication,published)` are referenced consistently across tasks.

**Sequencing:** A is built and verified first (it is the experience-critical, led item). B–F are independent and may be executed in any order after A; each ends green on its own.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-23-discovery-phase-0.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task with two-stage review between tasks; fast iteration, each task verified before the next.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach? (And do you want all six workstreams, or just Workstream A — the trust gate — first?)
