// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TakedownsView } from "@/domains/editorial/takedowns-view";
import { DANA_TAKEDOWN, HELD_TAKEDOWN } from "../../../fixtures/editorial/takedowns";
import { takedownForm, takedownsViewProps } from "../../../helpers/editorial/takedowns-view";

afterEach(cleanup);

describe("TakedownsView", () => {
  it("shows each hidden profile, why it came down and what restoring does", () => {
    const props = takedownsViewProps({ pendingTakedownId: HELD_TAKEDOWN.id });
    render(<TakedownsView {...props} />);

    expect(screen.getByText("2 hidden")).toBeInTheDocument();
    expect(screen.getByText("Asked to be removed by email.")).toBeInTheDocument();
    expect(screen.getByText(/Person · taken down Oct 8, 2026 by editor@/)).toBeInTheDocument();
    expect(screen.getByText(/Organization · taken down Oct 7, 2026/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Held Group" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restore Held Group" })).toHaveTextContent(
      "Restore to review",
    );

    fireEvent.click(screen.getByRole("button", { name: "Restore Dana Example" }));

    expect(props.onRestore).toHaveBeenCalledWith(DANA_TAKEDOWN);
    expect(screen.getByRole("button", { name: "Restore Dana Example" })).toHaveTextContent(
      "Restore and republish",
    );
  });

  it("says plainly when nothing is taken down, but not over a load failure", () => {
    const { rerender } = render(<TakedownsView {...takedownsViewProps({ takedowns: [] })} />);
    expect(screen.getByText("No profiles are taken down.")).toBeInTheDocument();

    rerender(
      <TakedownsView
        {...takedownsViewProps({
          actionError: "The profile could not be restored.",
          errorMessage: "Takedowns could not load.",
          takedowns: [],
        })}
      />,
    );
    expect(screen.getByText("Takedowns could not load.")).toBeInTheDocument();
    expect(screen.getByText("The profile could not be restored.")).toBeInTheDocument();
    expect(screen.queryByText("No profiles are taken down.")).toBeNull();

    rerender(<TakedownsView {...takedownsViewProps({ isLoading: true, takedowns: [] })} />);
    expect(document.querySelector("[aria-busy]")).not.toBeNull();
  });

  it("takes a profile down only with an address and a reason", () => {
    const props = takedownsViewProps();
    render(<TakedownsView {...props} />);
    const submit = screen.getByRole("button", { name: "Take down" });
    expect(submit).toBeDisabled();

    fireEvent.submit(takedownForm());
    expect(props.onCreate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Profile address/), {
      target: { value: " /profiles/people/dana-example " },
    });
    fireEvent.change(screen.getByLabelText(/Reason/), {
      target: { value: " Asked by email. " },
    });
    fireEvent.click(submit);

    expect(props.onCreate).toHaveBeenCalledWith({
      address: "/profiles/people/dana-example",
      reason: "Asked by email.",
    });
  });

  it("shows a takedown in progress, its refusal, and clears after success", () => {
    const props = takedownsViewProps({
      createError: "The profile could not be taken down.",
      isCreating: true,
    });
    const { rerender } = render(<TakedownsView {...props} />);
    expect(screen.getByRole("button", { name: "Taking down…" })).toBeDisabled();
    expect(screen.getByText("The profile could not be taken down.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Profile address/), { target: { value: "dana" } });
    rerender(<TakedownsView {...props} formResetKey={1} />);

    expect(screen.getByLabelText(/Profile address/)).toHaveValue("");
  });
});
