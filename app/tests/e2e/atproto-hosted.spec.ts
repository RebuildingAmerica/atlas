import { expect, test } from "@playwright/test";
import {
  absoluteHostedUrl,
  hostedPublicRequestInit,
  requiredHostedOrigin,
} from "../helpers/hosted-endpoints";

interface OAuthClientMetadata {
  client_id: string;
  client_name: string;
  client_uri: string;
  redirect_uris: string[];
  scope: string;
}

function parseOAuthClientMetadata(value: unknown): OAuthClientMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected ATProto client metadata to be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.client_id !== "string" ||
    typeof record.client_name !== "string" ||
    typeof record.client_uri !== "string" ||
    typeof record.scope !== "string" ||
    !Array.isArray(record.redirect_uris) ||
    !record.redirect_uris.every((item) => typeof item === "string")
  ) {
    throw new Error("Expected ATProto client metadata to include typed OAuth fields.");
  }
  return {
    client_id: record.client_id,
    client_name: record.client_name,
    client_uri: record.client_uri,
    redirect_uris: record.redirect_uris,
    scope: record.scope,
  };
}

async function parseJsonResponse(response: Response, label: string): Promise<unknown> {
  const body = await response.text();
  expect(response.status, label).toBe(200);
  expect(body.length, `${label} body length`).toBeGreaterThan(0);
  return JSON.parse(body) as unknown;
}

test.describe("hosted ATProto identity routes", () => {
  test("serves configured client metadata through the public app", async () => {
    const publicOrigin = requiredHostedOrigin("ATLAS_HOSTED_PUBLIC_URL");

    const metadata = parseOAuthClientMetadata(
      await parseJsonResponse(
        await fetch(
          absoluteHostedUrl(publicOrigin, "/api/atproto/oauth/client-metadata.json"),
          hostedPublicRequestInit(),
        ),
        "public ATProto client metadata",
      ),
    );

    expect(metadata.client_id).toBe(
      absoluteHostedUrl(publicOrigin, "/api/atproto/oauth/client-metadata.json"),
    );
    expect(metadata.client_name).toBe("Atlas");
    expect(metadata.client_uri).toBe(publicOrigin);
    expect(metadata.redirect_uris).toContain(
      absoluteHostedUrl(publicOrigin, "/api/atproto/oauth/callback"),
    );
    expect(metadata.scope).toBe("atproto");
  });

  test("keeps sign-in start fail-closed for malformed hosted requests", async () => {
    const publicOrigin = requiredHostedOrigin("ATLAS_HOSTED_PUBLIC_URL");

    const response = await fetch(
      absoluteHostedUrl(publicOrigin, "/api/atproto/sign-in/start"),
      hostedPublicRequestInit({ redirect: "manual" }),
    );
    const payload = (await response.json()) as { error?: unknown };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("ATProto handle is required.");
  });

  test("serves the managed PDS public health endpoint", async () => {
    const pdsOrigin = requiredHostedOrigin("ATLAS_HOSTED_PDS_URL");

    const response = await fetch(absoluteHostedUrl(pdsOrigin, "/xrpc/_health"));
    const payload = (await response.json()) as { version?: unknown };

    expect(response.status).toBe(200);
    expect(typeof payload.version).toBe("string");
    expect(payload.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
