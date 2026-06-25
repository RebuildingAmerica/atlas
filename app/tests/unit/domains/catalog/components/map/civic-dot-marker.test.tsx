// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CivicDotMarker } from "@/domains/catalog/components/map/civic-dot-marker";
import { ISSUE_COLORS } from "@/domains/catalog/map/issue-colors";
import { CIVIC_NAVY } from "@/domains/catalog/map/marker-style";
import { makePoint } from "../../../../../helpers/catalog/map-clustering-harness";

afterEach(cleanup);

describe("CivicDotMarker", () => {
  it("renders a focusable button with a descriptive accessible name", () => {
    render(
      <CivicDotMarker
        point={makePoint({ id: "p", name: "River Keepers", type: "organization" })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", {
      name: "River Keepers, organization, corroborated",
    });
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onSelect with the actor when clicked", () => {
    const onSelect = vi.fn();
    const point = makePoint({ id: "p" });
    render(<CivicDotMarker point={point} selected={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith(point);
  });

  it("draws a person as a circle filled with their primary issue color", () => {
    const { container } = render(
      <CivicDotMarker
        point={makePoint({ id: "p", type: "person", issue_areas: ["climate-resilience"] })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    const circle = container.querySelector("circle");
    expect(circle?.getAttribute("fill")).toBe(ISSUE_COLORS.climate);
  });

  it("draws an organization as a rounded square (squircle)", () => {
    const { container } = render(
      <CivicDotMarker
        point={makePoint({ id: "o", type: "organization" })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector("rect")).not.toBeNull();
  });

  it("draws an initiative as a diamond", () => {
    const { container } = render(
      <CivicDotMarker
        point={makePoint({ id: "i", type: "initiative" })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector("polygon")).not.toBeNull();
  });

  it("rings a verified actor in civic navy", () => {
    const { container } = render(
      <CivicDotMarker
        point={makePoint({ id: "v", type: "person", trust_level: "atlas_verified" })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector("circle")?.getAttribute("stroke")).toBe(CIVIC_NAVY);
  });

  it("draws no ring for an unverified actor (silence is honest)", () => {
    const { container } = render(
      <CivicDotMarker
        point={makePoint({ id: "u", type: "person", trust_level: "unverified" })}
        selected={false}
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector("circle")?.getAttribute("stroke")).toBe("none");
  });

  it("lifts the selected dot by growing its radius rather than scaling chrome", () => {
    const point = makePoint({ id: "p", type: "person" });
    const { container, rerender } = render(
      <CivicDotMarker point={point} selected={false} onSelect={vi.fn()} />,
    );
    const restingRadius = Number(container.querySelector("circle")?.getAttribute("r"));
    rerender(<CivicDotMarker point={point} selected={true} onSelect={vi.fn()} />);
    const liftedRadius = Number(container.querySelector("circle")?.getAttribute("r"));
    expect(liftedRadius).toBeGreaterThan(restingRadius);
  });
});
