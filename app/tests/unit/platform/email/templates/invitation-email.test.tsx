// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { InvitationEmail } from "@/platform/email/templates/invitation-email";

describe("InvitationEmail template", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the organization name and the sign-in URL", () => {
    render(
      <InvitationEmail
        organizationName="Atlas Research"
        signInUrl="https://atlas.test/sign-in?invitation=abc"
      />,
    );

    expect(screen.getAllByText(/You.*ve been invited/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Atlas Research/i).length).toBeGreaterThan(0);
    const acceptButton = screen.getByRole("link", { name: /Accept invitation/ });
    expect(acceptButton).toHaveAttribute("href", "https://atlas.test/sign-in?invitation=abc");
    expect(screen.getByRole("link", { name: /atlas.test\/sign-in/ })).toHaveAttribute(
      "href",
      "https://atlas.test/sign-in?invitation=abc",
    );
  });
});
