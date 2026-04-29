// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/platform/ui/toast", () => ({
  useToast: () => ({
    show: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  SsoShareLinkButton,
  buildIdTeamShareUrl,
} from "@/domains/access/components/organization/sso-share-link";

describe("buildIdTeamShareUrl", () => {
  it("composes the SSO setup deep link", () => {
    expect(buildIdTeamShareUrl("https://atlas.example", "civic-team")).toBe(
      "https://atlas.example/organization/sso?from=civic-team",
    );
  });

  it("trims trailing slashes from the public base URL", () => {
    expect(buildIdTeamShareUrl("https://atlas.example///", "civic-team")).toBe(
      "https://atlas.example/organization/sso?from=civic-team",
    );
  });

  it("URL-encodes the workspace slug", () => {
    expect(buildIdTeamShareUrl("https://atlas.example", "team with spaces")).toBe(
      "https://atlas.example/organization/sso?from=team%20with%20spaces",
    );
  });
});

describe("SsoShareLinkButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("copies the share URL to the clipboard on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<SsoShareLinkButton workspaceSlug="civic-team" />);
    fireEvent.click(screen.getByRole("button", { name: /Send to my IT team/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("/organization/sso?from=civic-team"),
      );
    });
  });
});
