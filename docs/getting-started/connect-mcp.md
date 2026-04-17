# Connect to Atlas via MCP

Atlas exposes a remote [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that gives AI assistants direct access to the Atlas entity catalog, discovery tools, and place-level civic data. Once connected, your AI assistant can search entities, explore issue areas, check coverage gaps, and more — all through natural conversation.

The server is available at:

```
https://atlas.example.com/mcp
```

Atlas uses OAuth 2.1 for authentication. Most MCP clients handle the authorization flow automatically — you'll be redirected to sign in with your Atlas operator account and approve access.

---

## Claude Desktop

Claude Desktop supports remote MCP servers natively through Connectors.

1. Open Claude Desktop and go to **Settings**.
2. Select **Connectors** in the sidebar.
3. Click **Add Connector**.
4. Enter the server URL:
   ```
   https://atlas.example.com/mcp
   ```
5. Click **Connect**. A browser window will open for you to sign in to Atlas and approve access.
6. Once authorized, Atlas tools will appear in your conversations.

No config file is needed — Claude Desktop handles everything through the UI.

---

## Claude Code

Claude Code supports remote MCP servers via the `claude mcp add` command.

### Add the server

```bash
claude mcp add --transport http atlas https://atlas.example.com/mcp
```

This registers Atlas as an MCP server for the current project. To make it available across all projects, add `--scope user`:

```bash
claude mcp add --transport http --scope user atlas https://atlas.example.com/mcp
```

### Authorize

Run `/mcp` inside a Claude Code session to trigger the OAuth flow. A browser window will open for you to sign in and approve access. Tokens are stored securely and refreshed automatically.

### Share with your team

To share the Atlas connection with collaborators, add it to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "atlas": {
      "type": "http",
      "url": "https://atlas.example.com/mcp"
    }
  }
}
```

Commit this file to version control. Each collaborator will complete their own OAuth flow on first use.

---

## VS Code with GitHub Copilot

VS Code supports remote MCP servers for Copilot with automatic OAuth discovery.

### Quick install

[Install Atlas in VS Code](vscode:mcp/install?%7B%22name%22%3A%22atlas%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fatlas.example.com%2Fmcp%22%7D)

Or configure manually:

### Option A: Workspace config

Create `.vscode/mcp.json` in your project root:

```json
{
  "servers": {
    "atlas": {
      "type": "http",
      "url": "https://atlas.example.com/mcp"
    }
  }
}
```

### Option B: User settings

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`), search for **MCP: Add Server**, and enter the URL when prompted.

### Authorize

The first time Copilot connects to Atlas, VS Code will open a browser window for you to sign in and approve access. This happens automatically — no extra auth configuration is needed in the JSON.

---

## Gemini CLI

Google's Gemini CLI supports remote MCP servers with automatic OAuth discovery.

### Add the server

```bash
gemini mcp add atlas "https://atlas.example.com/mcp" \
  --transport http \
  --scope user
```

Or edit `~/.gemini/settings.json` directly:

```json
{
  "mcpServers": {
    "atlas": {
      "url": "https://atlas.example.com/mcp",
      "type": "http"
    }
  }
}
```

### Authorize

Gemini CLI discovers the OAuth server automatically via Atlas's protected resource metadata. On first use, it opens a browser for you to sign in and approve access. Tokens are persisted and refreshed automatically.

You can also trigger the OAuth flow manually:

```
/mcp auth atlas
```

---

## Codex CLI

OpenAI's Codex CLI uses TOML configuration and has an explicit OAuth login command.

### Add the server

Edit `~/.codex/config.toml` (or `.codex/config.toml` in your project root):

```toml
[mcp_servers.atlas]
url = "https://atlas.example.com/mcp"
```

### Authorize

Run the OAuth login command to open a browser flow:

```bash
codex mcp login atlas
```

Codex starts a local callback server, opens your browser, and stores the tokens securely. Subsequent sessions reuse the stored credentials automatically.

---

## Copilot CLI

GitHub's Copilot CLI supports remote MCP servers with automatic OAuth via Dynamic Client Registration.

### Option A: Global config

Edit `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "atlas": {
      "type": "http",
      "url": "https://atlas.example.com/mcp"
    }
  }
}
```

### Option B: Workspace config

Create `.mcp.json` in your project root with the same structure above.

### Authorize

Copilot CLI handles OAuth automatically. The first time a tool call requires authentication, it opens a browser window for you to sign in and approve access.

---

## Other MCP clients

Any MCP client that supports Streamable HTTP transport and OAuth 2.1 can connect to Atlas. Point it at:

```
https://atlas.example.com/mcp
```

The server implements standard OAuth 2.1 with:

- **OIDC discovery** at `https://atlas.example.com/api/auth/.well-known/openid-configuration`
- **Dynamic client registration** at `https://atlas.example.com/api/auth/oauth2/register` (no pre-registration needed)
- **Protected resource metadata** at `https://atlas.example.com/.well-known/oauth-protected-resource`
- **PKCE** required for all authorization flows
- **Streamable HTTP** transport (SSE is not supported)

---

## Available tools

Once connected, your AI assistant has access to:

| Tool | Description |
|------|-------------|
| `search_entities` | Search Atlas entities by place, topic, or text |
| `get_entity` | Get details for a specific entity |
| `get_entity_sources` | Get the sources backing an entity |
| `search_sources` | Search across all Atlas sources |
| `get_place_entities` | Get entities for a specific place |
| `get_place_profile` | Demographic and socioeconomic context for a place |
| `get_place_coverage` | Coverage gaps and entity counts for a place |
| `get_place_issue_signals` | Issue area summary for a place |
| `get_related_entities` | Entities related through Atlas relationships |
| `resolve_issue_areas` | Map natural language to Atlas issue areas |

## Scopes

When authorizing, Atlas will ask you to approve one or more of these permissions:

| Scope | What it allows |
|-------|----------------|
| `discovery:read` | Read discovery runs and results |
| `discovery:write` | Create and manage discovery runs |
| `entities:write` | Create and update catalog entries |

Standard identity scopes (`openid`, `profile`, `email`) may also be requested.

---

## Troubleshooting

**"Connection failed" or timeout**
Check that `https://atlas.example.com/mcp` is reachable from your network. If you're behind a corporate proxy, ensure it allows outbound HTTPS to `atlas.example.com`.

**OAuth window doesn't open**
Make sure your browser is set as the default. Some clients require a specific callback URL to be reachable — check the client-specific docs above.

**"Unauthorized" after connecting**
Your OAuth token may have expired. Disconnect and reconnect the server in your client to trigger a fresh authorization flow.

**Tools don't appear**
Restart your MCP client after connecting. Some clients require a reload to discover newly available tools.
