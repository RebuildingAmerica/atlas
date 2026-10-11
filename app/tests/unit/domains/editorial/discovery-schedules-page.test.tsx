// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscoverySchedulesPage } from "@/domains/editorial/discovery-schedules-page";
import { PAUSED_SCHEDULE, RENO_SCHEDULE } from "../../../fixtures/editorial/discovery-schedules";
import { SCHEDULE_TAXONOMY_SEED } from "../../../helpers/editorial/discovery-schedules-view";
import { renderWithProviders } from "../../../helpers/render-with-providers";

const mocks = vi.hoisted(() => ({
  createDiscoverySchedule: vi.fn(),
  deleteDiscoverySchedule: vi.fn(),
  listDiscoverySchedules: vi.fn(),
  setDiscoveryScheduleEnabled: vi.fn(),
}));

vi.mock("@/domains/editorial/discovery-schedules.functions", () => mocks);
vi.mock("@/platform/runtime/use-hydrated", () => ({ useHydrated: () => true }));

beforeEach(() => {
  mocks.listDiscoverySchedules.mockResolvedValue([RENO_SCHEDULE, PAUSED_SCHEDULE]);
});

afterEach(() => {
  cleanup();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("DiscoverySchedulesPage", () => {
  it("pauses a target and shows the refreshed schedule", async () => {
    mocks.setDiscoveryScheduleEnabled.mockResolvedValue({ ...RENO_SCHEDULE, enabled: false });
    renderWithProviders(<DiscoverySchedulesPage />, SCHEDULE_TAXONOMY_SEED);

    fireEvent.click(await screen.findByRole("button", { name: "Pause Reno, NV" }));

    await waitFor(() => {
      expect(mocks.setDiscoveryScheduleEnabled.mock.calls[0]?.[0]).toEqual({
        data: { enabled: false, scheduleId: RENO_SCHEDULE.id },
      });
    });
    await waitFor(() => {
      expect(mocks.listDiscoverySchedules).toHaveBeenCalledTimes(2);
    });
  });

  it("removes a target only after the operator confirms", async () => {
    mocks.deleteDiscoverySchedule.mockResolvedValue({ id: RENO_SCHEDULE.id });
    renderWithProviders(<DiscoverySchedulesPage />, SCHEDULE_TAXONOMY_SEED);

    fireEvent.click(await screen.findByRole("button", { name: "Remove Reno, NV" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(mocks.deleteDiscoverySchedule).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove Reno, NV" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }),
    );

    await waitFor(() => {
      expect(mocks.deleteDiscoverySchedule.mock.calls[0]?.[0]).toEqual({
        data: { scheduleId: RENO_SCHEDULE.id },
      });
    });
  });

  it("adds a target and clears the form", async () => {
    mocks.createDiscoverySchedule.mockResolvedValue(RENO_SCHEDULE);
    renderWithProviders(<DiscoverySchedulesPage />, SCHEDULE_TAXONOMY_SEED);
    await screen.findByRole("heading", { name: "Reno, NV" });

    fireEvent.change(screen.getByLabelText(/Place/), { target: { value: "Boise" } });
    fireEvent.change(screen.getByLabelText(/State/), { target: { value: "ID" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Public transit" }));
    fireEvent.click(screen.getByRole("button", { name: "Add target" }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Place/)).toHaveValue("");
    });
    expect(mocks.createDiscoverySchedule.mock.calls[0]?.[0]).toEqual({
      data: {
        issueAreas: ["public_transit"],
        locationQuery: "Boise",
        searchDepth: "standard",
        state: "ID",
      },
    });
  });

  it("says why a change, removal or addition failed", async () => {
    mocks.setDiscoveryScheduleEnabled.mockRejectedValue(new Error("down"));
    mocks.deleteDiscoverySchedule.mockRejectedValue(new Error("down"));
    mocks.createDiscoverySchedule.mockRejectedValue(new Error("down"));
    renderWithProviders(<DiscoverySchedulesPage />, SCHEDULE_TAXONOMY_SEED);

    fireEvent.click(await screen.findByRole("button", { name: "Resume Las Vegas, NV" }));
    expect(await screen.findByText("The schedule could not be changed.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Las Vegas, NV" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }),
    );
    expect(await screen.findByText("The schedule could not be removed.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Place/), { target: { value: "Boise" } });
    fireEvent.change(screen.getByLabelText(/State/), { target: { value: "ID" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Public transit" }));
    fireEvent.click(screen.getByRole("button", { name: "Add target" }));
    expect(await screen.findByText("The target could not be added.")).toBeInTheDocument();
  });

  it("holds a target's buttons while it is being paused", async () => {
    mocks.setDiscoveryScheduleEnabled.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<DiscoverySchedulesPage />, SCHEDULE_TAXONOMY_SEED);

    fireEvent.click(await screen.findByRole("button", { name: "Pause Reno, NV" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Remove Reno, NV" })).toBeDisabled();
    });
  });

  it("holds a target's buttons while it is being removed", async () => {
    mocks.deleteDiscoverySchedule.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<DiscoverySchedulesPage />, SCHEDULE_TAXONOMY_SEED);

    fireEvent.click(await screen.findByRole("button", { name: "Remove Las Vegas, NV" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Resume Las Vegas, NV" })).toBeDisabled();
    });
  });

  it("says when the schedules cannot load, before the taxonomy arrives", async () => {
    mocks.listDiscoverySchedules.mockRejectedValue(new Error("down"));
    renderWithProviders(<DiscoverySchedulesPage />);

    expect(await screen.findByText("Schedules could not load.")).toBeInTheDocument();
  });
});
