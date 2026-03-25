# API Reference

[Docs](../README.md) > [Architecture](./README.md) > API Reference

REST API endpoints, request/response schemas, and conventions.

## Base URL

All requests go to:
```
http://localhost:8000/api/v1
```

**In production:** Replace `localhost:8000` with the deployed backend domain.

## Authentication

Currently no authentication. All endpoints are public.

**Future:** Admin endpoints (`POST /discovery`, etc.) will require authentication. TBD.

## Response Format

All responses are JSON. Successful responses return the requested data. Errors return a structured error object.

**Success (2xx):**
```json
{
  "data": { /* requested data */ }
}
```

**Error (4xx/5xx):**
```json
{
  "error": {
    "type": "NOT_FOUND",
    "message": "Entry not found",
    "detail": "No entry with id=123"
  }
}
```

## Pagination

List endpoints support pagination via query parameters.

**Query Parameters:**
- `page` — Page number (1-indexed, default: 1)
- `page_size` — Items per page (default: 20, max: 100)

**Response:**
```json
{
  "data": [
    { /* item */ },
    { /* item */ }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total": 150,
    "has_more": true
  }
}
```

## Entries Endpoints

### List All Entries

```
GET /entries
```

**Query Parameters:**
- `page` — Page number (default: 1)
- `page_size` — Items per page (default: 20)
- `state` — Filter by state (2-letter code, e.g., "KS")
- `issue_area` — Filter by issue area slug (e.g., "labor")
- `q` — Full-text search query

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "organization",
      "name": "Prairie Workers Cooperative",
      "description": "Worker-owned cleaning cooperative...",
      "city": "Garden City",
      "state": "KS",
      "website": "https://...",
      "issue_areas": ["labor", "worker_cooperatives"],
      "sources": [
        {
          "id": "uuid",
          "url": "https://wichita-eagle.com/...",
          "title": "Article title",
          "publication": "Wichita Eagle",
          "published_date": "2026-01-15"
        }
      ],
      "created_at": "2026-03-20T10:00:00Z",
      "updated_at": "2026-03-25T14:30:00Z"
    }
  ],
  "pagination": { ... }
}
```

**Status Codes:**
- `200` — Success
- `400` — Invalid query parameters
- `500` — Server error

---

### Get Single Entry

```
GET /entries/{id}
```

**Path Parameters:**
- `id` — Entry UUID

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "type": "person",
    "name": "Maria Gonzalez",
    "description": "Founder of Prairie Workers Cooperative...",
    "city": "Garden City",
    "state": "KS",
    "region": null,
    "geo_specificity": "local",
    "website": "https://...",
    "issue_areas": ["labor", "worker_cooperatives"],
    "sources": [ /* array of sources */ ],
    "affiliated_org_id": "uuid-of-org",
    "active": true,
    "created_at": "2026-03-20T10:00:00Z",
    "updated_at": "2026-03-25T14:30:00Z"
  }
}
```

**Status Codes:**
- `200` — Success
- `404` — Entry not found
- `500` — Server error

---

### Create Entry (Internal)

```
POST /entries
```

**Request Body:**
```json
{
  "type": "person",
  "name": "Jane Smith",
  "description": "Housing rights organizer in Denver",
  "city": "Denver",
  "state": "CO",
  "issue_areas": ["housing"],
  "website": "https://...",
  "sources": [
    {
      "url": "https://article.com",
      "extraction_context": "Jane Smith is leading the campaign..."
    }
  ]
}
```

**Response:** Created entry object (same as GET)

**Status Codes:**
- `201` — Created
- `400` — Invalid request
- `500` — Server error

---

### Update Entry

```
PUT /entries/{id}
```

**Path Parameters:**
- `id` — Entry UUID

**Request Body:** Fields to update (all optional)
```json
{
  "name": "Updated name",
  "description": "Updated description",
  "active": false,
  "issue_areas": ["labor", "housing"]
}
```

**Response:** Updated entry object

**Status Codes:**
- `200` — Updated
- `404` — Entry not found
- `400` — Invalid request
- `500` — Server error

---

## Discovery Pipeline Endpoints

### Trigger Discovery

```
POST /discovery
```

**Request Body:**
```json
{
  "location": "Kansas City, MO",
  "issue_areas": ["labor", "housing"]
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "location_query": "Kansas City, MO",
    "state": "MO",
    "issue_areas": ["labor", "housing"],
    "status": "pending",
    "started_at": "2026-03-25T15:00:00Z",
    "completed_at": null,
    "entries_found": 0,
    "sources_processed": 0,
    "error_message": null
  }
}
```

