# Development Workflow

[Docs](../README.md) > [Development](./README.md) > Workflow

Day-to-day development practices. How we branch, commit, test, and review code.

## Branch Naming

Use descriptive branch names with a prefix:

```
<type>/<description>
```

**Types:**
- `feat/` — New feature
- `fix/` — Bug fix
- `refactor/` — Code refactoring (no feature change)
- `docs/` — Documentation only
- `test/` — Adding or updating tests
- `chore/` — Dependency, tooling, config changes

**Examples:**
```bash
git checkout -b feat/search-by-issue-area
git checkout -b fix/entry-deduplication-crash
git checkout -b docs/add-pipeline-overview
git checkout -b test/add-api-integration-tests
```

## Commit Messages

Use Conventional Commits format. Enforced by pre-commit hook.

**Format:**
```
<type>(<scope>): <description>

[optional body]
```

**Types:**
- `feat` — A new feature
- `fix` — A bug fix
- `docs` — Documentation only
- `refactor` — Code refactoring
- `test` — Adding or updating tests
- `chore` — Dependency, tooling, config changes
- `perf` — Performance improvements

**Scopes:** (optional but recommended)
- `backend` — Backend changes
- `frontend` — Frontend changes
- `pipeline` — Pipeline/discovery changes
- `db` — Database/schema changes
- `taxonomy` — Issue areas or search terms
- `devops` — Docker, Makefile, CI/CD
- `docs` — Documentation

**Examples:**

```bash
# New feature
git commit -m "feat(api): add full-text search endpoint"

# Bug fix
git commit -m "fix(pipeline): handle null values in extraction"

# With body for more context
git commit -m "feat(backend): add entry deduplication logic

Deduplicates entries by fuzzy matching on name and location.
Merges sources from duplicate entries into single record."

# Documentation
git commit -m "docs: add pipeline architecture overview"

# Test
git commit -m "test(backend): add 15 new tests for deduplicator"
```

**Avoid:**
- ❌ `Updated code`
- ❌ `WIP`
- ❌ `fixes`
- ❌ `asdf`

**Instead:**
- ✅ `feat(pipeline): implement source deduplication`
- ✅ `fix(api): handle empty query string`
- ✅ `docs: clarify deployment process`

The pre-commit hook will reject non-conformant messages.

## Pull Request Process

1. **Create a branch** from main:
   ```bash
   git checkout -b feat/your-feature
   ```

2. **Make your changes** in small, logical commits:
   ```bash
   # Make change
   git add .
   git commit -m "feat(scope): description"

   # Make another change
   git add .
   git commit -m "test(scope): add tests for new feature"
   ```

3. **Run quality checks locally** before pushing:
   ```bash
   make quality
   ```

   If checks fail, fix them:
   ```bash
   make format lint-fix
   make typecheck  # Fix manually if needed
   make test
   ```

4. **Push your branch:**
   ```bash
   git push origin feat/your-feature
   ```

5. **Create a Pull Request** on GitHub:
   - Link any related issues
   - Describe what you changed and why
   - Request reviewers

6. **Address review feedback:**
   - Make requested changes
   - Commit with descriptive message
   - Push again (don't rebase, let history show iteration)

7. **Merge when approved:**
   - GitHub merges to main
   - Delete feature branch

## Git Hooks

The project has three git hooks that automate quality checks:

### Pre-Commit Hook
Runs before every commit. Checks:
- Code formatting (ruff format, prettier)
- Linting (ruff check, eslint)
- Type safety (mypy, tsc)

**If it fails:**
1. Hook shows you the errors
2. Fix them: `make format lint-fix`
3. Type errors: fix manually then try again
4. Re-run: `git commit` again

**Don't bypass it:** Don't use `git commit --no-verify`. The hooks are your safety net.

### Commit-Msg Hook
Validates commit message format (Conventional Commits).

**If it fails:**
- Message doesn't match `type(scope): description` format
- Fix it: `git commit --amend -m "feat(scope): new message"`

### Pre-Push Hook
Runs before pushing to remote. Checks:
- Clean working directory (no unstaged changes)
- Full type checking (mypy + tsc)
- Full test suite (with 90%+ coverage)

**If it fails:**
- Fix the issue
- Commit if needed
- Try pushing again

**Purpose:** Prevent broken code from going to main.

**Don't bypass it:** Don't use `git push --force` on main. If you must, get team approval.

## Code Review Expectations

### What Reviewers Look For

1. **Does it work?** Tests pass, code compiles, no obvious bugs
2. **Does it follow standards?** Commit messages, code style, conventions (see [Standards](../standards/README.md))
3. **Is it understandable?** Clear variable names, functions do one thing, comments where needed
4. **Is it maintainable?** No copy-paste code, reuses existing patterns, no technical debt
5. **Is it complete?** Code + tests + docs all updated

### Code Review Checklist for Authors

Before requesting review:

- [ ] All quality checks pass locally (`make quality`)
- [ ] Tests are added/updated for new behavior
- [ ] Commit messages are clear and follow conventions
- [ ] No unrelated changes (keep PRs focused)
- [ ] Documentation is updated if API/behavior changed
- [ ] No debug code or commented-out code
- [ ] Type annotations are present (Python/TypeScript)

### Responding to Review Feedback

- Don't be defensive — reviewers are helping
- Ask for clarification if feedback is unclear
- Make changes and commit (don't rebase history)
- Reply to each comment (acknowledge, explain, or ask for help)
- Re-request review when done

## Testing Before Commit

**Must pass locally before pushing:**

```bash
# Run everything
make quality

# Or individually:
make format-check    # Check formatting
make lint            # Check lint
make typecheck       # Check types
make test            # Run tests with coverage
```

**Coverage requirement:** 90%+ on all changed files.

## Deployment Notes

Currently no automated deployment. To deploy:

1. Ensure main branch is passing all checks
2. Tag the commit: `git tag v0.1.0`
3. Push tag: `git push origin v0.1.0`
4. Build Docker images: `make docker-build`
5. Deploy manually or via your deployment tool

---

## See Also

- [Code Quality](./code-quality.md) — Detailed guide to fixing lint/type errors
- [Standards](../standards/README.md) — Code style and conventions
- [Testing](./testing.md) — How to write tests

---

Last updated: March 25, 2026
