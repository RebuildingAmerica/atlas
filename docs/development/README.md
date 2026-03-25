# Development Guide

[Docs](../README.md) > Development

How to build and maintain the project. Reference these docs when working on features, tests, or quality.

## Getting Started

If you're new to the project, start here:
1. [Prerequisites](../getting-started/prerequisites.md)
2. [Quick Start](../getting-started/quick-start.md)
3. [Project Structure](../getting-started/project-structure.md)
4. Then come back here

## Development Docs

### Workflow
Day-to-day development practices. Branch naming, commits, PR process, quality checks.

→ [Read: Workflow](./workflow.md)

### Backend Development
Building Python features. Adding endpoints, models, pipeline steps, issue areas.

→ [Read: Backend Development](./backend.md)

### Frontend Development
Building React features. Adding pages, components, hooks.

→ [Read: Frontend Development](./frontend.md)

### Testing
Test strategies for both stacks. Running tests, coverage requirements.

→ [Read: Testing](./testing.md)

### Code Quality
Quality gates and tooling. Pre-commit hooks, linting, formatting, type checking.

→ [Read: Code Quality](./code-quality.md)

## Quick Reference

### Running Locally

**Full stack:**
```bash
make dev
```

**Backend only:**
```bash
make dev-backend
```

**Frontend only:**
```bash
make dev-frontend
```

### Quality Checks

**Check everything:**
```bash
make quality
```

**Format code:**
```bash
make format
```

**Lint code:**
```bash
make lint
```

**Type check:**
```bash
make typecheck
```

**Run tests:**
```bash
make test
```

### Database

**Initialize schema:**
```bash
make db-init
```

**Reset (WARNING: deletes all data):**
```bash
make db-reset
```

## Before You Commit

1. Make sure all quality checks pass:
   ```bash
   make quality
   ```

2. If they don't, fix them:
   ```bash
   make format lint-fix
   make typecheck  # Fix manually
   ```

3. Review your changes:
   ```bash
   git diff
   git status
   ```

4. Commit with a proper message (see [Workflow](./workflow.md)):
   ```bash
   git commit -m "feat(backend): add new endpoint for searching entries"
   ```

5. Push and create a PR:
   ```bash
   git push origin feature-branch-name
   ```

## Common Tasks

| I need to... | Read this |
|---|---|
| Understand how to work on a feature | [Workflow](./workflow.md) |
| Add a new API endpoint | [Backend Development](./backend.md) |
| Add a new database table | [Backend Development](./backend.md) |
| Add a new pipeline step | [Backend Development](./backend.md) |
| Add a new issue area | [Backend Development](./backend.md) |
| Add a new page | [Frontend Development](./frontend.md) |
| Add a new component | [Frontend Development](./frontend.md) |
| Fix a type error | [Code Quality](./code-quality.md) |
| Write tests | [Testing](./testing.md) |

## Architecture Review

Before starting work, understand how the system is built:
- [System Overview](../architecture/system-overview.md)
- [Pipeline Architecture](../architecture/pipeline.md)
- [API Reference](../architecture/api-reference.md)
- [Frontend Architecture](../architecture/frontend.md)

## Standards to Follow

All code must follow the project standards:
- [Standards Index](../standards/README.md)
- [Commit Messages](../standards/commit-messages.md)
- [Code Style](../standards/code-style.md)
- [API Conventions](../standards/api-conventions.md)

## Getting Help

- Check the relevant doc section above
- Look for `TODO` or `FIXME` comments in code
- Review git commit history for examples
- Ask on the team channel

---

Last updated: March 25, 2026
