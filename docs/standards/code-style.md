# Code Style

[Docs](../README.md) > [Standards](./README.md) > Code Style

Python and TypeScript code style rules. Enforced by ruff, prettier, and eslint.

## Python Code Style

### Line Length

**Maximum: 100 characters**

```python
# ✅ Good: under 100 chars
entries = db.query_entries(
    location="Kansas City, MO",
    issue_areas=["labor", "housing"]
)

# ❌ Bad: exceeds 100 chars
entries = db.query_entries(location="Kansas City, MO", issue_areas=["labor", "housing"])
```

### Type Annotations

**Required on all functions.**

```python
# ✅ Good: all parameters and return type annotated
def create_entry(
    name: str,
    description: str,
    state: str | None = None
) -> dict[str, Any]:
    ...

# ❌ Bad: missing type annotations
def create_entry(name, description, state=None):
    ...

# ❌ Bad: missing return type
def create_entry(name: str, description: str):
    ...
```

### Import Order

1. Standard library
2. Third-party packages
3. Local imports

Sorted alphabetically within each group. One per line.

```python
# ✅ Good
import asyncio
import json
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import aiosqlite

from atlas.models import entry
from atlas.schemas import EntryResponse
```

```python
# ❌ Bad
from fastapi import APIRouter, HTTPException  # Third-party before std
import json
from atlas.models import entry  # Not grouped
import asyncio
```

### Variable Naming

Use `snake_case` for variables and functions.

```python
# ✅ Good
entry_name = "Test"
is_active = True
get_entries_by_state()

# ❌ Bad
entryName = "Test"  # camelCase
IsActive = True     # PascalCase
GetEntriesByState() # PascalCase
```

### Class Naming

Use `PascalCase` for classes.

```python
# ✅ Good
class EntryModel:
    ...

class DatabaseConnection:
    ...

# ❌ Bad
class entry_model:
    ...

class database_connection:
    ...
```

### Constant Naming

Use `UPPER_SNAKE_CASE` for constants.

```python
# ✅ Good
MAX_PAGE_SIZE = 100
DEFAULT_LOCATION = "United States"
ISSUE_AREAS = ["housing", "labor"]

# ❌ Bad
max_page_size = 100
defaultLocation = "United States"
```

### Docstrings

Use triple-quote docstrings for modules, classes, and functions.

```python
# ✅ Good
def create_entry(name: str, description: str) -> dict:
    """Create a new entry in the database.

    Args:
        name: Entry name (required)
        description: Entry description (required)

    Returns:
        Dictionary with entry data including id, created_at

    Raises:
        ValueError: If name or description is empty
    """
    ...

# ❌ Bad
def create_entry(name, description):
    # Create entry
    ...
```

### Formatting

Use `ruff format` to auto-format. It enforces:

```python
# String quotes: double quotes
message = "Hello"  # ✅ not 'Hello'

# Trailing commas in multiline
data = {
    "name": "Test",
    "state": "KS",  # ✅ trailing comma
}

# Blank lines
def function1():
    pass


def function2():  # ✅ Two blank lines between functions
    pass
```

Run:
```bash
cd api
ruff format .
```

---

## TypeScript Code Style

### Line Length

**Maximum: 100 characters** (soft limit, can exceed for long strings)

```typescript
// ✅ Good: readable and under 100
interface EntryCardProps {
  entry: Entry
  onClick?: (id: string) => void
}

// ❌ Bad: hard to read
interface EntryCardProps { entry: Entry; onClick?: (id: string) => void }
```

### Type Annotations

**Required on all functions and variables.**

```typescript
// ✅ Good: all types explicitly annotated
function createEntry(
  name: string,
  description: string,
  state?: string
): Entry {
  ...
}

const entries: Entry[] = []

// ❌ Bad: implicit types
function createEntry(name, description, state) {
  ...
}

const entries = []  // Type is inferred, but better to be explicit
```

### No `any` Type

**Avoid `any`. Use `unknown` if you must.**

```typescript
// ✅ Good: specific type
function handleResponse(data: Entry): void {
  console.log(data.name)
}

// ❌ Bad: too loose
function handleResponse(data: any): void {
  console.log(data.something)  // Could be wrong property
}

// ⚠️ Acceptable: when type is truly unknown
function parseJSON(text: string): unknown {
  return JSON.parse(text)
}
```

