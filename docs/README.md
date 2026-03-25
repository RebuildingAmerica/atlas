# The Atlas Documentation

Welcome to The Atlas documentation hub. This is your guide to understanding, developing, and contributing to the project.

## Quick Navigation

Start here based on what you need:

- **New to the project?** → [Getting Started](./getting-started/README.md)
- **Understanding the system?** → [Architecture](./architecture/README.md)
- **Building features?** → [Development](./development/README.md)
- **Maintaining code quality?** → [Standards](./standards/README.md)
- **Design docs?** → [Design](./design/README.md)

---

## Documentation Structure

### Getting Started
A one-way ramp from zero to running. Start here if you're new to the project.

- [Getting Started](./getting-started/README.md) — Overview and what you need
- [Prerequisites](./getting-started/prerequisites.md) — Install Python, Node, Docker
- [Quick Start](./getting-started/quick-start.md) — Clone, setup, run in 4 steps
- [Project Structure](./getting-started/project-structure.md) — Tour of the codebase

### Architecture
How the system is built. Reference these to understand what exists and how pieces fit together.

- [Architecture Overview](./architecture/README.md) — Hub for all architecture docs
- [System Overview](./architecture/system-overview.md) — High-level layers and flow
- [Data Model](./architecture/data-model.md) — Tables, fields, and relationships
- [Pipeline Architecture](./architecture/pipeline.md) — The 6-step autodiscovery pipeline
- [Frontend Architecture](./architecture/frontend.md) — TanStack Start, routes, and SSR strategy
- [API Reference](./architecture/api-reference.md) — REST endpoints and schemas

### Development
How to build and maintain the project. Follow these when making changes.

- [Development Guide](./development/README.md) — Hub for all development docs
- [Workflow](./development/workflow.md) — Day-to-day development practices
- [Backend Development](./development/backend.md) — Adding models, endpoints, pipeline steps
- [Frontend Development](./development/frontend.md) — Adding routes, components, hooks
- [Testing](./development/testing.md) — Test strategies and running tests
- [Code Quality](./development/code-quality.md) — Quality gates and tooling

### Standards
Engineering standards that apply across the project. Follow these before choosing a pattern.

- [Standards Index](./standards/README.md) — Hub for all standards
- [Commit Messages](./standards/commit-messages.md) — Conventional commit format
- [Code Style](./standards/code-style.md) — Python and TypeScript style rules
- [API Conventions](./standards/api-conventions.md) — REST API design standards

### Design
Product vision, system design, and taxonomy. Reference documents that define what we're building.

- [Design Hub](./design/README.md) — Links to all design docs
- [The Atlas Product Vision](../the-atlas-product.md) — Problem, solution, users, and go-to-market
- [System Design](../the-atlas-system-design.md) — Architecture, data model, and constraints
- [Issue Area Taxonomy](../the-atlas-taxonomy.md) — Categories and issue area definitions

---

## About This Project

**The Atlas** is a national directory and autodiscovery engine for organizations, people, and initiatives working on transformative change across America.

**Tech Stack:**
- Backend: Python 3.12 + FastAPI + SQLite (FTS5)
- Frontend: TanStack Start (React + TypeScript)
- AI: Anthropic Claude API for extraction
- DevOps: Docker Compose, Makefile, git hooks

**Current Phase:** Phase 1 (Scaffold)

The platform is in early development. Core APIs and database schema are in place. The autodiscovery pipeline is scaffolded with all 6 steps stubbed. Frontend is built out with routing and basic components. See individual docs for what's implemented vs. what's pending.

---

## Getting Help

- Check the relevant section above for docs
- Search for `TODO` or `FIXME` comments in code to understand what's pending
- Review git commit history for examples of how things are done
- Ask questions on the team channel

---

## Contributing

All changes must follow [Standards](./standards/README.md) and pass quality gates. See [Development Workflow](./development/workflow.md) for process details.

Quality is enforced automatically:
- Commit hooks verify formatting, linting, types
- Pre-push hooks run full test suite
- All code, tests, and docs must agree

---

Last updated: March 25, 2026
