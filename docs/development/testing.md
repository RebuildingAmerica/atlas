# Testing

[Docs](../README.md) > [Development](./README.md) > Testing

Test strategies and how to write tests for both backend and frontend. Running tests and coverage requirements.

## Testing Philosophy

Code + tests + docs are one artifact. New behavior must be tested or it's incomplete.

**Requirements:**
- 90%+ coverage on all changed code
- Tests describe intended behavior (not just pass/fail)
- Tests catch regressions (would fail if behavior regressed)

## Backend Testing (pytest)

### Running Tests

```bash
cd backend

# Run all tests
pytest

# Run with coverage
pytest --cov=atlas --cov-report=term-missing --cov-fail-under=90

# Run specific file
pytest tests/test_models.py -v

# Run specific test
pytest tests/test_models.py::test_create_entry -v

# Watch mode (rerun on file change)
pip install pytest-watch
ptw
```

### Test Structure

```
backend/tests/
├── conftest.py          # Fixtures and test configuration
├── test_models.py       # Database model tests
├── test_api.py          # API endpoint tests
├── test_pipeline.py     # Pipeline step tests
└── test_taxonomy.py     # Taxonomy tests
```

### Writing Unit Tests

```python
# backend/tests/test_models.py
import pytest
from atlas.models import entry as entry_model

class TestEntryModel:
    """Tests for Entry model CRUD operations"""

    def test_create_entry(self):
        """Should create new entry in database"""
        result = entry_model.create(
            name="Test Org",
            description="A test organization",
            city="TestCity",
            state="TC"
        )

        assert result["id"] is not None
        assert result["name"] == "Test Org"
        assert result["state"] == "TC"

    def test_create_entry_with_invalid_state(self):
        """Should validate state is 2-letter code"""
        with pytest.raises(ValueError):
            entry_model.create(
                name="Test",
                description="Test",
                state="INVALID"  # Too long
            )

    def test_read_nonexistent_entry(self):
        """Should return None for nonexistent entry"""
        result = entry_model.read("nonexistent-id")
        assert result is None

    def test_update_entry(self):
        """Should update fields"""
        entry = entry_model.create(
            name="Original",
            description="Original description"
        )

        updated = entry_model.update(
            entry["id"],
            name="Updated"
        )

        assert updated["name"] == "Updated"
        assert updated["description"] == "Original description"
```

### Testing API Endpoints

```python
# backend/tests/test_api.py
import pytest
from fastapi.testclient import TestClient
from atlas.main import app

@pytest.fixture
def client():
    """FastAPI test client"""
    return TestClient(app)

class TestEntriesAPI:
    """Tests for entries endpoints"""

    def test_list_entries(self, client):
        """GET /entries should return list"""
        response = client.get("/api/v1/entries")

        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        assert isinstance(data["data"], list)

    def test_create_entry(self, client):
        """POST /entries should create new entry"""
        response = client.post(
            "/api/v1/entries",
            json={
                "name": "New Org",
                "description": "New organization",
                "state": "KS"
            }
        )

        assert response.status_code == 201
        data = response.json()["data"]
        assert data["name"] == "New Org"
        assert data["id"] is not None

    def test_get_entry(self, client):
        """GET /entries/{id} should return entry"""
        # Create entry first
        create_response = client.post(
            "/api/v1/entries",
            json={"name": "Test", "description": "Test", "state": "KS"}
        )
        entry_id = create_response.json()["data"]["id"]

        # Get it
        response = client.get(f"/api/v1/entries/{entry_id}")

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["id"] == entry_id

    def test_get_nonexistent_entry(self, client):
        """GET /entries/{id} should return 404"""
        response = client.get("/api/v1/entries/nonexistent")

        assert response.status_code == 404
```

### Testing Pipeline Steps

```python
# backend/tests/test_pipeline.py
import pytest
from atlas.pipeline import query_generator

class TestQueryGenerator:
    """Tests for Step 1: Query Generation"""

    def test_generate_queries(self):
        """Should generate diverse queries"""
        queries = query_generator.generate_queries(
            "Kansas City, MO",
            ["labor", "housing"]
        )

        # Should return many queries
        assert len(queries) > 20

        # Should be strings
        assert all(isinstance(q, str) for q in queries)

        # Should include location
        assert any("Kansas City" in q or "Kansas+City" in q for q in queries)

        # Should include issue areas
        assert any("labor" in q for q in queries)
        assert any("housing" in q for q in queries)

    def test_generate_queries_targets_multiple_sources(self):
        """Should generate queries for different source types"""
        queries = query_generator.generate_queries(
            "Denver, CO",
            ["education"]
        )

        # Should target news
        assert any("news" in q.lower() for q in queries)

        # Should target nonprofits
        assert any("nonprofit" in q.lower() or "guidestar" in q for q in queries)

        # Should target organizations
        assert any("organization" in q.lower() or "org" in q.lower() for q in queries)
```

### Using Fixtures

Fixtures are reusable test setup:

```python
# backend/tests/conftest.py
import pytest
import sqlite3
from atlas.models import database

@pytest.fixture
def test_db():
    """Fresh database for each test"""
    # Create in-memory database
    db = sqlite3.connect(":memory:")
    database.init_db_connection(db)
    yield db
    db.close()

@pytest.fixture
def sample_entry(test_db):
    """Sample entry for testing"""
    from atlas.models import entry as entry_model
    return entry_model.create(
        name="Test Entry",
        description="A test entry",
        state="KS"
    )

# Use in tests
def test_something(sample_entry):
    """This test receives the sample_entry fixture"""
    assert sample_entry["name"] == "Test Entry"
```

### Mocking External Services

