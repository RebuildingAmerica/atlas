// @vitest-environment jsdom

import "./profile-redesign-test-setup";

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectionList } from "@/domains/catalog/components/profiles/connection-list";
import type { ConnectedActor, ConnectionNetwork } from "@rebuildingamerica/atlas-api-client";
import { createEntryFixture as buildEntry } from "../../../../fixtures/catalog/entries";

describe("ConnectionList", () => {
  function buildActor(overrides: Partial<ConnectedActor> = {}): ConnectedActor {
    return {
      id: "a1",
      name: "Marcus Lee",
      type: "person",
      slug: "marcus-lee",
      description_snippet: "Tenant advocate",
      score: 5,
      strength: 100,
      tier: "strong",
      reasons: [{ kind: "same_organization", label: "Their organization", count: null }],
      evidence: "Their organization",
      ...overrides,
    };
  }

  function buildNetwork(actors: ConnectedActor[], total?: number): ConnectionNetwork {
    return { actors, total: total ?? actors.length };
  }

  it("shows a labeled skeleton while loading with no server data", () => {
    render(<ConnectionList entry={buildEntry()} network={undefined} isLoading />);
    const skeleton = screen.getByLabelText("Loading network");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(/Loading connections/i)).toBeInTheDocument();
  });

  it("keeps server-provided data visible without a skeleton while revalidating", () => {
    render(
      <ConnectionList entry={buildEntry()} network={buildNetwork([buildActor()])} isLoading />,
    );
    expect(screen.queryByLabelText("Loading network")).not.toBeInTheDocument();
    expect(screen.getByText("Marcus Lee")).toBeInTheDocument();
  });

  it("renders ranked rows with the strength tier and reason chips", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([buildActor()])}
        isLoading={false}
      />,
    );
    expect(screen.getByText("Marcus Lee")).toBeInTheDocument();
    expect(screen.getByText("Their organization")).toBeInTheDocument();
    expect(screen.getByText("Strong")).toBeInTheDocument();
  });

  it("links source-backed relationship reasons to the matching evidence packet", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([
          buildActor({
            reasons: [
              {
                kind: "sourced_edge",
                label: "Staff profile",
                count: 1,
                source_id: "source-1",
              },
            ],
            evidence: "Staff profile",
          }),
        ])}
        isLoading={false}
      />,
    );

    expect(screen.getByRole("link", { name: "Staff profile" })).toHaveAttribute(
      "href",
      "#source-source-1",
    );
  });

  it("shows the semantic relationship type for source-backed connections", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([
          buildActor({
            reasons: [
              {
                kind: "sourced_edge",
                label: "Staff profile",
                count: 1,
                source_id: "source-1",
                relationship_type: "staff",
              },
            ],
            evidence: "Staff profile",
          }),
        ])}
        isLoading={false}
      />,
    );

    expect(screen.getByText("Staff")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Staff profile" })).toHaveAttribute(
      "href",
      "#source-source-1",
    );
  });

  it("labels the moderate and light tiers", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([
          buildActor({ id: "m", name: "Mod Tie", slug: "mod", tier: "moderate", strength: 50 }),
          buildActor({ id: "w", name: "Weak Tie", slug: "weak", tier: "weak", strength: 20 }),
        ])}
        isLoading={false}
      />,
    );
    expect(screen.getByText("Moderate")).toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
  });

  it("links person actors to the people route and org actors to the org route", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([
          buildActor({ id: "p", name: "Person A", type: "person", slug: "person-a" }),
          buildActor({ id: "o", name: "Acme Org", type: "organization", slug: "acme-org" }),
        ])}
        isLoading={false}
      />,
    );
    expect(screen.getByRole("link", { name: /Person A/ })).toHaveAttribute(
      "href",
      "/profiles/people/person-a",
    );
    expect(screen.getByRole("link", { name: /Acme Org/ })).toHaveAttribute(
      "href",
      "/profiles/organizations/acme-org",
    );
  });

  it("renders an unlinked row when the actor has no slug", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([buildActor({ id: "anon", name: "Anon Actor", slug: null })])}
        isLoading={false}
      />,
    );
    expect(screen.getByText("Anon Actor")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Anon Actor/ })).not.toBeInTheDocument();
  });

  it("shows an honest 'strongest of N' note when the total exceeds the page", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([buildActor()], 25)}
        isLoading={false}
      />,
    );
    expect(screen.getByText(/strongest of 25 connections/i)).toBeInTheDocument();
  });

  it("omits the total note when everything is shown", () => {
    render(
      <ConnectionList
        entry={buildEntry()}
        network={buildNetwork([buildActor()])}
        isLoading={false}
      />,
    );
    expect(screen.queryByText(/strongest of/i)).not.toBeInTheDocument();
  });

  it("shows an empty state with full browse links when there are no connections", () => {
    render(<ConnectionList entry={buildEntry()} network={buildNetwork([])} isLoading={false} />);
    expect(screen.getByText(/No connections surfaced yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Keep exploring/i)).toBeInTheDocument();
    expect(screen.getByText("More people in MS")).toBeInTheDocument();
    expect(screen.getByText("Organizations working on Housing Affordability")).toBeInTheDocument();
    expect(screen.getByText("Housing Affordability in another place")).toBeInTheDocument();
    expect(screen.getByText("All profiles")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /More people in MS/ })).toHaveAttribute(
      "data-link-search",
      JSON.stringify({ entry_types: "person", states: "MS" }),
    );
  });

  it("treats undefined network (not loading) as empty", () => {
    render(<ConnectionList entry={buildEntry()} network={undefined} isLoading={false} />);
    expect(screen.getByText(/No connections surfaced yet/i)).toBeInTheDocument();
  });

  it("renders a minimal browse-more list when entry lacks state and issue areas", () => {
    render(
      <ConnectionList
        entry={buildEntry({ state: undefined, issue_areas: [] })}
        network={buildNetwork([])}
        isLoading={false}
      />,
    );
    expect(screen.getByText("All profiles")).toBeInTheDocument();
    expect(screen.queryByText(/All profiles in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Browse by issue area/)).not.toBeInTheDocument();
  });
});
