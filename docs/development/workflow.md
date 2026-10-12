# Development Workflow

[Docs](../README.md) > [Development](./README.md) > Workflow

Day-to-day development practices. How we branch, commit, test, and review code.

## Branch Naming

Use descriptive branch names with a prefix:

```
<type>/<description>
```

**Types:**

- `feature/` — Product, API, Scout, or data behavior that changes what someone
  can use, see, trust, or do.
- `fix/` — A narrow correction to broken, incorrect, or unsafe behavior.
- `chore/` — Maintenance, dependencies, tooling, tests, refactors, docs cleanup,
  and repo health work.

Local Git hooks block other branch prefixes by default. This keeps branch intent
obvious before review, makes automation and triage simpler, and reinforces that
docs/process updates should travel with the underlying `feature/`, `fix/`, or
`chore/` change instead of becoming after-the-fact cleanup.

## Documentation Belongs With The Change

Docs are not an afterthought and should not usually be split into a separate
branch or follow-up commit. When product behavior, developer workflow,
architecture, operations, API contracts, Scout behavior, or public/private data
boundaries change, update the relevant docs in the same branch and the same
reviewable change.

A docs-only change is the exception, not the default. Use it for correcting
existing guidance that is wrong, unclear, broken, or missing for behavior that
already exists. Do not use docs-only work to finish explaining a feature,
process, or contract that changed somewhere else.

**Examples:**

```bash
git checkout -b feature/search-by-issue-area
git checkout -b fix/entry-deduplication-crash
git checkout -b chore/add-pipeline-overview
git checkout -b chore/add-api-integration-tests
```

## Commit Messages

Use Conventional Commits format. Enforced by the `commit-msg` hook.

**Format:**

```
<type>(<scope>): <description>

[optional body]
```

**Types:** `feat` and `fix` for end-user behavior; `docs`, `chore`, and
`refactor` for documentation, tooling, tests and internal changes.

**Scopes:** `admin`, `api`, `app`, `scout`, `docs`, `dx`, or omit for a
cross-cutting change. Descriptions start with a capital letter. Bodies use short
prose paragraphs wrapped to 72 columns; the commit hook wraps them. Explain the
experience the change enables or protects.

Write the message to a file and stage only the intended paths in the same chain
as the commit:

```bash
git restore --staged . && git add <paths> && git commit -F <message-file>
```

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
   - Rebase if needed, then push again so the branch stays linear

7. **Merge when approved:**
   - GitHub lands to main through the repo's linear-history rules
   - Delete feature branch

## Shell Scripts

Repo shell scripts should default to POSIX `sh`. Use `#!/usr/bin/env sh` for
scripts that do not require Bash-specific syntax, and invoke those scripts with
`sh` from package scripts, workflows, and other shell entrypoints.

Use `#!/usr/bin/env bash` only when the script needs Bash features such as
`[[ ... ]]`, regex captures, here-strings, arrays, or `BASH_SOURCE`. Git hooks
currently use Bash because they rely on those features for validation and
operator-facing output.

## Git Hooks

The project uses local Git hooks to automate quality checks and protect the
mainline branch:

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

**Don't bypass it:** Don't use `git commit --no-verify`. The hooks are your
safety net.

### Commit-Msg Hook

Validates commit message format (Conventional Commits).

**If it fails:**

- Message doesn't match `type(scope): description` format
- Fix it: `git commit --amend -m "feat(scope): new message"`

### Pre-Push Hook

Runs before pushing to remote. Checks:

- Clean working directory (no unstaged changes)
- Full type checking (mypy + tsc)
- Full test suite (with 100% coverage)

**If it fails:**

- Fix the issue
- Commit if needed
- Try pushing again

**Purpose:** Prevent broken code from going to main.

**Don't bypass it:** Don't use `git push --force` on main. If you must, get team
approval.

## Code Review Expectations

### What Reviewers Look For

1. **Does it work?** Tests pass, code compiles, no obvious bugs
2. **Does it follow standards?** Commit messages, code style, conventions (see
   [Standards](../standards/README.md))
3. **Is it understandable?** Clear variable names, functions do one thing,
   comments where needed
4. **Is it maintainable?** No copy-paste code, reuses existing patterns, no
   technical debt
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
- Make changes and commit; rebase the branch before pushing if needed
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

**Coverage requirement:** 100% on all changed files.

## GitHub Actions

| Workflow                         | Purpose                                                                                | When it runs                                              |
| -------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| CI                               | Tests, types, lint, API contracts, generated files, documentation and secret scanning. | Pull requests, weekly, and before releases.               |
| Deploy Staging                   | Checks staging configuration and runs the selected private release operation.          | Main pushes run `doctor`; release operations are manual.  |
| Deploy Production                | Checks production configuration and publishes, verifies or promotes a release.         | Release tags run `doctor`; release operations are manual. |
| Roll Back Production             | Restores retained production routing from a previous release run.                      | Manual, using the retained run ID.                        |
| Production Canary                | Checks the public app, sitemap, PDS, catalog and search.                               | Hourly or manual.                                         |
| Scout Release                    | Publishes a versioned Scout package and Homebrew formula.                              | `atlas-scout-v*.*.*` tags.                                |
| Protected Cloudflare publication | Implements the shared staging, production and rollback jobs.                           | Called by those workflows.                                |
| Build Cloudflare Python wheels   | Builds native Python dependencies for the Workers runtime.                             | Native recipe changes on main or manual.                  |

Use **CI** for code verification, **Deploy Staging** for private release checks,
and **Deploy Production** for the public release. A `doctor` result checks
configuration; it does not deploy the site. Exact operations and required
settings are documented in
[Cloudflare publication](../deployment/cloudflare-publication.md). Rollback and
public health checks remain independent of release approval.

---

## See Also

- [Code Quality](./code-quality.md) — Detailed guide to fixing lint/type errors
- [Standards](../standards/README.md) — Code style and conventions
- [Testing](./testing.md) — How to write tests

---

Last updated: October 12, 2026
