import { Buffer } from "node:buffer";
import http from "node:http";

const brokerSecret = requiredEnv("ATLAS_PDS_INVITE_BROKER_SECRET");
const pdsAdminPassword = requiredEnv("PDS_ADMIN_PASSWORD");
const pdsOrigin = process.env.ATLAS_PDS_INTERNAL_URL || "http://atlas-pds:2583";
const port = Number.parseInt(process.env.ATLAS_PDS_INVITE_BROKER_PORT || "2584", 10);

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
  const response = await fetch(new URL("/xrpc/com.atproto.server.createInviteCode", pdsOrigin), {
    body: JSON.stringify({ useCount }),
    headers: {
      authorization: `Basic ${Buffer.from(`admin:${pdsAdminPassword}`).toString("base64")}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`PDS invite creation failed with HTTP ${response.status}.`);
  }

  const body = await response.json();
  if (typeof body.code !== "string" || !body.code.trim()) {
    throw new Error("PDS invite creation did not return a code.");
  }
  return body.code;
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url !== "/_atlas/pds/invites") {
      writeJson(response, 404, { error: "not_found" });
      return;
    }
    if (request.method !== "POST") {
      writeJson(response, 405, { error: "method_not_allowed" });
      return;
    }
    if (request.headers.authorization !== `Bearer ${brokerSecret}`) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }

    const rawBody = await readRequestBody(request);
    const parsedBody = rawBody ? JSON.parse(rawBody) : {};
    const useCount = Number.isInteger(parsedBody.useCount) ? parsedBody.useCount : 1;
    if (useCount < 1 || useCount > 1) {
      writeJson(response, 400, { error: "invalid_use_count" });
      return;
    }

    const code = await createInviteCode(useCount);
    writeJson(response, 200, { code });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    writeJson(response, 502, { error: "invite_creation_failed" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Atlas PDS invite broker listening on ${port}`);
});
