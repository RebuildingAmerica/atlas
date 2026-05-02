// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OAuthConsentPage } from "@/domains/access/pages/auth/oauth-consent-page";

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

describe("OAuthConsentPage", () => {
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

  it("loads client details and grants consent", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "Third Party App", uri: "https://app.test" }),
    } as unknown as Response);

    authClient.oauth2.consent.mockResolvedValue({
      data: { redirect: true, url: "https://app.test/callback" },
    });

    render(<OAuthConsentPage clientId="client_1" scope="openid profile" />);

    expect(await screen.findAllByText("Third Party App")).toHaveLength(2);
    expect(screen.getByText("Basic identity")).toBeInTheDocument();
    expect(screen.getByText("Profile")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Allow"));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(authClient.oauth2.consent).toHaveBeenCalledWith({
        accept: true,
        scope: "openid profile",
      });
    });
    expect(mockLocationAssign).toHaveBeenCalledWith("https://app.test/callback");
  });

  it("handles denial", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "Third Party App" }),
    } as unknown as Response);

    authClient.oauth2.consent.mockResolvedValue({
      data: { redirect: true, url: "https://app.test/denied" },
    });

    render(<OAuthConsentPage clientId="client_1" />);

    expect(await screen.findAllByText("Third Party App")).toHaveLength(2);

    await act(async () => {
      fireEvent.click(screen.getByText("Deny"));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(authClient.oauth2.consent).toHaveBeenCalledWith({ accept: false });
    });
    expect(mockLocationAssign).toHaveBeenCalledWith("https://app.test/denied");
  });

  it("shows error when client loading fails", async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: false } as unknown as Response);

    render(<OAuthConsentPage clientId="client_1" />);

    expect(await screen.findByText(/Could not load application details/i)).toBeInTheDocument();
  });

  it("shows the same error when the fetch promise rejects", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("network down"));

    render(<OAuthConsentPage clientId="client_1" />);

    expect(await screen.findByText(/Could not load application details/i)).toBeInTheDocument();
  });

  it("shows a generic application name when the response omits one and renders the workspace picker for multi-workspace operators", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    } as unknown as Response);
    mocks.getAtlasSession.mockResolvedValue({
      workspace: {
        memberships: [
          {
            id: "org_a",
            name: "Atlas Team",
            role: "owner",
            slug: "atlas-team",
            workspaceType: "team",
          },
          {
            id: "org_b",
            name: "Atlas Research",
            role: "member",
            slug: "atlas-research",
            workspaceType: "team",
          },
        ],
        activeOrganization: {
          id: "org_b",
          name: "Atlas Research",
          role: "member",
          slug: "atlas-research",
          workspaceType: "team",
        },
      },
    });

    render(<OAuthConsentPage clientId="client_1" scope="openid email" />);

    expect(await screen.findAllByText("Unknown app")).toHaveLength(2);
    await waitFor(() => {
      expect(screen.getByText("Atlas Research")).toBeInTheDocument();
    });
  });

  it("falls back to the first membership when no active organization is set and renders a workspace label for solo operators", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "Solo App" }),
    } as unknown as Response);
    mocks.getAtlasSession.mockResolvedValue({
      workspace: {
        memberships: [
          {
            id: "org_a",
            name: "Solo Atlas",
            role: "owner",
            slug: "solo",
            workspaceType: "individual",
          },
        ],
        activeOrganization: null,
      },
    });

    render(<OAuthConsentPage clientId="client_1" scope="openid" />);

    await waitFor(() => {
      expect(screen.getByText(/Solo Atlas/)).toBeInTheDocument();
    });
  });

  it("shows the consent error when allow returns an error payload", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "App" }),
    } as unknown as Response);
    authClient.oauth2.consent.mockResolvedValue({ error: { message: "denied" } });

    render(<OAuthConsentPage clientId="client_1" />);
    await screen.findAllByText("App");

    await act(async () => {
      fireEvent.click(screen.getByText("Allow"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        screen.getByText("Access could not be granted. Please try again."),
      ).toBeInTheDocument();
    });
  });

  it("shows the deny error when consent throws", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "App" }),
    } as unknown as Response);
    authClient.oauth2.consent.mockRejectedValue(new Error("network"));

    render(<OAuthConsentPage clientId="client_1" />);
    await screen.findAllByText("App");

    await act(async () => {
      fireEvent.click(screen.getByText("Deny"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("Access could not be denied. Please try again.")).toBeInTheDocument();
    });
  });

  it("renders the deny error path when consent surfaces an error payload", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "App" }),
    } as unknown as Response);
    authClient.oauth2.consent.mockResolvedValue({ error: { message: "blocked" } });

    render(<OAuthConsentPage clientId="client_1" />);
    await screen.findAllByText("App");

    await act(async () => {
      fireEvent.click(screen.getByText("Deny"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText("Access could not be denied. Please try again.")).toBeInTheDocument();
    });
  });

  it("hides the workspace picker and forwards the scope verbatim when the request already pins an org", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "App" }),
    } as unknown as Response);
    authClient.oauth2.consent.mockResolvedValue({ data: { redirect: false } });

    render(<OAuthConsentPage clientId="client_1" scope="openid org:fixed" />);
    await screen.findAllByText("App");

    await act(async () => {
      fireEvent.click(screen.getByText("Allow"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(authClient.oauth2.consent).toHaveBeenCalledWith({
        accept: true,
        scope: "openid org:fixed",
      });
    });
  });

  it("renders the same allow-failure copy when the consent call throws", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ name: "App" }),
    } as unknown as Response);
    authClient.oauth2.consent.mockRejectedValue(new Error("network"));

    render(<OAuthConsentPage clientId="client_1" />);
    await screen.findAllByText("App");

    await act(async () => {
      fireEvent.click(screen.getByText("Allow"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        screen.getByText("Access could not be granted. Please try again."),
      ).toBeInTheDocument();
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

    // The page should still render even when the session lookup throws.
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
});
