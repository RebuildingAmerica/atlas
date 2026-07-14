import "@tanstack/react-start/server-only";

import { randomBytes } from "node:crypto";
import { AtpAgent } from "@atproto/api";
import { getAuthRuntimeConfig } from "./runtime";

export interface ManagedAtprotoProvisionInput {
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
  const account = await agent.createAccount({
    handle: input.handle.trim(),
    password: randomBytes(32).toString("base64url"),
  });

  return {
    current_handle: account.data.handle,
    did: account.data.did,
    pds_url: pdsUrl,
  };
}

function isE2EHarnessEnabled(): boolean {
  return process.env.ATLAS_ATPROTO_OAUTH_E2E_HARNESS === "1";
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
