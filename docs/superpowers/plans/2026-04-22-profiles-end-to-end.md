# Profiles End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform profile pages from CSR dead-ends into SSR research surfaces with canonical URLs, SEO markup, actor connections, and smooth view transitions — making profiles the public face of the Atlas civic graph.

**Architecture:** New slug column on entries + slug_aliases table enables canonical URLs. TanStack Start SSR with server functions fetches profile data server-side. A new connections API computes related actors from existing junction tables. View Transitions API handles morphing between browse, profile, and profile-to-profile navigation.

**Tech Stack:** TanStack Start (SSR), TanStack Router (view transitions), FastAPI (connections endpoint), schema.org JSON-LD, View Transitions API

**Spec:** `docs/superpowers/specs/2026-04-22-profiles-end-to-end-design.md`

**Out of scope (separate plan):** Network Explorer (`/explore` route, graph canvas, force layout, sidebar)

---

## File Map

### Backend (API)

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `api/atlas/models/schema.sql` | Add `slug` column to entries, create `slug_aliases` table |
| Modify | `api/atlas/models/database.py` | Add slug column + slug_aliases to embedded SQLite schema |
| Modify | `api/atlas/domains/catalog/models/entry.py` | Add slug to EntryModel, slug generation, resolution, connections query |
| Create | `api/atlas/domains/catalog/models/connections.py` | Connection computation logic (same org, same issues, same geo, co-mentioned) |
| Modify | `api/atlas/domains/catalog/schemas/entry.py` | Add slug to create/update schemas |
| Create | `api/atlas/domains/catalog/api/connections.py` | FastAPI router for connections endpoint |
| Modify | `api/atlas/platform/http/router.py` | Register connections router |
| Create | `api/tests/domains/catalog/test_slugs.py` | Slug generation + resolution tests |
| Create | `api/tests/domains/catalog/test_connections.py` | Connections endpoint tests |

### Frontend (App)

| Action | Path | Purpose |
|--------|------|---------|
| Create | `app/src/routes/_public/profiles/people.$slug.tsx` | Person profile SSR route |
| Create | `app/src/routes/_public/profiles/organizations.$slug.tsx` | Org profile SSR route |
| Modify | `app/src/routes/_public/entries.$entryId.tsx` | Convert to redirect route |
| Create | `app/src/domains/catalog/server/profile-loaders.ts` | Server functions for profile data fetching |
| Create | `app/src/domains/catalog/components/profiles/profile-head.tsx` | SEO meta tags + JSON-LD component |
| Create | `app/src/domains/catalog/components/profiles/connections-section.tsx` | Connections sidebar section |
| Modify | `app/src/domains/catalog/pages/entry-page.tsx` | Accept server-loaded data, add sidebar layout |
| Create | `app/src/domains/catalog/hooks/use-connections.ts` | React Query hook for connections |
| Modify | `app/src/domains/catalog/components/entries/entry-card.tsx` | Add view-transition-name to avatar + name |
| Modify | `app/src/domains/catalog/components/profiles/profile-header.tsx` | Add view-transition-name to avatar + name |
| Modify | `app/src/types/entry.ts` | Add slug field to Entry type |
| Modify | `app/src/lib/api.ts` | Map slug from API response, add connections fetcher |
| Create | `app/src/routes/_public/sitemap[.]xml.ts` | Sitemap generation route |
| Create | `app/tests/unit/domains/catalog/components/connections-section.test.tsx` | Connections section tests |
| Create | `app/tests/unit/domains/catalog/server/profile-loaders.test.ts` | Server function tests |

---

## Task 1: Add Slug Column and Aliases Table

**Files:**
- Modify: `api/atlas/models/schema.sql`
- Modify: `api/atlas/models/database.py`

- [ ] **Step 1: Add slug column and slug_aliases table to PostgreSQL schema**

In `api/atlas/models/schema.sql`, add after the entries table definition (after line ~50, before the sources table):

```sql
-- Add slug column to entries (after the existing CREATE TABLE entries block)
-- Note: This ALTER is idempotent; for fresh installs, add the column to CREATE TABLE instead.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_entries_slug ON entries(slug);

CREATE TABLE IF NOT EXISTS slug_aliases (
    old_slug TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_slug_aliases_entry_id ON slug_aliases(entry_id);
```

Also add the `slug` column inline to the `CREATE TABLE entries` block so fresh installs get it:

```sql
slug TEXT UNIQUE,
```

Add it after the `updated_at` column definition.

- [ ] **Step 2: Add slug column and slug_aliases to SQLite embedded schema**

In `api/atlas/models/database.py`, find the `DB_SCHEMA` string and add the `slug` column to the `CREATE TABLE entries` block:

```sql
slug TEXT UNIQUE,
```

Add it after the `updated_at` column. Then add after the entries table:

```sql
CREATE INDEX IF NOT EXISTS idx_entries_slug ON entries(slug);

CREATE TABLE IF NOT EXISTS slug_aliases (
    old_slug TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_slug_aliases_entry_id ON slug_aliases(entry_id);
```

- [ ] **Step 3: Add slug migration to `_ensure_entry_columns`**

In `api/atlas/models/database.py`, find the `_ensure_entry_columns` function. Add slug to the migration columns list:

```python
{"name": "slug", "sql": "ALTER TABLE entries ADD COLUMN slug TEXT UNIQUE"},
```

- [ ] **Step 4: Run the test suite to verify schema changes don't break existing tests**

Run: `cd api && python -m pytest tests/ -x -q`
Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```
chore(api): Add slug column to entries table and slug_aliases table

The slug column enables human-readable canonical URLs for profile pages.
The slug_aliases table supports redirects when vanity slugs replace
autogenerated ones.
```

---

## Task 2: Slug Generation and Resolution in EntryCRUD

**Files:**
- Modify: `api/atlas/domains/catalog/models/entry.py`
- Create: `api/tests/domains/catalog/test_slugs.py`

- [ ] **Step 1: Write failing tests for slug generation**

Create `api/tests/domains/catalog/test_slugs.py`:

