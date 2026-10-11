import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { proxyHostedRequest } from "../../app/server/hosted-proxy.ts";
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const env = {
  ATLAS_DOCS_URL: "https://docs.example.com",
  ATLAS_SERVER_API_PROXY_TARGET: "https://api.example.com",
  ATLAS_AUTH_INTERNAL_SECRET: "existing-internal-secret",
};
test("Workers keeps auth, server functions and unrelated API routes in the app", async () => {
  for (const path of [
    "/api/auth/session",
    "/api/atproto/oauth/callback",
    "/api/entities-extra",
    "/api/internal/something",
    "/docs-extra",
  ])
    assert.equal(
      await proxyHostedRequest(
        new Request("https://atlas.example.com" + path),
        env,
      ),
      null,
    );
});
test("Workers proxy preserves the MCP canonical trailing slash and signed visitor identity", async () => {
  globalThis.fetch = async (request) => {
    assert.equal(request.url, "https://api.example.com/mcp/?q=hello");
    assert.equal(request.headers.get("x-atlas-client-ip"), "203.0.113.2");
    assert.equal(
      request.headers.get("x-atlas-proxy-secret"),
      "existing-internal-secret",
    );
    assert.equal(request.headers.get("cookie"), null);
    return new Response("mcp");
  };
  assert.equal(
    await (
      await proxyHostedRequest(
        new Request("https://atlas.example.com/mcp?q=hello", {
          headers: {
            "x-forwarded-for": "203.0.113.2",
            cookie: "session=private",
          },
        }),
        env,
      )
    ).text(),
    "mcp",
  );
});
test("Workers documentation keeps CSP and does not send browser credentials to Mintlify", async () => {
  globalThis.fetch = async (request) => {
    assert.equal(request.url, "https://docs.example.com/docs/guide");
    assert.equal(request.headers.get("host"), null);
    assert.equal(request.headers.get("connection"), null);
    assert.equal(request.headers.get("authorization"), null);
    assert.equal(request.headers.get("cookie"), null);
    return new Response("docs");
  };
  const response = await proxyHostedRequest(
    new Request("https://atlas.example.com/docs/guide", {
      headers: {
        host: "atlas.example.com",
        connection: "keep-alive",
        authorization: "Bearer private",
        cookie: "private",
      },
    }),
    env,
  );
  assert.match(
    response.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
