// @vitest-environment node
import { describe, expect, it } from "vitest";
import { setLastUsedAtlasLoginMethod } from "@/domains/access/client/last-login-method";

describe("last-login-method (SSR)", () => {
  it("is a no-op when document is unavailable", () => {
    expect(() => {
      setLastUsedAtlasLoginMethod("passkey");
    }).not.toThrow();
  });
});
