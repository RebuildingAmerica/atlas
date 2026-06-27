import { describe, expect, it } from "vitest";
import { enforceOAuthTokenResourceConsistency } from "@/domains/access/server/oauth-token-resource-guard";
import {
  authWithVerification,
  tokenRequest,
} from "@/../tests/helpers/access/oauth-token-resource-guard";

describe("enforceOAuthTokenResourceConsistency", () => {
  it("rejects token exchanges whose resource differs from the authorization request", async () => {
    const fixture = authWithVerification("https://atlas.test/mcp");
    const response = await enforceOAuthTokenResourceConsistency(
      tokenRequest(
        new URLSearchParams({
          grant_type: "authorization_code",
          code: "code_123",
          client_id: "client_123",
          redirect_uri: "http://127.0.0.1/callback",
          resource: "https://api.atlas.test",
        }),
      ),
      fixture.auth,
    );

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error: "invalid_request",
      error_description: "Token request resource must match the authorization request resource.",
    });
  });

  it("allows token exchanges whose resource matches the authorization request", async () => {
    const fixture = authWithVerification("https://atlas.test/mcp");
    const response = await enforceOAuthTokenResourceConsistency(
      tokenRequest(
        new URLSearchParams({
          grant_type: "authorization_code",
          code: "code_123",
          client_id: "client_123",
          redirect_uri: "http://127.0.0.1/callback",
          resource: "https://atlas.test/mcp",
        }),
      ),
      fixture.auth,
    );

    expect(response).toBeNull();
  });

  it("requires the token request to repeat a resource from the authorization request", async () => {
    const fixture = authWithVerification("https://atlas.test/mcp");
    const response = await enforceOAuthTokenResourceConsistency(
      tokenRequest(
        new URLSearchParams({
          grant_type: "authorization_code",
          code: "code_123",
          client_id: "client_123",
          redirect_uri: "http://127.0.0.1/callback",
        }),
      ),
      fixture.auth,
    );

    expect(response?.status).toBe(400);
  });

  it("leaves non-authorization-code token requests to Better Auth", async () => {
    const fixture = authWithVerification("https://atlas.test/mcp");

    const response = await enforceOAuthTokenResourceConsistency(
      tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: "rt" })),
      fixture.auth,
    );

    expect(response).toBeNull();
    expect(fixture.findVerificationValue).not.toHaveBeenCalled();
  });
});
