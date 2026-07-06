# MCP Resource Catalog Design

## Summary

Atlas's MCP resources should become a curated context layer for trusted civic
research artifacts, not a catalog dump. The user experience this protects is
simple: when someone uses Atlas through an AI assistant, they should be able to
pin, re-read, and trust the specific evidence and research artifacts that matter
to their question without flooding the client with thousands of entities.

The existing MCP surface is already action-oriented: tools search entities,
inspect sources, summarize places, list discovery runs, and start long-running
research. V1 keeps those tools as the discovery mechanism. Resources make known
artifacts durable after discovery: completed research briefs, entity source
trails, and place coverage summaries.

## Product Model

Atlas exposes three kinds of resource behavior:

1. **Listed resources are the research desk.** `resources/list` returns a small,
   bounded shelf of high-signal resources: recent completed discovery runs and
   the existing MCP Apps widget resources. It must never enumerate every entity,
   source, place, or discovery artifact in the database.
2. **Templates describe the large address space.** `resources/templates/list`
   exposes URI patterns for known Atlas artifacts so clients can understand what
   can be read without requiring Atlas to list the whole graph.
3. **Tools discover the world.** Search and lookup tools continue to return
   `resource_uri` fields. For V1-supported URI families, those URIs become a
   read contract: a client can pass them to `resources/read` and receive the
   durable context artifact.

This preserves the product shape Atlas wants: broad civic discovery remains
available, but the MCP client sees a calm, trustworthy context surface instead
of a giant resource tree.

## V1 Resource Surface

V1 centers completed discovery-run briefs because they are already durable,
source-linked research artifacts and pair naturally with the existing MCP Tasks
flow for `start_discovery_run`.

The V1 readable data resources are:

| URI                                       | Purpose                                                           | MIME type          |
| ----------------------------------------- | ----------------------------------------------------------------- | ------------------ |
| `atlas://discovery-runs/{run_id}`         | Full structured discovery-run record                              | `application/json` |
| `atlas://discovery-runs/{run_id}/brief`   | Human-readable research brief with leads, gaps, and source limits | `text/markdown`    |
| `atlas://discovery-runs/{run_id}/sources` | Sources referenced by the run summary, when available             | `application/json` |
| `atlas://entities/{entity_id}/sources`    | Public source trail for one known entity                          | `application/json` |
| `atlas://cities/{city-state}/coverage`    | Place coverage summary for one known city                         | `application/json` |
| `atlas://states/{STATE}/coverage`         | State-level coverage summary                                      | `application/json` |

The corresponding templates are:

```text
atlas://discovery-runs/{run_id}
atlas://discovery-runs/{run_id}/brief
atlas://discovery-runs/{run_id}/sources
atlas://entities/{entity_id}/sources
atlas://cities/{place_key}/coverage
atlas://states/{state}/coverage
```

V1 deliberately does not list entity resources globally and does not
autocomplete entities globally. Entity resources are addressable after a tool
result, saved workspace item, or other specific context has surfaced the entity
ID.

## Architecture

Add a dedicated Atlas data-resource layer beside the current MCP server and
widget extension:

- Keep `api/atlas/platform/mcp/widgets.py` focused on MCP Apps UI bundles such
  as `ui://atlas/entity-card`. These resources are client-rendered UI assets.
- Add a new MCP data-resource module for `atlas://...` URIs. It owns URI
  parsing, resource metadata, template registration, read handlers, and resource
  annotations.
- Keep `AtlasDataService` as the data contract. Resource handlers adapt parsed
  URIs to existing service methods such as `get_discovery_run`,
  `get_entity_sources`, and `get_place_coverage` instead of duplicating SQL.
- Register the data-resource module from `build_mcp()` after tools and before
  returning the FastMCP instance, alongside prompts, tasks, logging, and
  widgets.

The architecture separates two product meanings that share the MCP resource
primitive:

- `ui://atlas/...` resources are presentation assets for MCP Apps hosts.
- `atlas://...` resources are durable Atlas research artifacts.

