import { describe, expect, it } from "vitest";
import { enforceOAuthTokenResourceConsistency } from "@/domains/access/server/oauth-token-resource-guard";
import {
  authWithStoredValue,
  authWithVerification,
  jsonTokenRequest,
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

  it("rejects a token exchange that smuggles in a second resource", async () => {
    const fixture = authWithVerification("https://atlas.test/mcp");
    const body = new URLSearchParams({ grant_type: "authorization_code", code: "code_123" });
    body.append("resource", "https://atlas.test/mcp");
    body.append("resource", "https://api.atlas.test");

    const response = await enforceOAuthTokenResourceConsistency(tokenRequest(body), fixture.auth);

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error: "invalid_request",
      error_description: "Token request must include exactly one resource parameter.",
    });
    expect(fixture.findVerificationValue).not.toHaveBeenCalled();
  });

  it("applies the same rule to a JSON token request", async () => {
    const fixture = authWithVerification("https://atlas.test/mcp");

    await expect(
      enforceOAuthTokenResourceConsistency(
        jsonTokenRequest(
          JSON.stringify({
            code: "code_123",
            grant_type: "authorization_code",
            resource: "https://atlas.test/mcp",
          }),
        ),
        fixture.auth,
      ),
    ).resolves.toBeNull();

    const mismatched = await enforceOAuthTokenResourceConsistency(
      jsonTokenRequest(
        JSON.stringify({
          code: "code_123",
          grant_type: "authorization_code",
          resource: "https://api.atlas.test",
        }),
      ),
      fixture.auth,
    );

    expect(mismatched?.status).toBe(400);
  });

  it("ignores a JSON body whose OAuth fields are not strings", async () => {
    const fixture = authWithVerification("https://atlas.test/mcp");

    const response = await enforceOAuthTokenResourceConsistency(
      jsonTokenRequest(JSON.stringify({ code: 1, grant_type: 2, resource: 3 })),
      fixture.auth,
    );

    expect(response).toBeNull();
    expect(fixture.findVerificationValue).not.toHaveBeenCalled();
  });

  it("defers to Better Auth when the body cannot be parsed at all", async () => {
    const fixture = authWithVerification("https://atlas.test/mcp");

    await expect(
      enforceOAuthTokenResourceConsistency(jsonTokenRequest("{not json"), fixture.auth),
    ).resolves.toBeNull();
  });

  it("defers to Better Auth for a body in an unsupported content type", async () => {
    const fixture = authWithVerification("https://atlas.test/mcp");

    const response = await enforceOAuthTokenResourceConsistency(
      new Request("https://atlas.test/api/auth/oauth2/token", {
        body: "opaque",
        headers: { "content-type": "application/octet-stream" },
        method: "POST",
      }),
      fixture.auth,
    );

    expect(response).toBeNull();
  });

  it("reads a body sent without a content type as form encoded", async () => {
    const fixture = authWithVerification("https://atlas.test/mcp");

    const response = await enforceOAuthTokenResourceConsistency(
      new Request("https://atlas.test/api/auth/oauth2/token", { method: "POST" }),
      fixture.auth,
    );

    expect(response).toBeNull();
    expect(fixture.findVerificationValue).not.toHaveBeenCalled();
  });

  it("only guards the token endpoint", async () => {
    const fixture = authWithVerification("https://atlas.test/mcp");

    await expect(
      enforceOAuthTokenResourceConsistency(
        new Request("https://atlas.test/api/auth/oauth2/authorize?client_id=abc"),
        fixture.auth,
      ),
    ).resolves.toBeNull();
    await expect(
      enforceOAuthTokenResourceConsistency(
        new Request("https://atlas.test/api/auth/oauth2/par", { method: "POST" }),
        fixture.auth,
      ),
    ).resolves.toBeNull();
    expect(fixture.findVerificationValue).not.toHaveBeenCalled();
  });

  it("leaves an unknown or already-redeemed code to Better Auth", async () => {
    const fixture = authWithStoredValue(null);

    await expect(
      enforceOAuthTokenResourceConsistency(
        tokenRequest(
          new URLSearchParams({
            code: "code_123",
            grant_type: "authorization_code",
            resource: "https://atlas.test/mcp",
          }),
        ),
        fixture.auth,
      ),
    ).resolves.toBeNull();
  });

  it("does not block a code that was stored in an unreadable shape", async () => {
    for (const stored of [
      "{not json",
      JSON.stringify({ type: "magic_link", query: { resource: "https://atlas.test/mcp" } }),
      JSON.stringify({ type: "authorization_code", query: "not-an-object" }),
      JSON.stringify({ type: "authorization_code", query: null }),
    ]) {
      const response = await enforceOAuthTokenResourceConsistency(
        tokenRequest(new URLSearchParams({ code: "code_123", grant_type: "authorization_code" })),
        authWithStoredValue(stored).auth,
      );
      expect(response).toBeNull();
    }
  });

  it("lets a resource-free authorization flow through untouched", async () => {
    const fixture = authWithVerification(undefined);

    await expect(
      enforceOAuthTokenResourceConsistency(
        tokenRequest(new URLSearchParams({ code: "code_123", grant_type: "authorization_code" })),
        fixture.auth,
      ),
    ).resolves.toBeNull();
  });

  it("rejects a resource added at token time that the authorization never asked for", async () => {
    const fixture = authWithVerification(undefined);

    const response = await enforceOAuthTokenResourceConsistency(
      tokenRequest(
        new URLSearchParams({
          code: "code_123",
          grant_type: "authorization_code",
          resource: "https://api.atlas.test",
        }),
      ),
      fixture.auth,
    );

    expect(response?.status).toBe(400);
  });
});
