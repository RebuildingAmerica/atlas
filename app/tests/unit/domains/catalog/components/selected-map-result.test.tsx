// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SelectedMapResult } from "@/domains/catalog/components/browse/selected-map-result";
import { createEntryFixture } from "@/../tests/fixtures/catalog/entries";

const useEntry = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@rebuildingamerica/atlas-catalog/hooks/use-entries", () => ({ useEntry }));

beforeEach(() => {
  useEntry.mockReset();
  useEntry.mockReturnValue({ data: undefined, isError: false });
});

afterEach(cleanup);

describe("SelectedMapResult", () => {
  it("points to a selected actor already on the current results page", () => {
    const actor = createEntryFixture({ id: "vegas-actor", name: "Las Vegas Housing Group" });
    const onClear = vi.fn();
    render(
      <SelectedMapResult
        selectedId={actor.id}
        entries={[actor]}
        issueAreaLabels={{}}
        onClear={onClear}
      />,
    );

    expect(useEntry).toHaveBeenCalledWith(actor.id, { enabled: false });
    expect(screen.getByRole("link", { name: "Las Vegas Housing Group" })).toHaveAttribute(
      "href",
      "#selected-map-result",
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("shows a selected actor that is outside the current results page", () => {
    const actor = createEntryFixture({ id: "vegas-actor", name: "Las Vegas Housing Group" });
    useEntry.mockReturnValue({ data: actor, isError: false });
    render(
      <SelectedMapResult
        selectedId={actor.id}
        entries={[]}
        issueAreaLabels={{}}
        onClear={vi.fn()}
      />,
    );

    expect(useEntry).toHaveBeenCalledWith(actor.id, { enabled: true });
    expect(screen.getByRole("article")).toHaveAttribute("id", "selected-map-result");
    expect(screen.getByRole("link", { name: actor.name })).toBeInTheDocument();
  });

  it("keeps search usable while the selected profile loads or is unavailable", () => {
    const props = { selectedId: "vegas-actor", entries: [], issueAreaLabels: {}, onClear: vi.fn() };
    const view = render(<SelectedMapResult {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");

    useEntry.mockReturnValue({ data: undefined, isError: true });
    view.rerender(<SelectedMapResult {...props} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Selected profile unavailable");
  });
});