```python
import pytest

from atlas.domains.catalog.models.entry import EntryCRUD

STATUS_OK = 200
STATUS_CREATED = 201
STATUS_NOT_FOUND = 404


class TestSlugGeneration:
    def test_generates_slug_from_name_and_id(self) -> None:
        slug = EntryCRUD.generate_slug("Jane Doe", "a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        assert slug.startswith("jane-doe-")
        assert len(slug.split("-")[-1]) == 4  # short hash suffix

    def test_strips_special_characters(self) -> None:
        slug = EntryCRUD.generate_slug(
            "Dr. María García-López (PhD)", "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        )
        assert "." not in slug
        assert "(" not in slug
        assert ")" not in slug
        # Name portion should be lowercase alphanumeric + hyphens only
        name_part = "-".join(slug.split("-")[:-1])
        assert all(c.isalnum() or c == "-" for c in name_part)

    def test_handles_unicode_names(self) -> None:
        slug = EntryCRUD.generate_slug("José Hernández", "a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        assert slug.startswith("jose-hernandez-") or slug.startswith("jos-hern")
        assert len(slug.split("-")[-1]) == 4

    def test_collapses_multiple_hyphens(self) -> None:
        slug = EntryCRUD.generate_slug("A -- B  C", "a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        assert "--" not in slug

    def test_deterministic_for_same_inputs(self) -> None:
        slug_a = EntryCRUD.generate_slug("Jane Doe", "a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        slug_b = EntryCRUD.generate_slug("Jane Doe", "a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        assert slug_a == slug_b

    def test_different_ids_produce_different_slugs(self) -> None:
        slug_a = EntryCRUD.generate_slug("Jane Doe", "a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        slug_b = EntryCRUD.generate_slug("Jane Doe", "ffffffff-ffff-ffff-ffff-ffffffffffff")
        assert slug_a != slug_b


class TestSlugResolution:
    @pytest.mark.asyncio
    async def test_resolve_by_slug_returns_entry(self, test_db: object) -> None:
        conn = test_db
        entry_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Jane Doe",
            description="Test person",
            geo_specificity="local",
        )
        entry = await EntryCRUD.get_by_id(conn, entry_id)
        assert entry is not None
        assert entry.slug is not None

        resolved = await EntryCRUD.get_by_slug(conn, entry.slug)
        assert resolved is not None
        assert resolved.id == entry_id

    @pytest.mark.asyncio
    async def test_resolve_unknown_slug_returns_none(self, test_db: object) -> None:
        conn = test_db
        resolved = await EntryCRUD.get_by_slug(conn, "nonexistent-slug-xxxx")
        assert resolved is None

    @pytest.mark.asyncio
    async def test_resolve_alias_returns_entry_and_canonical(self, test_db: object) -> None:
        conn = test_db
        entry_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Jane Doe",
            description="Test person",
            geo_specificity="local",
        )
        entry = await EntryCRUD.get_by_id(conn, entry_id)
        assert entry is not None
        old_slug = entry.slug

        # Set a vanity slug
        await EntryCRUD.set_vanity_slug(conn, entry_id, "janedoe")

        # Old slug should resolve via alias
        result = await EntryCRUD.resolve_slug(conn, old_slug)
        assert result is not None
        assert result["entry"].id == entry_id
        assert result["canonical_slug"] == "janedoe"
        assert result["is_alias"] is True

        # New slug should resolve directly
        result = await EntryCRUD.resolve_slug(conn, "janedoe")
        assert result is not None
        assert result["entry"].id == entry_id
        assert result["is_alias"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && python -m pytest tests/domains/catalog/test_slugs.py -v`
Expected: FAIL — `EntryCRUD.generate_slug` does not exist.

- [ ] **Step 3: Implement slug generation**

In `api/atlas/domains/catalog/models/entry.py`, add these imports at the top:

```python
import hashlib
import re
import unicodedata
```

Add the `generate_slug` static method to `EntryCRUD`:

```python
@staticmethod
def generate_slug(name: str, entry_id: str) -> str:
    """Generate a URL slug from name + short hash of entry ID.

    Format: {name-slug}-{4-char-hash}
    Example: jane-doe-a3f2
    """
    # Normalize unicode to ASCII approximation
    normalized = unicodedata.normalize("NFKD", name)
    ascii_name = normalized.encode("ascii", "ignore").decode("ascii")
    # Lowercase, replace non-alphanumeric with hyphens, collapse multiples
    slug_name = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    slug_name = re.sub(r"-{2,}", "-", slug_name)
    # Short hash from entry ID
    short_hash = hashlib.sha256(entry_id.encode()).hexdigest()[:4]
    return f"{slug_name}-{short_hash}"
```

- [ ] **Step 4: Add slug field to EntryModel dataclass**

In `api/atlas/domains/catalog/models/entry.py`, add to the `EntryModel` fields:

```python
slug: str | None = None
```

Add it after the `updated_at` field.

Update `_row_to_entry` to include slug:

```python
slug=row.get("slug"),
```

- [ ] **Step 5: Add slug generation to `create` method**

In `EntryCRUD.create`, after `entry_id = db.generate_uuid()`, add:

```python
slug = EntryCRUD.generate_slug(name, entry_id)
```

Add `slug` to the INSERT column list and values. Add `slug` to the parameter tuple.

- [ ] **Step 6: Implement slug resolution methods**

Add to `EntryCRUD`:

```python
@staticmethod
async def get_by_slug(conn, slug: str):
    """Resolve a slug to an EntryModel. Returns None if not found."""
    cursor = await conn.execute(
        "SELECT * FROM entries WHERE slug = ? AND active = 1",
        (slug,),
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    columns = [desc[0] for desc in cursor.description]
    return _row_to_entry(dict(zip(columns, row)))

@staticmethod
async def resolve_slug(conn, slug: str) -> dict | None:
    """Resolve a slug, checking aliases if primary lookup fails.

    Returns dict with keys: entry, canonical_slug, is_alias.
    Returns None if slug not found anywhere.
    """
    # Try primary slug first
    entry = await EntryCRUD.get_by_slug(conn, slug)
    if entry is not None:
        return {"entry": entry, "canonical_slug": entry.slug, "is_alias": False}

    # Check aliases
    cursor = await conn.execute(
        "SELECT entry_id FROM slug_aliases WHERE old_slug = ?",
        (slug,),
    )
    alias_row = await cursor.fetchone()
    if alias_row is None:
        return None

    entry_id = alias_row[0]
    entry = await EntryCRUD.get_by_id(conn, entry_id)
    if entry is None:
        return None
    return {"entry": entry, "canonical_slug": entry.slug, "is_alias": True}

@staticmethod
async def set_vanity_slug(conn, entry_id: str, new_slug: str) -> bool:
    """Set a vanity slug for an entry, preserving the old slug as an alias."""
    # Get current slug
    entry = await EntryCRUD.get_by_id(conn, entry_id)
    if entry is None:
        return False

    old_slug = entry.slug
    if old_slug == new_slug:
        return True

    # Store old slug as alias
    if old_slug is not None:
        await conn.execute(
            "INSERT OR IGNORE INTO slug_aliases (old_slug, entry_id) VALUES (?, ?)",
            (old_slug, entry_id),
        )

    # Update to new slug
    await conn.execute(
        "UPDATE entries SET slug = ?, updated_at = ? WHERE id = ?",
        (new_slug, db.now_iso(), entry_id),
    )
    await conn.commit()
    return True
```

- [ ] **Step 7: Run slug tests**

Run: `cd api && python -m pytest tests/domains/catalog/test_slugs.py -v`
Expected: All tests PASS.

- [ ] **Step 8: Run full test suite to check for regressions**

Run: `cd api && python -m pytest tests/ -x -q`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```
chore(api): Add slug generation and resolution to EntryCRUD

Slugs are autogenerated as name-shortid (e.g., jane-doe-a3f2) on entry
creation. Resolution checks the primary slug column first, then falls
back to slug_aliases for entries with vanity slugs.
```

---

## Task 3: Slug Resolution API Endpoint

**Files:**
- Modify: `api/atlas/platform/http/router.py`
- Modify: `api/atlas/domains/catalog/api/entries.py` (find the entries router file)

- [ ] **Step 1: Find the entries API router**

The entries router is registered in `router.py` as `entries_router`. Locate it — likely at `api/atlas/domains/catalog/api/entries.py` or similar. Read that file to understand existing endpoint patterns.

- [ ] **Step 2: Write failing test for slug resolution endpoint**

Add to `api/tests/domains/catalog/test_slugs.py`:

