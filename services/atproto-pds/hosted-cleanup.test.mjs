import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { spawn } from "node:child_process";
import test from "node:test";

const token = "synthetic-broker-test-credential";
const admin = "synthetic-admin-test-credential";
const runId = "38246581597-1";
const handle = "a382465815971o.pds.example.org";
const email = `atlas-hosted-e2e+${runId}-owner+atlas-0123456789abcdef@atlas.test`;
const did = "did:plc:fixture";

async function fixture(t, options = {}) {
  const calls = [];
  let deleted = false;
  const upstream = http.createServer(async (req, res) => {
    calls.push(req.url);
    res.setHeader("content-type", "application/json");
    const reply = (status, body) => {
      res.statusCode = status;
      res.end(JSON.stringify(body));
    };
    if (
      req.headers.authorization !==
        `Basic ${Buffer.from(`admin:${admin}`).toString("base64")}` ||
      options.adminDenied
    )
      return reply(401, { error: "AuthenticationRequired" });
    if (req.url.startsWith("/xrpc/com.atproto.identity.resolveHandle"))
      if (options.unresolved)
        return reply(400, {
          error: "InvalidRequest",
          message: "Unable to resolve handle",
        });
    if (req.url.startsWith("/xrpc/com.atproto.identity.resolveHandle"))
      return deleted || options.absent
        ? reply(400, { error: "HandleNotFound" })
        : reply(200, { did });
    if (req.url.startsWith("/xrpc/com.atproto.admin.searchAccounts")) {
      if (options.inventoryDenied) return reply(403, {});
      return reply(200, {
        accounts:
          options.absent || deleted
            ? []
            : [{ did, handle, email: options.realEmail ?? email }],
        ...(options.inventoryCursor ? { cursor: "same-cursor" } : {}),
      });
    }
    if (req.url.startsWith("/xrpc/com.atproto.admin.getAccountInfo")) {
      if (
        req.url.includes("aaaaaaaaaaaaaaaaaaaaaaaa") ||
        (deleted && !options.staleReadback)
      )
        return reply(400, { error: "NotFound" });
      return reply(200, { did, handle, email: options.realEmail ?? email });
    }
    if (req.url === "/xrpc/com.atproto.admin.deleteAccount") {
      if (options.deleteDenied) return reply(500, {});
      deleted = true;
      return reply(200, {});
    }
    return reply(404, {});
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => upstream.close());
  const reservation = http.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(
    process.execPath,
    ["services/atproto-pds/invite-broker.mjs"],
    {
      env: {
        ...process.env,
        ATLAS_PDS_INVITE_BROKER_SECRET: token,
        PDS_ADMIN_PASSWORD: admin,
        ATLAS_PDS_INTERNAL_URL: `http://127.0.0.1:${upstream.address().port}`,
        ATLAS_PDS_INVITE_BROKER_PORT: String(port),
        PDS_HOSTNAME: "pds.example.org",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(() => child.kill());
  await once(child.stdout, "data");
  const origin = `http://127.0.0.1:${port}/_atlas/pds/invites`;
  return {
    calls,
    get deleted() {
      return deleted;
    },
    capability: () =>
      fetch(origin, { headers: { authorization: `Bearer ${token}` } }),
    cleanup: (patch = {}, authorized = true) =>
      fetch(origin, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorized ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: "cleanup-hosted-e2e",
          runId,
          accounts: [{ handle, email }],
          ...patch,
        }),
      }),
  };
}

test("cleanup preflight verifies admin connectivity without creating or deleting accounts", async (t) => {
  const f = await fixture(t);
  const response = await f.capability();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { hostedFixtureCleanup: true });
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0], /^\/xrpc\/com.atproto.admin.getAccountInfo\?did=/);
  assert.equal(f.deleted, false);
});

test("cleanup preflight fails closed when the PDS admin credential is rejected", async (t) => {
  const f = await fixture(t, { adminDenied: true });
  const response = await f.capability();
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "broker_operation_failed" });
  assert.equal(f.deleted, false);
});

test("broker cleanup deletes verified exact-run fixtures and reads back absence", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.cleanup({}, false)).status, 401);
  assert.equal((await f.cleanup({ runId: "38246581598-1" })).status, 400);
  assert.equal(f.calls.length, 0);
  const response = await f.cleanup();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    deletedDids: [did],
    cleanedHandles: [handle],
  });
  assert.equal(
    f.calls.filter((path) => path === "/xrpc/com.atproto.admin.deleteAccount")
      .length,
    1,
  );
  assert.equal(
    f.calls.filter((path) =>
      path.startsWith("/xrpc/com.atproto.admin.getAccountInfo"),
    ).length,
    2,
  );
  const repeated = await f.cleanup();
  assert.equal(repeated.status, 200);
  assert.deepEqual(await repeated.json(), {
    deletedDids: [],
    cleanedHandles: [handle],
  });
});

test("broker retains an account with a different provider email", async (t) => {
  const f = await fixture(t, { realEmail: "person@example.org" });
  assert.equal((await f.cleanup()).status, 502);
  assert.equal(f.deleted, false);
});

test("generic unresolved handles require complete authenticated inventory before cleanup", async (t) => {
  const f = await fixture(t, { unresolved: true, absent: true });
  const response = await f.cleanup();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    deletedDids: [],
    cleanedHandles: [handle],
  });
  assert.ok(
    f.calls.some((path) =>
      path.startsWith("/xrpc/com.atproto.admin.searchAccounts"),
    ),
  );
  assert.equal(f.deleted, false);
});

test("unresolved exact fixtures are verified by DID before deletion and cleanup is repeatable", async (t) => {
  const f = await fixture(t, { unresolved: true });
  assert.equal(
    (await f.cleanup({ accounts: [{ handle, email, did }] })).status,
    200,
  );
  assert.equal(f.deleted, true);
  assert.equal(
    (await f.cleanup({ accounts: [{ handle, email, did }] })).status,
    200,
  );
});

for (const options of [
  { inventoryDenied: true },
  { inventoryCursor: true },
  { realEmail: "person@example.org" },
])
  test(`unresolved handle inventory fails closed ${JSON.stringify(options)}`, async (t) => {
    const f = await fixture(t, { unresolved: true, ...options });
    assert.equal((await f.cleanup()).status, 502);
    assert.equal(f.deleted, false);
  });

test("broker verifies every account before deleting any", async (t) => {
  const f = await fixture(t);
  const response = await f.cleanup({
    accounts: [
      { handle, email },
      {
        handle: "a382465815971g.pds.example.org",
        email,
      },
    ],
  });
  assert.equal(response.status, 502);
  assert.equal(f.deleted, false);
});

for (const options of [{ staleReadback: true }, { deleteDenied: true }])
  test(`broker rejects unverified deletion ${JSON.stringify(options)}`, async (t) => {
    const f = await fixture(t, options);
    const response = await f.cleanup();
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: "broker_operation_failed",
    });
  });

for (const accounts of [
  [{ handle: "person.pds.example.org", email }],
  [{ handle, email: "person@example.org" }],
  [
    { handle, email },
    { handle, email },
  ],
  [null],
])
  test(`broker rejects non-fixture scope ${JSON.stringify(accounts)}`, async (t) => {
    const f = await fixture(t);
    const response = await f.cleanup({ accounts });
    assert.equal(response.status, 400);
    assert.equal(f.calls.length, 0);
    assert.equal(f.deleted, false);
  });
