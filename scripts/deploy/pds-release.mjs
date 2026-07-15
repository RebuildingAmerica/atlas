#!/usr/bin/env node

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
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

async function main() {
  const command = process.argv[2];
  if (command === "health") {
    const result = await probePdsHealth(requiredEnv("ATLAS_PDS_PUBLIC_URL"));
    console.log(`PDS health probe passed: ${result.url} (${result.version})`);
    return;
  }
  if (command === "invite-broker-route") {
    const result = await probePdsInviteBrokerRoute(
      requiredEnv("ATLAS_PDS_PUBLIC_URL"),
    );
    console.log(`PDS invite broker route probe passed: ${result.url}`);
    return;
  }
  throw new Error("Usage: pds-release.mjs health|invite-broker-route");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
