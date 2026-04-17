// @vitest-environment jsdom

import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createAtlasSessionFixture } from "../../../../fixtures/access/sessions";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  useAtlasSession: vi.fn(),
  useDiscoveryRuns: vi.fn(),
  useStartDiscovery: vi.fn(),
  useTaxonomy: vi.fn(),
}));

vi.mock("@/platform/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/platform/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = "button",
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
}));

vi.mock("@/domains/discovery/hooks/use-discovery", () => ({
  useDiscoveryRuns: mocks.useDiscoveryRuns,
  useStartDiscovery: mocks.useStartDiscovery,
}));

vi.mock("@/domains/access", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/domains/catalog/hooks/use-taxonomy", () => ({
  useTaxonomy: mocks.useTaxonomy,
}));

afterEach(() => {
  cleanup();
});

function getDiscoveryForm() {
  const submitButton = screen.getByRole("button", { name: "Start run" });
  const form = submitButton.closest("form");

  if (!(form instanceof HTMLFormElement)) {
    throw new TypeError("Expected the Start run button to live inside a form.");
  }

  return form;
}

function getDiscoveryMutationCall(): [unknown, unknown] {
  const mutationCall = mocks.mutate.mock.calls.at(0) as [unknown, unknown] | undefined;

  if (!mutationCall) {
    throw new TypeError("Expected the discovery mutation to be called.");
  }

  return mutationCall;
}

