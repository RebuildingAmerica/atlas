// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DiscoveryPage } from "@/domains/discovery/pages/discovery-page";

const mocks = vi.hoisted(() => ({
  useAtlasSession: vi.fn(),
  useDiscoveryRuns: vi.fn(),
  useStartDiscovery: vi.fn(),
  useTaxonomy: vi.fn(),
}));

vi.mock("@/domains/access", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/domains/discovery/hooks/use-discovery", () => ({
  useDiscoveryRuns: mocks.useDiscoveryRuns,
  useStartDiscovery: mocks.useStartDiscovery,
}));

vi.mock("@/domains/catalog/hooks/use-taxonomy", () => ({
  useTaxonomy: mocks.useTaxonomy,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

describe("DiscoveryPage", () => {
  beforeEach(() => {
    mocks.useAtlasSession.mockReturnValue({ data: null });
    mocks.useDiscoveryRuns.mockReturnValue({ data: { items: [] }, isLoading: false });
    mocks.useStartDiscovery.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
    mocks.useTaxonomy.mockReturnValue({
      data: { "Domain 1": [{ name: "Issue 1", slug: "issue-1", description: "desc" }] },
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the discovery hero", () => {
    render(<DiscoveryPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Discovery" })).toBeInTheDocument();
    expect(screen.getByText(/Start discovery runs/i)).toBeInTheDocument();
  });

  it("shows setup notice when workspace is needed", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
          capabilities: { canUseTeamFeatures: false },
          onboarding: { needsWorkspace: true, hasPendingInvitations: false },
        },
      },
    });

    render(<DiscoveryPage />);
    expect(screen.getByText(/Create your workspace before Atlas sprawls/i)).toBeInTheDocument();
  });

  it("renders issue areas from taxonomy", () => {
    render(<DiscoveryPage />);
    expect(screen.getByText("Issue 1")).toBeInTheDocument();
    expect(screen.getByText("desc")).toBeInTheDocument();
  });

  it("handles form input and toggles issues", () => {
    render(<DiscoveryPage />);

    const locationInput = screen.getByPlaceholderText(/Kansas City, MO/i);
    fireEvent.change(locationInput, { target: { value: "New York" } });
    expect(locationInput).toHaveValue("New York");

    const stateInput = screen.getByPlaceholderText(/^MO$/i);
    fireEvent.change(stateInput, { target: { value: "ny" } });
    expect(stateInput).toHaveValue("NY");

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("submits a discovery run", () => {
    const mutate = vi.fn();
    mocks.useStartDiscovery.mockReturnValue({ mutate, isPending: false, error: null });

    render(<DiscoveryPage />);

    fireEvent.change(screen.getByPlaceholderText(/Kansas City, MO/i), {
      target: { value: "New York" },
    });
    fireEvent.change(screen.getByPlaceholderText(/^MO$/i), { target: { value: "ny" } });
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByText("Start run"));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        location_query: "New York",
        state: "NY",
        issue_areas: ["issue-1"],
      }),
      expect.any(Object),
    );
  });

  it("renders recent runs and handles error messages", () => {
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Chicago",
            started_at: "2026-04-20T10:00:00.000Z",
            state: "IL",
            status: "completed",
            issue_areas: ["area1"],
            entries_extracted: 10,
            sources_fetched: 5,
            entries_after_dedup: 8,
            error_message: "Process failed",
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);
    expect(screen.getByText("Chicago")).toBeInTheDocument();
    expect(screen.getByText("Process failed")).toBeInTheDocument();
  });

  it("shows loading states for runs and taxonomy", () => {
    mocks.useDiscoveryRuns.mockReturnValue({ data: null, isLoading: true });
    mocks.useTaxonomy.mockReturnValue({ data: null, isLoading: true });

    render(<DiscoveryPage />);
    expect(screen.getByText(/Loading runs/i)).toBeInTheDocument();
    expect(screen.getByText(/Loading issue areas/i)).toBeInTheDocument();
  });

  it("shows unavailable message when taxonomy is empty", () => {
    mocks.useTaxonomy.mockReturnValue({ data: {}, isLoading: false });

    render(<DiscoveryPage />);
    expect(screen.getByText(/Issue areas are unavailable/i)).toBeInTheDocument();
  });

  it("shows start error message when mutation fails", () => {
    mocks.useStartDiscovery.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: new Error("Fail"),
    });

    render(<DiscoveryPage />);
    expect(screen.getByText(/Could not start the run/i)).toBeInTheDocument();
  });

  it("renders team hero when team features are enabled", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: {
            id: "org_1",
            name: "Atlas Team",
            role: "owner",
            workspaceType: "team",
          },
          capabilities: { canUseTeamFeatures: true },
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
        },
      },
    });

    render(<DiscoveryPage />);
    expect(screen.getByText("Team discovery")).toBeInTheDocument();
    expect(screen.getByText("Atlas Team discovery")).toBeInTheDocument();
    expect(screen.getByText(/team · owner/i)).toBeInTheDocument();
  });

  it("clears form on successful submission", () => {
    let successCallback: (() => void) | undefined;
    const mutate = vi
      .fn()
      .mockImplementation((_data: unknown, options: { onSuccess?: () => void }) => {
        successCallback = options.onSuccess;
      });
    mocks.useStartDiscovery.mockReturnValue({ mutate, isPending: false, error: null });

    render(<DiscoveryPage />);

    const locationInput = screen.getByPlaceholderText(/Kansas City, MO/i);
    fireEvent.change(locationInput, { target: { value: "New York" } });
    fireEvent.change(screen.getByPlaceholderText(/^MO$/i), { target: { value: "ny" } });
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByText("Start run"));

    if (!successCallback) throw new Error("Expected successCallback to be set");
    const callback = successCallback;
    act(() => {
      callback();
    });

    expect(locationInput).toHaveValue("");
  });
});
