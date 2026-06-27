// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InvitationEmail } from "@/platform/email/templates/invitation-email";

describe("InvitationEmail template", () => {
  it("renders the organization name and the sign-in URL", () => {
    const markup = renderToStaticMarkup(
      <InvitationEmail
        organizationName="Atlas Research"
        signInUrl="https://atlas.test/sign-in?invitation=abc"
      />,
    );

    expect(markup).toMatch(/You(?:&rsquo;|&#x27;|\u2019)ve been invited/);
    expect(markup).toContain("Atlas Research");
    expect(markup).toContain('href="https://atlas.test/sign-in?invitation=abc"');
    expect(markup).toContain("Accept invitation");
  });
});
