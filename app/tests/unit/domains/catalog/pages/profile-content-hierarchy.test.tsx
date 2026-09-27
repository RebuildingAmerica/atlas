// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders as render } from "../../../../helpers/render-with-providers";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEntryFixture as buildEntry,
  createSourceFixture as buildSource,
} from "../../../../fixtures/catalog/entries";

const actionClusterCaptures = vi.hoisted(() => ({
  shareUrls: [] as string[],
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access", () => ({
  useAtlasSession: () => ({ data: null }),
}));

vi.mock("@rebuildingamerica/atlas-catalog/hooks/use-taxonomy", () => ({
  useTaxonomy: () => ({
    data: {
      Housing: [
        {
          name: "Housing affordability",
          slug: "housing_affordability",
        },
      ],
    },
  }),
}));

vi.mock("@rebuildingamerica/atlas-catalog/hooks/use-connections", () => ({
  useConnections: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@rebuildingamerica/atlas-catalog/hooks/use-entries", () => ({
  useEntries: () => ({ data: { data: [] } }),
  useEntry: () => ({ data: null }),
}));

vi.mock("@/domains/catalog/components/profiles/action-cluster", () => ({
  ActionCluster: (props: { shareUrl: string }) => {
    actionClusterCaptures.shareUrls.push(props.shareUrl);
    return <div data-testid="action-cluster" />;
  },
}));

vi.mock("@/domains/catalog/components/profiles/appearances-list", () => ({
  AppearancesList: () => <div data-testid="appearances-list" />,
}));

vi.mock("@/domains/catalog/components/profiles/avatar-row", () => ({
  AvatarRow: () => <div data-testid="avatar-row" />,
}));

vi.mock("@/domains/catalog/components/profiles/data-quality-block", () => ({
  DataQualityBlock: () => <div data-testid="data-quality" />,
}));

vi.mock("@/domains/catalog/components/profiles/issue-footprint", () => ({
  IssueFootprint: () => <div data-testid="issue-footprint" />,
}));

vi.mock("@/domains/catalog/components/profiles/connection-list", () => ({
  ConnectionList: () => <div data-testid="connection-list" />,
}));

vi.mock("@/domains/catalog/components/profiles/presence-section", () => ({
  PresenceSection: () => <div data-testid="presence-section" />,
}));

vi.mock("@/domains/catalog/components/profiles/profile-hero", () => ({
  ProfileHero: ({ entry }: { entry: { name: string } }) => <h1>{entry.name}</h1>,
}));

vi.mock("@/domains/catalog/components/profiles/profile-head", () => ({
  ProfileJsonLd: () => null,
}));

vi.mock("@/domains/catalog/components/profiles/profile-stats", () => ({
  ProfileStats: () => <div data-testid="profile-stats" />,
}));

vi.mock("@/domains/catalog/components/profiles/actor-avatar", () => ({
  ActorAvatar: () => <div data-testid="actor-avatar" />,
}));

vi.mock("@/domains/catalog/components/profiles/reach-section", () => ({
  ReachSection: () => <div data-testid="reach-section" />,
}));

afterEach(() => {
  cleanup();
  actionClusterCaptures.shareUrls.length = 0;
});

describe("actor profile content hierarchy", () => {
  it("shows organization actions and source context without repeated summaries", async () => {
    const { OrgProfilePage } =
      await import("@/domains/catalog/pages/profiles/detail/org-profile-page");

    render(
      <OrgProfilePage
        entry={buildEntry({
          type: "organization",
          name: "Housing Justice KC",
          sources: [buildSource()],
        })}
      />,
    );

    expect(screen.queryByRole("region", { name: "Profile at a glance" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Why this matters" })).toBeNull();
    expect(screen.getByTestId("action-cluster")).toBeInTheDocument();
    expect(screen.getByTestId("appearances-list")).toBeInTheDocument();
    expect(screen.getByTestId("profile-stats")).toBeInTheDocument();
    const sources = screen.getByRole("region", { name: "Sources for this profile" });
    const history = screen.getByRole("region", { name: "Record history" });
    expect(
      Boolean(sources.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(
      screen.getByRole("heading", { level: 1, name: "Housing Justice KC" }),
    ).toBeInTheDocument();
  });

  it("shows person actions and source context without repeated summaries", async () => {
    const { PersonProfilePage } =
      await import("@/domains/catalog/pages/profiles/detail/person-profile-page");

    render(<PersonProfilePage entry={buildEntry({ sources: [buildSource()] })} />);

    expect(screen.queryByRole("region", { name: "Profile at a glance" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Why this matters" })).toBeNull();
    expect(screen.getByTestId("action-cluster")).toBeInTheDocument();
    expect(screen.getByTestId("appearances-list")).toBeInTheDocument();
    const sources = screen.getByRole("region", { name: "Sources for this profile" });
    const history = screen.getByRole("region", { name: "Record history" });
    expect(
      Boolean(sources.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("gives repeated profile sections quiet scan headers", async () => {
    const { PersonProfilePage } =
      await import("@/domains/catalog/pages/profiles/detail/person-profile-page");

    render(<PersonProfilePage entry={buildEntry({ sources: [buildSource()] })} />);

    const sourcesAndTrust = screen.getByRole("region", { name: "Sources and trust" });
    const header = sourcesAndTrust.querySelector("[data-profile-section-header='true']");
    expect(header).not.toBeNull();
    expect(header?.className).not.toContain("sticky");
    expect(sourcesAndTrust).toHaveAttribute("data-profile-section", "sources-and-trust");
  });

  it("passes canonical Atlas URLs to profile sharing actions", async () => {
    const { PersonProfilePage } =
      await import("@/domains/catalog/pages/profiles/detail/person-profile-page");
    const { OrgProfilePage } =
      await import("@/domains/catalog/pages/profiles/detail/org-profile-page");

    render(
      <PersonProfilePage
        entry={buildEntry({
          slug: "jane-doe",
          type: "person",
          sources: [buildSource()],
        })}
      />,
    );

    expect(actionClusterCaptures.shareUrls.at(-1)).toBe(
      "https://atlas.rebuildingus.org/profiles/people/jane-doe",
    );

    cleanup();
    actionClusterCaptures.shareUrls.length = 0;

    render(
      <OrgProfilePage
        entry={buildEntry({
          slug: "housing-justice-kc",
          type: "organization",
          sources: [buildSource()],
        })}
      />,
    );

    expect(actionClusterCaptures.shareUrls.at(-1)).toBe(
      "https://atlas.rebuildingus.org/profiles/organizations/housing-justice-kc",
    );
  });
});
