# API Development

[Docs](../README.md) > [Development](./README.md) > API Development

How to build features on the Python/FastAPI API. Adding endpoints, models, pipeline steps, and issue areas.

## Prerequisites

- Python 3.12+ installed
- API dependencies installed (`make setup` or `cd api && pip install -e ".[dev]"`)
- Familiar with FastAPI and SQLAlchemy/Pydantic

## Adding a New API Endpoint

### 1. Define the Request/Response Schema

In `api/atlas/schemas/`:

```python
# api/atlas/schemas/my_feature.py
from pydantic import BaseModel
from typing import Optional
from uuid import UUID

class MyFeatureRequest(BaseModel):
    """Request body for new endpoint"""
    name: str
    description: str
    category: Optional[str] = None

class MyFeatureResponse(BaseModel):
    """Response body for new endpoint"""
    id: UUID
    name: str
    description: str
    created_at: datetime
```

### 2. Create the Route Handler

In `api/atlas/api/`:

```python
# api/atlas/api/my_feature.py
from fastapi import APIRouter, HTTPException, status
from ..schemas.my_feature import MyFeatureRequest, MyFeatureResponse
from ..models import db  # or import your model functions

router = APIRouter(prefix="/my-feature", tags=["my-feature"])

@router.get("", response_model=list[MyFeatureResponse])
async def list_my_features(skip: int = 0, limit: int = 20):
    """List all items"""
    items = db.get_my_features(skip=skip, limit=limit)
    return items

@router.post("", response_model=MyFeatureResponse, status_code=status.HTTP_201_CREATED)
async def create_my_feature(request: MyFeatureRequest):
    """Create new item"""
    item = db.create_my_feature(
        name=request.name,
        description=request.description,
        category=request.category
    )
    return item

@router.get("/{id}", response_model=MyFeatureResponse)
async def get_my_feature(id: UUID):
    """Get single item"""
    item = db.get_my_feature_by_id(id)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    return item
```

### 3. Register the Route in Main Router

In `api/atlas/api/router.py`:

```python
from . import entries, discovery, taxonomy, my_feature  # Add import

def get_routes():
    api_router = APIRouter(prefix="/api/v1")

    # Existing routes...
    api_router.include_router(entries.router)
    api_router.include_router(discovery.router)
    api_router.include_router(taxonomy.router)

    # New route
    api_router.include_router(my_feature.router)

    return api_router
```

### 4. Add Database Layer (if needed)

In `api/atlas/models/my_feature.py`:

```python
from atlas.db import get_db
from uuid import UUID, uuid4
from datetime import datetime

def create_my_feature(name: str, description: str, category: str | None = None) -> dict:
    """Create new item in database"""
    db = get_db()
    item_id = str(uuid4())
    now = datetime.now()

    db.execute("""
        INSERT INTO my_feature (id, name, description, category, created_at)
        VALUES (?, ?, ?, ?, ?)
    """, (item_id, name, description, category, now))
    db.commit()

    return {
        "id": item_id,
        "name": name,
        "description": description,
        "created_at": now
    }

def get_my_feature_by_id(id: UUID) -> dict | None:
    """Get single item"""
    db = get_db()
    row = db.execute(
        "SELECT * FROM my_feature WHERE id = ?",
        (str(id),)
    ).fetchone()

    if not row:
        return None

    return dict(row)
```

### 5. Test the Endpoint

See [Testing](./testing.md).

```python
# api/tests/test_my_feature.py
def test_create_my_feature(client):
    response = client.post(
        "/api/v1/my-feature",
        json={
            "name": "Test",
            "description": "Test description"
        }
    )
    assert response.status_code == 201
    assert response.json()["data"]["name"] == "Test"
```

### 6. Check Everything Works

```bash
cd api

# Type check
mypy atlas

# Lint
ruff check .

# Format check
ruff format . --check

# Test
pytest tests/test_my_feature.py -v

# Full quality
cd ..
make quality
```

---

## Adding a New Database Table

### 1. Create the Schema

In `api/atlas/models/database.py`:

