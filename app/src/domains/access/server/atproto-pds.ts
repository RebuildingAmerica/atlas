import "@tanstack/react-start/server-only";

import { createHash, randomBytes } from "node:crypto";
import { AtpAgent } from "@atproto/api";
import { getAuthRuntimeConfig } from "./runtime";

export interface ManagedAtprotoProvisionInput {
  email: string;
  handle: string;
  userId: string;
}

export interface ManagedAtprotoProvisionResult {
  current_handle: string;
  did: string;
  pds_url: string;
}

/**
 * Creates a managed ATProto account without retaining its password or session
 * tokens. Atlas persists the resulting public DID through its existing control
 * graph, never through this protocol adapter.
 */
export async function provisionManagedAtprotoIdentity(
  input: ManagedAtprotoProvisionInput,
): Promise<ManagedAtprotoProvisionResult> {
  if (isE2EHarnessEnabled()) {
    const handle = input.handle.trim().toLowerCase().replace(/^@/, "");
    return {
      current_handle: handle,
      did: `did:web:${handle}`,
      pds_url: "https://pds.atlas-e2e.test",
    };
  }

  const pdsUrl = getManagedAtprotoPdsUrl();
  const agent = new AtpAgent({ service: pdsUrl });
  const inviteCode = await createManagedAtprotoInviteCode(pdsUrl);
  const account = await agent.createAccount({
    email: managedPdsAccountEmail(input),
    handle: input.handle.trim(),
    inviteCode,
    password: randomBytes(32).toString("base64url"),
  });

  return {
    current_handle: account.data.handle,
    did: account.data.did,
    pds_url: pdsUrl,
  };
}

function isE2EHarnessEnabled(): boolean {
  return process.env.ATLAS_ATPROTO_PDS_E2E_HARNESS === "1";
}

function managedPdsAccountEmail(input: ManagedAtprotoProvisionInput): string {
  const accountEmail = input.email.trim().toLowerCase();
  const atIndex = accountEmail.lastIndexOf("@");
  const domain = accountEmail.slice(atIndex + 1);
  if (atIndex <= 0 || !domain) {
    throw new Error("Atlas account email is required to provision an Atlas identity.");
  }

  const localPart =
    accountEmail
      .slice(0, atIndex)
      .replace(/[^a-z0-9.!#$%&'*+/=?^_`{|}~-]/g, "")
      .slice(0, 40) || "atlas";
  const identityDigest = createHash("sha256")
    .update(`${input.userId.trim()}:${input.handle.trim().toLowerCase().replace(/^@/, "")}`)
    .digest("hex")
    .slice(0, 16);
  return `${localPart}+atlas-${identityDigest}@${domain}`;
}

async function createManagedAtprotoInviteCode(pdsUrl: string): Promise<string | undefined> {
  const adminPassword = getAuthRuntimeConfig().atprotoPdsAdminPassword;
  if (!adminPassword) {
    return undefined;
  }

  const response = await fetch(new URL("/xrpc/com.atproto.server.createInviteCode", pdsUrl), {
    body: JSON.stringify({ useCount: 1 }),
    headers: {
      authorization: `Basic ${Buffer.from(`admin:${adminPassword}`).toString("base64")}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Atlas PDS invite creation failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as { code?: unknown };
  if (typeof body.code !== "string" || !body.code.trim()) {
    throw new Error("Atlas PDS invite creation did not return a code.");
  }

  return body.code;
}

function getManagedAtprotoPdsUrl(): string {
  const configuredUrl = getAuthRuntimeConfig().atprotoPdsUrl;
  if (!configuredUrl) {
    throw new Error("ATLAS_PDS_PUBLIC_URL is required to provision an Atlas identity.");
  }

  const pdsUrl = new URL(configuredUrl);
  if (pdsUrl.protocol !== "https:") {
    throw new Error("ATLAS_PDS_PUBLIC_URL must use https.");
  }

  return pdsUrl.toString().replace(/\/$/, "");
}
