# Design Documentation

[Docs](../README.md) > Design

This section contains the core design documents that define what we're building
and how the system works.

## Design Documents

### The Atlas Product

**What problem are we solving? Who is it for? What does success look like?**

Read this first if you're new to the project. Covers the problem statement,
target users, product vision, and the autodiscovery pipeline at a conceptual
level.

→ [Read: The Atlas Product Vision](../the-atlas-product.md)

### System Design

**How is the system built? What's the data model? What are the constraints?**

Deep dive into architecture, database schema, entity relationships, and API
contract. Reference this when implementing features or understanding data flow.

→ [Read: System Design](../the-atlas-system-design.md)

### Issue Area Taxonomy

**What are the issue areas? What search terms define each one?**

Complete taxonomy of issue categories (housing, healthcare, labor, etc.) with
their definitions and associated search terms used by the autodiscovery
pipeline.

→ [Read: Issue Area Taxonomy](../the-atlas-taxonomy.md)

### Firehose Architecture

**How does Atlas turn public civic activity into source-backed intelligence?**

High-level architecture and deep technical documents for collecting public
artifacts, analyzing them into civic signals, resolving them to Atlas records,
storing the evidence chain, and governing the operational boundary between civic
intelligence and private-life tracking.

→ [Read: Firehose Architecture Overview](firehose/README.md)

---

## Design Specs

Point-in-time specs proposing or defining a specific subsystem. Dated; newest
first.

- [Firehose Architecture And Pipeline Suite](firehose/README.md) (2026-07-05) —
  High-level PRD companion and deep technical design for collection, analysis,
  storage, serving, governance, and operations.
- [Atlas Scout CLI Worker Auth And Discovery Spec](2026-07-04-atlas-scout-cli-worker-discovery.md)
  (2026-07-04) — Turnkey Scout login, worker enrollment, upload destinations,
  sync receipts, web handoff, search connection behavior, and the review-gated
  discovery contribution model.
- [Discovery Platform Redesign](2026-06-23-discovery-platform-redesign.md)
  (2026-06-23) — Inverting the discovery substrate from a flat directory into a
  persistent civic knowledge graph; the production-readiness chassis, the
  data-model redesign, the hybrid trust gate, and the phased roadmap.
- [Atlas Scout: Pipeline & Indexer Design Spec](2026-04-11-atlas-scout-pipeline-design.md)
  (2026-04-11) — Extracting the discovery pipeline into the standalone Scout
  runner with shared canonical types.

---

## Related Documentation

- [Architecture Overview](../architecture/README.md) — How the design translates
  to code
- [Pipeline Architecture](../architecture/pipeline.md) — Deep dive on the 6-step
  discovery process
- [Data Model Reference](../architecture/data-model.md) — Quick reference for
  database schema

---

Last updated: July 5, 2026
