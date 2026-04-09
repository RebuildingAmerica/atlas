# API Conventions

[Docs](../README.md) > [Standards](./README.md) > API Conventions

REST API design standards. How we structure endpoints, responses, errors, and versioning.

## Base Path

All API endpoints are versioned and prefixed:

```
/api/v1
```

Examples:
- `/api/v1/entries`
- `/api/v1/entries/{id}`
- `/api/v1/discovery`
- `/api/v1/taxonomy/issue-areas`

**Future:** If we make breaking changes, we'll create `/api/v2` while maintaining `/api/v1` for backwards compatibility.

## HTTP Methods

Follow standard REST conventions:

| Method | Action | Idempotent | Response Code |
|---|---|---|---|
| `GET` | Fetch data | Yes | 200, 404 |
| `POST` | Create resource | No | 201 (created), 400 |
| `PUT` | Update resource | Yes | 200 (updated), 404, 400 |
| `DELETE` | Delete resource | Yes | 204 (no content), 404 |

## Response Format

All responses are JSON. Standard envelope for consistency.

### Success Response

```json
{
  "data": {
    "id": "uuid",
    "name": "string",
    ...
  }
}
```

For lists:

```json
{
  "data": [
    { "id": "uuid", "name": "string" },
    { "id": "uuid", "name": "string" }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 150,
    "has_more": true
  }
}
```

### Error Response

```json
{
  "error": {
    "type": "NOT_FOUND",
    "message": "Entry not found",
    "detail": "No entry with id=123"
  }
}
```

**Fields:**
- `type` — Machine-readable error code (all caps)
- `message` — Human-readable summary
- `detail` — Additional context (optional)

## Pagination

List endpoints support cursor-less pagination.

### Request

Query parameters:

```
GET /api/v1/entries?page=2&page_size=25
```

- `page` — Page number (1-indexed, default: 1)
- `page_size` — Items per page (default: 20, max: 100)

### Response

Include pagination metadata:

```json
{
  "data": [ ... ],
  "pagination": {
    "page": 2,
    "page_size": 25,
    "total": 150,
    "has_more": true
  }
}
```

**Usage:** Client can show "Showing items X-Y of Z" and "Next page" button based on `has_more`.

## Filtering and Search

### Query Parameters

Use query params for filtering:

```
GET /api/v1/entries?state=KS&issue_area=labor
GET /api/v1/entries?q=search+query
GET /api/v1/entries?state=MO&active=true&page=1
```

Standard filter params:
- `q` — Full-text search query
- `state` — 2-letter state code
- `issue_area` — Issue area slug
- `active` — Boolean filter

### Combining Filters

All filters work together (AND logic):

```
GET /api/v1/entries?state=KS&issue_area=labor&active=true
# Returns: active entries in KS working on labor issues
```

## Field Naming

All JSON field names use `snake_case`:

```json
{
  "entry_id": "uuid",
  "issue_areas": ["labor"],
  "created_at": "2026-03-25T10:00:00Z",
  "last_verified": "2026-03-25",
  "is_active": true
}
```

**Why:** JSON convention. Python also uses snake_case. TypeScript uses camelCase internally but converts to/from snake_case via API client.

## Timestamps

Use ISO 8601 format with timezone:

```
"created_at": "2026-03-25T10:00:00Z"      # ✅ with Z (UTC)
"created_at": "2026-03-25T10:00:00+00:00" # ✅ with offset
"created_at": "2026-03-25 10:00:00"       # ❌ no timezone
"created_at": "2026-03-25"                # ❌ no time
```

All timestamps are UTC. No locale-specific formatting.

## Error Types

Standard error codes used across the API:

| Type | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `INVALID_QUERY` | 400 | Query parameters invalid |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource already exists |
| `INTERNAL_ERROR` | 500 | Server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily down |

### Error Response Example

```json
{
  "error": {
    "type": "VALIDATION_ERROR",
    "message": "Invalid request",
    "detail": "Field 'state' must be 2-letter code. Got: TOOLONG"
  }
}
```

