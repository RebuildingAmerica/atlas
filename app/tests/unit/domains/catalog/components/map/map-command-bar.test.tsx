// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { makePoint } from "../../../../../helpers/catalog/map-clustering-harness";
import { renderCommandBar } from "../../../../../helpers/catalog/map-command-bar-harness";
import type { PlaceMatch } from "@/domains/catalog/map/map-place-search";
import type { MapPoint } from "@rebuildingamerica/atlas-api-client";

afterEach(cleanup);

describe("MapCommandBar", () => {
  it("keeps the result menu closed until the visitor types", () => {
    renderCommandBar();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("suggests places and actors as the visitor types, in labeled groups", () => {
    renderCommandBar(undefined, [makePoint({ id: "1", name: "Dallas Housing Trust" })]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Dallas" } });

    expect(screen.getByRole("group", { name: "Places" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Actors" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Dallas, TX/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Dallas Housing Trust/ })).toBeTruthy();
  });

  it("flies to a place and sets its filter when a place option is chosen", () => {
    const onSelectPlace = vi.fn<(place: PlaceMatch) => void>();
    renderCommandBar({ onSelectPlace });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Dallas" } });
    fireEvent.click(screen.getByRole("option", { name: /Dallas, TX/ }));

    expect(onSelectPlace).toHaveBeenCalledOnce();
    expect(onSelectPlace.mock.calls[0]?.[0].label).toBe("Dallas, TX");
  });

  it("flies to and opens an actor when an actor option is chosen", () => {
    const onSelectActor = vi.fn<(point: MapPoint) => void>();
    const point = makePoint({ id: "1", name: "Dallas Housing Trust" });
    renderCommandBar({ onSelectActor }, [point]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Dallas" } });
    fireEvent.click(screen.getByRole("option", { name: /Dallas Housing Trust/ }));

    expect(onSelectActor).toHaveBeenCalledWith(point);
  });

  it("clears the query and closes the menu after a selection", () => {
    const point = makePoint({ id: "1", name: "Dallas Housing Trust" });
    renderCommandBar(undefined, [point]);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Dallas" } });
    fireEvent.click(screen.getByRole("option", { name: /Dallas Housing Trust/ }));

    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("explains a no-match query rather than showing an empty menu", () => {
    renderCommandBar(undefined, []);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "zzzznowhere" } });

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("No places or actors match");
    expect(input.getAttribute("aria-describedby")).toBe(status.id);
    expect(input.getAttribute("aria-controls")).toBeNull();
  });

  it("toggles an issue filter through the disclosure", () => {
    const onToggleFilter = vi.fn();
    renderCommandBar({ onToggleFilter });
    fireEvent.click(screen.getByRole("button", { name: /Issues/ }));
    fireEvent.click(screen.getByRole("button", { name: "Housing" }));
    expect(onToggleFilter).toHaveBeenCalledWith("issue_areas", "housing-affordability");
    expect(screen.getByRole("button", { name: /Issues/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("toggles a type filter through the disclosure", () => {
    const onToggleFilter = vi.fn();
    renderCommandBar({ onToggleFilter });
    fireEvent.click(screen.getByRole("button", { name: /Types/ }));
    fireEvent.click(screen.getByRole("button", { name: "People" }));
    expect(onToggleFilter).toHaveBeenCalledWith("entry_types", "person");
  });

  it("toggles a source filter through the disclosure", () => {
    const onToggleFilter = vi.fn();
    renderCommandBar({ onToggleFilter });
    fireEvent.click(screen.getByRole("button", { name: /Sources/ }));
    fireEvent.click(screen.getByRole("button", { name: "Local news" }));
    expect(onToggleFilter).toHaveBeenCalledWith("source_types", "news_article");
  });

  it("keeps only one map filter menu open so panels do not block sibling triggers", () => {
    renderCommandBar();

    fireEvent.click(screen.getByRole("button", { name: /Issues/ }));
    expect(screen.getByRole("button", { name: "Housing" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Types/ }));

    expect(screen.queryByRole("button", { name: "Housing" })).toBeNull();
    expect(screen.getByRole("button", { name: "People" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Issues/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.getByRole("button", { name: /Types/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("hides the Types disclosure when entry-type filtering is turned off", () => {
    renderCommandBar(undefined, undefined, { showEntryTypeFilter: false });
    expect(screen.queryByText("Types")).toBeNull();
    // Issues and Sources still anchor the filter row.
    expect(screen.getByText("Issues")).toBeTruthy();
    expect(screen.getByText("Sources")).toBeTruthy();
  });

  it("closes an open menu when Escape is pressed", () => {
    renderCommandBar(undefined, [makePoint({ id: "1", name: "Dallas Housing Trust" })]);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Dallas" } });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps the menu open on a non-Escape keypress", () => {
    renderCommandBar(undefined, [makePoint({ id: "1", name: "Dallas Housing Trust" })]);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Dallas" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("tracks and selects the active combobox option from the keyboard", () => {
    const onSelectPlace = vi.fn<(place: PlaceMatch) => void>();
    renderCommandBar({ onSelectPlace }, [makePoint({ id: "1", name: "Dallas Housing Trust" })]);
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "Dallas" } });
    const listbox = screen.getByRole("listbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });

    const option = screen.getByRole("option", { name: /Dallas, TX/ });
    expect(option.id).not.toBe("");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(input.getAttribute("aria-activedescendant")).toBe(option.id);
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(option.tagName).toBe("LI");
    expect(option.getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelectPlace).toHaveBeenCalledOnce();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows only the Actors group when nothing matches a place", () => {
    renderCommandBar(undefined, [makePoint({ id: "1", name: "Zephyr Collective" })]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Zephyr" } });
    expect(screen.getByRole("group", { name: "Actors" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Places" })).toBeNull();
  });

  it("shows only the Places group when no actor matches", () => {
    renderCommandBar(undefined, []);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Dallas" } });
    expect(screen.getByRole("group", { name: "Places" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Actors" })).toBeNull();
  });
  it("walks down the option list and wraps back to the top", () => {
    renderCommandBar(undefined, [makePoint({ id: "1", name: "Dallas Housing Trust" })]);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Dallas" } });

    const place = screen.getByRole("option", { name: /Dallas, TX/ });
    const actor = screen.getByRole("option", { name: /Dallas Housing Trust/ });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(place.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(actor.id);
    expect(actor.className).toContain("bg-surface-container-high");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(place.id);
  });

  it("walks up the option list from the bottom and wraps back round", () => {
    renderCommandBar(undefined, [makePoint({ id: "1", name: "Dallas Housing Trust" })]);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Dallas" } });

    const place = screen.getByRole("option", { name: /Dallas, TX/ });
    const actor = screen.getByRole("option", { name: /Dallas Housing Trust/ });

    // Nothing is active yet, so the first ArrowUp lands on the last option.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(actor.id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(place.id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(actor.id);
  });

  it("ignores Enter until the visitor has picked an option", () => {
    const onSelectPlace = vi.fn<(place: PlaceMatch) => void>();
    renderCommandBar({ onSelectPlace }, []);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Dallas" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelectPlace).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("ignores arrow keys when nothing matches the query", () => {
    renderCommandBar(undefined, []);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "zzzznowhere" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(input.getAttribute("aria-activedescendant")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("keeps the text cursor in the search box when an option is pressed", () => {
    renderCommandBar(undefined, [makePoint({ id: "1", name: "Dallas Housing Trust" })]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Dallas" } });

    for (const name of [/Dallas, TX/, /Dallas Housing Trust/]) {
      const mouseDown = fireEvent.mouseDown(screen.getByRole("option", { name }));
      // A prevented mousedown is what stops the input losing focus mid-pick.
      expect(mouseDown).toBe(false);
    }
  });

  it("closes an open filter menu when the visitor points somewhere else", () => {
    renderCommandBar();
    const trigger = screen.getByRole("button", { name: /Issues/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Housing" })).toBeTruthy();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Housing" }));
    expect(screen.getByRole("button", { name: "Housing" })).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("button", { name: "Housing" })).toBeNull();
  });

  it("closes an open filter menu when its own trigger is pressed again", () => {
    renderCommandBar();
    const trigger = screen.getByRole("button", { name: /Issues/ });

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes an open filter menu on Escape from its trigger", () => {
    renderCommandBar();
    const trigger = screen.getByRole("button", { name: /Issues/ });

    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Tab" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("counts the filters already applied on each disclosure", () => {
    renderCommandBar(undefined, undefined, {
      activeCounts: { issues: 2, sources: 0, types: 0 },
      selectedIssueAreas: ["housing-affordability"],
    });

    expect(screen.getByRole("button", { name: "Issues2 selected" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "SourcesAll" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Issues/ }));
    expect(screen.getByRole("button", { name: "Housing" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});
