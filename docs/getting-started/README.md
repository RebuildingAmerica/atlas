# Getting Started with The Atlas

[Docs](../README.md) > Getting Started

A one-way ramp from zero to running. Everything you need to understand the project and start developing.

## For New Contributors

If you're joining the project for the first time, follow this order:

1. **[Prerequisites](./prerequisites.md)** — Make sure you have Python, Node, Docker, and Make installed
2. **[Quick Start](./quick-start.md)** — Clone the repo and get it running in 4 steps
3. **[Project Structure](./project-structure.md)** — Tour of the codebase with explanations
4. Then jump to [Architecture](../architecture/README.md) to understand how pieces fit together

## For Existing Contributors

- [Prerequisites](./prerequisites.md) — Set up a new machine or troubleshoot install issues
- [Project Structure](./project-structure.md) — Reference for where code lives
- [Quick Start](./quick-start.md) — Running the project locally
- See [Development](../development/README.md) for day-to-day development

## What is The Atlas?

The Atlas is a national directory and autodiscovery engine for organizations, people, and initiatives working on transformative change across America.

The product has three key pieces:

1. **Autodiscovery Pipeline** — Takes a location and set of issues, systematically searches the web, extracts structured data, deduplicates, and ranks results. This is the core product.

2. **Storage Layer** — SQLite database with FTS5 (full-text search) storing entries, sources, and their relationships.

3. **Public Directory** — A searchable, browsable interface where people can find organizations and initiatives in their area and around issues they care about.

**Current Phase:** Phase 1 (Scaffold)

The core APIs and database schema are in place. The pipeline is stubbed with all 6 steps. App is built with routing and components. See individual docs for what's working vs. what's pending.

## Quick Links

- **[Architecture](../architecture/README.md)** — Understand how the system is built
- **[Development](../development/README.md)** — Learn how to build features
- **[Standards](../standards/README.md)** — Engineering standards for the project
- **[Design](../design/README.md)** — Product vision and system design docs

---

Last updated: March 25, 2026
