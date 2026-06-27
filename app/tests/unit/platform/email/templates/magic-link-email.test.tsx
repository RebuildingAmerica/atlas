// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MagicLinkEmail } from "@/platform/email/templates/magic-link-email";

describe("MagicLinkEmail template", () => {
  it("renders the sign-in URL and fallback link", () => {
    const markup = renderToStaticMarkup(
      <MagicLinkEmail url="https://atlas.test/sign-in/magic?token=abc" />,
    );

    expect(markup).toContain("Sign in to Atlas");
    expect(markup).toContain('href="https://atlas.test/sign-in/magic?token=abc"');
    expect(markup).toContain("Or copy and paste this URL into your browser");
  });
});
