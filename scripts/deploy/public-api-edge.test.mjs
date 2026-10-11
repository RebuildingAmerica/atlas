import assert from "node:assert/strict";
import test from "node:test";
import edge from "../../services/api-cloudflare/public-edge/index.mjs";

const publicHost = "atlas-api.rebuildingus.org";
const operationsHost = "atlas-api-ops-production.atlas.rebuildingus.org";
function fixture() {
  const calls = [];
  const binding = (role) => ({
    getByName(name, options) {
      assert.equal(name, "application");
      assert.deepEqual(options, { locationHint: "enam" });
      return {
        async fetch(request) {
          calls.push({ role, request });
          return new Response("catalog response", {
            headers: {
              "cdn-cache-control": "public",
              "mcp-session-id": "session",
            },
          });
        },
      };
    },
  });
  return {
    calls,
    env: {
      ATLAS_API_PUBLIC_HOSTNAME: publicHost,
      ATLAS_API_OPERATIONS_HOSTNAME: operationsHost,
      ATLAS_EDGE_ORIGIN_SECRET: "fixture-existing-origin-proof",
      API_RUNTIME: binding("api"),
      DISCOVERY_RUNTIME: binding("discovery"),
    },
  };
}
function request(path, options = {}, hostname = publicHost) {
  return new Request(`https://${hostname}${path}`, {
    ...options,
    headers: { "cf-connecting-ip": "198.51.100.8", ...options.headers },
  });
}

test("public API and MCP requests use the retained production application object", async () => {
  const f = fixture();
  for (const path of ["/health", "/api/entities?limit=2", "/mcp"])
    assert.equal((await edge.fetch(request(path), f.env)).status, 200);
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every((call) => call.role === "api"));
  assert.equal(new URL(f.calls[1].request.url).search, "?limit=2");
});

test("public callers cannot reach internal controls or platform administration through alternate encodings", async () => {
  const f = fixture();
  for (const path of [
    "/__atlas/release",
    "/__atlas/consumers",
    "/api/platform/waitlist",
    "/%5f%5fatlas/release",
    "/%61pi/platform/waitlist",
    "/api%2fplatform/waitlist",
    "/api/platform%2fwaitlist",
    "/%255f%255fatlas/release",
    "/api/%70latform/waitlist",
    "/api/platform\\waitlist",
    "/public-api/__atlas/release",
  ]) {
    const response = await edge.fetch(request(path), f.env);
    assert.ok([400, 403, 404].includes(response.status), path);
  }
  assert.equal(f.calls.length, 0);
});

test("visitor identity comes only from the edge, while customer bearer credentials remain usable", async () => {
  const f = fixture();
  const response = await edge.fetch(
    request("/mcp", {
      headers: {
        authorization: "Bearer customer-token",
        "x-api-key": "customer-api-key",
        cookie: "session=forged",
        "x-atlas-actor-assertion": "forged",
        "x-atlas-callback-secret": "forged",
        "x-atlas-client-ip": "127.0.0.1",
        "x-atlas-proxy-secret": "forged",
        "cf-access-jwt-assertion": "forged",
        "cf-access-client-secret": "forged",
        "x-forwarded-for": "127.0.0.1",
        connection: "x-custom-hop",
        "x-custom-hop": "must-drop",
      },
    }),
    f.env,
  );
  assert.equal(response.status, 200);
  const headers = f.calls[0].request.headers;
  assert.equal(headers.get("authorization"), "Bearer customer-token");
  assert.equal(headers.get("x-api-key"), "customer-api-key");
  assert.equal(headers.get("x-atlas-client-ip"), "198.51.100.8");
  assert.equal(
    headers.get("x-atlas-proxy-secret"),
    f.env.ATLAS_EDGE_ORIGIN_SECRET,
  );
  for (const key of [
    "cookie",
    "x-atlas-actor-assertion",
    "x-atlas-callback-secret",
    "cf-access-jwt-assertion",
    "cf-access-client-secret",
    "x-forwarded-for",
    "connection",
    "x-custom-hop",
  ])
    assert.equal(headers.get(key), null, key);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("cdn-cache-control"), null);
  assert.equal(response.headers.get("mcp-session-id"), "session");
});

test("existing Access-protected operations remain read-only and discovery controls stay private", async () => {
  const f = fixture();
  assert.equal(
    (
      await edge.fetch(
        request("/discovery/__atlas/consumers", {}, operationsHost),
        f.env,
      )
    ).status,
    200,
  );
  assert.equal(f.calls[0].role, "discovery");
  assert.equal(new URL(f.calls[0].request.url).pathname, "/__atlas/consumers");
  assert.equal(
    (
      await edge.fetch(
        request("/api/health", { method: "POST" }, operationsHost),
        f.env,
      )
    ).status,
    405,
  );
  assert.equal(
    (await edge.fetch(request("/discovery/jobs", {}, operationsHost), f.env))
      .status,
    404,
  );
  assert.equal(f.calls.length, 1);
});

test("protected public-edge probes exercise the same sanitization before canonical cutover", async () => {
  const f = fixture();
  assert.equal(
    (await edge.fetch(request("/public-api/health", {}, operationsHost), f.env))
      .status,
    200,
  );
  assert.equal(new URL(f.calls[0].request.url).hostname, publicHost);
  assert.equal(new URL(f.calls[0].request.url).pathname, "/health");
  assert.equal(
    (
      await edge.fetch(
        request("/public-api/api/platform/waitlist", {}, operationsHost),
        f.env,
      )
    ).status,
    404,
  );
  assert.equal(f.calls.length, 1);
});

test("authenticated MCP POST bodies remain intact behind the protected public-edge probe", async () => {
  const f = fixture();
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "initialize",
    id: 1,
  });
  const response = await edge.fetch(
    request(
      "/public-api/mcp?workspace=fixture",
      {
        method: "POST",
        body: payload,
        headers: {
          authorization: "Bearer customer-token",
          "content-type": "application/json",
        },
      },
      operationsHost,
    ),
    f.env,
  );
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].request.method, "POST");
  assert.equal(
    f.calls[0].request.headers.get("authorization"),
    "Bearer customer-token",
  );
  assert.equal(new URL(f.calls[0].request.url).search, "?workspace=fixture");
  assert.equal(await f.calls[0].request.text(), payload);
});

test("unknown hosts and missing visitor-proof configuration fail without a backend call", async () => {
  for (const patch of [
    { ATLAS_EDGE_ORIGIN_SECRET: "" },
    { ATLAS_API_PUBLIC_HOSTNAME: "" },
  ]) {
    const f = fixture();
    assert.equal(
      (await edge.fetch(request("/health"), { ...f.env, ...patch })).status,
      503,
    );
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal(
    (await edge.fetch(request("/health", {}, "untrusted.example"), f.env))
      .status,
    421,
  );
  assert.equal(
    (await edge.fetch(new Request(`https://${publicHost}/health`), f.env))
      .status,
    503,
  );
  assert.equal(f.calls.length, 0);
});

test("MCP responses stream immediately and propagate cancellation to the upstream body", async () => {
  const f = fixture();
  let cancelled = false;
  f.env.API_RUNTIME = {
    getByName() {
      return {
        async fetch() {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("first event"));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        },
      };
    },
  };
  const response = await edge.fetch(request("/mcp"), f.env);
  const reader = response.body.getReader();
  assert.equal(
    new TextDecoder().decode((await reader.read()).value),
    "first event",
  );
  await reader.cancel();
  assert.equal(cancelled, true);
});