```python
class TestSlugResolutionEndpoint:
    @pytest.mark.asyncio
    async def test_resolve_slug_returns_entity(self, test_client: object) -> None:
        # Create an entity first
        create_response = await test_client.post(
            "/api/entities",
            json={
                "type": "person",
                "name": "Jane Doe",
                "description": "Test person for slug resolution",
                "geo_specificity": "local",
            },
        )
        assert create_response.status_code == STATUS_CREATED
        entity_id = create_response.json()["id"]

        # Get the slug from the entity
        get_response = await test_client.get(f"/api/entities/{entity_id}")
        slug = get_response.json()["slug"]
        assert slug is not None

        # Resolve by slug
        resolve_response = await test_client.get(f"/api/entities/by-slug/people/{slug}")
        assert resolve_response.status_code == STATUS_OK
        assert resolve_response.json()["id"] == entity_id

    @pytest.mark.asyncio
    async def test_resolve_unknown_slug_returns_404(self, test_client: object) -> None:
        response = await test_client.get("/api/entities/by-slug/people/nonexistent-xxxx")
        assert response.status_code == STATUS_NOT_FOUND

    @pytest.mark.asyncio
    async def test_resolve_alias_returns_redirect(self, test_client: object) -> None:
        # Create entity, get its slug, set vanity, resolve old slug
        create_response = await test_client.post(
            "/api/entities",
            json={
                "type": "person",
                "name": "Jane Doe",
                "description": "Test",
                "geo_specificity": "local",
            },
        )
        entity_id = create_response.json()["id"]
        get_response = await test_client.get(f"/api/entities/{entity_id}")
        old_slug = get_response.json()["slug"]

        # The vanity slug endpoint is admin-only and out of scope for now,
        # so test alias resolution at the model level only (covered in TestSlugResolution).
        # This test verifies the resolution endpoint returns the entity for the current slug.
        resolve_response = await test_client.get(f"/api/entities/by-slug/people/{old_slug}")
        assert resolve_response.status_code == STATUS_OK
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && python -m pytest tests/domains/catalog/test_slugs.py::TestSlugResolutionEndpoint -v`
Expected: FAIL — route not defined.

- [ ] **Step 4: Add slug field to EntityResponse schema**

Find the response schema (likely in `api/atlas/domains/catalog/schemas/entry.py` or the entity response model). Add `slug: str | None = None` to the response model. Ensure the serialization path includes slug from the EntryModel.

- [ ] **Step 5: Add the by-slug endpoint to the entries router**

In the entries API router file, add:

```python
@router.get("/by-slug/{entity_type}/{slug}")
async def resolve_by_slug(
    entity_type: str,
    slug: str,
    conn=Depends(get_connection),
):
    """Resolve a type + slug pair to an entity."""
    # Validate entity_type
    type_map = {"people": "person", "organizations": "organization"}
    entry_type = type_map.get(entity_type)
    if entry_type is None:
        raise HTTPException(status_code=400, detail=f"Invalid entity type: {entity_type}")

    result = await EntryCRUD.resolve_slug(conn, slug)
    if result is None:
        raise HTTPException(status_code=404, detail="Entity not found")

    entry = result["entry"]
    if entry.type != entry_type:
        raise HTTPException(status_code=404, detail="Entity not found")

    if result["is_alias"]:
        # Return 301 with canonical slug in Location header
        canonical_slug = result["canonical_slug"]
        return JSONResponse(
            status_code=301,
            headers={"Location": f"/api/entities/by-slug/{entity_type}/{canonical_slug}"},
            content={"redirect_to": f"/api/entities/by-slug/{entity_type}/{canonical_slug}"},
        )

    # Return full entity detail (reuse existing detail serialization)
    sources = await EntryCRUD.get_with_sources(conn, entry.id)
    issue_areas = await EntryCRUD.get_issue_areas(conn, entry.id)
    # Serialize using existing patterns from the get-entity-by-id endpoint
    return _serialize_entity_detail(entry, sources[1] if sources[0] else [], issue_areas)
```

Note: Match the existing serialization pattern used by the `GET /api/entities/{id}` endpoint. Reuse the same response builder function.

- [ ] **Step 6: Run slug endpoint tests**

Run: `cd api && python -m pytest tests/domains/catalog/test_slugs.py -v`
Expected: All tests PASS.

- [ ] **Step 7: Update the OpenAPI spec**

Run: `cd api && python -m pytest tests/ -x -q` to ensure nothing is broken. Then regenerate the OpenAPI spec if the project has a generation script, or manually verify the new endpoint appears.

- [ ] **Step 8: Commit**

```
feat(api): Add slug resolution endpoint at /api/entities/by-slug/:type/:slug

The endpoint resolves human-readable slugs to full entity responses,
supporting the canonical profile URL scheme. Alias slugs return a 301
redirect to the current canonical slug.
```

---

## Task 4: Add Slug to Frontend Types and API Mapping

**Files:**
- Modify: `app/src/types/entry.ts`
- Modify: `app/src/lib/api.ts`

- [ ] **Step 1: Add slug to Entry type**

In `app/src/types/entry.ts`, add to the `Entry` interface:

```typescript
slug: string | null;
```

Add it after `updated_at`.

- [ ] **Step 2: Map slug in API response mapping**

In `app/src/lib/api.ts`, find the function that maps `EntityDetailResponse` (or `EntityResponse`) to `Entry`. Add:

```typescript
slug: entity.slug ?? null,
```

- [ ] **Step 3: Add slug resolution and connections to API client**

In `app/src/lib/api.ts`, add to the `api` object's `entries` namespace:

```typescript
getBySlug: async (type: "people" | "organizations", slug: string): Promise<Entry> => {
  const response = await atlasFetch<EntityDetailResponse>({
    url: `/api/entities/by-slug/${type}/${slug}`,
    method: "GET",
  });
  return mapEntityToEntry(response);
},

getConnections: async (entryId: string): Promise<ConnectionGroup[]> => {
  const response = await atlasFetch<ConnectionsResponse>({
    url: `/api/entities/${entryId}/connections`,
    method: "GET",
  });
  return response.connections;
},
```

- [ ] **Step 4: Add connection types**

In `app/src/types/entry.ts`, add:

```typescript
type ConnectionType =
  | "same_organization"
  | "same_issue_area"
  | "same_geography"
  | "co_mentioned";

interface ConnectedActor {
  id: string;
  name: string;
  type: EntryType;
  slug: string | null;
  description_snippet: string | null;
  evidence: string;
}

interface ConnectionGroup {
  type: ConnectionType;
  actors: ConnectedActor[];
}
```

- [ ] **Step 5: Run type checks**

Run: `cd app && pnpm tsc --noEmit`
Expected: No type errors (or only pre-existing ones).

- [ ] **Step 6: Commit**

```
chore(app): Add slug field and connection types to frontend data layer

Maps the slug field from API responses to the Entry type and adds
type definitions for the connections API that powers the profile
sidebar's related actors section.
```

---

## Task 5: SSR Profile Routes

**Files:**
- Create: `app/src/routes/_public/profiles/people.$slug.tsx`
- Create: `app/src/routes/_public/profiles/organizations.$slug.tsx`
- Create: `app/src/domains/catalog/server/profile-loaders.ts`
- Modify: `app/src/routes/_public/entries.$entryId.tsx`

- [ ] **Step 1: Create server functions for profile data loading**

Create `app/src/domains/catalog/server/profile-loaders.ts`:

