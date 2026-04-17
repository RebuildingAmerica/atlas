import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMagicLinkSender, createVerificationEmailSender } from "@/domains/access/server/auth";

describe("createMagicLinkSender", () => {
  const originalAllowedEmails = process.env.ATLAS_AUTH_ALLOWED_EMAILS;
  const originalPublicUrl = process.env.ATLAS_PUBLIC_URL;

  beforeEach(() => {
    process.env.ATLAS_PUBLIC_URL = "https://atlas.test";
  });

  afterEach(() => {
    if (originalAllowedEmails === undefined) {
      delete process.env.ATLAS_AUTH_ALLOWED_EMAILS;
    } else {
      process.env.ATLAS_AUTH_ALLOWED_EMAILS = originalAllowedEmails;
    }

    if (originalPublicUrl === undefined) {
      delete process.env.ATLAS_PUBLIC_URL;
    } else {
      process.env.ATLAS_PUBLIC_URL = originalPublicUrl;
    }
  });

  it("delivers magic links for allowed emails", async () => {
    process.env.ATLAS_AUTH_ALLOWED_EMAILS = "operator@atlas.test";
    const deliverMagicLink = vi.fn().mockResolvedValue(undefined);

    await createMagicLinkSender(deliverMagicLink)({
      email: "operator@atlas.test",
      url: "https://atlas.test/sign-in",
    });

    expect(deliverMagicLink).toHaveBeenCalledWith(
      "operator@atlas.test",
      "https://atlas.test/sign-in",
    );
  });

  it("silently ignores unapproved emails", async () => {
    process.env.ATLAS_AUTH_ALLOWED_EMAILS = "operator@atlas.test";
    const deliverMagicLink = vi.fn().mockResolvedValue(undefined);

    await expect(
      createMagicLinkSender(deliverMagicLink)({
        email: "outside@atlas.test",
        url: "https://atlas.test/sign-in",
      }),
    ).resolves.toBeUndefined();

    expect(deliverMagicLink).not.toHaveBeenCalled();
  });
});

describe("createVerificationEmailSender", () => {
  it("delivers verification emails through the provided sender", async () => {
    const deliverVerificationEmail = vi.fn().mockResolvedValue(undefined);

    await createVerificationEmailSender(deliverVerificationEmail)({
      email: "operator@atlas.test",
      url: "https://atlas.test/account-setup",
    });

    expect(deliverVerificationEmail).toHaveBeenCalledWith(
      "operator@atlas.test",
      "https://atlas.test/account-setup",
    );
  });
});
