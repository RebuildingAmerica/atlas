// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  show: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/toast", () => ({
  useToast: () => toastMocks,
}));

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: clipboardMocks.copyToClipboard,
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
      "https://atlas.example/organization/sso?from=team+with+spaces",
    );
  });
});

describe("SsoShareLinkButton", () => {
  afterEach(() => {
    cleanup();
    toastMocks.success.mockClear();
    toastMocks.error.mockClear();
    clipboardMocks.copyToClipboard.mockReset();
  });

  it("toasts a success message when the clipboard accepts the link", async () => {
    clipboardMocks.copyToClipboard.mockResolvedValue(true);
    render(<SsoShareLinkButton workspaceSlug="civic-team" />);
    fireEvent.click(screen.getByRole("button", { name: /Send to my IT team/i }));
    await waitFor(() => {
      expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith(
        expect.stringContaining("/organization/sso?from=civic-team"),
      );
    });
    expect(toastMocks.success).toHaveBeenCalled();
  });

  it("surfaces a user-facing error when the clipboard refuses the copy", async () => {
    clipboardMocks.copyToClipboard.mockResolvedValue(false);
    render(<SsoShareLinkButton workspaceSlug="civic-team" />);
    fireEvent.click(screen.getByRole("button", { name: /Send to my IT team/i }));
    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalled();
    });
  });

  it("does not toast or update state when the component unmounts before the copy resolves", async () => {
    let resolveCopy: ((ok: boolean) => void) | null = null;
    clipboardMocks.copyToClipboard.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveCopy = resolve;
        }),
    );

    const view = render(<SsoShareLinkButton workspaceSlug="civic-team" />);
    fireEvent.click(screen.getByRole("button", { name: /Send to my IT team/i }));
    view.unmount();

    if (resolveCopy) {
      (resolveCopy as (ok: boolean) => void)(true);
      await Promise.resolve();
    }
    expect(toastMocks.success).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });
});
