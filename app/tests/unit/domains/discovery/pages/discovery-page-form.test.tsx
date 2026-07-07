// @vitest-environment jsdom
import "./discovery-page-test-setup";

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoveryPage } from "@/domains/discovery/pages/discovery-page";
import { mocks } from "./discovery-page-test-setup";

afterEach(() => {
  vi.clearAllMocks();
});

describe("DiscoveryPage form and gating", () => {
  it("prefills a research request from a coverage gap", () => {
    mocks.useTaxonomy.mockReturnValue({
      data: {
        Housing: [
          {
            name: "Housing affordability",
            slug: "housing_affordability",
            description: "Tenant protections and housing costs",
          },
        ],
      },
      isLoading: false,
    });

    render(
      <DiscoveryPage
        initialRequest={{
          issue_areas: "housing_affordability",
          location: "Kansas City, MO",
          research_goal: "partner_scan",
          state: "mo",
        }}
      />,
    );

    expect(screen.getByPlaceholderText(/Kansas City, MO/i)).toHaveValue("Kansas City, MO");
    expect(screen.getByPlaceholderText(/^MO$/i)).toHaveValue("MO");
    expect(screen.getByLabelText("Partner scan")).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Housing affordability" })).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("submits a research request", () => {
    const mutate = vi.fn();
    mocks.useStartDiscovery.mockReturnValue({ mutate, isPending: false, error: null });
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
          capabilities: { canUseTeamFeatures: false },
          resolvedCapabilities: {
            capabilities: ["research.run"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 0,
              api_requests_per_day: 0,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
        },
      },
    });

    render(<DiscoveryPage />);

    fireEvent.change(screen.getByPlaceholderText(/Kansas City, MO/i), {
      target: { value: "New York" },
    });
    fireEvent.change(screen.getByPlaceholderText(/^MO$/i), { target: { value: "ny" } });
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button", { name: "Start research" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        location_query: "New York",
        state: "NY",
        issue_areas: ["issue-1"],
        research_goal: "landscape_scan",
      }),
      expect.any(Object),
    );
  });

  it("submits the selected research goal", () => {
    const mutate = vi.fn();
    mocks.useStartDiscovery.mockReturnValue({ mutate, isPending: false, error: null });
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
          capabilities: { canUseTeamFeatures: false },
          resolvedCapabilities: {
            capabilities: ["research.run"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 0,
              api_requests_per_day: 0,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
        },
      },
    });

    render(<DiscoveryPage />);

    fireEvent.change(screen.getByPlaceholderText(/Kansas City, MO/i), {
      target: { value: "New York" },
    });
    fireEvent.change(screen.getByPlaceholderText(/^MO$/i), { target: { value: "ny" } });
    fireEvent.click(screen.getByLabelText("Interview leads"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Start research" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        research_goal: "interview_leads",
      }),
      expect.any(Object),
    );
  });

  it("keeps goal choices compact while preserving the selected goal context", () => {
    render(<DiscoveryPage />);

    fireEvent.click(screen.getByLabelText("Interview leads"));

    expect(screen.getAllByText("Interview leads").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Best for source lists, reporting calls, and first outreach."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ranked people and organizations")).not.toBeInTheDocument();
    expect(screen.queryByText("Contact and reachability signals")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent source context")).not.toBeInTheDocument();
  });

  it("explains the local landscape flow before a run starts", () => {
    render(<DiscoveryPage />);

    expect(screen.getAllByText("Landscape scan").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Best for understanding who is active around a place and issue."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ranked local actors")).not.toBeInTheDocument();
    expect(screen.queryByText("Key sources")).not.toBeInTheDocument();
    expect(screen.queryByText("Coverage gaps")).not.toBeInTheDocument();
  });

  it("does not expose template shortcuts in the run form", () => {
    mocks.useTaxonomy.mockReturnValue({
      data: {
        Housing: [
          {
            name: "Housing affordability",
            slug: "housing_affordability",
            description: "Tenant protections and housing costs",
          },
        ],
        Labor: [
          {
            name: "Worker power",
            slug: "worker_power",
            description: "Worker centers and labor campaigns",
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    expect(screen.queryByRole("button", { name: "Local partner scan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Research templates" })).not.toBeInTheDocument();
  });

  it("renders the pending-invitations notice when invitations are waiting", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
          capabilities: { canUseTeamFeatures: false },
          resolvedCapabilities: {
            capabilities: ["research.run"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 0,
              api_requests_per_day: 0,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
          onboarding: { needsWorkspace: false, hasPendingInvitations: true },
        },
      },
    });
    render(<DiscoveryPage />);
    expect(screen.getByText(/You have workspace invitations waiting/)).toBeInTheDocument();
  });

  it("renders the upgrade prompt when research capability is missing", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
          activeProducts: ["atlas_pro"],
          capabilities: { canUseTeamFeatures: false },
          resolvedCapabilities: {
            capabilities: [],
            limits: {
              research_runs_per_month: 0,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 0,
              api_requests_per_day: 0,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
        },
      },
    });
    render(<DiscoveryPage />);
    expect(screen.getByText(/Atlas/)).toBeInTheDocument();
  });

  it("renders the free-tier upgrade prompt when activeProducts is empty", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
          activeProducts: [],
          capabilities: { canUseTeamFeatures: false },
          resolvedCapabilities: {
            capabilities: ["research.run"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 0,
              api_requests_per_day: 0,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
        },
      },
    });
    render(<DiscoveryPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Recent research" })).toBeInTheDocument();
  });

  it("sorts taxonomy issue areas alphabetically", () => {
    mocks.useTaxonomy.mockReturnValue({
      data: {
        Domain: [
          { name: "Zebra protection", slug: "zebra", description: "" },
          { name: "Apple orchards", slug: "apple", description: "" },
          { name: "Mango farms", slug: "mango", description: "" },
        ],
      },
      isLoading: false,
    });
    render(<DiscoveryPage />);
    const labels = screen.getAllByRole("checkbox").map((el) => el.parentElement?.textContent);
    const apple = labels.findIndex((label) => label?.includes("Apple"));
    const zebra = labels.findIndex((label) => label?.includes("Zebra"));
    expect(apple).toBeLessThan(zebra);
  });

  it("ignores form submissions with missing fields", () => {
    const mutate = vi.fn();
    mocks.useStartDiscovery.mockReturnValue({ mutate, isPending: false, error: null });
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
          capabilities: { canUseTeamFeatures: false },
          resolvedCapabilities: {
            capabilities: ["research.run"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 0,
              api_requests_per_day: 0,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
        },
      },
    });

    render(<DiscoveryPage />);
    const form = screen.getByRole("button", { name: "Start research" }).closest("form");
    if (!form) throw new Error("Expected discovery form");
    fireEvent.submit(form);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("clears form on successful submission", () => {
    let successCallback: (() => void) | undefined;
    const mutate = vi
      .fn()
      .mockImplementation((_data: unknown, options: { onSuccess?: () => void }) => {
        successCallback = options.onSuccess;
      });
    mocks.useStartDiscovery.mockReturnValue({ mutate, isPending: false, error: null });
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
          capabilities: { canUseTeamFeatures: false },
          resolvedCapabilities: {
            capabilities: ["research.run"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 0,
              api_requests_per_day: 0,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
          onboarding: { needsWorkspace: false, hasPendingInvitations: false },
        },
      },
    });

    render(<DiscoveryPage />);

    const locationInput = screen.getByPlaceholderText(/Kansas City, MO/i);
    fireEvent.change(locationInput, { target: { value: "New York" } });
    fireEvent.change(screen.getByPlaceholderText(/^MO$/i), { target: { value: "ny" } });
    fireEvent.click(screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("button", { name: "Start research" }));

    if (!successCallback) throw new Error("Expected successCallback to be set");
    const callback = successCallback;
    act(() => {
      callback();
    });

    expect(locationInput).toHaveValue("");
  });
});
