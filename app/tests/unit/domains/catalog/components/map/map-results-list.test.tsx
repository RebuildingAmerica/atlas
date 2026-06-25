// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MapResultsList } from "@/domains/catalog/components/map/map-results-list";
import { makePoint } from "../../../../../helpers/catalog/map-clustering-harness";
import type { MapPoint } from "@/types";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

beforeEach(async () => {
  const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
  resetRouterMocks();
});

afterEach(cleanup);

describe("MapResultsList", () => {
  it("lists every placed actor with a link into its profile", () => {
    const points: MapPoint[] = [
      makePoint({ id: "1", name: "Dallas Housing Trust", type: "organization", slug: "dht" }),
      makePoint({ id: "2", name: "Ada Civic", type: "person", slug: "ada-civic" }),
    ];
    render(<MapResultsList points={points} isLoading={false} onFocusActor={vi.fn()} />);

    expect(screen.getByText("Dallas Housing Trust")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Ada Civic/ });
    expect(link.getAttribute("data-link-to")).toBe("/profiles/people/$slug");
  });

  it("focuses an actor on the map when its row is activated", () => {
    const onFocusActor = vi.fn<(point: MapPoint) => void>();
    const point = makePoint({ id: "1", name: "Dallas Housing Trust" });
    render(<MapResultsList points={[point]} isLoading={false} onFocusActor={onFocusActor} />);

    fireEvent.click(screen.getByRole("button", { name: /Show Dallas Housing Trust on the map/ }));
    expect(onFocusActor).toHaveBeenCalledWith(point);
  });

  it("shows a quiet loading line instead of an empty list while fetching", () => {
    render(<MapResultsList points={[]} isLoading onFocusActor={vi.fn()} />);
    expect(screen.getByText(/Loading actors/i)).toBeTruthy();
  });

  it("explains an empty viewport rather than rendering a blank list", () => {
    render(<MapResultsList points={[]} isLoading={false} onFocusActor={vi.fn()} />);
    expect(screen.getByText(/No actors in view/i)).toBeTruthy();
  });

  it("omits the profile link for an actor that has no page yet", () => {
    const point = makePoint({ id: "1", name: "Nascent Effort", type: "initiative", slug: null });
    render(<MapResultsList points={[point]} isLoading={false} onFocusActor={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /Nascent Effort/ })).toBeNull();
    expect(screen.getByText("Nascent Effort")).toBeTruthy();
  });
});