### Variable Naming

Use `camelCase` for variables and functions.

```typescript
// ✅ Good
const entryName = "Test"
const isActive = true
function getEntriesByState() { ... }

// ❌ Bad
const entry_name = "Test"       // snake_case
const EntryName = "Test"        // PascalCase
const ENTRY_NAME = "Test"       // UPPER_CASE
```

### Type vs Interface

Use `type` for type aliases, `interface` for object shapes.

```typescript
// ✅ Good: interface for objects
interface Entry {
  id: string
  name: string
}

// ✅ Good: type for unions or aliases
type IssueArea = 'housing' | 'labor' | 'climate'

// ❌ Bad: interface for union
interface IssueArea = 'housing' | 'labor'  // Syntax error

// ❌ Bad: type for object (works but less clear)
type Entry = {
  id: string
  name: string
}
```

### Imports

Sort imports, group by source.

```typescript
// ✅ Good
import { useState, useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'
import classNames from 'classnames'

import { Button } from '../components/ui/Button'
import { api } from '../lib/api'
import type { Entry } from '../types/entry'

// ❌ Bad
import classNames from 'classnames'
import { api } from '../lib/api'
import { Button } from '../components/ui/Button'
import { useState } from 'react'
import type { Entry } from '../types/entry'
```

### Destructuring

Use destructuring when accessing multiple properties.

```typescript
// ✅ Good
function EntryCard({ entry, onClick }: EntryCardProps) {
  const { name, state, issue_areas } = entry
  return <div>{name}</div>
}

// ❌ Bad
function EntryCard(props) {
  return <div>{props.entry.name}</div>
}
```

### Arrow Functions

Use arrow functions for callbacks and simple functions.

```typescript
// ✅ Good: arrow function
const handleClick = () => {
  // ...
}

const entries = data.map((entry) => entry.name)

// ✅ Good: function declaration for complex logic
function complexCalculation(): number {
  // ...
}

// ❌ Bad: mixing styles inconsistently
const handleClick = function () {
  // ...
}
```

### String Formatting

Use template literals with backticks, not concatenation.

```typescript
// ✅ Good: template literal
const message = `Hello, ${name}! You're in ${city}, ${state}`

// ❌ Bad: concatenation
const message = "Hello, " + name + "! You're in " + city + ", " + state
```

### Formatting and Linting

Use `prettier` and `eslint` to enforce.

Run:
```bash
cd app
pnpm run format      # Auto-format
pnpm run lint:fix    # Auto-fix lint issues
```

---

## Both Languages

### Comments

Write comments that explain "why", not "what".

```python
# ❌ Bad: obvious what the code does
count = 0  # Set count to 0

# ✅ Good: explains why
# Start at 0 because entry IDs are 1-indexed
count = 0
```

### Naming Clarity

Names should reveal intent.

```python
# ❌ Bad: unclear what data contains
data = fetch_from_api()

# ✅ Good: clear what we're getting
entries = fetch_entries_by_state(state)
```

### Single Responsibility

Functions should do one thing.

```python
# ❌ Bad: creates AND saves AND logs
def create_entry(name):
    entry = Entry(name=name)
    db.save(entry)
    logger.info(f"Created {name}")
    send_notification(entry)
    return entry

# ✅ Good: focused on creation
def create_entry(name: str) -> Entry:
    return Entry(name=name)
```

### No Magic Numbers

Use named constants.

```python
# ❌ Bad: what is 90?
if coverage > 90:
    ...

# ✅ Good: intention is clear
MIN_COVERAGE = 90
if coverage > MIN_COVERAGE:
    ...
```

---

## Pre-Commit Hook

All formatting and linting are checked automatically:

```bash
git add .
git commit -m "feat: add something"

# Hook runs:
# ✅ ruff format . → passes
# ✅ prettier . → passes
# ✅ ruff check . → passes
# ✅ eslint . → passes
# ✅ mypy atlas → passes
# ✅ tsc → passes

# Commit succeeds
```

If any check fails:

```bash
# Hook shows error
❌ Code is not formatted

# Fix it
make format

# Stage again
git add .

# Try commit again
git commit -m "feat: add something"
```

---

## See Also

- [Code Quality](../development/code-quality.md) — Common errors and fixes
- [Commit Messages](./commit-messages.md) — How to write good commits

---

Last updated: March 25, 2026
