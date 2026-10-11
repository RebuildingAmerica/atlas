import assert from "node:assert/strict";
import { test } from "node:test";
import edge from "../../services/api-cloudflare/edge/index.js";

test("discovery probes use the isolated object while API requests retain their body and headers", async () => {
  const seen = [];
  const namespace = (kind) => ({
    getByName(name) {
      assert.equal(name, "compatibility");
      return {
        async fetch(request) {
          seen.push({
            kind,
            path: new URL(request.url).pathname,
            method: request.method,
            body: await request.text(),
            header: request.headers.get("x-contract"),
          });
          return new Response("stream", {
            status: 202,
            headers: { "cache-control": "private, no-store" },
          });
        },
      };
    },
  });
  const env = {
    API_RUNTIME: namespace("api"),
    DISCOVERY_RUNTIME: namespace("discovery"),
  };
  for (const path of ["/database", "/discovery/native"]) {
    const result = await edge.fetch(
      new Request("https://atlas.test" + path, {
        method: "POST",
        body: "input",
        headers: { "x-contract": "preserved" },
      }),
      env,
    );
    assert.equal(result.status, 202);
    assert.equal(await result.text(), "stream");
    assert.equal(result.headers.get("cache-control"), "private, no-store");
  }
  assert.deepEqual(seen, [
    {
      kind: "api",
      path: "/database",
      method: "POST",
      body: "input",
      header: "preserved",
    },
    {
      kind: "discovery",
      path: "/native",
      method: "POST",
      body: "input",
      header: "preserved",
    },
  ]);
});
