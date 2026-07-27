// @vitest-environment jsdom
import "./discovery-page-test-setup";

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiscoveryPage } from "@/domains/discovery/pages/discovery-page";
import type { DiscoveryRunRecord } from "@rebuildingamerica/atlas-catalog/discovery/discovery-run-summary";
import { mocks } from "./discovery-page-test-setup";
import type { MutationCallbacks } from "./discovery-page-test-setup";

describe("DiscoveryPage artifact failures", () => {
  function completedRun(id: string, locationQuery: string): DiscoveryRunRecord {
    return {
      completed_at: "2026-04-20T10:05:00.000Z",
      entries_after_dedup: 8,
      entries_confirmed: 3,
      entries_extracted: 10,
      error_message: null,
      id,
      issue_areas: ["housing_affordability"],
      location_query: locationQuery,
      queries_generated: 2,
      research_goal: "interview_leads",
      research_summary: {
        brief: "Source-backed tenant leads.",
        gaps: [],
        key_sources: [
          {
            published_date: "2026-04-19",
            publication: "City Council",
            source_id: `source_${id}`,
            title: "Tenant meeting agenda",
            url: "https://example.test/agenda",
            why_it_matters: "Names the lead and issue.",
          },
        ],
        ranked_leads: [
          {
            confidence: "corroborated",
            entry_id: `entry_${id}`,
            latest_source_date: "2026-04-19",
            name: "KC Tenants",
            source_count: 2,
            type: "organization",
            why_it_matters: "Named by city and community sources.",
          },
        ],
        reasoning_signals: [],
      },
      sources_fetched: 5,
      sources_processed: 5,
      started_at: "2026-04-20T10:00:00.000Z",
      state: "MO",
      status: "completed",
    };
  }

  function showRuns(...runs: DiscoveryRunRecord[]) {
    mocks.useDiscoveryRuns.mockReturnValue({ data: { items: runs }, isLoading: false });
  }

  it("lets a researcher take an issue area back off the request", () => {
    render(<DiscoveryPage />);

    const issue = screen.getByRole("checkbox", { name: /Issue 1/ });
    fireEvent.click(issue);
    expect(issue).toBeChecked();

    fireEvent.click(issue);
    expect(issue).not.toBeChecked();
  });

  it("tells the researcher when the brief could not be saved", () => {
    let callbacks: MutationCallbacks = {};
    mocks.useCreateWorkspaceBrief.mockReturnValue({
      isPending: false,
      mutate: vi.fn((_input: unknown, options: MutationCallbacks) => {
        callbacks = options;
      }),
    });
    showRuns(completedRun("run_1", "Kansas City"));

    render(<DiscoveryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Save as Atlas Brief" }));

    act(() => {
      callbacks.onError?.(new Error("ATLAS_API_REQUEST_FAILED"));
      callbacks.onSettled?.();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Could not save Atlas Brief.");
    expect(screen.queryByText(/ATLAS_API/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save as Atlas Brief" })).toBeEnabled();
  });

  it("keeps the second brief in flight when the first one settles", () => {
    const settlers: MutationCallbacks[] = [];
    mocks.useCreateWorkspaceBrief.mockReturnValue({
      isPending: false,
      mutate: vi.fn((_input: unknown, options: MutationCallbacks) => {
        settlers.push(options);
      }),
    });
    showRuns(completedRun("run_1", "Kansas City"), completedRun("run_2", "Saint Louis"));

    render(<DiscoveryPage />);
    const saveButtons = screen.getAllByRole("button", { name: "Save as Atlas Brief" });
    expect(saveButtons).toHaveLength(2);
    const [firstSaveButton] = saveButtons;
    if (!firstSaveButton) throw new Error("Expected a save button for the first run.");
    fireEvent.click(firstSaveButton);
    fireEvent.click(screen.getByRole("button", { name: "Save as Atlas Brief" }));

    act(() => {
      settlers[0]?.onSettled?.();
    });

    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save as Atlas Brief" })).toBeEnabled();
  });

  it("tells the researcher when the coverage target could not be created", () => {
    let callbacks: MutationCallbacks = {};
    mocks.useCreateCoverageTarget.mockReturnValue({
      isPending: false,
      mutate: vi.fn((_input: unknown, options: MutationCallbacks) => {
        callbacks = options;
      }),
    });
    showRuns(completedRun("run_1", "Kansas City"));

    render(<DiscoveryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create coverage target" }));

    act(() => {
      callbacks.onError?.(new Error("ATLAS_API_REQUEST_FAILED"));
      callbacks.onSettled?.();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Could not create coverage target.");
    expect(screen.getByRole("button", { name: "Create coverage target" })).toBeEnabled();
  });

  it("keeps the second coverage target in flight when the first one settles", () => {
    const settlers: MutationCallbacks[] = [];
    mocks.useCreateCoverageTarget.mockReturnValue({
      isPending: false,
      mutate: vi.fn((_input: unknown, options: MutationCallbacks) => {
        settlers.push(options);
      }),
    });
    showRuns(completedRun("run_1", "Kansas City"), completedRun("run_2", "Saint Louis"));

    render(<DiscoveryPage />);
    const [firstTargetButton] = screen.getAllByRole("button", { name: "Create coverage target" });
    if (!firstTargetButton) throw new Error("Expected a coverage target button for the first run.");
    fireEvent.click(firstTargetButton);
    fireEvent.click(screen.getByRole("button", { name: "Create coverage target" }));

    act(() => {
      settlers[0]?.onSettled?.();
    });

    expect(screen.getByRole("button", { name: "Creating target..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create coverage target" })).toBeEnabled();
  });

  it("tells the researcher when the top leads could not be watched", async () => {
    mocks.useWatchWorkspaceResource.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn().mockRejectedValue(new Error("ATLAS_API_REQUEST_FAILED")),
    });
    showRuns(completedRun("run_1", "Kansas City"));

    render(<DiscoveryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Watch top leads" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not watch top leads.");
    expect(screen.queryByText(/ATLAS_API/)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Watch top leads" })).toBeEnabled();
    });
  });

  it("keeps the second watch in flight when the first one settles", async () => {
    const resolvers: (() => void)[] = [];
    mocks.useWatchWorkspaceResource.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvers.push(() => {
              resolve();
            });
          }),
      ),
    });
    showRuns(completedRun("run_1", "Kansas City"), completedRun("run_2", "Saint Louis"));

    render(<DiscoveryPage />);
    const [firstWatchButton] = screen.getAllByRole("button", { name: "Watch top leads" });
    if (!firstWatchButton) throw new Error("Expected a watch button for the first run.");
    fireEvent.click(firstWatchButton);
    fireEvent.click(screen.getByRole("button", { name: "Watch top leads" }));

    await act(async () => {
      resolvers[0]?.();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Watching..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Watch top leads" })).toBeEnabled();
  });
});
