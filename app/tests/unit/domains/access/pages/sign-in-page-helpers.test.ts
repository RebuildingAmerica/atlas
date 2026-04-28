import { describe, expect, it } from "vitest";
import {
  buildMagicLinkStatusMessage,
  buildSignInCallbackURL,
  buildSignInErrorCallbackURL,
  extractSSORedirectUrl,
  isOAuthOriginSignIn,
  sanitizeSignInRedirectPath,
} from "@/domains/access/pages/auth/sign-in-page-helpers";

describe("sanitizeSignInRedirectPath", () => {
  it("accepts a same-origin absolute path", () => {
    expect(sanitizeSignInRedirectPath("/discovery")).toBe("/discovery");
    expect(sanitizeSignInRedirectPath("/account?tab=settings")).toBe("/account?tab=settings");
    expect(sanitizeSignInRedirectPath("/organization#section")).toBe("/organization#section");
  });

  it("rejects empty and missing inputs", () => {
    expect(sanitizeSignInRedirectPath(undefined)).toBeNull();
    expect(sanitizeSignInRedirectPath("")).toBeNull();
  });

  it("rejects absolute URLs", () => {
    expect(sanitizeSignInRedirectPath("https://attacker.example/cb")).toBeNull();
    expect(sanitizeSignInRedirectPath("http://attacker.example")).toBeNull();
    expect(sanitizeSignInRedirectPath("javascript:alert(1)")).toBeNull();
    expect(sanitizeSignInRedirectPath("data:text/html,<script>")).toBeNull();
  });

  it("rejects protocol-relative URLs", () => {
    expect(sanitizeSignInRedirectPath("//attacker.example/cb")).toBeNull();
  });

  it("rejects backslash-prefixed authority tricks", () => {
    expect(sanitizeSignInRedirectPath("/\\attacker.example")).toBeNull();
  });

  it("rejects non-absolute paths", () => {
    expect(sanitizeSignInRedirectPath("account")).toBeNull();
    expect(sanitizeSignInRedirectPath("./account")).toBeNull();
    expect(sanitizeSignInRedirectPath("../escape")).toBeNull();
  });

  it("rejects oversized inputs", () => {
    const huge = "/" + "a".repeat(2048);
    expect(sanitizeSignInRedirectPath(huge)).toBeNull();
  });
});

describe("buildSignInCallbackURL", () => {
  it("uses the sanitized redirectTo when safe", () => {
    expect(buildSignInCallbackURL(undefined, "/discovery")).toBe("/discovery");
  });

  it("falls back to /discovery when no invitation and no safe redirect", () => {
    expect(buildSignInCallbackURL()).toBe("/discovery");
    expect(buildSignInCallbackURL(undefined, "https://attacker.example")).toBe("/discovery");
    expect(buildSignInCallbackURL(undefined, "//attacker.example")).toBe("/discovery");
  });

  it("falls back to /organization for invitations with no safe redirect", () => {
    expect(buildSignInCallbackURL("inv-123")).toBe("/organization");
    expect(buildSignInCallbackURL("inv-123", "https://attacker.example")).toBe("/organization");
  });

  it("uses the sanitized redirectTo even for invitations", () => {
    expect(buildSignInCallbackURL("inv-123", "/organization?team=eng")).toBe(
      "/organization?team=eng",
    );
  });
});

describe("buildSignInErrorCallbackURL", () => {
  it("returns the bare sign-in path with no inputs", () => {
    expect(buildSignInErrorCallbackURL()).toBe("/sign-in");
  });

  it("preserves an invitation id", () => {
    expect(buildSignInErrorCallbackURL("inv-123")).toBe("/sign-in?invitation=inv-123");
  });

  it("preserves a safe redirect target", () => {
    expect(buildSignInErrorCallbackURL(undefined, "/discovery")).toBe(
      "/sign-in?redirect=%2Fdiscovery",
    );
  });

  it("drops an unsafe redirect target", () => {
    expect(buildSignInErrorCallbackURL(undefined, "https://attacker.example")).toBe("/sign-in");
    expect(buildSignInErrorCallbackURL("inv-123", "//attacker.example")).toBe(
      "/sign-in?invitation=inv-123",
    );
  });
});

describe("buildMagicLinkStatusMessage", () => {
  it("returns invitation copy when an invitation id is present", () => {
    expect(buildMagicLinkStatusMessage("inv-123")).toContain("review the invitation");
  });

  it("returns generic copy otherwise", () => {
    expect(buildMagicLinkStatusMessage()).toBe("A sign-in link is on the way. Check your inbox.");
  });
});

describe("isOAuthOriginSignIn", () => {
  it("returns true when the redirect points back into the OAuth flow", () => {
    expect(isOAuthOriginSignIn("/api/auth/oauth2/authorize?client_id=foo")).toBe(true);
    expect(isOAuthOriginSignIn("/api/auth/oauth2/par")).toBe(true);
  });

  it("returns false for unrelated redirect targets", () => {
    expect(isOAuthOriginSignIn("/discovery")).toBe(false);
    expect(isOAuthOriginSignIn("/account")).toBe(false);
    expect(isOAuthOriginSignIn(undefined)).toBe(false);
  });

  it("returns false for redirects that fail sanitization", () => {
    // Cross-origin candidates should never trip the OAuth-origin signal even
    // when they syntactically look like the OAuth path; sanitization rejects
    // them first.
    expect(isOAuthOriginSignIn("//attacker.example/api/auth/oauth2/authorize")).toBe(false);
  });
});

describe("extractSSORedirectUrl", () => {
  it("returns the url string when present", () => {
    expect(extractSSORedirectUrl({ data: { url: "https://idp.example/auth" } })).toBe(
      "https://idp.example/auth",
    );
  });

  it("returns null for unexpected shapes", () => {
    expect(extractSSORedirectUrl(null)).toBeNull();
    expect(extractSSORedirectUrl({})).toBeNull();
    expect(extractSSORedirectUrl({ data: null })).toBeNull();
    expect(extractSSORedirectUrl({ data: { url: 42 } })).toBeNull();
  });
});