describe("DiscoveryPage", () => {
  beforeEach(() => {
    mocks.mutate.mockReset();
    mocks.useAtlasSession.mockReset();
    mocks.useDiscoveryRuns.mockReset();
    mocks.useStartDiscovery.mockReset();
    mocks.useTaxonomy.mockReset();
    mocks.useAtlasSession.mockReturnValue({
      data: createAtlasSessionFixture(),
    });
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            entries_after_dedup: 7,
            entries_extracted: 9,
            error_message: null,
            id: "run_123",
            issue_areas: ["housing_affordability"],
            location_query: "Kansas City",
            sources_fetched: 12,
            started_at: "2026-04-10T00:00:00.000Z",
            state: "MO",
            status: "completed",
          },
        ],
      },
      isLoading: false,
    });
    mocks.useStartDiscovery.mockReturnValue({
      error: null,
      isPending: false,
      mutate: mocks.mutate,
    });
    mocks.useTaxonomy.mockReturnValue({
      data: {
        Housing: [
          {
            description: "Housing policy",
            name: "Housing Affordability",
            slug: "housing_affordability",
          },
        ],
      },
      isLoading: false,
    });
  });

  it("renders runs and starts new discovery requests from valid form input", async () => {
    const { DiscoveryPage } = await import("@/domains/discovery/pages/discovery-page");

    render(<DiscoveryPage />);

    fireEvent.change(screen.getByPlaceholderText("Kansas City, MO"), {
      target: { value: "St. Louis" },
    });
    fireEvent.change(screen.getByPlaceholderText("MO"), {
      target: { value: "il" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(getDiscoveryForm());

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    const [payload, options] = getDiscoveryMutationCall();
    expect(payload).toEqual({
      issue_areas: ["housing_affordability"],
      location_query: "St. Louis",
      state: "IL",
    });
    expect(options).toBeDefined();
    expect(options).toHaveProperty("onSuccess");
    expect(screen.getByText("Kansas City")).not.toBeNull();
  });

  it("clears form state after a successful run and shows empty dependency states", async () => {
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [],
      },
      isLoading: false,
    });
    mocks.useTaxonomy.mockReturnValue({
      data: {},
      isLoading: false,
    });
    mocks.useStartDiscovery.mockReturnValue({
      error: null,
      isPending: false,
      mutate: (input: unknown, options?: { onSuccess?: () => void }) => {
        mocks.mutate(input, options);
        options?.onSuccess?.();
      },
    });
    const { DiscoveryPage } = await import("@/domains/discovery/pages/discovery-page");

    render(<DiscoveryPage />);

    expect(screen.getByText("Issue areas are unavailable right now.")).not.toBeNull();
    expect(screen.getByText("No discovery runs yet.")).not.toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Kansas City, MO"), {
      target: { value: "St. Louis" },
    });
    fireEvent.change(screen.getByPlaceholderText("MO"), {
      target: { value: "il" },
    });
    fireEvent.submit(getDiscoveryForm());

    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("renders loading and error states for discovery dependencies", async () => {
    mocks.useDiscoveryRuns.mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    mocks.useStartDiscovery.mockReturnValue({
      error: new Error("Bad request"),
      isPending: false,
      mutate: mocks.mutate,
    });
    mocks.useTaxonomy.mockReturnValue({
      data: undefined,
      isLoading: true,
    });
    const { DiscoveryPage } = await import("@/domains/discovery/pages/discovery-page");

    render(<DiscoveryPage />);

    expect(screen.getByText("Loading issue areas...")).not.toBeNull();
    expect(screen.getByText("Loading runs...")).not.toBeNull();
    expect(
      screen.getByText("Could not start the run. Check the fields and try again."),
    ).not.toBeNull();
  });

  it("renders run errors and resets the form after onSuccess", async () => {
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            entries_after_dedup: 0,
            entries_extracted: 0,
            error_message: "Job failed",
            id: "run_456",
            issue_areas: ["housing_affordability"],
            location_query: "Springfield",
            sources_fetched: 0,
            started_at: "2026-04-10T00:00:00.000Z",
            state: "MO",
            status: "failed",
          },
        ],
      },
      isLoading: false,
    });
    mocks.useStartDiscovery.mockReturnValue({
      error: null,
      isPending: false,
      mutate: (_input: unknown, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.();
      },
    });
    const { DiscoveryPage } = await import("@/domains/discovery/pages/discovery-page");

    render(<DiscoveryPage />);

    fireEvent.change(screen.getByPlaceholderText("Kansas City, MO"), {
      target: { value: "Columbia" },
    });
    fireEvent.change(screen.getByPlaceholderText("MO"), {
      target: { value: "mo" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(getDiscoveryForm());

    const locationInput = screen.getByPlaceholderText("Kansas City, MO");
    expect(locationInput).toBeInstanceOf(HTMLInputElement);
    if (!(locationInput instanceof HTMLInputElement)) {
      throw new TypeError("Expected the location input to be an HTMLInputElement.");
    }

    const stateInput = screen.getByPlaceholderText("MO");
    expect(stateInput).toBeInstanceOf(HTMLInputElement);
    if (!(stateInput instanceof HTMLInputElement)) {
      throw new TypeError("Expected the state input to be an HTMLInputElement.");
    }

    await waitFor(() => {
      expect(locationInput.value).toBe("");
      expect(stateInput.value).toBe("");
    });
    expect(screen.getByText("Job failed")).not.toBeNull();
  });

  it("sorts taxonomy issue areas alphabetically", async () => {
    mocks.useTaxonomy.mockReturnValue({
      data: {
        Housing: [
          {
            description: "Transit policy",
            name: "Transit Access",
            slug: "transit_access",
          },
          {
            description: "Housing policy",
            name: "Housing Affordability",
            slug: "housing_affordability",
          },
        ],
      },
      isLoading: false,
    });
    const { DiscoveryPage } = await import("@/domains/discovery/pages/discovery-page");

    render(<DiscoveryPage />);

    const labels = screen
      .getAllByText(/Housing Affordability|Transit Access/)
      .map((node) => node.textContent);
    expect(labels.slice(0, 2)).toEqual(["Housing Affordability", "Transit Access"]);
  });

  it("shows workspace setup guidance when the operator still needs a workspace", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: createAtlasSessionFixture({
        workspace: {
          activeOrganization: null,
          capabilities: {
            canInviteMembers: false,
            canManageOrganization: false,
            canSwitchOrganizations: false,
            canUseTeamFeatures: false,
          },
          memberships: [],
          onboarding: {
            hasPendingInvitations: false,
            needsWorkspace: true,
          },
          pendingInvitations: [],
        },
      }),
    });
    const { DiscoveryPage } = await import("@/domains/discovery/pages/discovery-page");

    render(<DiscoveryPage />);

    expect(screen.getByText("Create your workspace before Atlas sprawls")).not.toBeNull();
  });

  it("toggles selected issue counts back off and renders the pending start label", async () => {
    mocks.useStartDiscovery.mockReturnValue({
      error: null,
      isPending: true,
      mutate: mocks.mutate,
    });
    const { DiscoveryPage } = await import("@/domains/discovery/pages/discovery-page");

    render(<DiscoveryPage />);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText("1 selected")).not.toBeNull();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByText("0 selected")).not.toBeNull();
    expect(screen.getByText("Starting...")).not.toBeNull();
  });
});
