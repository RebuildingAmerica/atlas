// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OAuthConsentPage } from "@/domains/access/pages/auth/oauth-consent-page";
import type { AtlasSessionPayload } from "@/domains/access/organization-contracts";

const mocks = vi.hoisted(() => ({
  getAuthClient: vi.fn(),
  getAtlasSession: vi.fn(),
}));

vi.mock("@/domains/access/client/auth-client", () => ({
  getAuthClient: mocks.getAuthClient,
}));

vi.mock("@/domains/access/session.functions", () => ({
  getAtlasSession: mocks.getAtlasSession,
}));

describe("OAuthConsentPage behavior", () => {
  const authClient = {
    oauth2: {
      consent: vi.fn(),
    },
  };

  const originalLocation = window.location;
  const mockLocationAssign = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthClient.mockReturnValue(authClient);
    mocks.getAtlasSession.mockResolvedValue(null);

    vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn());

    Object.defineProperty(window, "location", {
      value: { ...originalLocation, assign: mockLocationAssign },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it("redirects after a successful deny when the response carries a redirect url", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "App" }),
    } as unknown as Response);
    authClient.oauth2.consent.mockResolvedValue({
      data: { redirect: true, url: "https://app.test/denied-after-pick" },
    });

    render(<OAuthConsentPage clientId="client_1" />);
    await screen.findAllByText("App");

    await act(async () => {
      fireEvent.click(screen.getByText("Deny"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockLocationAssign).toHaveBeenCalledWith("https://app.test/denied-after-pick");
    });
  });

  it("falls back to the API-side default when the session lookup throws", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "App" }),
    } as unknown as Response);
    mocks.getAtlasSession.mockRejectedValue(new Error("network"));

    render(<OAuthConsentPage clientId="client_1" scope="openid" />);
    await screen.findAllByText("App");

    expect(screen.getByText("Allow")).toBeInTheDocument();
  });

  it("renders a redirect URI host caption when the redirect URI parses cleanly", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "App" }),
    } as unknown as Response);

    render(
      <OAuthConsentPage clientId="client_1" scope="openid" redirectUri="https://app.test/cb" />,
    );
    await screen.findAllByText("App");

    expect(screen.getByText(/app\.test/)).toBeInTheDocument();
  });

  it("falls back to the first membership when activeOrganization is missing on a multi-workspace session", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "App" }),
    } as unknown as Response);
    mocks.getAtlasSession.mockResolvedValue({
      workspace: {
        memberships: [
          {
            id: "org_a",
            name: "Workspace A",
            role: "owner",
            slug: "ws-a",
            workspaceType: "team",
          },
          {
            id: "org_b",
            name: "Workspace B",
            role: "member",
            slug: "ws-b",
            workspaceType: "team",
          },
        ],
        activeOrganization: null,
      },
    });

    render(<OAuthConsentPage clientId="client_1" scope="openid" />);
    await waitFor(() => {
      expect(screen.getByText(/Workspace A/)).toBeInTheDocument();
    });
  });

  it("does not redirect when the deny response omits a url", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "App" }),
    } as unknown as Response);
    authClient.oauth2.consent.mockResolvedValue({
      data: { redirect: true, url: null },
    });

    render(<OAuthConsentPage clientId="client_1" />);
    await screen.findAllByText("App");

    await act(async () => {
      fireEvent.click(screen.getByText("Deny"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(authClient.oauth2.consent).toHaveBeenCalledWith({ accept: false });
    });
    expect(mockLocationAssign).not.toHaveBeenCalled();
  });

  it("does not redirect when the allow response omits a url", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "App" }),
    } as unknown as Response);
    authClient.oauth2.consent.mockResolvedValue({
      data: { redirect: true, url: null },
    });

    render(<OAuthConsentPage clientId="client_1" scope="openid" />);
    await screen.findAllByText("App");

    await act(async () => {
      fireEvent.click(screen.getByText("Allow"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(authClient.oauth2.consent).toHaveBeenCalled();
    });
    expect(mockLocationAssign).not.toHaveBeenCalled();
  });

  it("ignores fetch results that resolve after the component unmounts", async () => {
    let resolveFetch: ((value: Response) => void) | null = null;
    vi.mocked(global.fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const view = render(<OAuthConsentPage clientId="client_1" scope="openid" />);
    view.unmount();

    if (resolveFetch) {
      (resolveFetch as (value: Response) => void)({
        ok: true,
        json: vi.fn().mockResolvedValue({ name: "App" }),
      } as unknown as Response);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    expect(authClient.oauth2.consent).not.toHaveBeenCalled();
  });

  it("ignores a fetch failure that resolves after the component unmounts", async () => {
    let rejectFetch: ((reason: Error) => void) | null = null;
    vi.mocked(global.fetch).mockImplementation(
      () =>
        new Promise<Response>((_, reject) => {
          rejectFetch = reject;
        }),
    );

    const view = render(<OAuthConsentPage clientId="client_1" scope="openid" />);
    view.unmount();

    if (rejectFetch) {
      (rejectFetch as (reason: Error) => void)(new Error("late failure"));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    expect(screen.queryByText(/Could not load/)).toBeNull();
  });

  it("ignores a session lookup that resolves after the component unmounts", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "App" }),
    } as unknown as Response);
    let resolveSession: ((value: AtlasSessionPayload) => void) | null = null;
    mocks.getAtlasSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        }),
    );

    const view = render(<OAuthConsentPage clientId="client_1" scope="openid" />);
    view.unmount();

    if (resolveSession) {
      (resolveSession as (value: AtlasSessionPayload) => void)({
        accountReady: true,
        hasPasskey: false,
        passkeyCount: 0,
        user: { email: "u@a.test", emailVerified: true, name: "U" },
        workspace: {
          activeOrganization: null,
          memberships: [
            {
              id: "org_a",
              name: "A",
              role: "owner",
              slug: "a",
              workspaceType: "individual",
            },
          ],
          onboarding: { hasPendingInvitations: false, needsWorkspace: false },
        },
      } as unknown as AtlasSessionPayload);
      await act(async () => {
        await Promise.resolve();
      });
    }
  });
});
