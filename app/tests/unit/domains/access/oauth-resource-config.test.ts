import { describe, expect, it } from "vitest";
import {
  buildAtlasAuthJwtAudiences,
  buildMcpResourceUrl,
} from "@rebuildingamerica/atlas-access/oauth-resource-config";

describe("OAuth resource config", () => {
  it("builds the canonical MCP resource without preserving trailing slashes", () => {
    expect(buildMcpResourceUrl("https://atlas.example.com/")).toBe("https://atlas.example.com/mcp");
  });

  it("puts the canonical MCP resource first in API audience values", () => {
    expect(
      buildAtlasAuthJwtAudiences({
        apiBaseUrl: "https://api.atlas.example.com/v1",
        publicBaseUrl: "https://atlas.example.com",
      }),
    ).toBe("https://atlas.example.com/mcp,https://api.atlas.example.com");
  });

  it("keeps a single canonical audience when no API origin is supplied", () => {
    expect(
      buildAtlasAuthJwtAudiences({
        apiBaseUrl: null,
        publicBaseUrl: "http://127.0.0.1:3100",
      }),
    ).toBe("http://127.0.0.1:3100/mcp");
  });
});
