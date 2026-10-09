// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MergesPage } from "@/domains/editorial/merges-page";
import { mergePreview, profileMerge } from "../../../fixtures/editorial/merges";
import { renderWithProviders } from "../../../helpers/render-with-providers";

const mocks = vi.hoisted(() => ({
  listMerges: vi.fn(),
  mergeProfiles: vi.fn(),
  previewMerge: vi.fn(),
}));

vi.mock("@/domains/editorial/merges.functions", () => mocks);
vi.mock("@/platform/runtime/use-hydrated", () => ({ useHydrated: () => true }));

beforeEach(() => {
  mocks.listMerges.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("MergesPage", () => {
  it("checks a merge, then merges only after the editor confirms", async () => {
    mocks.previewMerge.mockResolvedValue(mergePreview());
    mocks.mergeProfiles.mockResolvedValue(profileMerge());
    renderWithProviders(<MergesPage />);
    await screen.findByText("No profiles have been merged.");

    fireEvent.change(screen.getByLabelText(/Profile to keep/), {
      target: { value: "reno-tenants-union" },
    });
    fireEvent.change(screen.getByLabelText(/Duplicate to fold into it/), {
      target: { value: "reno-tenants" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check this merge" }));
    const card = await screen.findByRole("article", { name: "What this merge does" });
    expect(mocks.previewMerge.mock.calls[0]?.[0]).toEqual({
      data: { duplicate: "reno-tenants", keep: "reno-tenants-union" },
    });
    fireEvent.change(within(card).getByLabelText(/Reason/), {
      target: { value: "Same EIN on both filings." },
    });

    fireEvent.click(within(card).getByRole("button", { name: "Merge" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mocks.mergeProfiles).not.toHaveBeenCalled();

    fireEvent.click(within(card).getByRole("button", { name: "Merge" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Profile to keep/)).toHaveValue("");
    });
    expect(mocks.mergeProfiles.mock.calls[0]?.[0]).toEqual({
      data: {
        duplicate: "reno-tenants",
        keep: "reno-tenants-union",
        reason: "Same EIN on both filings.",
      },
    });
    expect(screen.queryByRole("article", { name: "What this merge does" })).toBeNull();
    expect(mocks.listMerges).toHaveBeenCalledTimes(2);
  });

  it("drops a preview when an address changes and reports failures", async () => {
    mocks.listMerges.mockRejectedValue(new Error("down"));
    mocks.previewMerge.mockResolvedValueOnce(mergePreview()).mockRejectedValueOnce(new Error("x"));
    mocks.mergeProfiles.mockRejectedValue(new Error("conflict"));
    renderWithProviders(<MergesPage />);
    expect(await screen.findByText("Past merges could not load.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Profile to keep/), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText(/Duplicate to fold into it/), {
      target: { value: "b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check this merge" }));
    const card = await screen.findByRole("article", { name: "What this merge does" });
    fireEvent.change(within(card).getByLabelText(/Reason/), {
      target: { value: "Same person." },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Merge" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Merge" }),
    );
    expect(await screen.findByText("The profiles could not be merged.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Duplicate to fold into it/), {
      target: { value: "c" },
    });
    await waitFor(() => {
      expect(screen.queryByRole("article", { name: "What this merge does" })).toBeNull();
    });
    expect(screen.queryByText("The profiles could not be merged.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check this merge" }));
    expect(await screen.findByText("That merge could not be checked.")).toBeInTheDocument();
  });
});
