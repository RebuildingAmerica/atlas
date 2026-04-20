# Organization Support for Atlas API

## Context

Atlas uses better-auth's organization plugin on the frontend for workspace
management (members, invitations, SSO). However, the Python API has zero
organization awareness — `AuthenticatedActor` carries only user_id and email,
the database schema has no org scoping, and all data is globally shared.

For v1 production, Atlas needs:
- Org context flowing to the Python API on every authenticated request
- A shared global catalog with org attribution (who contributed what)
- Org-private resources (entries, annotations, discovery runs) as a team feature
- RESTful endpoints for all org-scoped operations

## Design Decisions

- Every user has at least one organization (personal/individual workspace)
- Some API features (public catalog reads) don't require auth or org context
- Org membership is verified via a dedicated internal endpoint (not shared DB access)
- Resource ownership is tracked in a separate table, not by modifying core schemas
- Private resources use `/api/orgs/{orgId}/...` URL namespace
- All APIs are RESTful

---

## 1. Org Context Transmission

Org context flows through all three existing auth paths:

### Internal Headers (browser → frontend proxy → API)

```
X-Atlas-Internal-Secret: <shared secret>
X-Atlas-Actor-Id: <user_id>
X-Atlas-Actor-Email: <email>
X-Atlas-Organization-Id: <active org id>   ← NEW
```

Added in `createInternalAuthHeaders` from the session's
`workspace.activeOrganization.id`.

### API Keys

Organization ID stored in API key metadata at creation time:

```typescript
auth.api.createApiKey({
  metadata: { organizationId: activeOrganization.id },
  // ...
});
```

API keys are permanently bound to the org they were created under.

### JWT/OAuth Tokens (MCP Clients)

`org_id` claim added to access tokens via `buildAtlasAccessTokenClaims`:

```typescript
{ permissions: {...}, org_id: "org_abc123" }
```

---

## 2. Membership Verification Endpoint

The frontend exposes a new internal endpoint the API calls to verify org
membership. This extends the existing pattern used for API key introspection.

### Endpoint

```
GET /api/auth/internal/memberships/{organizationId}/members/{userId}
Headers: X-Atlas-Internal-Secret: <shared secret>
```

### Response (200 — is a member)

```json
{
  "role": "owner",
  "slug": "acme-corp",
  "name": "Acme Corp",
  "workspaceType": "team"
}
```

### Response (404 — not a member)

Standard 404 response.

### API-Side Caching

- In-memory TTL cache, key = `(user_id, org_id)`
- Default TTL: 60 seconds
- On cache miss: HTTP GET to the frontend
- On cache hit: skip network call

---

## 3. AuthenticatedActor Changes

```python
@dataclass(slots=True)
class AuthenticatedActor:
    user_id: str
    email: str
    auth_type: str
    org_id: str | None = None
    org_role: str | None = None        # owner | admin | member
    org_slug: str | None = None
    workspace_type: str | None = None  # team | individual
    api_key_id: str | None = None
    is_local: bool = False
    permissions: dict[str, list[str]] | None = None
```

### New FastAPI Dependencies

```python
async def require_org_actor(
    request: Request,
    actor: AuthenticatedActor = Depends(require_actor),
    settings: Settings = Depends(get_settings),
) -> AuthenticatedActor:
    """Requires auth + verified org context. Returns 403 if no org or membership invalid."""

def require_org_role(min_role: str) -> Dependency:
    """Requires auth + org + at least the specified role (member < admin < owner)."""
```

### Resolution Order in `require_actor`

1. Local mode → synthetic actor (no org, dev convenience)
2. Internal headers → extract `X-Atlas-Organization-Id`
3. API key → read `organizationId` from introspection metadata
4. JWT → read `org_id` claim from decoded payload
5. After actor resolved: if `org_id` present, verify via cached endpoint call

---

## 4. Database Schema

### Ownership Table (new)

```sql
CREATE TABLE resource_ownership (
    resource_id TEXT NOT NULL,
    resource_type TEXT NOT NULL CHECK(resource_type IN ('entry', 'source', 'discovery_run')),
    org_id TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'private')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (resource_id, resource_type)
);
CREATE INDEX idx_resource_ownership_org ON resource_ownership(org_id);
CREATE INDEX idx_resource_ownership_org_visibility ON resource_ownership(org_id, visibility);
```

**Semantics:**
- No ownership row → legacy/pre-org data (globally visible, no org can modify)
- `visibility = 'public'` → shared catalog, attributed to org, anyone reads
- `visibility = 'private'` → only members of `org_id` can see it

Private entries and private discovery runs live in the same `entries` and
`discovery_runs` tables as public ones. The `resource_ownership` row with
`visibility = 'private'` is what makes them private — no separate tables needed.
This means private entries have the same columns/constraints as public entries.

