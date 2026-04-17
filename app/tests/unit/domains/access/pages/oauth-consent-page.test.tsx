// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  consent: vi.fn(),
}));

vi.mock("@/platform/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/platform/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/domains/access/client/auth-client", () => ({
  getAuthClient: () => ({
    oauth2: {
      consent: mocks.consent,
    },
  }),
}));

afterEach(() => {
  cleanup();
});

describe("OAuthConsentPage", () => {
  const originalFetch = global.fetch;
  const originalWindow = globalThis.window;
  let assignMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mocks.consent.mockReset();
    vi.stubGlobal("fetch", vi.fn());
    assignMock = vi.fn();
    const testWindow = Object.create(originalWindow) as Window & typeof globalThis;
    Object.defineProperty(testWindow, "location", {
      configurable: true,
      value: { assign: assignMock },
    });
    vi.stubGlobal("window", testWindow);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it("loads client details and grants consent", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        icon: "https://atlas.test/app.png",
        name: "Atlas CLI",
        uri: "https://atlas.test",
      }),
      ok: true,
    } as unknown as Response);
    mocks.consent.mockResolvedValue({
      data: { redirect: true, url: "https://atlas.test/callback" },
    });
    const { OAuthConsentPage } = await import("@/domains/access/pages/oauth-consent-page");

    render(<OAuthConsentPage clientId="atlas-cli" scope="openid discovery:read" />);

    await waitFor(() => {
      expect(screen.getAllByText("Atlas CLI")).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() => {
      expect(mocks.consent).toHaveBeenCalledWith({
        accept: true,
        scope: "openid discovery:read",
      });
    });
    expect(assignMock).toHaveBeenCalledWith("https://atlas.test/callback");
    expect(screen.getByText("View discoveries")).not.toBeNull();
  });

  it("shows client-load failures", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
    } as unknown as Response);
    const { OAuthConsentPage } = await import("@/domains/access/pages/oauth-consent-page");

    render(<OAuthConsentPage clientId="atlas-cli" />);

    await waitFor(() => {
      expect(screen.getByText("Could not load application details.")).not.toBeNull();
    });
  });

  it("shows client-load failures when the request rejects outright", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("network down"));
    const { OAuthConsentPage } = await import("@/domains/access/pages/oauth-consent-page");

    render(<OAuthConsentPage clientId="atlas-cli" />);

    await waitFor(() => {
      expect(screen.getByText("Could not load application details.")).not.toBeNull();
    });
  });

  it("renders loading and fallback scope labels while client details are still resolving", async () => {
    vi.mocked(global.fetch).mockReturnValue(new Promise<Response>(() => undefined));
    const { OAuthConsentPage } = await import("@/domains/access/pages/oauth-consent-page");

    render(<OAuthConsentPage clientId="atlas-cli" scope="custom_scope" />);

    expect(screen.getByText("Loading application details...")).not.toBeNull();
  });

  it("denies consent and surfaces consent errors", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        name: "Atlas CLI",
      }),
      ok: true,
    } as unknown as Response);
    mocks.consent.mockResolvedValueOnce({
      error: { message: "Could not deny access." },
    });
    const { OAuthConsentPage } = await import("@/domains/access/pages/oauth-consent-page");

    render(<OAuthConsentPage clientId="atlas-cli" />);

    await waitFor(() => {
      expect(screen.getAllByText("Atlas CLI")).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    await waitFor(() => {
      expect(screen.getByText("Could not deny access.")).not.toBeNull();
    });
  });

  it("surfaces generic allow errors, redirects on deny success, and falls back to raw scope labels", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        name: undefined,
      }),
      ok: true,
    } as unknown as Response);
    mocks.consent
      .mockResolvedValueOnce({
        error: {},
      })
      .mockResolvedValueOnce({
        data: { redirect: true, url: "https://atlas.test/denied" },
      });
    const { OAuthConsentPage } = await import("@/domains/access/pages/oauth-consent-page");

    render(<OAuthConsentPage clientId="atlas-cli" scope="custom_scope" />);

    await waitFor(() => {
      expect(screen.getAllByText("Unknown app")).toHaveLength(2);
    });
    expect(screen.getByText("custom_scope")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => {
      expect(screen.getByText("Could not grant access.")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("https://atlas.test/denied");
    });
  });

  it("does not redirect when consent succeeds without a redirect target and ignores late client-load failures after unmount", async () => {
    let rejectFetch: ((error: Error) => void) | undefined;
    vi.mocked(global.fetch).mockReturnValue(
      new Promise<Response>((_, reject) => {
        rejectFetch = reject;
      }),
    );
    mocks.consent.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce({ error: {} });
    const { OAuthConsentPage } = await import("@/domains/access/pages/oauth-consent-page");

    const { unmount } = render(<OAuthConsentPage clientId="atlas-cli" />);
    unmount();
    rejectFetch?.(new Error("late failure"));

    vi.mocked(global.fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        name: "Atlas CLI",
      }),
      ok: true,
    } as unknown as Response);

    render(<OAuthConsentPage clientId="atlas-cli" />);

    await waitFor(() => {
      expect(screen.getAllByText("Atlas CLI")).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => {
      expect(assignMock).not.toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() => {
      expect(screen.getByText("Could not deny access.")).not.toBeNull();
    });
  });

  it("keeps operators on the consent page when denying succeeds without a redirect target", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        name: "Atlas CLI",
      }),
      ok: true,
    } as unknown as Response);
    mocks.consent.mockResolvedValue({
      data: { redirect: false, url: "https://atlas.test/ignored" },
    });
    const { OAuthConsentPage } = await import("@/domains/access/pages/oauth-consent-page");

    render(<OAuthConsentPage clientId="atlas-cli" />);

    await waitFor(() => {
      expect(screen.getAllByText("Atlas CLI")).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    await waitFor(() => {
      expect(mocks.consent).toHaveBeenCalledWith({
        accept: false,
      });
    });
    expect(assignMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Could not deny access.")).toBeNull();
  });

  it("does not update client state after an in-flight fetch resolves post-unmount and shows generic rejection fallbacks", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    vi.mocked(global.fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    mocks.consent.mockRejectedValueOnce("grant failed").mockRejectedValueOnce("deny failed");
    const { OAuthConsentPage } = await import("@/domains/access/pages/oauth-consent-page");

    const { unmount } = render(<OAuthConsentPage clientId="atlas-cli" />);
    unmount();
    resolveFetch?.({
      json: vi.fn().mockResolvedValue({ name: "Late app" }),
      ok: true,
    } as unknown as Response);

    vi.mocked(global.fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        name: "Atlas CLI",
      }),
      ok: true,
    } as unknown as Response);

    render(<OAuthConsentPage clientId="atlas-cli" />);

    await waitFor(() => {
      expect(screen.getAllByText("Atlas CLI")).toHaveLength(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => {
      expect(screen.getByText("Could not grant access.")).not.toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() => {
      expect(screen.getByText("Could not deny access.")).not.toBeNull();
    });
  });
});