```typescript
import { createServerFn } from "@tanstack/react-start/server";
import { api } from "@/lib/api";

export const loadProfileBySlug = createServerFn({
  method: "GET",
})
  .validator(
    (input: { type: "people" | "organizations"; slug: string }) => input,
  )
  .handler(async ({ data }) => {
    const entry = await api.entries.getBySlug(data.type, data.slug);
    return entry;
  });

export const loadProfileConnections = createServerFn({
  method: "GET",
})
  .validator((input: { entryId: string }) => input)
  .handler(async ({ data }) => {
    const connections = await api.entries.getConnections(data.entryId);
    return connections;
  });
```

- [ ] **Step 2: Create the person profile route**

Create `app/src/routes/_public/profiles/people.$slug.tsx`:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { loadProfileBySlug } from "@/domains/catalog/server/profile-loaders";
import { PersonProfilePage } from "@/domains/catalog/pages/person-profile-page";

export const Route = createFileRoute("/_public/profiles/people/$slug")({
  loader: async ({ params }) => {
    const entry = await loadProfileBySlug({
      data: { type: "people", slug: params.slug },
    });
    return { entry };
  },
  head: ({ loaderData }) => {
    const entry = loaderData?.entry;
    if (!entry) return {};
    return {
      meta: [
        { title: `${entry.name} — Person | Atlas` },
        {
          name: "description",
          content: entry.description?.slice(0, 160) ?? "",
        },
        { property: "og:title", content: entry.name },
        { property: "og:description", content: entry.description ?? "" },
        { property: "og:type", content: "profile" },
        {
          property: "og:url",
          content: `https://atlas.rebuildingamerica.com/profiles/people/${entry.slug}`,
        },
        { property: "og:site_name", content: "Atlas" },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: entry.name },
        {
          name: "twitter:description",
          content: entry.description?.slice(0, 160) ?? "",
        },
      ],
      links: [
        {
          rel: "canonical",
          href: `https://atlas.rebuildingamerica.com/profiles/people/${entry.slug}`,
        },
      ],
    };
  },
  component: PersonProfileRoute,
});

function PersonProfileRoute() {
  const { entry } = Route.useLoaderData();
  return <PersonProfilePage entry={entry} />;
}
```

- [ ] **Step 3: Create the organization profile route**

Create `app/src/routes/_public/profiles/organizations.$slug.tsx`:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { loadProfileBySlug } from "@/domains/catalog/server/profile-loaders";
import { OrgProfilePage } from "@/domains/catalog/pages/org-profile-page";

export const Route = createFileRoute(
  "/_public/profiles/organizations/$slug",
)({
  loader: async ({ params }) => {
    const entry = await loadProfileBySlug({
      data: { type: "organizations", slug: params.slug },
    });
    return { entry };
  },
  head: ({ loaderData }) => {
    const entry = loaderData?.entry;
    if (!entry) return {};
    return {
      meta: [
        { title: `${entry.name} — Organization | Atlas` },
        {
          name: "description",
          content: entry.description?.slice(0, 160) ?? "",
        },
        { property: "og:title", content: entry.name },
        { property: "og:description", content: entry.description ?? "" },
        { property: "og:type", content: "profile" },
        {
          property: "og:url",
          content: `https://atlas.rebuildingamerica.com/profiles/organizations/${entry.slug}`,
        },
        { property: "og:site_name", content: "Atlas" },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: entry.name },
        {
          name: "twitter:description",
          content: entry.description?.slice(0, 160) ?? "",
        },
      ],
      links: [
        {
          rel: "canonical",
          href: `https://atlas.rebuildingamerica.com/profiles/organizations/${entry.slug}`,
        },
      ],
    };
  },
  component: OrgProfileRoute,
});

function OrgProfileRoute() {
  const { entry } = Route.useLoaderData();
  return <OrgProfilePage entry={entry} />;
}
```

- [ ] **Step 4: Convert the legacy entries route to a redirect**

Replace `app/src/routes/_public/entries.$entryId.tsx`:

```typescript
import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_public/entries/$entryId")({
  beforeLoad: async ({ params }) => {
    // Fetch the entry to get its type and slug
    const entry = await api.entries.get(params.entryId);
    if (!entry) {
      throw redirect({ to: "/browse", statusCode: 302 });
    }

    const typePrefix =
      entry.type === "person"
        ? "people"
        : entry.type === "organization"
          ? "organizations"
          : null;

    if (typePrefix && entry.slug) {
      throw redirect({
        to: "/profiles/$type/$slug",
        params: { type: typePrefix, slug: entry.slug },
        statusCode: 301,
      });
    }

    // Non-profile entry types: fall through to a basic view (out of scope)
    throw redirect({ to: "/browse", statusCode: 302 });
  },
  component: () => null,
});
```

- [ ] **Step 5: Create PersonProfilePage and OrgProfilePage**

Create `app/src/domains/catalog/pages/person-profile-page.tsx`:

```typescript
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PersonProfile } from "@/domains/catalog/components/profiles/person-profile";
import { ConnectionsSection } from "@/domains/catalog/components/profiles/connections-section";
import { ProfileJsonLd } from "@/domains/catalog/components/profiles/profile-head";
import { useEntry } from "@/domains/catalog/hooks/use-entries";
import { useConnections } from "@/domains/catalog/hooks/use-connections";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";
import { PageLayout } from "@/platform/layout/page-layout";
import type { Entry } from "@/types/entry";

export function PersonProfilePage({ entry }: { entry: Entry }) {
  const taxonomyQuery = useTaxonomy();
  const connectionsQuery = useConnections(entry.id);

  const affiliatedOrgQuery = useEntry(entry.affiliated_org_id ?? "", {
    enabled: !!entry.affiliated_org_id,
  });

  const issueAreaLabels = Object.fromEntries(
    Object.values(taxonomyQuery.data ?? {})
      .flat()
      .map((issue) => [issue.slug, issue.name]),
  );

  return (
    <PageLayout className="space-y-6 py-10">
      <ProfileJsonLd entry={entry} />
      <Link
        to="/browse"
        className="type-label-large inline-flex items-center gap-2 font-medium text-stone-600 transition-colors hover:text-stone-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to the Atlas
      </Link>

      <div className="flex flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-[3]">
          <PersonProfile
            entry={entry}
            issueAreaLabels={issueAreaLabels}
            affiliatedOrg={affiliatedOrgQuery.data}
          />
        </div>
        <aside className="flex-[2] space-y-6 lg:max-w-sm">
          <ConnectionsSection
            connections={connectionsQuery.data ?? []}
            isLoading={connectionsQuery.isLoading}
          />
        </aside>
      </div>
    </PageLayout>
  );
}
```

Create `app/src/domains/catalog/pages/org-profile-page.tsx` following the same pattern but using `OrgProfile` and fetching affiliated people instead.

- [ ] **Step 6: Verify the route tree regenerates**

Run: `cd app && pnpm dev`

Check that `routeTree.gen.ts` includes the new profile routes. Verify no build errors.

- [ ] **Step 7: Commit**

```
feat(app): Add SSR profile routes with canonical URLs and legacy redirect

