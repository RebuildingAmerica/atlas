# Code Quality

[Docs](../README.md) > [Development](./README.md) > Code Quality

Quality gates and enforcement. How the hooks work, what they check, and how to fix common issues.

## Overview

Code quality is enforced by git hooks at three stages:

| Stage | Hook | Checks |
|---|---|---|
| Before commit | pre-commit | Format, lint, types (on staged files) |
| After commit | commit-msg | Commit message format |
| Before push | pre-push | Full types, full tests, build |

All checks must pass before code can be committed or pushed. This prevents broken code from reaching main.

## Pre-Commit Hook

Runs before every commit. Checks only the files you're committing.

**What it checks:**
1. **Code formatting** — Code follows consistent style
   - Python: `ruff format`
   - TypeScript: `prettier`

2. **Code linting** — No code smells or violations
   - Python: `ruff check`
   - TypeScript: `eslint`

3. **Type checking** — Types are correct
   - Python: `mypy`
   - TypeScript: `tsc`

**If it fails:**

```
error: code is not formatted
error: found 3 lint violations
error: 2 type errors
```

**To fix:**

```bash
# Auto-format
make format

# Auto-fix lint (some issues)
make lint-fix

# Fix type errors manually
# (or ask for help)

# Then try committing again
git commit -m "feat: ..."
```

**Example workflow:**

```bash
# 1. Make changes
echo "const x = 5" > file.ts

# 2. Stage changes
git add .

# 3. Try to commit
git commit -m "feat: add variable"

# ❌ Hook fails: formatting and type error
error: formatted output differs from input
error: missing type annotation on 'x'

# 4. Fix format
make format

# 5. Fix type error manually
# Change to: const x: number = 5

# 6. Stage again
git add .

# 7. Try commit again
git commit -m "feat: add variable"

# ✅ Success!
```

## Commit-Msg Hook

Validates that commit messages follow Conventional Commits format.

**Format:**
```
<type>(<scope>): <description>
```

**Valid types:**
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation
- `refactor` — Refactoring
- `test` — Tests
- `chore` — Dependencies, config
- `perf` — Performance
- `ci` — CI/CD changes
- `build` — Build changes

**Valid scopes:** (optional)
- `api`, `app`, `pipeline`, `db`, `taxonomy`, `devops`, `docs`

**If it fails:**

```
error: invalid commit message format
expected: type(scope): description
your message: fixed some stuff
```

**To fix:**

```bash
# Use --amend to fix the message
git commit --amend -m "fix(api): correct error handling"

# Then the commit goes through
```

**Examples that pass:**
```
✅ feat(pipeline): add query generation
✅ fix: handle null values
✅ docs: update API reference
✅ test(api): add 10 new tests
✅ refactor(app): simplify component
```

## Pre-Push Hook

Runs before pushing to the remote. Checks everything (not just staged files).

**What it checks:**
1. **Working directory is clean** — No uncommitted changes
2. **Full type checking** — All code, entire project
   - Python: `mypy atlas`
   - TypeScript: `pnpm run typecheck`

3. **Full test suite** — All tests pass, 90%+ coverage
   - Python: `pytest --cov-fail-under=90`

4. **Build succeeds** — Project compiles
   - App: `pnpm run build`

**If it fails:**

```
error: uncommitted changes detected
error: type checking failed (X errors)
error: 2 test failures
error: coverage dropped to 85% (need 90%)
```

**To fix:**

```bash
# Commit any uncommitted changes
git add .
git commit -m "fix: address review feedback"

# Fix type errors
cd api && mypy atlas --show-error-codes
# Fix manually

# Fix test failures
cd api && pytest -v
# Fix failing tests

# Improve coverage
# Add more tests to reach 90%

# Try pushing again
git push origin branch-name
```

**Note:** If the hook fails, your commit is already saved locally. You just can't push yet. Fix the issues, commit again, and push.

---

## Running Checks Manually

Don't wait for hooks to fail. Run checks before committing:

```bash
# Check everything
make quality

# Or individually

# Format check
make format-check     # Just check, don't change
make format           # Auto-format

# Lint check
make lint             # Check
make lint-fix         # Auto-fix what you can

# Type check
make typecheck

# Test
make test

# Full test with coverage
cd api && pytest --cov=atlas --cov-report=term-missing --cov-fail-under=90
```

---

## Common Lint Errors and Fixes

### Python (Ruff)

**Missing type annotation:**
```python
❌ def create_entry(name, description):
✅ def create_entry(name: str, description: str) -> dict:
```

**Unused import:**
```python
❌ import os, sys  # sys is unused
✅ import os
```

**Line too long (>100 chars):**
```python
❌ message = "This is a very long string that exceeds the maximum line length"
✅ message = (
    "This is a very long string that exceeds the maximum line length"
)
```

