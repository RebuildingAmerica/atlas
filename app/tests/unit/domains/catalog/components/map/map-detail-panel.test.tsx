// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MapDetailPanel } from "@/domains/catalog/components/map/map-detail-panel";
import { selectActor, selectCluster } from "@rebuildingamerica/atlas-catalog/map/map-selection";
import { makePoint } from "../../../../../helpers/catalog/map-clustering-harness";
import {
  PANEL_CLUSTER_MEMBERS,
  PANEL_ORG_ACTOR,
} from "../../../../../helpers/catalog/map-detail-panel-harness";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

afterEach(cleanup);

describe("MapDetailPanel — actor view", () => {
  it("renders the actor's name, trust, and a deep link to the full profile", () => {
    render(
      <MapDetailPanel
        selection={selectActor(PANEL_ORG_ACTOR, { lng: -96.8, lat: 32.78 })}
        onClose={vi.fn()}
        onSelectMember={vi.fn()}
      />,
    );
    const heading = screen.getByRole("heading", { name: "Dallas Tenants United" });
    expect(heading).toBeTruthy();
    expect(screen.getByRole("dialog").getAttribute("aria-labelledby")).toBe(heading.id);
    expect(screen.getByText("Atlas-verified")).toBeTruthy();
    const profileLink = screen.getByRole("link", { name: /View full profile/ });
    expect(profileLink.getAttribute("href")).toBe("/profiles/organizations/dallas-tenants-united");
  });

  it("links the secondary action to the profile's connection network", () => {
    render(
      <MapDetailPanel
        selection={selectActor(PANEL_ORG_ACTOR, { lng: -96.8, lat: 32.78 })}
        onClose={vi.fn()}
        onSelectMember={vi.fn()}
      />,
    );
    const connectionsLink = screen.getByRole("link", { name: /See their connections/ });
    expect(connectionsLink.getAttribute("href")).toBe(
      "/profiles/organizations/dallas-tenants-united#connections",
    );
  });

  it("names the actor heading with the shared view-transition name so it morphs into the profile hero", () => {
    render(
      <MapDetailPanel
        selection={selectActor(PANEL_ORG_ACTOR, { lng: -96.8, lat: 32.78 })}
        onClose={vi.fn()}
        onSelectMember={vi.fn()}
      />,
    );
    const heading = screen.getByRole("heading", { name: "Dallas Tenants United" });
    expect(heading.style.viewTransitionName).toBe("entry-name-actor-1");
  });

  it("shows one issue badge per issue area the actor carries", () => {
    render(
      <MapDetailPanel
        selection={selectActor(PANEL_ORG_ACTOR, { lng: -96.8, lat: 32.78 })}
        onClose={vi.fn()}
        onSelectMember={vi.fn()}
      />,
    );
    expect(screen.getByText("housing-affordability")).toBeTruthy();
    expect(screen.getByText("labor-organizing")).toBeTruthy();
  });

  it("shows place, location precision, and source context for the selected actor", () => {
    render(
      <MapDetailPanel
        selection={selectActor(PANEL_ORG_ACTOR, { lng: -96.8, lat: 32.78 })}
        onClose={vi.fn()}
        onSelectMember={vi.fn()}
      />,
    );

    const facts = screen.getByLabelText("Map facts");
    expect(within(facts).getByText("Dallas, TX")).toBeTruthy();
    expect(within(facts).getByText("City-level location")).toBeTruthy();
    expect(within(facts).getByText("3 links")).toBeTruthy();
    expect(within(facts).getByText("Newest May 4, 2026")).toBeTruthy();
  });

  it("shows no issue badges when an actor carries no issue areas", () => {
    const unsorted = makePoint({
      id: "bare-1",
      name: "Unsorted Org",
      type: "organization",
      slug: "unsorted-org",
      issue_areas: [],
    });
    render(
      <MapDetailPanel
        selection={selectActor(unsorted, { lng: -96.8, lat: 32.78 })}
        onClose={vi.fn()}
        onSelectMember={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Issue areas")).toBeNull();
    expect(screen.getByRole("heading", { name: "Unsorted Org" })).toBeTruthy();
  });

  it("drops the profile CTAs honestly for an actor with no canonical profile page", () => {
    const initiative = makePoint({
      id: "init-1",
      name: "Clean Air Now",
      type: "initiative",
      slug: "clean-air-now",
    });
    render(
      <MapDetailPanel
        selection={selectActor(initiative, { lng: -96.8, lat: 32.78 })}
        onClose={vi.fn()}
        onSelectMember={vi.fn()}
      />,
    );
    expect(screen.queryByRole("link", { name: /View full profile/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /See their connections/ })).toBeNull();
    expect(screen.getByText("No profile page is available for this actor.")).toBeTruthy();
    expect(screen.queryByText(/profile is still being assembled/i)).toBeNull();
  });

  it("closes when the close button is pressed", () => {
    const onClose = vi.fn();
    render(
      <MapDetailPanel
        selection={selectActor(PANEL_ORG_ACTOR, { lng: -96.8, lat: 32.78 })}
        onClose={onClose}
        onSelectMember={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("MapDetailPanel — cluster view", () => {
  it("lists who is working here with a count in the heading", () => {
    render(
      <MapDetailPanel
        selection={selectCluster(PANEL_CLUSTER_MEMBERS, { lng: -97, lat: 31 }, 42)}
        onClose={vi.fn()}
        onSelectMember={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: /3 people and groups here/ })).toBeTruthy();
    const list = screen.getByRole("list", { name: /who's working here/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Austin Housing Coalition")).toBeTruthy();
  });

  it("opens a member's own detail when their row is pressed", () => {
    const onSelectMember = vi.fn();
    render(
      <MapDetailPanel
        selection={selectCluster(PANEL_CLUSTER_MEMBERS, { lng: -97, lat: 31 }, 42)}
        onClose={vi.fn()}
        onSelectMember={onSelectMember}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Maria Reyes/ }));
    expect(onSelectMember).toHaveBeenCalledWith(PANEL_CLUSTER_MEMBERS[1]);
  });

  it("closes the cluster view from its close button", () => {
    const onClose = vi.fn();
    render(
      <MapDetailPanel
        selection={selectCluster(PANEL_CLUSTER_MEMBERS, { lng: -97, lat: 31 }, 42)}
        onClose={onClose}
        onSelectMember={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("MapDetailPanel — motion", () => {
  it("slides in by default", () => {
    render(
      <MapDetailPanel
        selection={selectActor(PANEL_ORG_ACTOR, { lng: -96.8, lat: 32.78 })}
        onClose={vi.fn()}
        onSelectMember={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-motion")).toBe("slide");
  });

  it("appears without sliding when the visitor prefers reduced motion", () => {
    render(
      <MapDetailPanel
        selection={selectActor(PANEL_ORG_ACTOR, { lng: -96.8, lat: 32.78 })}
        onClose={vi.fn()}
        onSelectMember={vi.fn()}
        reducedMotion
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-motion")).toBe("none");
    // Never a CSS scale transform on the panel chrome.
    expect(dialog.style.transform).toBe("");
  });
});
describe("MapDetailPanel — map facts", () => {
  it("counts a single source link in the singular and dates the newest one", () => {
    render(
      <MapDetailPanel
        selection={selectActor(
          makePoint({ id: "1", latest_source_date: "2026-05-04", source_count: 1 }),
          { lng: -96.8, lat: 32.78 },
        )}
        onClose={vi.fn()}
        onSelectMember={vi.fn()}
      />,
    );

    const facts = within(screen.getByLabelText("Map facts"));
    expect(facts.getByText("1 link")).toBeTruthy();
    expect(facts.getByText("Newest May 4, 2026")).toBeTruthy();
    expect(facts.getByText("Kansas City, MO")).toBeTruthy();
  });

  it("says only that a point is mapped when nothing records how precisely", () => {
    render(
      <MapDetailPanel
        selection={selectActor(
          makePoint({
            id: "1",
            geocode_precision: undefined,
            latest_source_date: null,
            place_label: null,
          }),
          { lng: -96.8, lat: 32.78 },
        )}
        onClose={vi.fn()}
        onSelectMember={vi.fn()}
      />,
    );

    const facts = within(screen.getByLabelText("Map facts"));
    expect(facts.getByText("Mapped location")).toBeTruthy();
    expect(facts.queryByText("Place")).toBeNull();
    expect(facts.queryByText(/^Newest /)).toBeNull();
  });

  it("echoes an unparseable source date rather than dropping the fact", () => {
    render(
      <MapDetailPanel
        selection={selectActor(makePoint({ id: "1", latest_source_date: "unknown" }), {
          lng: -96.8,
          lat: 32.78,
        })}
        onClose={vi.fn()}
        onSelectMember={vi.fn()}
      />,
    );

    expect(within(screen.getByLabelText("Map facts")).getByText("Newest unknown")).toBeTruthy();
  });

  it("counts a one-member cluster in the singular", () => {
    render(
      <MapDetailPanel
        selection={selectCluster(
          [makePoint({ id: "1", name: "Dallas Tenants United" })],
          { lng: -96.8, lat: 32.78 },
          42,
        )}
        onClose={vi.fn()}
        onSelectMember={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "1 person or group here" })).toBeTruthy();
  });
});
