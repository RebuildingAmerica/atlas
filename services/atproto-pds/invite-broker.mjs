import { Buffer } from "node:buffer";
import http from "node:http";

const brokerSecret = requiredEnv("ATLAS_PDS_INVITE_BROKER_SECRET");
const pdsAdminPassword = requiredEnv("PDS_ADMIN_PASSWORD");
const pdsOrigin = process.env.ATLAS_PDS_INTERNAL_URL || "http://atlas-pds:2583";
const port = Number.parseInt(
  process.env.ATLAS_PDS_INVITE_BROKER_PORT || "2584",
  10,
);

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024) {
        request.destroy(new Error("Request body is too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function createInviteCode(useCount) {
  const response = await fetch(
    new URL("/xrpc/com.atproto.server.createInviteCode", pdsOrigin),
    {
      body: JSON.stringify({ useCount }),
      headers: {
        authorization: `Basic ${Buffer.from(`admin:${pdsAdminPassword}`).toString("base64")}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(`PDS invite creation failed with HTTP ${response.status}.`);
  }

  const body = await response.json();
  if (typeof body.code !== "string" || !body.code.trim()) {
    throw new Error("PDS invite creation did not return a code.");
  }
  return body.code;
}

async function pdsRequest(path, body) {
  return fetch(new URL(path, pdsOrigin), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`admin:${pdsAdminPassword}`).toString("base64")}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
}

async function assertFixtureCleanupAvailable() {
  requiredEnv("PDS_HOSTNAME");
  // The same Basic admin verifier protects deletion. A missing probe account
  // proves authenticated read access without creating a disposable account.
  const did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
  const response = await pdsRequest(
    `/xrpc/com.atproto.admin.getAccountInfo?did=${did}`,
  );
  const body = await response.json();
  if (
    !(response.status === 400 && body.error === "NotFound") &&
    !(response.ok && body.did === did)
  )
    throw new Error("fixture_cleanup_unavailable");
}

async function cleanupHostedFixtures(input) {
  const runId = input.runId;
  const hostname = requiredEnv("PDS_HOSTNAME");
  if (
    !/^\d{1,11}-[1-9]\d?$/.test(runId ?? "") ||
    !Array.isArray(input.accounts) ||
    input.accounts.length > 3
  )
    throw new Error("invalid_fixture_scope");
  const compact = runId.replaceAll("-", "").slice(-12);
  const accounts = input.accounts;
  const handles = new Set();
  for (const account of accounts) {
    if (
      !account ||
      typeof account !== "object" ||
      typeof account.handle !== "string"
    )
      throw new Error("invalid_fixture_scope");
    const role =
      account.handle === `a${compact}d.${hostname}` ? "delegate" : "owner";
    const allowed = role === "delegate" ? ["d"] : ["o", "g"];
    const prefix = `atlas-hosted-e2e+${runId}-${role}+atlas-`;
    if (
      !allowed.some(
        (marker) => account.handle === `a${compact}${marker}.${hostname}`,
      ) ||
      (account.did !== undefined &&
        (typeof account.did !== "string" ||
          !/^did:plc:[a-z0-9]+$/.test(account.did))) ||
      typeof account.email !== "string" ||
      !account.email.startsWith(prefix) ||
      !/^[a-f0-9]{16}@atlas\.test$/.test(account.email.slice(prefix.length)) ||
      handles.has(account.handle)
    )
      throw new Error("invalid_fixture_scope");
    handles.add(account.handle);
  }
  const pds = pdsRequest;
  const verified = [];
  for (const account of accounts) {
    const resolved = await pds(
      `/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(account.handle)}`,
    );
    const resolution = await resolved.json();
    const absent =
      resolved.status === 400 && resolution.error === "HandleNotFound";
    const unresolved =
      resolved.status === 400 &&
      resolution.error === "InvalidRequest" &&
      resolution.message === "Unable to resolve handle";
    if (!resolved.ok && !absent && !unresolved)
      throw new Error("fixture_resolution_failed");
    let did = resolved.ok ? resolution.did : account.did;
    if (!did) {
      // This PDS does not expose admin.searchAccounts. A missing repository
      // corroborates an unresolved exact-run handle before treating it as absent.
      const repo = await pds(
        `/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(account.handle)}`,
      );
      const description = await repo.json();
      if (repo.status === 400 && description.error === "RepoNotFound") continue;
      if (!repo.ok || description.handle !== account.handle)
        throw new Error("fixture_resolution_failed");
      did = description.did;
    }
    if (account.did !== undefined && account.did !== did)
      throw new Error("fixture_account_mismatch");
    if (typeof did !== "string" || !/^did:plc:[a-z0-9]+$/.test(did))
      throw new Error("fixture_resolution_failed");
    const info = await pds(
      `/xrpc/com.atproto.admin.getAccountInfo?did=${encodeURIComponent(did)}`,
    );
    const actual = await info.json();
    if (info.status === 400 && actual.error === "NotFound") continue;
    if (
      !info.ok ||
      actual.did !== did ||
      actual.handle !== account.handle ||
      actual.email !== account.email
    )
      throw new Error("fixture_account_mismatch");
    verified.push(did);
  }
  for (const did of verified) {
    const deleted = await pds("/xrpc/com.atproto.admin.deleteAccount", { did });
    if (!deleted.ok) throw new Error("fixture_deletion_failed");
    const readback = await pds(
      `/xrpc/com.atproto.admin.getAccountInfo?did=${encodeURIComponent(did)}`,
    );
    const result = await readback.json();
    if (readback.status !== 400 || result.error !== "NotFound")
      throw new Error("fixture_deletion_unverified");
  }
  return {
    deletedDids: verified,
    cleanedHandles: accounts.map((account) => account.handle),
  };
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url !== "/_atlas/pds/invites") {
      writeJson(response, 404, { error: "not_found" });
      return;
    }
    if (request.headers.authorization !== `Bearer ${brokerSecret}`) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }

    if (request.method === "GET") {
      await assertFixtureCleanupAvailable();
      writeJson(response, 200, { hostedFixtureCleanup: true });
      return;
    }
    if (request.method !== "POST") {
      writeJson(response, 405, { error: "method_not_allowed" });
      return;
    }

    const rawBody = await readRequestBody(request);
    const parsedBody = rawBody ? JSON.parse(rawBody) : {};
    if (parsedBody.action === "cleanup-hosted-e2e") {
      writeJson(response, 200, await cleanupHostedFixtures(parsedBody));
      return;
    }
    if (parsedBody.action !== undefined) {
      writeJson(response, 400, { error: "invalid_action" });
      return;
    }
    const useCount = Number.isInteger(parsedBody.useCount)
      ? parsedBody.useCount
      : 1;
    if (useCount < 1 || useCount > 1) {
      writeJson(response, 400, { error: "invalid_use_count" });
      return;
    }

    const code = await createInviteCode(useCount);
    writeJson(response, 200, { code });
  } catch (error) {
    console.error("PDS broker operation failed.");
    const invalid =
      error instanceof Error && error.message === "invalid_fixture_scope";
    writeJson(response, invalid ? 400 : 502, {
      error: invalid ? "invalid_fixture_scope" : "broker_operation_failed",
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Atlas PDS invite broker listening on ${port}`);
});
