// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OAuthConsentPage } from "@/domains/access/pages/auth/oauth-consent-page";

const mocks = vi.hoisted(() => ({
  getAuthClient: vi.fn(),
}));

vi.mock("@/domains/access/client/auth-client", () => ({
  getAuthClient: mocks.getAuthClient,
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

    globalThis.fetch = vi.fn();

    Object.defineProperty(window, "location", {
      value: { ...originalLocation, assign: mockLocationAssign },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
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
});
