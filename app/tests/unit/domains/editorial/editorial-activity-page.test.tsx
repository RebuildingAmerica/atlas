// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorialActivityPage } from "@/domains/editorial/editorial-activity-page";
import { APPROVAL, REFUSED_REMOVAL } from "../../../fixtures/editorial/editorial-activity";
import { renderWithProviders } from "../../../helpers/render-with-providers";

const mocks = vi.hoisted(() => ({ listEditorialActivity: vi.fn() }));

vi.mock("@/domains/editorial/editorial-activity.functions", () => mocks);
vi.mock("@/platform/runtime/use-hydrated", () => ({ useHydrated: () => true }));

afterEach(() => {
  cleanup();
  mocks.listEditorialActivity.mockReset();
});

describe("EditorialActivityPage", () => {
  it("shows the newest decisions and appends older ones", async () => {
    mocks.listEditorialActivity
      .mockResolvedValueOnce({ items: [APPROVAL], nextBefore: "cursor-1" })
      .mockResolvedValueOnce({ items: [REFUSED_REMOVAL], nextBefore: null });
    renderWithProviders(<EditorialActivityPage />);

    expect(await screen.findByText("Approved a discovery review")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show older" }));

    expect(await screen.findByText("Removed a discovery schedule")).toBeInTheDocument();
    expect(screen.getByText("Approved a discovery review")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Show older" })).toBeNull();
    });
    expect(mocks.listEditorialActivity).toHaveBeenNthCalledWith(1, { data: { before: null } });
    expect(mocks.listEditorialActivity).toHaveBeenNthCalledWith(2, {
      data: { before: "cursor-1" },
    });
  });

  it("says when the activity cannot load", async () => {
    mocks.listEditorialActivity.mockRejectedValue(new Error("down"));
    renderWithProviders(<EditorialActivityPage />);

    expect(await screen.findByText("Editorial activity could not load.")).toBeInTheDocument();
  });
});