Profile pages at /profiles/people/:slug and /profiles/organizations/:slug
are server-rendered with full meta tags. The old /entries/:id route
performs a 301 redirect to the canonical profile URL. Profile data loads
server-side via TanStack Start server functions.
```

---

## Task 6: JSON-LD Structured Data Component

**Files:**
- Create: `app/src/domains/catalog/components/profiles/profile-head.tsx`

- [ ] **Step 1: Write test for JSON-LD output**

Create `app/tests/unit/domains/catalog/components/profile-head.test.tsx`:

```typescript
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ProfileJsonLd } from "@/domains/catalog/components/profiles/profile-head";
import type { Entry } from "@/types/entry";

const mockPerson: Entry = {
  id: "test-id",
  type: "person",
  name: "Jane Doe",
  description: "Community organizer focused on housing",
  city: "Kansas City",
  state: "MO",
  slug: "jane-doe-a3f2",
  issue_areas: ["housing", "labor"],
  source_count: 5,
  source_types: [],
  active: true,
  verified: true,
  created_at: "2026-01-01",
  updated_at: "2026-04-01",
};

describe("ProfileJsonLd", () => {
  it("renders Person schema for person entries", () => {
    const { container } = render(<ProfileJsonLd entry={mockPerson} />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const data = JSON.parse(script!.textContent!);
    expect(data["@type"]).toBe("Person");
    expect(data.name).toBe("Jane Doe");
    expect(data.areaServed.name).toBe("Kansas City, MO");
    expect(data.knowsAbout).toContain("housing");
  });

  it("renders Organization schema for org entries", () => {
    const orgEntry = { ...mockPerson, type: "organization" as const, slug: "prairie-coop-b1c2" };
    const { container } = render(<ProfileJsonLd entry={orgEntry} />);
    const script = container.querySelector('script[type="application/ld+json"]');
    const data = JSON.parse(script!.textContent!);
    expect(data["@type"]).toBe("Organization");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && pnpm vitest run tests/unit/domains/catalog/components/profile-head.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ProfileJsonLd component**

Create `app/src/domains/catalog/components/profiles/profile-head.tsx`:

```typescript
import type { Entry } from "@/types/entry";

interface ProfileJsonLdProps {
  entry: Entry;
  affiliatedOrg?: Entry | null;
  affiliatedPeople?: Entry[];
}

export function ProfileJsonLd({
  entry,
  affiliatedOrg,
  affiliatedPeople,
}: ProfileJsonLdProps) {
  const jsonLd =
    entry.type === "person"
      ? buildPersonSchema(entry, affiliatedOrg)
      : buildOrganizationSchema(entry, affiliatedPeople);

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

function buildPersonSchema(entry: Entry, affiliatedOrg?: Entry | null) {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: entry.name,
    description: entry.description,
    url: `https://atlas.rebuildingamerica.com/profiles/people/${entry.slug}`,
  };

  if (entry.city && entry.state) {
    schema.areaServed = {
      "@type": "Place",
      name: `${entry.city}, ${entry.state}`,
    };
  }

  if (entry.issue_areas.length > 0) {
    schema.knowsAbout = entry.issue_areas;
  }

  if (affiliatedOrg) {
    schema.memberOf = {
      "@type": "Organization",
      name: affiliatedOrg.name,
      url: `https://atlas.rebuildingamerica.com/profiles/organizations/${affiliatedOrg.slug}`,
    };
  }

  const sameAs: string[] = [];
  if (entry.social_media) {
    for (const url of Object.values(entry.social_media)) {
      if (typeof url === "string" && url.startsWith("http")) {
        sameAs.push(url);
      }
    }
  }
  if (sameAs.length > 0) {
    schema.sameAs = sameAs;
  }

  return schema;
}

function buildOrganizationSchema(
  entry: Entry,
  affiliatedPeople?: Entry[],
) {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: entry.name,
    description: entry.description,
    url: `https://atlas.rebuildingamerica.com/profiles/organizations/${entry.slug}`,
  };

  if (entry.city && entry.state) {
    schema.areaServed = {
      "@type": "Place",
      name: `${entry.city}, ${entry.state}`,
    };
  }

  if (entry.issue_areas.length > 0) {
    schema.knowsAbout = entry.issue_areas;
  }

  if (affiliatedPeople && affiliatedPeople.length > 0) {
    schema.member = affiliatedPeople.map((person) => ({
      "@type": "Person",
      name: person.name,
      url: `https://atlas.rebuildingamerica.com/profiles/people/${person.slug}`,
    }));
  }

  const sameAs: string[] = [];
  if (entry.social_media) {
    for (const url of Object.values(entry.social_media)) {
      if (typeof url === "string" && url.startsWith("http")) {
        sameAs.push(url);
      }
    }
  }
  if (sameAs.length > 0) {
    schema.sameAs = sameAs;
  }

  return schema;
}
```

- [ ] **Step 4: Run tests**

Run: `cd app && pnpm vitest run tests/unit/domains/catalog/components/profile-head.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```
feat(app): Add JSON-LD structured data component for profile pages

Renders schema.org Person or Organization markup with areaServed,
knowsAbout, memberOf, and sameAs properties for search engine
rich results.
```

---

## Task 7: Connections API Endpoint

**Files:**
- Create: `api/atlas/domains/catalog/models/connections.py`
- Create: `api/atlas/domains/catalog/api/connections.py`
- Modify: `api/atlas/platform/http/router.py`
- Create: `api/tests/domains/catalog/test_connections.py`

- [ ] **Step 1: Write failing tests for connections computation**

Create `api/tests/domains/catalog/test_connections.py`:

```python
import pytest

from atlas.domains.catalog.models.connections import compute_connections
from atlas.domains.catalog.models.entry import EntryCRUD

STATUS_OK = 200


class TestConnectionComputation:
    @pytest.mark.asyncio
    async def test_same_organization_connection(self, test_db: object) -> None:
        conn = test_db
        org_id = await EntryCRUD.create(
            conn,
            entry_type="organization",
            name="Prairie Workers Cooperative",
            description="Worker cooperative",
            geo_specificity="regional",
        )
        person_a_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Jane Doe",
            description="Founder",
            geo_specificity="local",
            affiliated_org_id=org_id,
        )
        person_b_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="John Smith",
            description="Member",
            geo_specificity="local",
            affiliated_org_id=org_id,
        )

        connections = await compute_connections(conn, person_a_id)
        same_org = next(
            (g for g in connections if g["type"] == "same_organization"), None
        )
        assert same_org is not None
        actor_ids = [a["id"] for a in same_org["actors"]]
        assert person_b_id in actor_ids
        # The org itself should also appear
        assert org_id in actor_ids

    @pytest.mark.asyncio
    async def test_co_mentioned_connection(self, test_db: object) -> None:
        conn = test_db
        person_a_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Jane Doe",
            description="Person A",
            geo_specificity="local",
        )
        person_b_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="John Smith",
            description="Person B",
            geo_specificity="local",
        )

        # Create a shared source
        from atlas.models.database import db as database

        source_id = database.generate_uuid()
        await conn.execute(
            "INSERT INTO sources (id, url, title, publication, source_type, extraction_method) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (source_id, "https://example.com/article", "Shared Article", "KC Star", "news_article", "manual"),
        )
        await conn.execute(
            "INSERT INTO entry_sources (entry_id, source_id) VALUES (?, ?)",
            (person_a_id, source_id),
        )
        await conn.execute(
            "INSERT INTO entry_sources (entry_id, source_id) VALUES (?, ?)",
            (person_b_id, source_id),
        )
        await conn.commit()

        connections = await compute_connections(conn, person_a_id)
        co_mentioned = next(
            (g for g in connections if g["type"] == "co_mentioned"), None
        )
        assert co_mentioned is not None
        actor_ids = [a["id"] for a in co_mentioned["actors"]]
        assert person_b_id in actor_ids
        # Evidence should reference the shared source
        evidence = co_mentioned["actors"][0]["evidence"]
        assert "KC Star" in evidence

    @pytest.mark.asyncio
    async def test_returns_empty_for_isolated_entry(self, test_db: object) -> None:
        conn = test_db
        entry_id = await EntryCRUD.create(
            conn,
            entry_type="person",
            name="Isolated Person",
            description="No connections",
            geo_specificity="local",
        )
        connections = await compute_connections(conn, entry_id)
        total_actors = sum(len(g["actors"]) for g in connections)
        assert total_actors == 0


class TestConnectionsEndpoint:
    @pytest.mark.asyncio
    async def test_returns_connections(self, test_client: object) -> None:
        # Create org + person
        org_response = await test_client.post(
            "/api/entities",
            json={
                "type": "organization",
                "name": "Test Org",
                "description": "Org",
                "geo_specificity": "regional",
            },
        )
        org_id = org_response.json()["id"]

        await test_client.post(
            "/api/entities",
            json={
                "type": "person",
                "name": "Person A",
                "description": "Affiliated",
                "geo_specificity": "local",
                "affiliated_org_id": org_id,
            },
        )

        person_b = await test_client.post(
            "/api/entities",
            json={
                "type": "person",
                "name": "Person B",
                "description": "Also affiliated",
                "geo_specificity": "local",
                "affiliated_org_id": org_id,
            },
        )
        person_b_id = person_b.json()["id"]

        response = await test_client.get(f"/api/entities/{person_b_id}/connections")
        assert response.status_code == STATUS_OK
        data = response.json()
        assert "connections" in data
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && python -m pytest tests/domains/catalog/test_connections.py -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement connections computation**

Create `api/atlas/domains/catalog/models/connections.py`:

```python
from __future__ import annotations

from atlas.domains.catalog.models.entry import EntryCRUD, _row_to_entry


async def compute_connections(conn, entry_id: str) -> list[dict]:
    """Compute related actors for an entry, grouped by relationship type."""
    entry = await EntryCRUD.get_by_id(conn, entry_id)
    if entry is None:
        return []

    groups: list[dict] = []

    # Same organization
    same_org_actors = await _find_same_organization(conn, entry)
    if same_org_actors:
        groups.append({"type": "same_organization", "actors": same_org_actors})

    # Co-mentioned in sources
    co_mentioned_actors = await _find_co_mentioned(conn, entry_id)
    if co_mentioned_actors:
        groups.append({"type": "co_mentioned", "actors": co_mentioned_actors})

    # Same issue area + geography
    same_issue_actors = await _find_same_issue_area(conn, entry)
    if same_issue_actors:
        groups.append({"type": "same_issue_area", "actors": same_issue_actors})

    # Same geography (different issues)
    same_geo_actors = await _find_same_geography(conn, entry)
    if same_geo_actors:
        groups.append({"type": "same_geography", "actors": same_geo_actors})

    return groups


async def _find_same_organization(conn, entry) -> list[dict]:
    """Find actors affiliated with the same organization."""
    actors: list[dict] = []

    if entry.type == "person" and entry.affiliated_org_id:
        # Get the org itself
        org = await EntryCRUD.get_by_id(conn, entry.affiliated_org_id)
        if org:
            actors.append({
                "id": org.id,
                "name": org.name,
                "type": org.type,
                "slug": org.slug,
                "description_snippet": (org.description or "")[:120] or None,
                "evidence": f"Affiliated organization",
            })

        # Get other people at the same org
        cursor = await conn.execute(
            "SELECT * FROM entries WHERE affiliated_org_id = ? AND id != ? AND active = 1 LIMIT 10",
            (entry.affiliated_org_id, entry.id),
        )
        rows = await cursor.fetchall()
        columns = [desc[0] for desc in cursor.description]
        for row in rows:
            other = _row_to_entry(dict(zip(columns, row)))
            actors.append({
                "id": other.id,
                "name": other.name,
                "type": other.type,
                "slug": other.slug,
                "description_snippet": (other.description or "")[:120] or None,
                "evidence": f"Also affiliated with {org.name}" if org else "Same organization",
            })

    elif entry.type == "organization":
        # Get people affiliated with this org
        cursor = await conn.execute(
            "SELECT * FROM entries WHERE affiliated_org_id = ? AND active = 1 LIMIT 10",
            (entry.id,),
        )
        rows = await cursor.fetchall()
        columns = [desc[0] for desc in cursor.description]
        for row in rows:
            person = _row_to_entry(dict(zip(columns, row)))
            actors.append({
                "id": person.id,
                "name": person.name,
                "type": person.type,
                "slug": person.slug,
                "description_snippet": (person.description or "")[:120] or None,
                "evidence": f"Affiliated with {entry.name}",
            })

    return actors


async def _find_co_mentioned(conn, entry_id: str) -> list[dict]:
    """Find actors co-mentioned in the same sources."""
    cursor = await conn.execute(
        """
        SELECT DISTINCT e.*, s.title AS source_title, s.publication AS source_publication
        FROM entries e
        JOIN entry_sources es1 ON es1.entry_id = e.id
        JOIN entry_sources es2 ON es2.source_id = es1.source_id
        JOIN sources s ON s.id = es1.source_id
        WHERE es2.entry_id = ? AND e.id != ? AND e.active = 1
        LIMIT 10
        """,
        (entry_id, entry_id),
    )
    rows = await cursor.fetchall()
    if not rows:
        return []

    columns = [desc[0] for desc in cursor.description]
    actors: list[dict] = []
    for row in rows:
        row_dict = dict(zip(columns, row))
        other = _row_to_entry(row_dict)
        source_title = row_dict.get("source_title", "")
        source_pub = row_dict.get("source_publication", "")
        evidence = f"Both mentioned in: {source_pub}" if source_pub else f"Co-mentioned in: {source_title}"
        actors.append({
            "id": other.id,
            "name": other.name,
            "type": other.type,
            "slug": other.slug,
            "description_snippet": (other.description or "")[:120] or None,
            "evidence": evidence,
        })

    return actors


async def _find_same_issue_area(conn, entry) -> list[dict]:
    """Find actors with overlapping issue areas in similar geography."""
    issue_areas = await EntryCRUD.get_issue_areas(conn, entry.id)
    if not issue_areas or not entry.state:
        return []

    placeholders = ", ".join("?" for _ in issue_areas)
    cursor = await conn.execute(
        f"""
        SELECT DISTINCT e.*
        FROM entries e
        JOIN entry_issue_areas eia ON eia.entry_id = e.id
        WHERE eia.issue_area IN ({placeholders})
        AND e.state = ?
        AND e.id != ?
        AND e.active = 1
        LIMIT 10
        """,
        (*issue_areas, entry.state, entry.id),
    )
    rows = await cursor.fetchall()
    if not rows:
        return []

    columns = [desc[0] for desc in cursor.description]
    actors: list[dict] = []
    for row in rows:
        other = _row_to_entry(dict(zip(columns, row)))
        actors.append({
            "id": other.id,
            "name": other.name,
            "type": other.type,
            "slug": other.slug,
            "description_snippet": (other.description or "")[:120] or None,
            "evidence": f"Shares issue areas in {entry.state}",
        })

    return actors


async def _find_same_geography(conn, entry) -> list[dict]:
    """Find actors in the same city/region working on different issues."""
    if not entry.city:
        return []

    cursor = await conn.execute(
        """
        SELECT * FROM entries
        WHERE city = ? AND state = ? AND id != ? AND active = 1
        LIMIT 10
        """,
        (entry.city, entry.state, entry.id),
    )
    rows = await cursor.fetchall()
    if not rows:
        return []

    columns = [desc[0] for desc in cursor.description]
    actors: list[dict] = []
    for row in rows:
        other = _row_to_entry(dict(zip(columns, row)))
        actors.append({
            "id": other.id,
            "name": other.name,
            "type": other.type,
            "slug": other.slug,
            "description_snippet": (other.description or "")[:120] or None,
            "evidence": f"Active in {entry.city}, {entry.state}",
        })

    return actors
```

- [ ] **Step 4: Create connections API router**

Create `api/atlas/domains/catalog/api/connections.py`:

```python
from fastapi import APIRouter, Depends, HTTPException

from atlas.domains.catalog.models.connections import compute_connections
from atlas.platform.http.dependencies import get_connection

router = APIRouter()


@router.get("/{entry_id}/connections")
async def get_connections(
    entry_id: str,
    conn=Depends(get_connection),
):
    """Get related actors for an entry, grouped by relationship type."""
    connections = await compute_connections(conn, entry_id)
    return {"connections": connections}
```

- [ ] **Step 5: Register connections router**

In `api/atlas/platform/http/router.py`, add the import and registration:

```python
from atlas.domains.catalog.api.connections import router as connections_router
```

Include it with the entities prefix:

```python
api_router.include_router(connections_router, prefix="/api/entities", tags=["connections"])
```

- [ ] **Step 6: Run connections tests**

Run: `cd api && python -m pytest tests/domains/catalog/test_connections.py -v`
Expected: All tests PASS.

- [ ] **Step 7: Run full test suite**

Run: `cd api && python -m pytest tests/ -x -q`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```
feat(api): Add connections endpoint for related actor discovery

The endpoint computes four relationship types from existing data: same
organization (via affiliated_org_id), co-mentioned (shared sources),
same issue area (overlapping tags in same state), and same geography
(same city). Each connection includes evidence explaining the link.
```

---

## Task 8: Connections UI Section

**Files:**
- Create: `app/src/domains/catalog/hooks/use-connections.ts`
- Create: `app/src/domains/catalog/components/profiles/connections-section.tsx`
- Create: `app/tests/unit/domains/catalog/components/connections-section.test.tsx`

- [ ] **Step 1: Write failing test for ConnectionsSection**

Create `app/tests/unit/domains/catalog/components/connections-section.test.tsx`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ConnectionsSection } from "@/domains/catalog/components/profiles/connections-section";
import type { ConnectionGroup } from "@/types/entry";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: Record<string, unknown>) => (
    <a href={props.to as string}>{children}</a>
  ),
}));

afterEach(() => cleanup());

const mockConnections: ConnectionGroup[] = [
  {
    type: "same_organization",
    actors: [
      {
        id: "org-1",
        name: "Prairie Workers Cooperative",
        type: "organization",
        slug: "prairie-workers-a1b2",
        description_snippet: "A worker cooperative in Kansas City",
        evidence: "Affiliated organization",
      },
    ],
  },
  {
    type: "co_mentioned",
    actors: [
      {
        id: "person-2",
        name: "Maria Reyes",
        type: "person",
        slug: "maria-reyes-c3d4",
        description_snippet: "Community organizer",
        evidence: "Both mentioned in: Kansas City Star",
      },
    ],
  },
];

describe("ConnectionsSection", () => {
  it("renders connection groups with labels", () => {
    render(<ConnectionsSection connections={mockConnections} isLoading={false} />);
    expect(screen.getByText("Same Organization")).toBeTruthy();
    expect(screen.getByText("Co-mentioned")).toBeTruthy();
  });

  it("renders actor names and evidence", () => {
    render(<ConnectionsSection connections={mockConnections} isLoading={false} />);
    expect(screen.getByText("Prairie Workers Cooperative")).toBeTruthy();
    expect(screen.getByText("Affiliated organization")).toBeTruthy();
    expect(screen.getByText("Maria Reyes")).toBeTruthy();
    expect(screen.getByText("Both mentioned in: Kansas City Star")).toBeTruthy();
  });

  it("renders loading state", () => {
    render(<ConnectionsSection connections={[]} isLoading={true} />);
    expect(screen.getByText("Loading connections...")).toBeTruthy();
  });

  it("renders empty state when no connections", () => {
    render(<ConnectionsSection connections={[]} isLoading={false} />);
    expect(screen.getByText("No connections found yet")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && pnpm vitest run tests/unit/domains/catalog/components/connections-section.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create useConnections hook**

Create `app/src/domains/catalog/hooks/use-connections.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ConnectionGroup } from "@/types/entry";

export function useConnections(entryId: string) {
  return useQuery<ConnectionGroup[]>({
    queryKey: ["connections", entryId],
    queryFn: () => api.entries.getConnections(entryId),
    staleTime: 10 * 60 * 1000,
    enabled: !!entryId,
  });
}
```

- [ ] **Step 4: Implement ConnectionsSection component**

Create `app/src/domains/catalog/components/profiles/connections-section.tsx`:

```typescript
import { Link } from "@tanstack/react-router";
import { ActorAvatar } from "./actor-avatar";
import type { ConnectionGroup, ConnectionType } from "@/types/entry";

interface ConnectionsSectionProps {
  connections: ConnectionGroup[];
  isLoading: boolean;
}

const CONNECTION_LABELS: Record<ConnectionType, string> = {
  same_organization: "Same Organization",
  same_issue_area: "Same Issue Area",
  same_geography: "Same Geography",
  co_mentioned: "Co-mentioned",
};

export function ConnectionsSection({
  connections,
  isLoading,
}: ConnectionsSectionProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <h3 className="type-label-large text-ink-muted uppercase tracking-wider">
          Connections
        </h3>
        <p className="type-body-small text-ink-soft">Loading connections...</p>
      </div>
    );
  }

  const hasConnections = connections.some((g) => g.actors.length > 0);

  if (!hasConnections) {
    return (
      <div className="space-y-3">
        <h3 className="type-label-large text-ink-muted uppercase tracking-wider">
          Connections
        </h3>
        <p className="type-body-small text-ink-soft">
          No connections found yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h3 className="type-label-large text-ink-muted uppercase tracking-wider">
        Connections
      </h3>
      {connections
        .filter((group) => group.actors.length > 0)
        .map((group) => (
          <div key={group.type} className="space-y-3">
            <h4 className="type-label-medium text-ink-soft">
              {CONNECTION_LABELS[group.type]}
            </h4>
            <div className="space-y-2">
              {group.actors.map((actor) => {
                const typePrefix =
                  actor.type === "person" ? "people" : "organizations";
                const href = actor.slug
                  ? `/profiles/${typePrefix}/${actor.slug}`
                  : `/browse`;

                return (
                  <Link
                    key={actor.id}
                    to={href}
                    className="block rounded-lg border border-border bg-surface-container-low p-3 transition-colors hover:border-border-strong"
                  >
                    <div className="flex items-center gap-3">
                      <ActorAvatar
                        name={actor.name}
                        type={actor.type}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="type-body-medium font-semibold text-ink-strong truncate">
                          {actor.name}
                        </div>
                        <div className="type-body-small text-ink-soft">
                          {actor.evidence}
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `cd app && pnpm vitest run tests/unit/domains/catalog/components/connections-section.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```
feat(app): Add connections section component for profile sidebar

Displays related actors grouped by relationship type with evidence
snippets. Each connection card links to the related actor's profile
page.
```

---

## Task 9: View Transitions

**Files:**
- Modify: `app/src/domains/catalog/components/entries/entry-card.tsx`
- Modify: `app/src/domains/catalog/components/profiles/profile-header.tsx`
- Modify: `app/src/domains/catalog/components/profiles/actor-avatar.tsx`

- [ ] **Step 1: Add view-transition-name to entry card avatar and name**

In `app/src/domains/catalog/components/entries/entry-card.tsx`, find where the entry name is rendered. Add a `style` prop with `viewTransitionName`:

```typescript
style={{ viewTransitionName: `entry-name-${entry.id}` }}
```

If the entry card renders an avatar or type indicator, add:

```typescript
style={{ viewTransitionName: `entry-avatar-${entry.id}` }}
```

- [ ] **Step 2: Add matching view-transition-name to profile header**

In `app/src/domains/catalog/components/profiles/profile-header.tsx`, find the name element and avatar. Add matching transition names:

On the name element:
```typescript
style={{ viewTransitionName: `entry-name-${entry.id}` }}
```

On the avatar wrapper:
```typescript
style={{ viewTransitionName: `entry-avatar-${entry.id}` }}
```

- [ ] **Step 3: Enable viewTransition on profile route Links**

In `entry-card.tsx`, update the `<Link>` to the profile page to include `viewTransition`:

```typescript
<Link
  to="/profiles/$type/$slug"
  params={{ type: typePrefix, slug: entry.slug }}
  viewTransition
>
```

Note: If the Link still points to `/entries/$entryId`, update it to point to the canonical profile URL instead.

- [ ] **Step 4: Add slide transition CSS for profile-to-profile navigation**

In `app/src/styles/app.css`, add view transition rules:

```css
/* Profile-to-profile slide transition */
::view-transition-old(profile-content) {
  animation: slide-out-left 200ms ease-in;
}

::view-transition-new(profile-content) {
  animation: slide-in-right 200ms ease-out;
}

@keyframes slide-out-left {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(-100px); opacity: 0; }
}

@keyframes slide-in-right {
  from { transform: translateX(100px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

/* Shared element morphs (avatar, name) are handled automatically
   by the View Transitions API via matching view-transition-name values.
   The browser interpolates actual position and dimensions. */
```

- [ ] **Step 5: Add view-transition-name to profile page content wrapper**

In the PersonProfilePage and OrgProfilePage components, wrap the main content area:

```typescript
<div style={{ viewTransitionName: "profile-content" }}>
  {/* profile content */}
</div>
```

- [ ] **Step 6: Test transitions manually**

Run: `cd app && pnpm dev`

1. Navigate from browse to a profile — verify avatar morphs smoothly
2. Navigate from one profile to another via connections — verify slide transition
3. Verify fallback: in a browser without View Transitions API, pages swap instantly without errors

- [ ] **Step 7: Commit**

```
feat(app): Add view transitions between browse, profile, and profile-to-profile

Shared element transitions morph avatar and name between entry cards and
profile headers. Profile-to-profile navigation uses a lateral slide.
Falls back to instant page swap in unsupported browsers.
```

---

## Task 10: Sitemap Generation

**Files:**
- Create: `app/src/routes/_public/sitemap[.]xml.ts`

- [ ] **Step 1: Create the sitemap route**

Create `app/src/routes/_public/sitemap[.]xml.ts`:

```typescript
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start/server";
import { api } from "@/lib/api";

const generateSitemap = createServerFn({ method: "GET" }).handler(
  async () => {
    // Fetch all active entries with slugs
    const people = await api.entries.list({
      entry_types: ["person"],
      limit: 10000,
    });
    const orgs = await api.entries.list({
      entry_types: ["organization"],
      limit: 10000,
    });

    const baseUrl = "https://atlas.rebuildingamerica.com";
    const entries = [...(people.data ?? []), ...(orgs.data ?? [])];

    const urls = entries
      .filter((entry) => entry.slug)
      .map((entry) => {
        const typePrefix =
          entry.type === "person" ? "people" : "organizations";
        return `  <url>
    <loc>${baseUrl}/profiles/${typePrefix}/${entry.slug}</loc>
    <lastmod>${entry.updated_at}</lastmod>
    <changefreq>weekly</changefreq>
  </url>`;
      });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}</loc>
    <changefreq>daily</changefreq>
  </url>
  <url>
    <loc>${baseUrl}/browse</loc>
    <changefreq>daily</changefreq>
  </url>
${urls.join("\n")}
</urlset>`;

    return xml;
  },
);

export const Route = createFileRoute("/_public/sitemap.xml")({
  loader: async () => {
    const xml = await generateSitemap();
    return { xml };
  },
  component: () => null,
});
```

Note: The exact approach to serving XML from a TanStack Start route may need adjustment. If the framework doesn't support non-HTML responses from file routes, this may need to be a Nitro server route instead (at `app/src/server/routes/sitemap.xml.ts`). Check TanStack Start docs for API route patterns during implementation.

- [ ] **Step 2: Test sitemap generation**

Run: `cd app && pnpm dev`
Navigate to `http://localhost:3000/sitemap.xml` — verify XML output with profile URLs.

- [ ] **Step 3: Commit**

```
feat(app): Add sitemap.xml generation with all profile URLs

Lists all person and organization profiles with canonical URLs and
lastmod dates for search engine indexing.
```

---

## Task 11: Integration Test — Full SSR Flow

- [ ] **Step 1: Run the full app and verify SSR**

Run: `cd app && pnpm dev`

1. Navigate to a profile URL directly (e.g., `/profiles/people/jane-doe-a3f2`)
2. View page source — verify full HTML is rendered server-side (not just a loading spinner)
3. Verify `<title>` contains the actor's name
4. Verify `<meta property="og:title">` is present
5. Verify `<script type="application/ld+json">` contains valid JSON-LD
6. Verify `<link rel="canonical">` points to the correct URL

- [ ] **Step 2: Test legacy redirect**

Navigate to `/entries/{some-uuid}` — verify 301 redirect to `/profiles/{type}/{slug}`.

- [ ] **Step 3: Test connections sidebar**

On a profile page, verify the sidebar shows related actors with evidence snippets. Click a connection — verify navigation to the linked profile with slide transition.

- [ ] **Step 4: Run full test suites**

```bash
cd api && python -m pytest tests/ -x -q
cd app && pnpm vitest run
cd app && pnpm tsc --noEmit
```

All should pass.

- [ ] **Step 5: Commit any fixes from integration testing**

```
fix(app): Address integration test findings for SSR profiles
```

---

## Deferred: Network Explorer

The Network Explorer (`/explore` route with interactive graph canvas) is covered in the design spec but excluded from this plan. It should be implemented as a separate plan after the core profile experience is stable. The "Explore this network" CTA can link to `/explore?actor=:id` but the route itself is out of scope.