```python
def init_db():
    db = sqlite3.connect("atlas.db")
    db.row_factory = sqlite3.Row

    db.execute("""
        CREATE TABLE IF NOT EXISTS my_table (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL
        )
    """)

    # Add indexes for performance
    db.execute("CREATE INDEX IF NOT EXISTS idx_my_table_created_at ON my_table(created_at)")

    db.commit()
    return db
```

### 2. Create CRUD Functions

In `api/atlas/models/my_table.py`:

```python
from datetime import datetime
from uuid import uuid4

def create(name: str, description: str) -> dict:
    """Insert new row"""
    db = get_db()
    id = str(uuid4())
    now = datetime.now()

    db.execute("""
        INSERT INTO my_table (id, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
    """, (id, name, description, now, now))
    db.commit()

    return {
        "id": id,
        "name": name,
        "description": description,
        "created_at": now,
        "updated_at": now
    }

def read(id: str) -> dict | None:
    """Fetch single row"""
    db = get_db()
    row = db.execute(
        "SELECT * FROM my_table WHERE id = ?",
        (id,)
    ).fetchone()
    return dict(row) if row else None

def update(id: str, **fields) -> dict:
    """Update row"""
    db = get_db()
    now = datetime.now()
    fields["updated_at"] = now

    set_clause = ", ".join([f"{k} = ?" for k in fields.keys()])
    values = list(fields.values()) + [id]

    db.execute(
        f"UPDATE my_table SET {set_clause} WHERE id = ?",
        values
    )
    db.commit()

    return read(id)

def delete(id: str) -> None:
    """Delete row"""
    db = get_db()
    db.execute("DELETE FROM my_table WHERE id = ?", (id,))
    db.commit()

def list_all(skip: int = 0, limit: int = 20) -> list[dict]:
    """Fetch multiple rows"""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM my_table ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (limit, skip)
    ).fetchall()
    return [dict(row) for row in rows]
```

### 3. Test the Table

```bash
cd api && pytest tests/test_models.py -v
```

---

## Adding a Pipeline Step

The pipeline is in `api/atlas/pipeline/`. It has 6 steps that run in sequence.

### Example: Improving Step 1 (Query Generation)

Current implementation in `api/atlas/pipeline/query_generator.py`:

```python
def generate_queries(location: str, issue_areas: list[str]) -> list[str]:
    """
    Generate search queries for autodiscovery.
    Currently returns basic queries. Needs improvement.
    """
    queries = []

    for issue in issue_areas:
        queries.append(f"{issue} {location}")
        queries.append(f"site:news.google.com {issue} {location}")

    return queries
```

**To improve it:**

1. **Add more query variations**
2. **Target different source types** (news, nonprofits, organizations, etc.)
3. **Add boolean operators** for better search precision
4. **Test that queries are diverse and targeted**

```python
def generate_queries(location: str, issue_areas: list[str]) -> list[str]:
    """
    Generate ~40 targeted search queries across source types.
    Returns diverse queries to maximize discovery.
    """
    queries = []
    location_encoded = location.replace(" ", "+")

    for issue in issue_areas:
        # Broad searches
        queries.append(f"{issue} {location}")

        # News-specific
        queries.append(f'site:news.google.com "{issue}" "{location}"')
        queries.append(f"{issue} activism {location}")
        queries.append(f"{issue} organization {location}")

        # Nonprofit directories
        queries.append(f"site:guidestar.org {issue} {location}")
        queries.append(f"site:idealist.org {issue} {location}")

        # Local government/civic
        queries.append(f"{issue} city council {location}")

        # Academic
        queries.append(f'site:scholar.google.com "{issue}" "{location}"')

    return queries
```

Test it:
```python
# api/tests/test_pipeline.py
def test_generate_queries():
    queries = generate_queries("Kansas City, MO", ["labor", "housing"])

    # Should return many queries
    assert len(queries) > 20

    # Should cover multiple source types
    assert any("site:guidestar.org" in q for q in queries)
    assert any("site:scholar.google.com" in q for q in queries)

    # Should include issue area
    assert any("labor" in q for q in queries)
    assert any("housing" in q for q in queries)
```

---

## Adding a New Issue Area

Issue areas are defined in `api/atlas/taxonomy/`.

### 1. Add to Issue Areas Enum

