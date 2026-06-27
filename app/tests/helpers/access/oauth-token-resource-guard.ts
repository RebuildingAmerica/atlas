import { vi } from "vitest";
import type { enforceOAuthTokenResourceConsistency } from "@/domains/access/server/oauth-token-resource-guard";

type ResourceGuardAuth = Parameters<typeof enforceOAuthTokenResourceConsistency>[1];

interface GuardFixture {
  auth: ResourceGuardAuth;
  findVerificationValue: ReturnType<typeof vi.fn>;
}

export function tokenRequest(body: URLSearchParams): Request {
  return new Request("https://atlas.test/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

export function authWithVerification(resource: string | undefined): GuardFixture {
  const findVerificationValue = vi.fn().mockResolvedValue({
    value: JSON.stringify({
      type: "authorization_code",
      query: {
        client_id: "client_123",
        redirect_uri: "http://127.0.0.1/callback",
        ...(resource ? { resource } : {}),
      },
      userId: "user_123",
    }),
  });

  return {
    auth: {
      $context: Promise.resolve({
        internalAdapter: {
          findVerificationValue,
        },
      }),
    },
    findVerificationValue,
  };
}
