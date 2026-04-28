import { describe, expect, it } from "vitest";
import { describeSsoError } from "@/domains/access/sso-error-messages";

describe("describeSsoError", () => {
  it("returns null for unknown or missing codes", () => {
    expect(describeSsoError(null)).toBeNull();
    expect(describeSsoError("totally_unrecognised")).toBeNull();
  });

  it("maps a known code to a human-readable explanation", () => {
    const message = describeSsoError("certificate_invalid");
    expect(message).toMatch(/IdP signing certificate/i);
  });

  it("is case-insensitive on the input code", () => {
    expect(describeSsoError("Certificate_Invalid")).toBeTruthy();
  });
});