```python
from unittest.mock import patch, MagicMock
import pytest

class TestExtractor:
    """Tests for AI extraction step"""

    @patch("atlas.pipeline.extractor.call_claude_api")
    def test_extraction(self, mock_claude):
        """Should extract entries from source"""
        # Mock Claude API response
        mock_claude.return_value = {
            "entries": [
                {
                    "name": "Jane Smith",
                    "type": "person",
                    "description": "Labor organizer"
                }
            ]
        }

        from atlas.pipeline import extractor

        result = extractor.extract(source="Sample article text")

        assert len(result) == 1
        assert result[0]["name"] == "Jane Smith"

        # Verify Claude was called
        mock_claude.assert_called_once()
```

---

## Frontend Testing (When Configured)

Frontend testing is not yet set up. When it is, use Vitest + React Testing Library.

### Basic Test Template

```tsx
// frontend/tests/components/EntryCard.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EntryCard } from '../../src/components/features/EntryCard'

describe('EntryCard', () => {
  const mockEntry = {
    id: '1',
    name: 'Test Org',
    description: 'Test description',
    city: 'Denver',
    state: 'CO',
    issue_areas: ['labor'],
    sources: [],
    active: true,
    created_at: '2026-03-20T10:00:00Z',
    updated_at: '2026-03-25T14:30:00Z'
  }

  it('should render entry name', () => {
    render(<EntryCard entry={mockEntry} />)
    expect(screen.getByText('Test Org')).toBeInTheDocument()
  })

  it('should render issue areas', () => {
    render(<EntryCard entry={mockEntry} />)
    expect(screen.getByText('labor')).toBeInTheDocument()
  })

  it('should call onClick when clicked', () => {
    const onClick = vitest.fn()
    render(<EntryCard entry={mockEntry} onClick={onClick} />)

    screen.getByText('Test Org').click()
    expect(onClick).toHaveBeenCalledWith(mockEntry)
  })
})
```

---

## Coverage Requirement

**Minimum: 90%** on all changed code.

```bash
cd backend

# Check coverage
pytest --cov=atlas --cov-report=term-missing --cov-fail-under=90

# HTML report (opens in browser)
pytest --cov=atlas --cov-report=html
open htmlcov/index.html
```

**Coverage includes:**
- Line coverage (was every line executed?)
- Branch coverage (all if/else paths?)

**Don't just hit 90%:**
- Write tests that describe behavior
- Test edge cases (null values, empty lists, errors)
- Test happy path AND unhappy paths

### Good Test Coverage

```python
def divide(a: int, b: int) -> float:
    """Divide a by b, raise ValueError if b is 0"""
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b

def test_divide_normal_case():
    assert divide(10, 2) == 5.0

def test_divide_by_zero_raises():
    with pytest.raises(ValueError):
        divide(10, 0)

def test_divide_negative():
    assert divide(-10, 2) == -5.0

def test_divide_with_floats():
    assert divide(7, 2) == 3.5
```

This tests:
- Happy path (normal operation)
- Error cases (division by zero)
- Edge cases (negative, floats)
- All branches covered

---

## Test-Driven Development (TDD)

Recommended approach for new features:

1. **Write the test first** (it fails)
2. **Write minimal code to pass the test**
3. **Refactor** to improve quality

Example:

```python
# Step 1: Write test (fails because function doesn't exist)
def test_deduplicator_merges_same_person():
    entries = [
        {"name": "Maria Gonzalez", "org": "Coop A"},
        {"name": "Maria Gonzalez", "org": "Coop A"}  # Same person
    ]
    result = dedup(entries)
    assert len(result) == 1

# Step 2: Write minimal code to pass
def dedup(entries):
    return entries[:1]  # Just return first (hacky but passes)

# Step 3: Refactor to proper implementation
def dedup(entries):
    seen = {}
    for entry in entries:
        key = (entry["name"], entry["org"])
        if key not in seen:
            seen[key] = entry
    return list(seen.values())
```

---

## Running Pre-Commit Checks

Git hooks run tests before you push:

```bash
# Pre-commit hook (before committing)
# - Format check
# - Lint
# - Type check

# Pre-push hook (before pushing to remote)
# - Full type check
# - Full test suite (90%+ required)
# - Build check

# If a hook fails, fix and try again
make quality  # Runs everything
```

---

## Debugging Tests

### Print Debugging

```python
def test_something():
    result = some_function()
    print(result)  # Will show in pytest output with -s flag
    assert result == expected
```

Run with output:
```bash
pytest tests/test_file.py -v -s
```

### Interactive Debugging (PDB)

```python
def test_something():
    result = some_function()
    import pdb; pdb.set_trace()  # Debugger stops here
    assert result == expected
```

Run with:
```bash
pytest tests/test_file.py -v -s  # Will drop into debugger
```

### Verbose Output

```bash
pytest -v                # Show each test
pytest -v -s            # Show output (print statements)
pytest -v --tb=short    # Shorter tracebacks
pytest -v --tb=long     # Longer tracebacks
```

---

## Common Issues

### Test Passes Locally, Fails in CI

Usually a timing issue or missing dependency:
- Mock external services (API calls, file access)
- Don't rely on system time being specific
- Ensure all dependencies are in `pyproject.toml`

### Test is Flaky (Sometimes Passes, Sometimes Fails)

Usually involves timing, randomness, or shared state:
- Use fixtures to isolate state
- Mock time if testing time-based logic
- Don't share databases between tests

### "No module named 'atlas'"

Make sure backend is installed in dev mode:
```bash
cd backend
pip install -e ".[dev]"
```

---

## See Also

- [Backend Development](./backend.md) — How to write the code
- [Code Quality](./code-quality.md) — Running checks
- [Workflow](./workflow.md) — Git workflow and CI/CD

---

Last updated: March 25, 2026
