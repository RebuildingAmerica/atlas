// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoverySchedulesView } from "@/domains/editorial/discovery-schedules-view";
import { PAUSED_SCHEDULE, RENO_SCHEDULE } from "../../../fixtures/editorial/discovery-schedules";
import {
  newScheduleForm,
  scheduleRow,
  schedulesViewProps,
} from "../../../helpers/editorial/discovery-schedules-view";

afterEach(cleanup);

describe("DiscoverySchedulesView", () => {
  it("shows what the nightly run will research and what is paused", () => {
    render(<DiscoverySchedulesView {...schedulesViewProps()} />);

    expect(screen.getByRole("heading", { name: "Discovery schedules" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2 running nightly")).toBeInTheDocument();

    const reno = within(scheduleRow("Reno, NV"));
    expect(reno.getByText("Housing affordability")).toBeInTheDocument();
    expect(reno.getByText("Nightly")).toBeInTheDocument();
    expect(reno.getByText(/Standard search · Last run Oct 8, 2026/)).toBeInTheDocument();

    const vegas = within(scheduleRow("Las Vegas, NV"));
    expect(vegas.getByText("Public transit, retired_issue")).toBeInTheDocument();
    expect(vegas.getByText("Paused")).toBeInTheDocument();
    expect(vegas.getByText(/Deep search · Not run yet/)).toBeInTheDocument();
  });

  it("pauses, resumes and removes a target, and holds its buttons while that is saving", () => {
    const props = schedulesViewProps({ pendingScheduleId: PAUSED_SCHEDULE.id });
    render(<DiscoverySchedulesView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Pause Reno, NV" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Reno, NV" }));

    expect(props.onToggle).toHaveBeenCalledWith(RENO_SCHEDULE);
    expect(props.onDelete).toHaveBeenCalledWith(RENO_SCHEDULE);
    expect(screen.getByRole("button", { name: "Resume Las Vegas, NV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove Las Vegas, NV" })).toBeDisabled();
  });

  it("says plainly when nothing is scheduled", () => {
    render(<DiscoverySchedulesView {...schedulesViewProps({ schedules: [] })} />);

    expect(screen.getByText(/Nothing is scheduled/)).toBeInTheDocument();
  });

  it("shows loading, and keeps the empty message away from a load failure", () => {
    const { rerender } = render(
      <DiscoverySchedulesView {...schedulesViewProps({ isLoading: true, schedules: [] })} />,
    );
    expect(document.querySelector("[aria-busy]")).not.toBeNull();

    rerender(
      <DiscoverySchedulesView
        {...schedulesViewProps({
          actionError: "The schedule could not be changed.",
          errorMessage: "Schedules could not load.",
          schedules: [],
        })}
      />,
    );
    expect(screen.getByText("Schedules could not load.")).toBeInTheDocument();
    expect(screen.getByText("The schedule could not be changed.")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is scheduled/)).toBeNull();
  });

  it("adds a target only once it names a place, a state and at least one issue", () => {
    const props = schedulesViewProps();
    render(<DiscoverySchedulesView {...props} />);
    const add = screen.getByRole("button", { name: "Add target" });
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Place/), { target: { value: " Boise " } });
    fireEvent.change(screen.getByLabelText(/State/), { target: { value: "id" } });
    fireEvent.change(screen.getByLabelText("Search depth"), { target: { value: "deep" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Public transit" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Housing affordability" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Public transit" }));
    expect(add).toBeEnabled();

    fireEvent.click(add);

    expect(props.onCreate).toHaveBeenCalledWith({
      issueAreas: ["housing_affordability"],
      locationQuery: "Boise",
      searchDepth: "deep",
      state: "ID",
    });
  });

  it("ignores a submit while the form is incomplete, and reverts to a standard search", () => {
    const props = schedulesViewProps();
    render(<DiscoverySchedulesView {...props} />);

    fireEvent.change(screen.getByLabelText("Search depth"), { target: { value: "deep" } });
    fireEvent.change(screen.getByLabelText("Search depth"), { target: { value: "standard" } });
    fireEvent.submit(newScheduleForm());

    expect(props.onCreate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Search depth")).toHaveValue("standard");
  });

  it("shows when a target is being added and why it was refused", () => {
    render(
      <DiscoverySchedulesView
        {...schedulesViewProps({ createError: "The target could not be added.", isCreating: true })}
      />,
    );

    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
    expect(screen.getByText("The target could not be added.")).toBeInTheDocument();
  });

  it("clears the form after a target is added", () => {
    const props = schedulesViewProps();
    const { rerender } = render(<DiscoverySchedulesView {...props} />);
    fireEvent.change(screen.getByLabelText(/Place/), { target: { value: "Boise" } });

    rerender(<DiscoverySchedulesView {...props} formResetKey={1} />);

    expect(screen.getByLabelText(/Place/)).toHaveValue("");
    expect(vi.mocked(props.onCreate)).not.toHaveBeenCalled();
  });
});
