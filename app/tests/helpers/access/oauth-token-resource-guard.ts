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

/**
 * Builds a token request whose body is JSON rather than form-encoded, which is
 * what some MCP clients send.
 *
 * @param body - The raw request body, already serialized.
 */
export function jsonTokenRequest(body: string): Request {
  return new Request("https://atlas.test/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

/**
 * Builds an auth stand-in whose verification store holds exactly the value
 * given, so tests can exercise codes stored in unexpected shapes.
 *
 * @param value - The stored verification value, or null when no code matches.
 */
export function authWithStoredValue(value: string | null): GuardFixture {
  const findVerificationValue = vi.fn().mockResolvedValue(value === null ? null : { value });

  return {
    auth: { $context: Promise.resolve({ internalAdapter: { findVerificationValue } }) },
    findVerificationValue,
  };
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