**Redefining built-in:**
```python
❌ id = "user-123"  # 'id' is built-in function
✅ user_id = "user-123"
```

**Auto-fix:**
```bash
cd api
ruff check . --fix
```

### TypeScript (ESLint)

**`any` type:**
```typescript
❌ const data: any = response.json()
✅ const data: Response = response.json()
```

**Missing type annotation:**
```typescript
❌ const handleClick = (event) => { ... }
✅ const handleClick = (event: React.MouseEvent) => { ... }
```

**Unused variable:**
```typescript
❌ const unused = getValue()
✅ const used = getValue()
```

**Auto-fix:**
```bash
cd app
pnpm run lint:fix
```

---

## Common Type Errors and Fixes

### Python (MyPy)

**Type mismatch:**
```python
❌ def get_age() -> int: return "25"
✅ def get_age() -> int: return 25
```

**Missing optional check:**
```python
❌ def process(name: str | None): return name.upper()
✅ def process(name: str | None):
       if name:
           return name.upper()
       return None
```

**Calling with wrong argument type:**
```python
❌ create_entry(name=123, description="test")  # name should be str
✅ create_entry(name="Test", description="test")
```

**Fix:** Read the error message and adjust your code. MyPy can't auto-fix types.

### TypeScript (TSC)

**Type mismatch:**
```typescript
❌ const age: number = "25"
✅ const age: number = 25
```

**Missing required property:**
```typescript
❌ const entry: Entry = { id: "1", name: "Test" }  // description missing
✅ const entry: Entry = { id: "1", name: "Test", description: "..." }
```

**Accessing optional property without check:**
```typescript
❌ function render(entry?: Entry) { return entry.name }
✅ function render(entry?: Entry) { return entry?.name }
```

**Fix:** Read the error and adjust. TypeScript can't auto-fix types.

---

## Coverage Requirements

**Minimum: 90%** on all changed code.

```bash
cd api

# Check coverage
pytest --cov=atlas --cov-report=term-missing --cov-fail-under=90

# Example output:
# atlas/models/entry.py      45    4    91%
# atlas/pipeline/dedup.py    87    9    90%
# ---------------------
# TOTAL                    450   45    90%
# ✅ Passed
```

**If you see:**
```
TOTAL                    450   50    88%
❌ Coverage must be at least 90.0%
```

**To fix:**

1. Identify lines not covered:
```bash
pytest --cov=atlas --cov-report=term-missing

# Shows:
# atlas/models/entry.py      45    4    91%    [missing lines: 12, 34, 56]
```

2. Write tests for those lines
3. Re-run coverage

**Good coverage = tests that describe behavior:**

```python
# Good: tests describe what should happen
def test_create_entry():
    entry = create(name="Test")
    assert entry["name"] == "Test"

def test_create_entry_with_none_description():
    entry = create(name="Test", description=None)
    assert entry["description"] is None

def test_create_entry_validates_state_code():
    with pytest.raises(ValueError):
        create(name="Test", state="TOOLONG")

# Bad: tests just check that code runs
def test_create_entry_runs():
    create(name="Test")  # No assertions
```

---

## Bypassing Hooks (Don't Do This)

If you absolutely must bypass a hook:

```bash
# Skip pre-commit hook
git commit -m "..." --no-verify

# Skip pre-push hook
git push --force-with-lease
```

**But:**
- This is dangerous
- Only do it if hook is broken (not your code)
- Tell the team
- Fix the hook or your code immediately after

**Better:** Ask for help fixing the real issue instead of bypassing.

---

## Setting Up Pre-Commit Locally

Hooks are configured in `.githooks/` and `.pre-commit-config.yaml`.

**If hooks aren't running:**

```bash
# Enable git hooks
git config core.hooksPath .githooks

# Make hooks executable
chmod +x .githooks/*

# Test hook
.githooks/pre-commit
```

---

## CI/CD Integration

All checks also run in CI (GitHub Actions) when you push:

```yaml
# .github/workflows/tests.yml
- name: Type Check
  run: make typecheck

- name: Lint
  run: make lint

- name: Tests
  run: make test

- name: Build
  run: make build
```

**If your PR shows a red X:** Check the CI logs to see which check failed. Fix locally and push again.

---

## Performance Tip

Pre-commit hooks can be slow. To speed up local development:

```bash
# Check only staged files (what pre-commit does)
cd api && ruff check --staged .

# Type check only changed files
cd api && mypy atlas/models/entry.py

# Run only one test
cd api && pytest tests/test_models.py::test_create_entry
```

Then run full `make quality` before pushing to ensure nothing breaks.

---

## See Also

- [Workflow](./workflow.md) — Git workflow and hooks
- [Testing](./testing.md) — Writing tests to improve coverage
- [Standards](../standards/README.md) — Code style standards

---

Last updated: March 25, 2026
