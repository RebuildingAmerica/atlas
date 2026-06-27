// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VerificationEmail } from "@/platform/email/templates/verification-email";

describe("VerificationEmail template", () => {
  it("renders the verification URL and account setup copy", () => {
    const markup = renderToStaticMarkup(
      <VerificationEmail url="https://atlas.test/verify-email?token=abc" />,
    );

    expect(markup).toContain("Verify your email");
    expect(markup).toContain("complete your Atlas account setup");
    expect(markup).toContain('href="https://atlas.test/verify-email?token=abc"');
  });
});
