// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { setLastUsedAtlasLoginMethod } from "@/domains/access/client/last-login-method";

describe("last-login-method", () => {
  it("sets the last used login method in a cookie", () => {
    setLastUsedAtlasLoginMethod("passkey");
    expect(document.cookie).toContain("better-auth.last_used_login_method=passkey");
  });

  it("handles magic-link as a login method", () => {
    setLastUsedAtlasLoginMethod("magic-link");
    expect(document.cookie).toContain("better-auth.last_used_login_method=magic-link");
  });
});