### Annotations Table (new)

```sql
CREATE TABLE org_annotations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    content TEXT NOT NULL,
    author_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (entry_id) REFERENCES entries(id)
);
CREATE INDEX idx_org_annotations_org ON org_annotations(org_id);
CREATE INDEX idx_org_annotations_entry ON org_annotations(entry_id);
```

### Existing Tables

`entries`, `sources`, `discovery_runs` remain unchanged. Ownership is tracked
externally via `resource_ownership`.

---

## 5. RESTful API Endpoints

### Public Catalog (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/entities` | Search/list all public entries |
| GET | `/api/entities/{id}` | Get public entry detail |

### Shared Catalog Writes (auth + org required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/entities` | Create entry (+ ownership row, visibility=public) |
| PUT | `/api/entities/{id}` | Update entry (only owning org) |
| DELETE | `/api/entities/{id}` | Delete entry (only owning org) |

### Org-Scoped Private Resources

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/orgs/{orgId}/entries` | List org's private entries |
| POST | `/api/orgs/{orgId}/entries` | Create private entry |
| GET | `/api/orgs/{orgId}/entries/{id}` | Get private entry |
| PUT | `/api/orgs/{orgId}/entries/{id}` | Update private entry |
| DELETE | `/api/orgs/{orgId}/entries/{id}` | Delete private entry |
| GET | `/api/orgs/{orgId}/annotations` | List org's annotations |
| POST | `/api/orgs/{orgId}/annotations` | Create annotation on shared entry |
| PUT | `/api/orgs/{orgId}/annotations/{id}` | Update annotation |
| DELETE | `/api/orgs/{orgId}/annotations/{id}` | Delete annotation |
| GET | `/api/orgs/{orgId}/discovery-runs` | List org's private discovery runs |
| POST | `/api/orgs/{orgId}/discovery-runs` | Start private discovery run |
| GET | `/api/orgs/{orgId}/discovery-runs/{id}` | Get private discovery run |

### Access Rules

- Path `{orgId}` is validated against the actor's verified `org_id`
- Creating private resources: any org member
- Modifying/deleting: org member who created it, or admin/owner
- Role-based admin actions: admin or owner only

---

## 6. Frontend Changes

### `createInternalAuthHeaders` (config.ts)

Add `X-Atlas-Organization-Id` from session workspace state.

### API Key Creation (api-keys.functions.ts)

Embed `organizationId` in API key metadata at creation time.

### JWT Claims (auth.ts)

Add `org_id` to `buildAtlasAccessTokenClaims` return value.

### New Internal Route

`GET /api/auth/internal/memberships/[organizationId]/members/[userId]`
— verifies membership using better-auth's organization API, returns role and
workspace metadata.

---

## 7. Endpoint Categorization Summary

| Category | Auth? | Org? | Role? | Example |
|----------|-------|------|-------|---------|
| Public read | No | No | No | `GET /api/entities` |
| Authenticated write | Yes | Yes | member+ | `POST /api/entities` |
| Org-private CRUD | Yes | Yes | member+ | `GET /api/orgs/{orgId}/entries` |
| Org admin | Yes | Yes | admin+ | future: manage org settings via API |

---

## 8. Verification Plan

1. **Unit tests:** Verification endpoint returns correct role/404 for valid/invalid memberships
2. **Integration tests:** Full auth flow — create entry with org context, verify ownership row created
3. **Access control tests:** Ensure org A cannot read/modify org B's private resources
4. **Public access tests:** Unauthenticated reads on shared catalog still work
5. **Cache tests:** Verify TTL behavior — membership revocation takes effect after cache expiry
6. **API key tests:** Key created for org A cannot access org B's private resources
7. **Legacy data tests:** Pre-org entries (no ownership row) remain globally visible and unmodifiable via org-scoped actions

---

## Critical Files

**Python API:**
- `api/atlas/domains/access/principals.py` — extend AuthenticatedActor
- `api/atlas/domains/access/dependencies.py` — add require_org_actor, verification client
- `api/atlas/platform/database.py` — add ownership + annotations tables to schema
- `api/atlas/domains/catalog/api/entries.py` — ownership enforcement on writes
- New: `api/atlas/domains/catalog/api/org_resources.py` — org-scoped entry/annotation CRUD
- New: `api/atlas/domains/discovery/api_org.py` — org-scoped discovery runs

**Frontend (TanStack Start app):**
- `app/src/domains/access/config.ts` — add X-Atlas-Organization-Id header
- `app/src/domains/access/server/auth.ts` — add org_id to JWT claims
- New: `app/src/routes/api/auth/internal/memberships/[organizationId]/members/[userId].ts` — verification endpoint
- `app/src/domains/access/api-keys.functions.ts` — embed org in key metadata
