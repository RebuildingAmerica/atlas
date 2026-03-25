# Engineering Standards

[Docs](../README.md) > Standards

Standards that apply across the project. Follow these before choosing a pattern or naming convention.

## Standards Documents

### Commit Messages
How we format commit messages. Enforced by pre-commit hook.

→ [Read: Commit Messages](./commit-messages.md)

### Code Style
Python and TypeScript style rules. Enforced by ruff and eslint.

→ [Read: Code Style](./code-style.md)

### API Conventions
REST API design standards. Base path, pagination, errors, versioning.

→ [Read: API Conventions](./api-conventions.md)

## Quick Reference

### Commit Message Format

```
<type>(<scope>): <description>

[optional body]
```

Valid types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`
Valid scopes: `backend`, `frontend`, `pipeline`, `db`, `taxonomy`, `devops`, `docs`

Example:
```
feat(pipeline): add query generation step

Generates ~40 search queries per location + issue area.
Queries target different source types (news, nonprofits, etc).
```

### Python Style

- **Line length:** 100 characters
- **Type annotations:** Required on all functions
- **Formatting:** `ruff format .`
- **Linting:** `ruff check .`
- **Type checking:** `mypy atlas --strict`
- **Imports:** One per line, sorted

### TypeScript Style

- **Strict mode:** Enabled
- **Type annotations:** Required, no `any`
- **Imports:** Consistent, no dynamic imports
- **Formatting:** `prettier`
- **Linting:** `eslint`

### API Endpoints

**Base path:** `/api/v1`

**Method conventions:**
- `GET` — Fetch data (idempotent)
- `POST` — Create new resource
- `PUT` — Update resource
- `DELETE` — Delete resource

**Pagination:**
- Query params: `page`, `page_size`
- Response includes: `total`, `has_more`

**Error format:**
```json
{
  "error": {
    "type": "NOT_FOUND",
    "message": "Entry not found",
    "detail": "No entry with id=123"
  }
}
```

---

## When to Reference Each Standard

| I need to... | Read this |
|---|---|
| Understand commit message format | [Commit Messages](./commit-messages.md) |
| Format code consistently | [Code Style](./code-style.md) |
| Design a REST endpoint | [API Conventions](./api-conventions.md) |

---

## Enforcement

All standards are enforced automatically:

- **Pre-commit hook** — Checks format, lint, types on every commit
- **ESLint + Ruff** — Automated linters catch violations
- **Pre-push hook** — Full test suite and build before pushing
- **Code review** — Reviewers check for standard compliance

If your code doesn't follow standards, the hooks will reject it. Fix it and try again.

---

## Exceptions

If a standard doesn't fit your use case:

1. **Document why** — Leave a comment explaining the exception
2. **Link to the standard** — Help future developers understand
3. **Plan to converge** — Describe when/how you'll align with the standard

**Example:**
```python
# TODO: This function lacks type annotations because it uses a third-party
# library that doesn't expose types. When we upgrade the library (v2.0),
# we should remove this comment and add annotations.
# See standards/code-style.md#type-annotations
def legacy_function(data):
    ...
```

---

## Adding New Standards

When you identify a pattern that needs standardization:

1. **Propose it** — Discuss with the team
2. **Document it** — Create a standard document
3. **Enforce it** — Add to hooks or linters if possible
4. **Apply it** — Update existing code to follow new standard

---

Last updated: March 25, 2026
