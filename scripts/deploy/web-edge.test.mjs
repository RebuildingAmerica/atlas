import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import worker from "../../services/web-edge/worker.ts";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const env = {
  ATLAS_WEB_ORIGIN_URL: "https://release---atlas-web.example.run.app",
  ATLAS_WEB_ORIGIN_SECRET: "test-secret",
};

test("streams body, preserves path/query, auth and public request origin", async () => {
  globalThis.fetch = async (request) => {
    assert.equal(
      request.url,
      env.ATLAS_WEB_ORIGIN_URL + "/api/auth/callback?code=abc",
    );
    assert.equal(request.method, "POST");
    assert.equal(await request.text(), "streamed-body");
    assert.equal(request.headers.get("authorization"), "Bearer user-token");
    assert.equal(request.headers.get("cookie"), "session=existing");
    assert.equal(request.headers.get("origin"), "https://atlas.example.com");
    assert.equal(request.headers.get("x-forwarded-host"), "atlas.example.com");
    assert.equal(request.headers.get("x-forwarded-for"), "203.0.113.1");
    assert.equal(
      request.headers.get("x-atlas-web-origin-secret"),
      "test-secret",
    );
    assert.equal(request.headers.get("cf-access-client-secret"), null);
    return new Response("ok");
  };
  const result = await worker.fetch(
    new Request("https://atlas.example.com/api/auth/callback?code=abc", {
      method: "POST",
      body: "streamed-body",
      headers: {
        authorization: "Bearer user-token",
        cookie: "session=existing",
        origin: "https://atlas.example.com",
        "cf-connecting-ip": "203.0.113.1",
        "x-forwarded-for": "spoofed",
        forwarded: "spoofed",
        "x-atlas-proxy-secret": "spoofed",
        "cf-access-client-secret": "must-not-forward",
      },
    }),
    env,
  );
  assert.equal(await result.text(), "ok");
});
test("preserves redirects and separate cookies without caching personalized responses", async () => {
  globalThis.fetch = async () => {
    const headers = new Headers({
      location: "https://atlas.example.com/account",
      "cache-control": "public,max-age=600",
    });
    headers.append("set-cookie", "session=a; HttpOnly");
    headers.append("set-cookie", "csrf=b; HttpOnly");
    return new Response(null, { status: 302, headers });
  };
  const result = await worker.fetch(
    new Request("https://atlas.example.com/sign-in"),
    env,
  );
  assert.equal(result.status, 302);
  assert.equal(
    result.headers.get("location"),
    "https://atlas.example.com/account",
  );
  assert.equal(result.headers.getSetCookie().length, 2);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
});
test("all dynamic routes remain on the application, including docs, MCP and entity proxy", async () => {
  const urls = [];
  globalThis.fetch = async (request) => {
    urls.push(request.url);
    return new Response(null, { status: 404 });
  };
  for (const path of [
    "/docs/a",
    "/mcp",
    "/api/entities/person",
    "/api/auth/session",
    "/unknown",
  ]) {
    assert.equal(
      (await worker.fetch(new Request("https://atlas.example.com" + path), env))
        .status,
      404,
    );
    assert.equal(urls.at(-1), env.ATLAS_WEB_ORIGIN_URL + path);
  }
});
test("fails closed for missing/invalid origin configuration and redacts upstream errors", async () => {
  for (const config of [
    {},
    { ...env, ATLAS_WEB_ORIGIN_URL: "https://example.com/path" },
    { ...env, ATLAS_WEB_ORIGIN_URL: "http://example.com" },
  ]) {
    assert.equal(
      (await worker.fetch(new Request("https://atlas.example.com"), config))
        .status,
      503,
    );
  }
  globalThis.fetch = async () => {
    throw new Error("secret-host-and-token");
  };
  const result = await worker.fetch(
    new Request("https://atlas.example.com"),
    env,
  );
  assert.equal(result.status, 502);
  assert.equal((await result.text()).includes("secret"), false);
});
