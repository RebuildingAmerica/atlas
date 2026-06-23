# Design Documentation

[Docs](../README.md) > Design

This section contains the core design documents that define what we're building and how the system works.

## Design Documents

### The Atlas Product
**What problem are we solving? Who is it for? What does success look like?**

Read this first if you're new to the project. Covers the problem statement, target users, product vision, and the autodiscovery pipeline at a conceptual level.

→ [Read: The Atlas Product Vision](../the-atlas-product.md)

### System Design
**How is the system built? What's the data model? What are the constraints?**

Deep dive into architecture, database schema, entity relationships, and API contract. Reference this when implementing features or understanding data flow.

→ [Read: System Design](../the-atlas-system-design.md)

### Issue Area Taxonomy
**What are the issue areas? What search terms define each one?**

Complete taxonomy of issue categories (housing, healthcare, labor, etc.) with their definitions and associated search terms used by the autodiscovery pipeline.

→ [Read: Issue Area Taxonomy](../the-atlas-taxonomy.md)

---

## Design Specs

Point-in-time specs proposing or defining a specific subsystem. Dated; newest first.

- [Discovery Platform Redesign](2026-06-23-discovery-platform-redesign.md) (2026-06-23) — Inverting the discovery substrate from a flat directory into a persistent civic knowledge graph; the production-readiness chassis, the data-model redesign, the hybrid trust gate, and the phased roadmap.
- [Atlas Scout: Pipeline & Indexer Design Spec](2026-04-11-atlas-scout-pipeline-design.md) (2026-04-11) — Extracting the discovery pipeline into the standalone Scout runner with shared canonical types.

---

## Related Documentation

- [Architecture Overview](../architecture/README.md) — How the design translates to code
- [Pipeline Architecture](../architecture/pipeline.md) — Deep dive on the 6-step discovery process
- [Data Model Reference](../architecture/data-model.md) — Quick reference for database schema

---

Last updated: June 23, 2026
