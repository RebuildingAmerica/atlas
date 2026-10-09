// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MergesView, type MergesViewProps } from "@/domains/editorial/merges-view";
import { mergePreview, noMoves, profileMerge } from "../../../fixtures/editorial/merges";
import { mergesViewProps } from "../../../helpers/editorial/merges-view";

afterEach(cleanup);

describe("MergesView", () => {
  function renderView(overrides: Partial<MergesViewProps> = {}): MergesViewProps {
    const props = mergesViewProps(overrides);
    render(<MergesView {...props} />);
    return props;
  }

  it("checks a merge only once both addresses are given", () => {
    const props = renderView();
    const check = screen.getByRole("button", { name: "Check this merge" });
    expect(check).toBeDisabled();
    fireEvent.submit(check.closest("form") ?? document.body);
    expect(props.onPreview).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Profile to keep/), {
      target: { value: " reno-tenants-union " },
    });
    fireEvent.change(screen.getByLabelText(/Duplicate to fold into it/), {
      target: { value: "reno-tenants" },
    });
    fireEvent.click(check);

    expect(props.onPairChange).toHaveBeenCalledTimes(2);
    expect(props.onPreview).toHaveBeenCalledWith({
      duplicate: "reno-tenants",
      keep: "reno-tenants-union",
    });
  });

  it("shows what moves and merges once the editor says why", () => {
    const preview = mergePreview();
    const props = renderView({ preview });
    const card = screen.getByRole("article", { name: "What this merge does" });

    expect(within(card).getByText("Reno Tenants Union")).toBeInTheDocument();
    expect(within(card).getByText(/Organization · \/reno-tenants · published/)).toBeInTheDocument();
    expect(within(card).getByText("3 sources, 1 follower")).toBeInTheDocument();
    expect(within(card).getByText(/2 pending discovery reviews/)).toBeInTheDocument();
    const mergeButton = within(card).getByRole("button", { name: "Merge" });
    expect(mergeButton).toBeDisabled();
    fireEvent.submit(mergeButton.closest("form") ?? document.body);
    expect(props.onMerge).not.toHaveBeenCalled();

    fireEvent.change(within(card).getByLabelText(/Reason/), {
      target: { value: " Same EIN on both filings. " },
    });
    fireEvent.click(mergeButton);

    expect(props.onMerge).toHaveBeenCalledWith(preview, "Same EIN on both filings.");
  });

  it("explains a blocked merge instead of offering it", () => {
    renderView({
      preview: mergePreview({
        blockers: ["Reno Tenants is taken down. Restore it before merging."],
        duplicate: { ...mergePreview().duplicate, active: false, type: "person" },
        moves: noMoves(),
      }),
    });

    expect(screen.getByText("Nothing but its address.")).toBeInTheDocument();
    expect(screen.queryByText(/pending discovery review/)).toBeNull();
    expect(screen.getByText(/Person · \/reno-tenants · not published/)).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Why this cannot be merged" })).getByText(
        "Reno Tenants is taken down. Restore it before merging.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Merge" })).toBeNull();
  });

  it("shows work in progress and failures", () => {
    renderView({
      errorMessage: "Past merges could not load.",
      isMerging: true,
      isPreviewing: true,
      mergeError: "The profiles could not be merged.",
      preview: mergePreview(),
      previewError: "That merge could not be checked.",
    });

    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Merging…" })).toBeDisabled();
    expect(screen.getByText("The profiles could not be merged.")).toBeInTheDocument();
    expect(screen.getByText("That merge could not be checked.")).toBeInTheDocument();
    expect(screen.getByText("Past merges could not load.")).toBeInTheDocument();
    expect(screen.queryByText("No profiles have been merged.")).toBeNull();
  });

  it("lists past merges, and says when there are none", () => {
    renderView({
      merges: [profileMerge(), { ...profileMerge(), id: "merge-2", moved: noMoves() }],
    });

    expect(screen.getAllByText("Reno Tenants into Reno Tenants Union")).toHaveLength(2);
    expect(
      screen.getByText(/by editor@rebuildingus.org · moved 3 sources, 1 follower, 1 identity key/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Same EIN on both filings.")).toHaveLength(2);

    cleanup();
    renderView();
    expect(screen.getByText("No profiles have been merged.")).toBeInTheDocument();

    cleanup();
    renderView({ isLoading: true });
    expect(screen.queryByText("No profiles have been merged.")).toBeNull();
  });
});
