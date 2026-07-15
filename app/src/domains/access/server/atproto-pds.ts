import "@tanstack/react-start/server-only";

import { randomBytes } from "node:crypto";
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
    email: input.email.trim(),
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
