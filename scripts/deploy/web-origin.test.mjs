import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { createOriginServer } from "../../services/web-edge/origin.mjs";

test("origin rejects bypass before all routes and forwards only authenticated visitor identity", async (t) => {
  let observed;
  const app = createServer((request, response) => {
    observed = request.headers;
    response.setHeader("set-cookie", ["session=retained; HttpOnly", "csrf=ok"]);
    response.writeHead(200);
    response.end("application");
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const server = createOriginServer({
    secret: "separate-origin-secret",
    publicUrl: "https://atlas.example.com",
    upstreamPort: app.address().port,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
    app.closeAllConnections();
    app.close();
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  for (const path of [
    "/",
    "/api/auth/session",
    "/docs/a",
    "/mcp",
    "/api/entities",
    "/_atlas/health",
  ]) {
    assert.equal((await fetch(origin + path)).status, 403);
  }
  const response = await fetch(origin + "/api/auth/session", {
    headers: {
      "x-atlas-web-origin-secret": "separate-origin-secret",
      "x-forwarded-host": "atlas.example.com",
      "x-atlas-web-client-ip": "203.0.113.5",
      "x-forwarded-for": "spoofed, 192.0.2.99",
      forwarded: "for=spoofed",
      cookie: "session=retained",
    },
  });
  assert.equal(await response.text(), "application");
  assert.equal(observed.host, "atlas.example.com");
  assert.equal(observed["x-forwarded-for"], "203.0.113.5");
  assert.equal(observed["x-atlas-web-origin-secret"], undefined);
  assert.equal(observed.forwarded, undefined);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.equal(
    (
      await fetch(origin, {
        headers: {
          "x-atlas-web-origin-secret": "separate-origin-secret",
          "x-forwarded-host": "evil.example",
        },
      })
    ).status,
    421,
  );
});

test("origin refuses missing secrets and malformed canonical origins", () => {
  assert.throws(() =>
    createOriginServer({
      secret: "",
      publicUrl: "https://atlas.example.com",
      upstreamPort: 3001,
    }),
  );
  assert.throws(() =>
    createOriginServer({
      secret: "present",
      publicUrl: "http://atlas.example.com",
      upstreamPort: 3001,
    }),
  );
});