## Status Codes

Use appropriate HTTP status codes:

| Code | Meaning | When to use |
|---|---|---|
| `200` | OK | Successful GET, PUT, PATCH |
| `201` | Created | Successful POST |
| `204` | No Content | Successful DELETE |
| `400` | Bad Request | Invalid input, validation error |
| `401` | Unauthorized | Missing authentication |
| `403` | Forbidden | Authenticated but not authorized |
| `404` | Not Found | Resource doesn't exist |
| `409` | Conflict | Resource already exists |
| `500` | Internal Error | Server crashed |
| `503` | Service Unavailable | Database down, etc. |

## Request Validation

All requests are validated using Pydantic schemas.

Invalid requests are rejected with 400:

```json
{
  "error": {
    "type": "VALIDATION_ERROR",
    "message": "Invalid request",
    "detail": "Field 'name' is required"
  }
}
```

**What gets validated:**
- Required fields present
- Types are correct
- String lengths
- Enum values
- Custom business logic

## Example Endpoints

### List with Pagination

```
GET /api/v1/entries?state=KS&page=1&page_size=20

Response 200:
{
  "data": [
    {
      "id": "uuid",
      "name": "Prairie Workers Cooperative",
      ...
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 127,
    "has_more": true
  }
}
```

### Create

```
POST /api/v1/entries

Request:
{
  "name": "New Org",
  "description": "Description",
  "state": "KS"
}

Response 201:
{
  "data": {
    "id": "new-uuid",
    "name": "New Org",
    "description": "Description",
    "state": "KS",
    "created_at": "2026-03-25T15:30:00Z",
    ...
  }
}
```

### Update

```
PUT /api/v1/entries/uuid

Request:
{
  "name": "Updated Name"
}

Response 200:
{
  "data": {
    "id": "uuid",
    "name": "Updated Name",
    ...
  }
}
```

### Delete

```
DELETE /api/v1/entries/uuid

Response 204 (no content)
```

### Error Example

```
GET /api/v1/entries/nonexistent

Response 404:
{
  "error": {
    "type": "NOT_FOUND",
    "message": "Entry not found",
    "detail": "No entry with id=nonexistent"
  }
}
```

## Rate Limiting

Currently no rate limiting. May be added in future based on usage patterns.

## CORS

All endpoints allow cross-origin requests from the app domain.

## Caching

Responses should not be cached by default (no Cache-Control headers).

Future: Add caching headers for expensive queries (list entries, search).

## Versioning Strategy

If we need to make breaking changes:

1. **Create new endpoint** under `/api/v2`
2. **Maintain `/api/v1`** for backwards compatibility
3. **Document deprecation** of v1 endpoint
4. **Sunset v1** after reasonable notice period (3-6 months)

Example:

```
# Old API
GET /api/v1/entries        # Returns v1 schema
POST /api/v1/entries/{id}  # For creating

# New API (v2)
GET /api/v2/entries        # Returns v2 schema (incompatible)
POST /api/v2/entries       # New behavior

# For 6 months: support both v1 and v2
```

---

## Checklist for New Endpoints

Before adding a new endpoint, make sure:

- [ ] Endpoint uses `/api/v1` base path
- [ ] Uses correct HTTP method (GET for fetch, POST for create, etc.)
- [ ] Request is validated with Pydantic schema
- [ ] Response follows standard envelope format
- [ ] Error responses include `type`, `message`, `detail`
- [ ] Status codes are appropriate (201 for create, 404 for not found, etc.)
- [ ] List endpoints support `page` and `page_size` pagination
- [ ] Field names use `snake_case`
- [ ] Timestamps use ISO 8601 with timezone
- [ ] Endpoint is documented (docstring + Swagger comment)
- [ ] Tests cover happy path and error cases

---

## See Also

- [API Reference](../architecture/api-reference.md) — Actual endpoints
- [API Development](../development/api.md) — How to add endpoints

---

Last updated: March 25, 2026
