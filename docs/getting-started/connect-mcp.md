# Atlas MCP reference

Atlas exposes a hosted Model Context Protocol server for compliant remote MCP
clients. The server gives assistants access to Atlas search, source review,
discovery-run artifacts, place-level civic context, and user-selected prompt
workflows.

## Endpoint

Production:

```text
https://atlas.rebuildingus.org/mcp
```

Staging:

```text
https://staging.atlas.rebuildingus.org/mcp
```

## Requirements

- Atlas Pro or Atlas Team access.
- A compliant MCP client with remote Streamable HTTP support.
- Browser-based OAuth support for sign-in and consent.

Atlas does not publish per-client setup instructions in this repository. Use the
client's built-in remote MCP server flow and enter the Atlas endpoint above.

## Atlas behavior

| Item               | Value                                           |
| ------------------ | ----------------------------------------------- |
| Transport          | Streamable HTTP                                 |
| Authentication     | OAuth through the client                        |
| Registry namespace | `org.rebuildingus.atlas/atlas`                  |
| Registry manifest  | [mcp/server.json](../../mcp/server.json)        |
| Public docs        | [MCP overview](../../mintlify/mcp/overview.mdx) |
| Tool reference     | [MCP tools](../../mintlify/mcp/tools.mdx)       |
| Prompt reference   | [MCP prompts](../../mintlify/mcp/prompts.mdx)   |

## Workspace activity

Workspace admins can review successful external REST API and MCP use through the
workspace integration activity surface. It reports counts, surfaces, paths, and
last-seen timestamps without request metadata, prompts, private notes, or
session replay.

## Long-running research runs

`start_discovery_run` starts source-linked research and requires
`discovery:write`. MCP clients that declare the Tasks extension receive a task
handle immediately and poll until the run finishes. Clients without task support
receive an explicit error instead of a partial result.

## Guided prompts

Atlas exposes static, read-only prompts for common assistant workflows:

- `research_place`
- `find_civic_actors`
- `inspect_source_trail`
- `assess_coverage_gaps`
- `create_research_brief`

These prompts guide clients through existing read tools. They do not start
discovery runs or require the Tasks extension.