## Resource Shelf

`resources/list` must stay bounded. The shelf should include:

- existing widget resources, so MCP Apps hosts continue to work;
- recent completed discovery-run resources, capped to a small page size;
- future workspace-pinned artifacts such as watched entities, saved briefs, or
  coverage targets.

The shelf query must be scoped by the authenticated workspace/user when
workspace context is available. Public catalog scale must not affect the shelf
size. A database with thousands of entities should still produce a short
`resources/list` response.

Pagination should apply to the shelf itself, not to the entire Atlas catalog.
Search tools remain responsible for large result sets.

## Resource Metadata And Annotations

Resource definitions should use display titles that name the artifact, not the
implementation. Examples:

- `Research brief: Kansas City, MO`
- `Source trail: KC Tenants`
- `Coverage summary: Gary, IN`

Use annotations to help clients decide how to show or include resources:

- `audience: ["user", "assistant"]` for briefs, source trails, and coverage
  resources.
- `priority` near `1.0` for the selected run brief or explicitly pinned
  workspace artifact; lower priority for older recent items.
- `lastModified` from the best available timestamp: discovery-run completion,
  entity update time, or the newest source/coverage input.

Descriptions should be plain and user-facing. They should not mention internal
pipeline state, seeding, warming, or implementation behavior.

## Error Handling And Access

Invalid Atlas resource URIs should return MCP invalid-params errors. Missing
known resources should return standard MCP not-found behavior. Permission
failures should keep using the existing MCP auth and workspace capability
boundary.

Suppressed sources must stay suppressed in public source-trail resources,
matching the current `get_entity` and `get_entity_sources` behavior. Resource
reads must not bypass product or privacy rules just because the caller knows a
URI.

## Follow-On Capabilities

Completion and subscriptions are useful, but they do not need to block V1.

Completion should be scoped, never global:

- `run_id` completion from recent runs;
- `place_key` completion from known place pages or recent place searches;
- `entity_id` completion only from current search results, a selected place,
  watchlist, or discovery run.

Subscriptions should be explicit:

- running discovery run completed;
- watched entity changed;
- watched place coverage changed;
- workspace shelf changed.

Atlas should support `listChanged` before broad per-resource subscriptions. The
first valuable client notification is that a new completed research artifact is
available.

## Acceptance Criteria

- `resources/list` returns a bounded research shelf and does not enumerate the
  entity catalog.
- `resources/templates/list` advertises all V1 data-resource URI patterns.
- Every V1 `resource_uri` returned by an MCP tool is readable through
  `resources/read`.
- Reading a completed discovery-run brief returns a concise, source-aware
  Markdown artifact.
- Reading an entity source trail preserves current source suppression behavior.
- Existing MCP Apps widget resources continue to list and read independently.
- A fixture database with thousands of entities still returns a short
  `resources/list` response.

## Test Plan

- Unit-test Atlas resource URI parsing for discovery-run, entity-source,
  city-coverage, and state-coverage resources.
- Unit-test resource metadata: names, titles, MIME types, annotations, and
  template registration.
- Integration-test `resources/read` for each V1 resource type against existing
  fixture data.
- Integration-test `resources/list` with many entities present and verify the
  response stays bounded and omits catalog-wide entity listings.
- Contract-test that V1 `resource_uri` values returned by MCP tools can be
  passed to `resources/read`.
- Regression-test widget resources still register and read with their existing
  `text/html;profile=mcp-app` MIME type.

## Out Of Scope For V1

- Listing every entity, source, place, or discovery run as an MCP resource.
- Global entity autocomplete.
- Per-resource subscriptions for the full catalog.
- New database schema.
- New write behavior through resources. Tools remain the action surface.

## References

- MCP resources:
  `https://modelcontextprotocol.io/specification/2025-11-25/server/resources`
- MCP completion:
  `https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/completion`
- MCP client best practices:
  `https://modelcontextprotocol.io/docs/develop/clients/client-best-practices`
