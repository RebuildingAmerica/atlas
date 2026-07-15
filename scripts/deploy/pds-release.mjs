#!/usr/bin/env node

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function optionalPositiveIntegerEnv(name, fallback) {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) return fallback;
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function pdsHealthUrl(pdsOrigin) {
  const origin = new URL(pdsOrigin);
  if (origin.protocol !== "https:") {
    throw new Error("ATLAS_PDS_PUBLIC_URL must use HTTPS.");
  }
  if (origin.username || origin.password) {
    throw new Error("ATLAS_PDS_PUBLIC_URL must not include credentials.");
  }
  return new URL("/xrpc/_health", origin).toString();
}

export function pdsInviteBrokerUrl(pdsOrigin) {
  const origin = new URL(pdsOrigin);
  if (origin.protocol !== "https:") {
    throw new Error("ATLAS_PDS_PUBLIC_URL must use HTTPS.");
  }
  if (origin.username || origin.password) {
    throw new Error("ATLAS_PDS_PUBLIC_URL must not include credentials.");
  }
  return new URL("/_atlas/pds/invites", origin).toString();
}

export async function probePdsHealth(pdsOrigin, fetchImpl = fetch) {
  const url = pdsHealthUrl(pdsOrigin);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`PDS health probe failed with HTTP ${response.status}.`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("PDS health response was not valid JSON.");
  }
  if (!payload || typeof payload.version !== "string" || !payload.version) {
    throw new Error("PDS health response did not include a version.");
  }
  return { url, version: payload.version };
}

export async function probePdsInviteBrokerRoute(pdsOrigin, fetchImpl = fetch) {
  const url = pdsInviteBrokerUrl(pdsOrigin);
  const response = await fetchImpl(url, {
    body: JSON.stringify({ useCount: 1 }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (response.status !== 401) {
    throw new Error(
      `PDS invite broker route probe failed with HTTP ${response.status}.`,
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("PDS invite broker route response was not valid JSON.");
  }
  if (!payload || payload.error !== "unauthorized") {
    throw new Error(
      "PDS invite broker route did not return the broker unauthorized response.",
    );
  }
  return { url };
}

export async function waitForProbe(probe, options = {}) {
  const attempts = options.attempts ?? 12;
  const delayMs = options.delayMs ?? 5_000;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await probe();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

async function main() {
  const command = process.argv[2];
  const attempts = optionalPositiveIntegerEnv("ATLAS_PDS_PROBE_ATTEMPTS", 12);
  const delayMs = optionalPositiveIntegerEnv("ATLAS_PDS_PROBE_DELAY_MS", 5_000);
  if (command === "health") {
    const result = await waitForProbe(
      () => probePdsHealth(requiredEnv("ATLAS_PDS_PUBLIC_URL")),
      { attempts, delayMs },
    );
    console.log(`PDS health probe passed: ${result.url} (${result.version})`);
    return;
  }
  if (command === "invite-broker-route") {
    const result = await waitForProbe(
      () => probePdsInviteBrokerRoute(requiredEnv("ATLAS_PDS_PUBLIC_URL")),
      { attempts, delayMs },
    );
    console.log(`PDS invite broker route probe passed: ${result.url}`);
    return;
  }
  throw new Error("Usage: pds-release.mjs health|invite-broker-route");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
