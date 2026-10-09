// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TakedownsPage } from "@/domains/editorial/takedowns-page";
import { DANA_TAKEDOWN, HELD_TAKEDOWN } from "../../../fixtures/editorial/takedowns";
import { renderWithProviders } from "../../../helpers/render-with-providers";

const mocks = vi.hoisted(() => ({
  createTakedown: vi.fn(),
  listTakedowns: vi.fn(),
  restoreTakedown: vi.fn(),
}));

vi.mock("@/domains/editorial/takedowns.functions", () => mocks);
vi.mock("@/platform/runtime/use-hydrated", () => ({ useHydrated: () => true }));

beforeEach(() => {
  mocks.listTakedowns.mockResolvedValue([DANA_TAKEDOWN, HELD_TAKEDOWN]);
});

afterEach(() => {
  cleanup();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("TakedownsPage", () => {
  it("takes a profile down only after the editor confirms, then clears the form", async () => {
    mocks.createTakedown.mockResolvedValue(DANA_TAKEDOWN);
    renderWithProviders(<TakedownsPage />);
    await screen.findByText("Dana Example");
    fireEvent.change(screen.getByLabelText(/Profile address/), { target: { value: "dana" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Asked by email." } });

    fireEvent.click(screen.getByRole("button", { name: "Take down" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mocks.createTakedown).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Take down" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Take down" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/Profile address/)).toHaveValue("");
    });
    expect(mocks.createTakedown.mock.calls[0]?.[0]).toEqual({
      data: { address: "dana", reason: "Asked by email." },
    });
    expect(mocks.listTakedowns).toHaveBeenCalledTimes(2);
  });

  it("restores after confirmation and says what restoring does", async () => {
    mocks.restoreTakedown.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<TakedownsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Restore Held Group" }));
    const heldDialog = await screen.findByRole("dialog");
    expect(heldDialog).toHaveTextContent("goes back to waiting for editorial review");
    fireEvent.click(within(heldDialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Restore Dana Example" }));
    const danaDialog = await screen.findByRole("dialog");
    expect(danaDialog).toHaveTextContent("public on Atlas again");
    fireEvent.click(within(danaDialog).getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Restore Dana Example" })).toBeDisabled();
    });
    expect(mocks.restoreTakedown.mock.calls[0]?.[0]).toEqual({
      data: { takedownId: DANA_TAKEDOWN.id },
    });
  });

  it("says why a takedown, a restore or the list failed", async () => {
    mocks.createTakedown.mockRejectedValue(new Error("down"));
    mocks.restoreTakedown.mockRejectedValue(new Error("down"));
    renderWithProviders(<TakedownsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Restore Dana Example" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore" }),
    );
    expect(await screen.findByText("The profile could not be restored.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Profile address/), { target: { value: "dana" } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Asked by email." } });
    fireEvent.click(screen.getByRole("button", { name: "Take down" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Take down" }),
    );
    expect(await screen.findByText("The profile could not be taken down.")).toBeInTheDocument();
  });

  it("says when takedowns cannot load", async () => {
    mocks.listTakedowns.mockRejectedValue(new Error("down"));
    renderWithProviders(<TakedownsPage />);

    expect(await screen.findByText("Takedowns could not load.")).toBeInTheDocument();
  });
});