**Status Codes:**
- `202` — Accepted (processing started)
- `400` — Invalid request
- `500` — Server error

---

### Get Discovery Run Status

```
GET /discovery/{run_id}
```

**Path Parameters:**
- `run_id` — DiscoveryRun UUID

**Response:** DiscoveryRun object (same structure as above)

**Status Codes:**
- `200` — Success
- `404` — Run not found
- `500` — Server error

---

### List Discovery Runs

```
GET /discovery
```

**Query Parameters:**
- `state` — Filter by state (e.g., "KS")
- `page` — Page number
- `page_size` — Items per page

**Response:**
```json
{
  "data": [ /* array of DiscoveryRun objects */ ],
  "pagination": { ... }
}
```

**Status Codes:**
- `200` — Success
- `400` — Invalid query
- `500` — Server error

---

## Taxonomy Endpoints

### List Issue Areas

```
GET /taxonomy/issue-areas
```

**Response:**
```json
{
  "data": [
    {
      "slug": "housing",
      "label": "Housing & Homelessness",
      "description": "Affordable housing, tenant organizing, homelessness..."
    },
    {
      "slug": "labor",
      "label": "Labor & Worker Power",
      "description": "Worker cooperatives, union organizing, workplace equity..."
    }
  ]
}
```

**Status Codes:**
- `200` — Success
- `500` — Server error

---

### Get Issue Area Details

```
GET /taxonomy/issue-areas/{slug}
```

**Path Parameters:**
- `slug` — Issue area slug (e.g., "housing")

**Response:**
```json
{
  "data": {
    "slug": "housing",
    "label": "Housing & Homelessness",
    "description": "...",
    "search_terms": [
      "affordable housing",
      "tenant organizing",
      "eviction prevention",
      "community land trust"
    ]
  }
}
```

**Status Codes:**
- `200` — Success
- `404` — Issue area not found
- `500` — Server error

---

## Error Types

Common error types returned in error responses:

| Type | HTTP | Meaning |
|---|---|---|
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `INVALID_QUERY` | 400 | Query parameters invalid |
| `CONFLICT` | 409 | Resource already exists |
| `INTERNAL_ERROR` | 500 | Server error |
| `UNAVAILABLE` | 503 | Service temporarily unavailable |

**Example error response:**
```json
{
  "error": {
    "type": "VALIDATION_ERROR",
    "message": "Invalid request",
    "detail": "Field 'state' must be 2-letter code"
  }
}
```

---

## Interactive Documentation

When the backend is running, visit:

```
http://localhost:8000/docs
```

This opens Swagger UI with all endpoints, request/response schemas, and a "Try It" button for each endpoint.

---

## Current Implementation Status

| Endpoint | Status | Notes |
|---|---|---|
| `GET /entries` | Partial | Returns empty. API structure correct. |
| `GET /entries/{id}` | Partial | Returns entry if exists. |
| `POST /entries` | Partial | Creates entry. Not all fields validated. |
| `PUT /entries/{id}` | Partial | Updates entry. Limited field support. |
| `POST /discovery` | Stubbed | Accepts request. Returns pending status. Pipeline doesn't actually run. |
| `GET /discovery/{run_id}` | Partial | Returns run status. Status stays "pending". |
| `GET /taxonomy/issue-areas` | Working | Returns all issue areas. |
| `GET /taxonomy/issue-areas/{slug}` | Working | Returns issue area details. |

**Key limitation:** `POST /discovery` doesn't actually run the pipeline. It creates a DiscoveryRun record but doesn't execute Steps 1-6. Status stays "pending" forever.

---

## Field Naming Conventions

All JSON field names use `snake_case`:
```json
{
  "issue_areas": [...],
  "published_date": "2026-03-25",
  "created_at": "2026-03-20T10:00:00Z"
}
```

This differs from TypeScript (camelCase) and Python (snake_case). The API client handles conversion automatically.

---

## Versioning

API is currently `v1` (in the base URL: `/api/v1`).

If we make breaking changes, we'll create `/api/v2` while maintaining `/api/v1` for backwards compatibility.

---

## See Also

- [System Overview](./system-overview.md) — How API fits in architecture
- [Backend Development](../development/backend.md) — How to add new endpoints
- [Data Model](./data-model.md) — Schema reference

---

Last updated: March 25, 2026
