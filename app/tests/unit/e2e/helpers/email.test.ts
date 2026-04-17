import { describe, expect, it } from "vitest";
import { extractFirstUrlFromEmail } from "../../../../tests/e2e/helpers/email";

describe("extractFirstUrlFromEmail", () => {
  it("keeps plain query strings intact when the raw message already contains a URL", () => {
    const rawEmail = [
      "From: Atlas <noreply@localhost>",
      "To: operator@atlas.test",
      "Subject: Sign in to Atlas",
      "",
      "Use this link to sign in to Atlas: http://localhost:3100/api/auth/magic-link/verify?token=dbtPzTuRaCXIVjkqRpomCUuYRlYkFSrP&callbackURL=%2Faccount",
    ].join("\n");

    const url = extractFirstUrlFromEmail(rawEmail);

    expect(url).toBe(
      "http://localhost:3100/api/auth/magic-link/verify?token=dbtPzTuRaCXIVjkqRpomCUuYRlYkFSrP&callbackURL=%2Faccount",
    );
  });

  it("falls back to quoted-printable decoding when the raw message wraps the URL", () => {
    const rawEmail = [
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Use this link to sign in to Atlas: http://localhost:3100/api/auth/magic-lin=",
      "k/verify?token=3Dabc123&callbackURL=3D%2Faccount",
    ].join("\n");

    const url = extractFirstUrlFromEmail(rawEmail);

    expect(url).toBe(
      "http://localhost:3100/api/auth/magic-link/verify?token=abc123&callbackURL=%2Faccount",
    );
  });
});
