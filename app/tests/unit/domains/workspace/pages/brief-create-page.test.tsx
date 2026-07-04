// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useCreateWorkspaceBrief } from "@/domains/workspace/hooks/use-briefs";
import { BriefCreatePage } from "@/domains/workspace/pages/brief-create-page";
import type { AtlasBrief } from "@/domains/workspace/server/briefs";

const mocks = vi.hoisted(() => ({
  createBrief: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className }: { children: ReactNode; className?: string; to?: string }) => (
    <a href={to} className={className} data-link-to={to}>
      {children}
    </a>
  ),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/domains/workspace/hooks/use-briefs", () => ({
  useCreateWorkspaceBrief: vi.fn(),
}));

describe("BriefCreatePage", () => {
  type CreateBriefMutation = ReturnType<typeof useCreateWorkspaceBrief>;

  function createBriefMutation(
    mutation: Pick<CreateBriefMutation, "isPending" | "mutateAsync">,
  ): CreateBriefMutation {
    return mutation as CreateBriefMutation;
  }

  beforeEach(async () => {
    const briefs = await import("@/domains/workspace/hooks/use-briefs");
    mocks.createBrief.mockReset();
    mocks.navigate.mockReset();
    vi.mocked(briefs.useCreateWorkspaceBrief).mockReturnValue(
      createBriefMutation({
        mutateAsync: mocks.createBrief,
        isPending: false,
      }),
    );
  });

  afterEach(() => {
    cleanup();
  });

  function createdBrief(): AtlasBrief {
    return {
      id: "brief_new",
      org_id: "org_123",
      title: "Detroit Tenant Power Brief",
      scope: {
        geography: "Detroit, MI",
        issue_areas: ["housing", "tenant organizing"],
        actor_types: ["organization", "person"],
        source_types: ["news", "website"],
      },
      summary: "A source-linked brief for tenant organizing.",
      linked_entry_ids: ["entry_1"],
      linked_source_ids: ["source_1", "source_2"],
      linked_discovery_run_ids: ["run_1"],
      confidence_summary: {
        source_count: 2,
        state: "partial",
        review_status: "needs review",
      },
      gaps: [
        {
          label: "Rural coverage",
          detail: "Confirm non-metro groups.",
        },
      ],
      created_by: "operator_1",
      created_at: "2026-07-03T10:00:00.000Z",
      updated_at: "2026-07-03T10:00:00.000Z",
    };
  }

  function fillRequiredFields() {
    fireEvent.change(screen.getByLabelText("Brief title"), {
      target: { value: "Detroit Tenant Power Brief" },
    });
    fireEvent.change(screen.getByLabelText("Place"), {
      target: { value: "Detroit, MI" },
    });
    fireEvent.change(screen.getByLabelText("Issues"), {
      target: { value: "housing, tenant organizing" },
    });
    fireEvent.change(screen.getByLabelText("Actors"), {
      target: { value: "organization, person" },
    });
    fireEvent.change(screen.getByLabelText("Sources"), {
      target: { value: "news, website" },
    });
    fireEvent.change(screen.getByLabelText("Brief summary"), {
      target: { value: "A source-linked brief for tenant organizing." },
    });
  }

  it("creates a source-linked brief and opens the new workspace artifact", async () => {
    mocks.createBrief.mockResolvedValue(createdBrief());

    render(<BriefCreatePage />);

    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Linked actor IDs"), {
      target: { value: "entry_1" },
    });
    fireEvent.change(screen.getByLabelText("Source receipt IDs"), {
      target: { value: "source_1, source_2" },
    });
    fireEvent.change(screen.getByLabelText("Research run IDs"), {
      target: { value: "run_1" },
    });
    fireEvent.change(screen.getByLabelText("Confidence state"), {
      target: { value: "partial" },
    });
    fireEvent.change(screen.getByLabelText("Review status"), {
      target: { value: "needs review" },
    });
    fireEvent.change(screen.getByLabelText("Known gaps"), {
      target: { value: "Rural coverage: Confirm non-metro groups." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create brief" }));

    await waitFor(() => {
      expect(mocks.createBrief).toHaveBeenCalledWith({
        title: "Detroit Tenant Power Brief",
        scope: {
          geography: "Detroit, MI",
          issue_areas: ["housing", "tenant organizing"],
          actor_types: ["organization", "person"],
          source_types: ["news", "website"],
        },
        summary: "A source-linked brief for tenant organizing.",
        linked_entry_ids: ["entry_1"],
        linked_source_ids: ["source_1", "source_2"],
        linked_discovery_run_ids: ["run_1"],
        confidence_summary: {
          source_count: 2,
          state: "partial",
          review_status: "needs review",
        },
        gaps: [
          {
            label: "Rural coverage",
            detail: "Confirm non-metro groups.",
          },
        ],
      });
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      params: { briefId: "brief_new" },
      to: "/briefs/$briefId",
    });
  });

  it("requires at least one source-linked artifact", async () => {
    render(<BriefCreatePage />);

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create brief" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Add at least one actor, source, or research run.",
    );
    expect(mocks.createBrief).not.toHaveBeenCalled();
  });

  it("rejects malformed known-gap lines before saving", async () => {
    render(<BriefCreatePage />);

    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Source receipt IDs"), {
      target: { value: "source_1" },
    });
    fireEvent.change(screen.getByLabelText("Known gaps"), {
      target: { value: "Coverage missing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create brief" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Each gap needs a label and detail.",
    );
    expect(mocks.createBrief).not.toHaveBeenCalled();
  });

  it("shows the known-gap line format before submission", () => {
    render(<BriefCreatePage />);

    expect(screen.getByText("Gap format")).toBeInTheDocument();
    expect(screen.getByText("Label: detail")).toBeInTheDocument();
  });
});
