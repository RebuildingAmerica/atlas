import { describe, expect, it, vi } from "vitest";
import { PLATFORM_API_AUDIENCE } from "@/server/admin-env";
import {
  ADMIN_TOKEN_LIFETIME_SECONDS,
  signAdminToken,
} from "@/server/admin-token";
import {
  ADMIN_ORIGIN,
  makeSigningKey,
  TEST_OPERATOR,
} from "../helpers/admin-fixtures";
import { decodeSegment as decode } from "../helpers/jwt";

describe("the admin app's token", () => {
  it("is an Ed25519 JWT naming the operator, the admin and the platform API", async () => {
    const { pkcs8, publicKey } = await makeSigningKey();
    const now = Date.UTC(2026, 9, 2, 12);

    const token = await signAdminToken(
      { adminOrigin: ADMIN_ORIGIN, signingKey: pkcs8 },
      TEST_OPERATOR,
      now,
    );
    const [header = "", claims = "", signature = ""] = token.split(".");

    expect(decode(header)).toEqual({ alg: "EdDSA", typ: "JWT" });
    expect(decode(claims)).toEqual({
      act: TEST_OPERATOR,
      aud: PLATFORM_API_AUDIENCE,
      exp: now / 1000 + ADMIN_TOKEN_LIFETIME_SECONDS,
      iat: now / 1000,
      iss: ADMIN_ORIGIN,
      sub: "atlas-admin",
    });
    const verified = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(verified).toBe(true);
  });

  it("reuses the imported key across tokens", async () => {
    const { pkcs8 } = await makeSigningKey();
    const settings = { adminOrigin: ADMIN_ORIGIN, signingKey: pkcs8 };

    const first = await signAdminToken(settings, TEST_OPERATOR, 1_000);
    const second = await signAdminToken(settings, TEST_OPERATOR, 1_000);

    expect(second).toBe(first);
  });

  it("tries a failed key import again rather than keeping the failure", async () => {
    const importKey = vi.spyOn(crypto.subtle, "importKey");
    const settings = {
      adminOrigin: ADMIN_ORIGIN,
      signingKey: btoa("x".repeat(48)),
    };

    await expect(
      signAdminToken(settings, TEST_OPERATOR, 1_000),
    ).rejects.toThrow();
    await expect(
      signAdminToken(settings, TEST_OPERATOR, 1_000),
    ).rejects.toThrow();

    expect(importKey).toHaveBeenCalledTimes(2);
    importKey.mockRestore();
  });
});
