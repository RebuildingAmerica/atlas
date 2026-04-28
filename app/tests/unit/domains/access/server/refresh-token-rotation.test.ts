import { describe, expect, it } from "vitest";
import { buildAuthorizationServerMetadata } from "@/domains/access/oauth-as-metadata";

/**
 * Smoke checks that pin Atlas's OAuth 2.1 §4.3.1 refresh-token rotation
 * posture.
 *
 * Atlas delegates the actual rotation behavior to Better Auth's
 * `oauthProvider` plugin: on a `refresh_token` grant exchange, BetterAuth
 * marks the presented refresh token as revoked, issues a new pair, and (on
 * a reuse attempt) deletes every refresh token belonging to the same
 * user/client pair.  That logic lives in
 * `@better-auth/oauth-provider/dist/index.mjs` (token endpoint handler);
 * see commit history if upstream changes the behavior.
 *
 * These tests verify the configuration surface MCP clients depend on for
 * rotation to work end-to-end.  A full code-flow integration test would
 * essentially exercise BetterAuth's own implementation, which is out of
 * scope for this audit pass.
 */
describe("refresh-token rotation configuration", () => {
  it("advertises refresh_token in supported grant types", () => {
    const metadata = buildAuthorizationServerMetadata({
      publicBaseUrl: "https://atlas.example",
    });

    expect(metadata.grant_types_supported).toContain("refresh_token");
  });

  it("keeps PKCE S256 as the only code-challenge method (OAuth 2.1)", () => {
    const metadata = buildAuthorizationServerMetadata({
      publicBaseUrl: "https://atlas.example",
    });

    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("publishes scopes_supported as a defined list, including offline_access", () => {
    const metadata = buildAuthorizationServerMetadata({
      publicBaseUrl: "https://atlas.example",
    });

    expect(metadata.scopes_supported).toContain("offline_access");
  });
});
