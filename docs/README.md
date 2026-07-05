# The Atlas Documentation

Welcome to the Atlas documentation hub. These docs follow
[Diátaxis](https://diataxis.fr/): every page is exactly one of four kinds — a
**tutorial**, a **how-to guide**, **reference**, or **explanation** — so you can
find what you need by what you're trying to do. How we apply it:
[Documentation standard](./standards/documentation.md).

> [!NOTE] Atlas is in the middle of a Mintlify docs cutover for the public API
> docs. The new Mintlify project lives in
> [`../mintlify/`](../mintlify/docs.json), while this `docs/` tree remains the
> source of truth for contributor, architecture, and deployment documentation.

## Find docs by what you need

| When you want to…                  | Mode             | Start here                                                                                                                                                                      |
| ---------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Learn the project from zero        | **Tutorial**     | [Getting Started](./getting-started/README.md)                                                                                                                                  |
| Accomplish a specific task         | **How-to guide** | [Development](./development/README.md) · [Deployment](./deployment/README.md) · [Runbooks](./runbooks/)                                                                         |
| Look a fact up quickly             | **Reference**    | [Data Model](./architecture/data-model.md) · [API Reference](./architecture/api-reference.md) · [Standards](./standards/README.md)                                              |
| Understand why it's built this way | **Explanation**  | [Experience First](./experience-first.md) · [Product Vision](./the-atlas-product.md) · [Product PRDs](./product/prds/README.md) · [System Design](./the-atlas-system-design.md) |

---

## The four modes

### Tutorials — learning-oriented

A one-way ramp from zero to a running project. Start here if you're new.

- [Getting Started](./getting-started/README.md) — Overview and what you need
- [Prerequisites](./getting-started/prerequisites.md) — Install Python, Node,
  Docker
- [Quick Start](./getting-started/quick-start.md) — Clone, set up, and run
- [Project Structure](./getting-started/project-structure.md) — A tour of the
  codebase

### How-to guides — task-oriented

Recipes for getting a specific job done. Reach for these when you know what you
want to do.

- [Development Workflow](./development/workflow.md) — Day-to-day practices,
  branches, PRs
- [API Development](./development/api.md) — Add models, endpoints, pipeline
  steps
- [App Development](./development/app.md) — Add routes, components, hooks
- [Testing](./development/testing.md) — Write and run tests
- [Code Quality](./development/code-quality.md) — Pass the quality gates
- [Deployment](./deployment/README.md) — Production deploys, releases, SSO setup
- [Runbooks](./runbooks/) — Operational procedures (incident response, registry
  publish)

### Reference — information-oriented

Dry, look-it-up descriptions of how things are. Consult these to confirm a fact.

- [Data Model](./architecture/data-model.md) — Tables, fields, relationships
- [API Reference](./architecture/api-reference.md) — Endpoints, schemas, errors
- [Standards](./standards/README.md) — Commit format, code style, API
  conventions, [documentation](./standards/documentation.md)
- [Atlas Reference](./reference/atlas.md) — Project reference details

### Explanation — understanding-oriented

The discursive _why_ behind Atlas. Read these to deepen understanding, not to
complete a task.

- **[Experience First](./experience-first.md) — Atlas's first principle, and the
  reason this nonprofit exists. Read it before contributing.**
- [Product Vision](./the-atlas-product.md) — The problem, the users, what
  success looks like
- [Product PRDs](./product/prds/README.md) — Journey-led product requirements
  for the public discovery experience and supporting platform
- [System Design](./the-atlas-system-design.md) — Architecture, data model, and
  constraints, in narrative
- [Issue Area Taxonomy](./the-atlas-taxonomy.md) — Why the issue areas are what
  they are
- [Architecture explainers](./architecture/README.md) — System overview,
  pipeline, app, and SSO narratives
- [Design specs](./design/README.md) — Point-in-time design decisions and their
  rationale
- [Whitepapers](./whitepapers/README.md) — Publishable position pieces on
  Atlas's model and principles

> Note: the `architecture/` section mixes modes — `data-model` and
> `api-reference` are **Reference**, while `system-overview`, `pipeline`, `app`,
> and `organization-and-enterprise-sso` are **Explanation**. Each page states
> its job at the top.

---

## About This Project

**The Atlas** is a national directory and autodiscovery engine for
organizations, people, and initiatives working on transformative change across
America. Its first principle is the end-user experience — see
[Experience First](./experience-first.md).

**Tech Stack:**

- API: Python 3.12 + FastAPI + SQLite (FTS5)
- App: TanStack Start (React + TypeScript)
- AI: Anthropic Claude API for extraction
- DevOps: Docker Compose, Makefile, git hooks

---

## Getting Help

- Find the right doc by mode in the table above
- Search for `TODO` or `FIXME` comments in code to understand what's pending
- Review git commit history for examples of how things are done
- Ask questions on the team channel

---

## Contributing

All changes must follow [Standards](./standards/README.md) and pass quality
gates. See [Development Workflow](./development/workflow.md) for process
details.

Quality is enforced automatically:

- Commit hooks verify formatting, linting, types
- Pre-push hooks run the full test suite
- All code, tests, and docs must agree

---

Last updated: July 3, 2026
