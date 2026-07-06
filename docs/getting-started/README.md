# Getting Started With Atlas

[Docs](../README.md) > Getting Started

A one-way ramp from zero to running. Use this section when you want to
understand the repo, start the local stack, and make a small change without
needing private project context.

## For New Contributors

If you're joining the project for the first time, follow this order:

1. **[Prerequisites](./prerequisites.md)** — Install Python, Node, pnpm, Git,
   and Make.
2. **[Quick Start](./quick-start.md)** — Clone the repo and start Atlas locally.
3. **[Project Structure](./project-structure.md)** — Tour the app, API, docs,
   Scout, and shared libraries.
4. Then read [Experience First](../experience-first.md) and
   [Architecture](../architecture/README.md) before changing product behavior.

## For Existing Contributors

- [Prerequisites](./prerequisites.md) — Set up a new machine or troubleshoot
  install issues.
- [Project Structure](./project-structure.md) — Reference for where code lives.
- [Quick Start](./quick-start.md) — Run the local stack.
- See [Development](../development/README.md) for day-to-day development

## What Is Atlas?

Atlas is open-source civic discovery infrastructure for finding the people,
organizations, initiatives, campaigns, and events working on public problems
across America. The public project lives at
[atlas.rebuildingus.org](https://atlas.rebuildingus.org).

The product has four durable pieces:

1. **Public Directory** — Search, browse, maps, profiles, places, and issue
   pages that help people find civic actors and inspect sources.
2. **Trust Layer** — Source links, excerpts, confidence, freshness, corrections,
   and public/private boundaries that make records usable without asking readers
   to trust a black box.
3. **Discovery Pipeline** — Shared extraction, deduplication, scoring, review,
   and sync logic used by the API worker and Scout.
4. **Developer And Workspace Tools** — API, MCP, Scout, lists, briefs, watches,
   exports, and self-hosting paths that let people build on Atlas without losing
   provenance.

## Current State

Atlas is usable as a public product and active development repo, and it is still
being cleaned up for broader open-source participation. Some code is clearly
public and self-hostable; some hosted, workspace, and operator surfaces are
being documented and separated more clearly. Treat that boundary as part of the
work: changes should make the repo easier to run, audit, trust, or responsibly
self-host.

## Quick Links

- **[Experience First](../experience-first.md)** — The principle that governs
  every technical decision.
- **[Architecture](../architecture/README.md)** — Understand how the system is
  built.
- **[Development](../development/README.md)** — Learn how to build features.
- **[Standards](../standards/README.md)** — Engineering standards for the
  project.
- **[Open source](../../mintlify/resources/open-source.mdx)** — Public project
  model and self-hosting posture.

---

Last updated: July 6, 2026