In `api/atlas/taxonomy/issue_areas.py`:

```python
from enum import Enum

class IssueArea(str, Enum):
    HOUSING = "housing"
    LABOR = "labor"
    HEALTHCARE = "healthcare"
    CLIMATE = "climate"
    DEMOCRACY = "democracy"
    EDUCATION = "education"
    JUSTICE = "justice"
    INFRASTRUCTURE = "infrastructure"
    MY_NEW_AREA = "my_new_area"  # Add here

ISSUE_AREA_METADATA = {
    "my_new_area": {
        "label": "My New Area",
        "description": "Description of what this issue area covers..."
    }
}
```

### 2. Add Search Terms

In `api/atlas/taxonomy/search_terms.py`:

```python
SEARCH_TERMS = {
    "my_new_area": [
        "search term 1",
        "search term 2",
        "search term 3",
        "related topic",
    ]
}
```

### 3. Test It

```python
# api/tests/test_taxonomy.py
def test_my_new_area_is_recognized():
    from atlas.taxonomy import IssueArea
    assert IssueArea.MY_NEW_AREA in IssueArea

def test_my_new_area_has_search_terms():
    from atlas.taxonomy import SEARCH_TERMS
    terms = SEARCH_TERMS.get("my_new_area")
    assert terms is not None
    assert len(terms) > 0
```

---

## Running Tests

```bash
cd api

# Run all tests
pytest

# Run with coverage
pytest --cov=atlas --cov-report=term-missing

# Run specific test file
pytest tests/test_models.py -v

# Run specific test
pytest tests/test_models.py::test_create_entry -v

# Watch mode (rerun on file change)
# Requires pytest-watch: pip install pytest-watch
ptw
```

**Coverage requirement:** 90%+ on all changes.

---

## Type Checking

```bash
cd api

# Check all code
mypy atlas

# Show error codes (helps look up error)
mypy atlas --show-error-codes

# Check strict mode (more rigorous)
mypy atlas --strict
```

**Rule:** All functions must have type annotations:

```python
# Good
def create_entry(name: str, location: str) -> dict:
    ...

# Bad
def create_entry(name, location):
    ...

# Bad
def create_entry(name, location) -> dict:
    ...
```

---

## Linting and Formatting

```bash
cd api

# Check formatting
ruff format . --check

# Auto-format
ruff format .

# Check lint
ruff check .

# Auto-fix lint issues
ruff check . --fix
```

---

## Environment Variables

API configuration is in `api/atlas/config.py`. Environment variables are loaded from `.env`:

```python
# .env (local development)
ANTHROPIC_API_KEY=your-key-here
DATABASE_URL=atlas.db
LOG_LEVEL=DEBUG
```

In code:
```python
from atlas.config import settings

api_key = settings.anthropic_api_key
db_path = settings.database_url
```

---

## Common Patterns

### Working with Database

```python
from atlas.models import db

# Create
entry = db.create_entry(name="...", description="...")

# Read
entry = db.get_entry(id)

# Update
entry = db.update_entry(id, name="new name")

# Delete
db.delete_entry(id)

# List
entries = db.list_entries(skip=0, limit=20)

# Search
entries = db.search_entries(query="search term")
```

### API Error Handling

```python
from fastapi import HTTPException, status

@router.get("/entries/{id}")
async def get_entry(id: str):
    entry = db.get_entry(id)

    # 404
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Entry not found"
        )

    # 400
    if not id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid ID"
        )

    return entry
```

### Async Database Operations

Currently using synchronous SQLite. If moving to async, use `aiosqlite`:

```python
import aiosqlite

async def get_entry(id: str):
    async with aiosqlite.connect("atlas.db") as db:
        cursor = await db.execute(
            "SELECT * FROM entries WHERE id = ?",
            (id,)
        )
        row = await cursor.fetchone()
    return dict(row) if row else None
```

---

## See Also

- [Testing](./testing.md) — Write tests for your code
- [Code Quality](./code-quality.md) — Fix lint/type errors
- [API Architecture](../architecture/pipeline.md) — How pipeline works
- [API Reference](../architecture/api-reference.md) — API endpoints

---

Last updated: March 25, 2026
