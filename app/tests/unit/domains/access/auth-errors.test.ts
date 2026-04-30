import { describe, expect, it } from "vitest";
import {
  AtlasAuthError,
  AUTH_ERROR_CODE,
  buildAuthErrorLabels,
  describePasskeyError,
  extractAuthErrorCode,
} from "@/domains/access/auth-errors";

describe("extractAuthErrorCode", () => {
  it("returns null for non-Error values", () => {
    expect(extractAuthErrorCode("nope")).toBeNull();
    expect(extractAuthErrorCode(null)).toBeNull();
  });

  it("returns null when the message is not a known auth code", () => {
    expect(extractAuthErrorCode(new Error("something else"))).toBeNull();
  });

  it("recovers a code from an AtlasAuthError that crossed the boundary", () => {
    const error = new AtlasAuthError(AUTH_ERROR_CODE.EMAIL_DELIVERY_FAILED);
    expect(extractAuthErrorCode(error)).toBe(AUTH_ERROR_CODE.EMAIL_DELIVERY_FAILED);
    expect(extractAuthErrorCode(new Error(AUTH_ERROR_CODE.LOCAL_MODE))).toBe(
      AUTH_ERROR_CODE.LOCAL_MODE,
    );
  });
});

describe("buildAuthErrorLabels", () => {
  it("uses sign-in copy when the action is sign-in", () => {
    const labels = buildAuthErrorLabels("sign-in");
    expect(labels[AUTH_ERROR_CODE.AUTH_UNAVAILABLE]).toMatch(/Sign-in is temporarily unavailable/);
    expect(labels[AUTH_ERROR_CODE.EMAIL_DELIVERY_FAILED]).toMatch(/sign-in link/);
    expect(labels[AUTH_ERROR_CODE.LOCAL_MODE]).toMatch(/Sign-in is not available/);
  });

  it("uses sign-up copy when the action is sign-up", () => {
    const labels = buildAuthErrorLabels("sign-up");
    expect(labels[AUTH_ERROR_CODE.AUTH_UNAVAILABLE]).toMatch(/Sign-up is temporarily unavailable/);
    expect(labels[AUTH_ERROR_CODE.EMAIL_DELIVERY_FAILED]).toMatch(/sign-up link/);
    expect(labels[AUTH_ERROR_CODE.LOCAL_MODE]).toMatch(/Sign-up is not available/);
  });
});

describe("describePasskeyError", () => {
  it("returns the generic message when no raw message is supplied", () => {
    expect(describePasskeyError(undefined)).toBe(
      "Passkey authentication failed. Please try again.",
    );
  });

  it("treats NotAllowedError or AbortError as cancellation", () => {
    expect(describePasskeyError("NotAllowedError: blocked")).toBe(
      "Passkey authentication was cancelled.",
    );
    expect(describePasskeyError("AbortError: user aborted")).toBe(
      "Passkey authentication was cancelled.",
    );
  });

  it("explains NotSupportedError in plain language", () => {
    expect(describePasskeyError("NotSupportedError: nope")).toBe(
      "Passkeys are not supported on this device or browser.",
    );
  });

  it("flags InvalidStateError as a duplicate registration", () => {
    expect(describePasskeyError("InvalidStateError: already registered")).toBe(
      "This passkey is already registered on your account.",
    );
  });

  it("falls back to the generic message for unknown errors", () => {
    expect(describePasskeyError("RandomError: weird")).toBe(
      "Passkey authentication failed. Please try again.",
    );
  });
});
