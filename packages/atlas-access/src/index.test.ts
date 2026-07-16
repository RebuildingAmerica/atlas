import { describe, expect, it } from "vitest";
import { normalizeDeviceUserCode } from "./device-code";
import { sanitizeAtlasRedirectPath } from "./redirect-paths";
import { SignInEmailForm } from ".";

describe("atlas access public behavior", () => {
  it("exports the reusable sign-in identity form", () => {
    expect(SignInEmailForm).toBeTypeOf("function");
  });

  it("keeps sign-in codes and return paths safe", () => {
    expect(normalizeDeviceUserCode("a1b2 c3d4")).toBe("A1B2-C3D4");
    expect(sanitizeAtlasRedirectPath("/account")).toBe("/account");
    expect(sanitizeAtlasRedirectPath("https://outside.example")).toBeNull();
  });
});
