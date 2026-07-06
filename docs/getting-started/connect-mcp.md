# Atlas MCP reference

Atlas exposes a hosted Model Context Protocol server for compliant remote MCP
clients. The server gives assistants access to Atlas search, source review,
discovery-run artifacts, and place-level civic context.

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

## Workspace activity

Workspace admins can review successful external REST API and MCP use through the
workspace integration activity surface. It reports counts, surfaces, paths, and
last-seen timestamps without request metadata, prompts, private notes, or
session replay.
