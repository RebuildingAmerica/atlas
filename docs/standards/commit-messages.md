# Commit Messages

[Docs](../README.md) > [Standards](./README.md) > Commit Messages

How we format commit messages. Follows Conventional Commits. Enforced by pre-commit hook.

## Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

## Type

What kind of change is this?

| Type | Meaning | Example |
|---|---|---|
| `feat` | New feature | `feat: add search endpoint` |
| `fix` | Bug fix | `fix: handle null entries in list` |
| `docs` | Documentation only | `docs: update README` |
| `refactor` | Code refactoring (no feature change) | `refactor: simplify entry deduplication` |
| `test` | Adding or updating tests | `test: add 15 tests for pipeline` |
| `chore` | Dependencies, config, tooling | `chore: upgrade FastAPI to 0.100` |
| `perf` | Performance improvement | `perf: add database index on state` |
| `ci` | CI/CD changes | `ci: add GitHub Actions workflow` |
| `build` | Build system changes | `build: update Docker Compose config` |

## Scope (Optional but Recommended)

What part of the code does this change?

| Scope | Applies to |
|---|---|
| `api` | Python/FastAPI code |
| `app` | React/TypeScript code |
| `pipeline` | Autodiscovery pipeline |
| `db` | Database/schema |
| `taxonomy` | Issue areas or search terms |
| `devops` | Docker, Makefile, infrastructure |
| `docs` | Documentation files |

## Description

Short (under 50 chars), imperative, present tense.

**Good:**
- `add search endpoint`
- `fix null pointer exception`
- `update README with quick start`
- `handle duplicate entries`

**Bad:**
- `added new feature` (past tense)
- `fixes bug` (present tense but sounds awkward)
- `This adds a new feature for searching` (too long)
- `asdf` (not descriptive)

## Body (Optional)

Explain the "why" and "how". Keep to 72 characters per line.

```
feat(pipeline): add query generation step

The autodiscovery pipeline needs to generate search queries from a
location and set of issue areas. This commit adds Step 1 of 6.

Queries are generated for different source types: news articles,
nonprofit directories, organizational websites, and academic papers.
For each issue area, we generate 5-6 targeted queries.

See the-atlas-system-design.md for the complete spec.
```

## Footer (Optional)

Reference issues or breaking changes.

```
fix(api): change entry response format

Breaking change: Entry.issue_area is now Entry.issue_areas (plural,
array instead of string).

Fixes #123
Closes #456
```

## Examples

### Feature

```
feat(api): add entries search endpoint

Adds GET /api/v1/entries?q=query for full-text search.
Supports filtering by state and issue area.

Endpoint returns paginated results with sorting options.
```

### Bug Fix

```
fix(pipeline): handle null descriptions in extraction

The extractor was crashing when Claude returned null descriptions.
Now we default to empty string and log a warning.
```

### Documentation

```
docs: add pipeline architecture overview

Explains the 6-step pipeline with diagrams and examples.
Links to implementation files for each step.
```

### Test

```
test(api): add 20 tests for entry model

Tests CRUD operations, validation, and edge cases.
Coverage for entry.py increased from 65% to 92%.
```

### Refactoring

```
refactor(app): extract search form to component

Moves SearchForm from SearchPage to separate component.
Improves reusability and testability.
No behavior change.
```

### Chore

```
chore: upgrade dependencies

- FastAPI 0.95 -> 0.100
- Pydantic 2.0 -> 2.5
- React 18 -> 18.3

All tests passing.
```

## Rules

### DO

- Use imperative mood ("add" not "adds" or "added")
- Use present tense
- Capitalize first word
- Reference issues (Fixes #123)
- Explain "why" in the body
- Keep description under 50 chars

### DON'T

- Include ticket numbers in description (`ATLAS-123: add feature` ❌)
- Use past tense (`added feature` ❌)
- Use overly casual tone (`yo added this thing` ❌)
- Leave placeholder messages (`WIP` or `asdf` ❌)

## How Conventional Commits Help

1. **Semantic versioning** — Type determines version bump
   - `feat` → Minor version (0.1.0 → 0.2.0)
   - `fix` → Patch version (0.1.0 → 0.1.1)
   - `BREAKING CHANGE` → Major version (0.1.0 → 1.0.0)

2. **Changelog generation** — Automatically group commits by type

3. **Git history clarity** — Easy to skim commit log and find related changes

4. **Code review context** — Clear what changed and why

## Enforcement

The pre-commit hook validates every commit:

```bash
git commit -m "added new feature"
# ❌ error: invalid commit message format
# expected: type(scope): description

git commit -m "feat: add new feature"
# ✅ success
```

If the hook rejects your message:

```bash
git commit --amend -m "feat(api): add new endpoint"
```

---

Last updated: March 25, 2026
