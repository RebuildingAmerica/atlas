# Atlas Quick Reference

[Docs](../README.md) > [Reference](./README.md) > Atlas Quick Reference

This is the one-page reference for the key facts about Atlas.

If you need the short version of what the project is, who it is for, who
maintains it, or how to reach the right person, start here.

## Atlas At A Glance

- **Project Name:** Atlas
- **Website:** [atlas.rebuildingus.org](https://atlas.rebuildingus.org)
- **Primary Maintainer:** The Rebuilding America Project
- **Maintainer Website:** [rebuildingus.org](https://rebuildingus.org)
- **Repository:**
  [github.com/RebuildingAmerica/atlas](https://github.com/RebuildingAmerica/atlas)

## What Atlas Is

Atlas is a national directory and autodiscovery tool for finding the people,
organizations, and initiatives rebuilding America in public.

It focuses on the issues that define this moment in American life: housing,
healthcare, climate, democracy, labor, education, justice, infrastructure, and
the connective tissue between them.

Every entry is tied to a place, connected to issue areas, and linked back to the
public sources where the information came from. Atlas does not try to invent a
hidden story. It documents, links, and organizes what is already in the public
record.

Atlas is meant to be a source-linked map people can actually use.

## What Atlas Tracks

Atlas organizes source-linked information about:

- People
- Organizations
- Initiatives
- Campaigns
- Events

Entries are tied to places and issue areas, and each one points back to the
public sources where the information came from.

The project is designed to surface specific people doing specific things in
specific places, not vague institutional placeholders.

## Who Atlas Is For

- **Researchers and organizers** who need structured local discovery and want to
  go from a place and issue area to a credible set of leads
- **Journalists and producers** looking for source-linked people and
  organizations to learn from, interview, or feature
- **The public** looking for the people and groups doing real work on a specific
  issue in a specific place
- **Developers and integrators** building on top of Atlas's API or extending the
  discovery workflow

## Product Shape

Atlas currently brings together three connected surfaces:

- **Public directory** for browsing and search
- **REST API** for entries, sources, and discovery workflows
- **Autodiscovery pipeline** for finding and structuring new entries

The autodiscovery pipeline is the core of the product. The database, interface,
and public directory exist to support and present what the pipeline finds.

## Current Status

Atlas is a live project with a public product, API, MCP server, Scout CLI,
self-hosting path, and hosted workspace surfaces under active development.
Public and self-hostable code should keep source provenance clear. Hosted,
workspace, and operator workflows should keep public/private boundaries
explicit.

## Technology Stack

- **API:** Python 3.12, FastAPI, SQLite with FTS5
- **App:** TanStack Start, React, TypeScript
- **AI Extraction:** Anthropic Claude API
- **Developer Tooling:** `uv`, `pnpm`, `make`, git hooks, Docker Compose

## Rebuilding America Context

Atlas is maintained by The Rebuilding America Project and was created alongside
the broader Rebuilding America initiative.

Rebuilding America uses storytelling, research, and civic tooling to surface the
people, organizations, and ideas rebuilding public life across the country.
Atlas supports that mission by making it easier to discover who is doing the
work, where they are doing it, and how to trace that back to public evidence.

Atlas also serves journalists, organizers, researchers, developers, nonprofits,
funders, civic educators, and public users who need source-linked civic
discovery.

## Canonical External References

- **Atlas:** [atlas.rebuildingus.org](https://atlas.rebuildingus.org)
- **Repository:**
  [github.com/RebuildingAmerica/atlas](https://github.com/RebuildingAmerica/atlas)
- **Rebuilding America Project:** [rebuildingus.org](https://rebuildingus.org)
