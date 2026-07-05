import { expect, test } from "@playwright/test";
import { absoluteHostedUrl, requiredHostedOrigin } from "../helpers/hosted-endpoints";

const publicOrigin = requiredHostedOrigin("ATLAS_HOSTED_PUBLIC_URL");
const apiOrigin = requiredHostedOrigin("ATLAS_HOSTED_API_URL");
const mcpPaths = ["/mcp", "/mcp/"] as const;

test.describe("hosted MCP endpoint", () => {
  test("serves API health", async () => {
    const response = await fetch(absoluteHostedUrl(apiOrigin, "/health"));

    expect(response.status).toBe(200);
  });

  for (const path of mcpPaths) {
    test(`serves an OAuth challenge from the public Atlas MCP URL at ${path}`, async () => {
      const response = await fetch(absoluteHostedUrl(publicOrigin, path), {
        method: "POST",
        redirect: "manual",
      });
      const body = await response.text();
      const challenge = response.headers.get("www-authenticate");

      expect(response.status).toBe(401);
      expect(response.headers.get("location")).toBeNull();
      expect(body).not.toContain("Invalid Host header");
      expect(challenge).toMatch(/^Bearer /);
      expect(challenge).toContain(
        `resource_metadata="${absoluteHostedUrl(
          publicOrigin,
          "/.well-known/oauth-protected-resource/mcp",
        )}"`,
      );
    });
  }
});
