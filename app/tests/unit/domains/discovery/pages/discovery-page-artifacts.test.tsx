// @vitest-environment jsdom
import "./discovery-page-test-setup";

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiscoveryPage } from "@/domains/discovery/pages/discovery-page";
import { mocks } from "./discovery-page-test-setup";

describe("DiscoveryPage research artifacts", () => {
  it("copies stable research artifacts for agent and editorial workflows", async () => {
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: clipboardWriteText,
      },
    });
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Kansas City",
            research_goal: "interview_leads",
            started_at: "2026-04-20T10:00:00.000Z",
            completed_at: "2026-04-20T10:05:00.000Z",
            state: "MO",
            status: "completed",
            issue_areas: ["housing_affordability"],
            queries_generated: 2,
            sources_fetched: 5,
            sources_processed: 5,
            entries_extracted: 10,
            entries_after_dedup: 8,
            entries_confirmed: 3,
            error_message: null,
            research_summary: {
              brief: "Three source-backed tenant leads in Kansas City.",
              ranked_leads: [
                {
                  entry_id: "entry-1",
                  name: "KC Tenants",
                  type: "organization",
                  why_it_matters: "Named by city and community sources.",
                  source_count: 2,
                  confidence: "corroborated",
                  latest_source_date: "2026-04-19",
                },
              ],
              key_sources: [
                {
                  source_id: "source-1",
                  title: "Tenant meeting agenda",
                  url: "https://example.test/agenda",
                  publication: "City Council",
                  published_date: "2026-04-19",
                  why_it_matters: "Names the lead and issue.",
                },
              ],
              gaps: [{ label: "County groups", detail: "No suburban source yet." }],
              reasoning_signals: ["Two independent sources point to the same actor."],
            },
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    expect(screen.queryByText("Export artifacts")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy agent JSON" }));
      await Promise.resolve();
    });
    expect(clipboardWriteText).toHaveBeenCalledWith(
      expect.stringContaining('"schema_version": "atlas.research_artifact.v1"'),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy editorial brief" }));
      await Promise.resolve();
    });
    expect(clipboardWriteText).toHaveBeenLastCalledWith(
      expect.stringContaining("# Kansas City research brief"),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy leads CSV" }));
      await Promise.resolve();
    });
    expect(clipboardWriteText).toHaveBeenLastCalledWith(
      expect.stringContaining("rank,name,type,confidence,source_count"),
    );
  });

  it("saves a completed research summary as an Atlas Brief", async () => {
    interface CreatedBrief {
      id: string;
      title: string;
    }

    interface CreateBriefMutationOptions {
      onSettled?: () => void;
      onSuccess?: (brief: CreatedBrief) => void;
    }

    const createBrief = vi.fn((_input: unknown, options?: CreateBriefMutationOptions) => {
      options?.onSuccess?.({
        id: "brief_123",
        title: "Kansas City Interview leads",
      });
      options?.onSettled?.();
    });
    mocks.useCreateWorkspaceBrief.mockReturnValue({
      mutate: createBrief,
      isPending: false,
    });
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Kansas City",
            research_goal: "interview_leads",
            started_at: "2026-04-20T10:00:00.000Z",
            completed_at: "2026-04-20T10:05:00.000Z",
            state: "MO",
            status: "completed",
            issue_areas: ["housing_affordability"],
            queries_generated: 2,
            sources_fetched: 5,
            sources_processed: 5,
            entries_extracted: 10,
            entries_after_dedup: 8,
            entries_confirmed: 3,
            error_message: null,
            research_summary: {
              brief: "Three source-backed tenant leads in Kansas City.",
              ranked_leads: [
                {
                  entry_id: "entry_1",
                  name: "KC Tenants",
                  type: "organization",
                  why_it_matters: "Named by city and community sources.",
                  source_count: 2,
                  confidence: "corroborated",
                  latest_source_date: "2026-04-19",
                },
              ],
              key_sources: [
                {
                  source_id: "source_1",
                  title: "Tenant meeting agenda",
                  url: "https://example.test/agenda",
                  publication: "City Council",
                  published_date: "2026-04-19",
                  why_it_matters: "Names the lead and issue.",
                },
              ],
              gaps: [{ label: "County groups", detail: "No suburban source yet." }],
              reasoning_signals: ["Two independent sources point to the same actor."],
            },
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save as Atlas Brief" }));
      await Promise.resolve();
    });

    expect(createBrief).toHaveBeenCalledWith(
      expect.objectContaining({
        linked_discovery_run_ids: ["run_1"],
        linked_entry_ids: ["entry_1"],
        linked_source_ids: ["source_1"],
        title: "Kansas City Interview leads",
      }),
      expect.any(Object),
    );
    expect(screen.getByRole("link", { name: "Open brief" })).toHaveAttribute(
      "href",
      "/briefs/brief_123",
    );
  });

  it("creates a coverage target from a completed research summary", async () => {
    interface CreatedCoverageTarget {
      id: string;
      name: string;
    }

    interface CreateCoverageTargetMutationOptions {
      onSettled?: () => void;
      onSuccess?: (target: CreatedCoverageTarget) => void;
    }

    const createCoverageTarget = vi.fn(
      (_input: unknown, options?: CreateCoverageTargetMutationOptions) => {
        options?.onSuccess?.({
          id: "coverage_123",
          name: "Kansas City Interview leads coverage",
        });
        options?.onSettled?.();
      },
    );
    mocks.useCreateCoverageTarget.mockReturnValue({
      mutate: createCoverageTarget,
      isPending: false,
    });
    mocks.useDiscoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Kansas City",
            research_goal: "interview_leads",
            started_at: "2026-04-20T10:00:00.000Z",
            completed_at: "2026-04-20T10:05:00.000Z",
            state: "MO",
            status: "completed",
            issue_areas: ["housing_affordability"],
            queries_generated: 2,
            sources_fetched: 5,
            sources_processed: 5,
            entries_extracted: 10,
            entries_after_dedup: 8,
            entries_confirmed: 3,
            error_message: null,
            research_summary: {
              brief: "Three source-backed tenant leads in Kansas City.",
              ranked_leads: [
                {
                  entry_id: "entry_1",
                  name: "KC Tenants",
                  type: "organization",
                  why_it_matters: "Named by city and community sources.",
                  source_count: 2,
                  confidence: "corroborated",
                  latest_source_date: "2026-04-19",
                },
              ],
              key_sources: [
                {
                  source_id: "source_1",
                  title: "Tenant meeting agenda",
                  url: "https://example.test/agenda",
                  publication: "City Council",
                  published_date: "2026-04-19",
                  why_it_matters: "Names the lead and issue.",
                },
              ],
              gaps: [{ label: "County groups", detail: "No suburban source yet." }],
              reasoning_signals: ["Two independent sources point to the same actor."],
            },
          },
        ],
      },
      isLoading: false,
    });

    render(<DiscoveryPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create coverage target" }));
      await Promise.resolve();
    });

    expect(createCoverageTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        linked_discovery_run_ids: ["run_1"],
        linked_entry_ids: ["entry_1"],
        name: "Kansas City Interview leads coverage",
        review_state: "in_review",
      }),
      expect.any(Object),
    );
    expect(screen.getByRole("link", { name: "Open coverage" })).toHaveAttribute(
      "href",
      "/coverage/coverage_123",
    );
  });
});
