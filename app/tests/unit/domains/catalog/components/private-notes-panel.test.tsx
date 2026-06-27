// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({
  useAtlasSession: vi.fn(),
}));

const annotationMocks = vi.hoisted(() => ({
  useCreateOrgAnnotation: vi.fn(),
  useOrgAnnotations: vi.fn(),
}));

vi.mock("@/domains/access", () => sessionMocks);
vi.mock("@/domains/catalog/hooks/use-org-annotations", () => annotationMocks);

import { PrivateNotesPanel } from "@/domains/catalog/components/profiles/private-notes-panel";

describe("PrivateNotesPanel", () => {
  beforeEach(() => {
    sessionMocks.useAtlasSession.mockReturnValue({
      data: {
        isLocal: false,
        workspace: {
          activeOrganization: { id: "org-1", name: "Newsroom" },
        },
      },
    });
    annotationMocks.useOrgAnnotations.mockReturnValue({
      data: [
        {
          id: "note-1",
          content: "Ask about the board vote.",
          author_id: "user-1",
          created_at: "2026-06-25T12:00:00Z",
          updated_at: "2026-06-25T12:00:00Z",
          org_id: "org-1",
          entry_id: "entry-1",
          source_id: null,
          target_id: "entry-1",
          target_type: "entry",
        },
      ],
      isLoading: false,
    });
    annotationMocks.useCreateOrgAnnotation.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows existing notes and saves a new entry note for the active workspace", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    annotationMocks.useCreateOrgAnnotation.mockReturnValue({
      mutateAsync: saveMock,
      isPending: false,
    });

    render(<PrivateNotesPanel targetId="entry-1" targetLabel="Housing Justice KC" type="entry" />);

    expect(screen.getByText("Private notes")).toBeInTheDocument();
    expect(screen.getByText("Ask about the board vote.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New note for Housing Justice KC"), {
      target: { value: "Confirm Tuesday availability." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note for Housing Justice KC" }));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith({
        orgId: "org-1",
        body: {
          entry_id: "entry-1",
          content: "Confirm Tuesday availability.",
        },
      });
    });
  });

  it("saves source notes against source_id", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    annotationMocks.useCreateOrgAnnotation.mockReturnValue({
      mutateAsync: saveMock,
      isPending: false,
    });

    render(<PrivateNotesPanel targetId="source-1" targetLabel="Local Paper" type="source" />);

    fireEvent.change(screen.getByLabelText("New note for Local Paper"), {
      target: { value: "Useful quote near the end." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note for Local Paper" }));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith({
        orgId: "org-1",
        body: {
          source_id: "source-1",
          content: "Useful quote near the end.",
        },
      });
    });
  });

  it("stays hidden without an active shared workspace", () => {
    sessionMocks.useAtlasSession.mockReturnValue({
      data: {
        isLocal: true,
        workspace: { activeOrganization: { id: "local", name: "Local" } },
      },
    });

    const { container } = render(
      <PrivateNotesPanel targetId="entry-1" targetLabel="Housing Justice KC" type="entry" />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
