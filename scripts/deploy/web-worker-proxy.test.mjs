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
  ATLAS_EDGE_ORIGIN_SECRET: "existing-edge-origin-secret",
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
      "existing-edge-origin-secret",
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

test("documentation keeps proxy and test credentials and Atlas identity out of the upstream request", async () => {
  const privateHeaders = {
    "cf-access-client-id": "test-client-id",
    "cf-access-client-secret": "test-client-secret", // pragma: allowlist secret - synthetic test fixture
    "cf-access-jwt-assertion": "test-access-assertion",
    "cf-access-authenticated-user-email": "visitor@example.com",
    "cf-access-future-identity": "test-future-identity",
    "x-atlas-hosted-e2e-secret": "test-hosted-verifier", // pragma: allowlist secret - synthetic test fixture
    "x-atlas-proxy-secret": "test-proxy-secret", // pragma: allowlist secret - synthetic test fixture
    "x-atlas-client-ip": "203.0.113.7",
    "x-atlas-future-identity": "test-future-identity",
  };
  globalThis.fetch = async (request) => {
    assert.equal(request.url, "https://docs.example.com/docs/guide?q=topic");
    for (const header of Object.keys(privateHeaders))
      assert.equal(request.headers.get(header), null, header);
    assert.equal(request.headers.get("accept"), "text/html");
    return new Response("Documentation");
  };
  const response = await proxyHostedRequest(
    new Request("https://atlas.example.com/docs/guide?q=topic", {
      headers: { ...privateHeaders, accept: "text/html" },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "Documentation");
});

test("API proxy keeps bearer authentication but excludes Access and hosted verifier credentials", async () => {
  globalThis.fetch = async (request) => {
    assert.equal(request.url, "https://api.example.com/mcp/");
    assert.equal(request.headers.get("cf-access-client-secret"), null);
    assert.equal(
      request.headers.get("cf-access-authenticated-user-email"),
      null,
    );
    assert.equal(request.headers.get("x-atlas-hosted-e2e-secret"), null);
    assert.equal(
      request.headers.get("authorization"),
      "Bearer test-api-client",
    );
    return new Response("API response");
  };
  const response = await proxyHostedRequest(
    new Request("https://atlas.example.com/mcp", {
      headers: {
        "cf-access-client-secret": "test-client-secret", // pragma: allowlist secret - synthetic test fixture
        "cf-access-authenticated-user-email": "visitor@example.com",
        "x-atlas-hosted-e2e-secret": "test-hosted-verifier", // pragma: allowlist secret - synthetic test fixture
        authorization: "Bearer test-api-client",
      },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "API response");
});
