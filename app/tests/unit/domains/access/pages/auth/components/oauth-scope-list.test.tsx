// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OAuthScopeList } from "@/domains/access/pages/auth/components/oauth-scope-list";

afterEach(() => {
  cleanup();
});

describe("OAuthScopeList", () => {
  it("renders nothing when there are no requested scopes", () => {
    const { container } = render(<OAuthScopeList scopes={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("maps known scope names to titles and falls back to the raw scope for unknown ones", () => {
    render(<OAuthScopeList scopes={["openid", "profile", "custom:special"]} />);

    expect(screen.getByText("Basic identity")).not.toBeNull();
    expect(screen.getByText("Your account identifier")).not.toBeNull();
    expect(screen.getByText("Profile")).not.toBeNull();
    expect(screen.getByText("custom:special")).not.toBeNull();
  });
});
