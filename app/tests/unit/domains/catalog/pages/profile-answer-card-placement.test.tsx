// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEntryFixture as buildEntry,
  createSourceFixture as buildSource,
} from "../../../../fixtures/catalog/entries";

const actionClusterCaptures = vi.hoisted(() => ({
  shareUrls: [] as string[],
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

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

vi.mock("@/domains/catalog/components/profiles/signature-quote", () => ({
  SignatureQuote: () => <div data-testid="signature-quote" />,
}));

vi.mock("@/domains/catalog/components/profiles/work-section", () => ({
  WorkSection: () => <div data-testid="work-section" />,
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

describe("actor profile answer-card placement", () => {
  it("renders the profile answers panel on organization profiles", async () => {
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

    expect(screen.getByRole("region", { name: "Profile at a glance" })).toBeInTheDocument();
    expect(screen.getByText("Profile at a glance")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Why this matters" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Record history" })).toBeInTheDocument();
    expect(screen.getByText("Organization")).toBeInTheDocument();
  });

  it("renders the profile answers panel on person profiles", async () => {
    const { PersonProfilePage } =
      await import("@/domains/catalog/pages/profiles/detail/person-profile-page");

    render(<PersonProfilePage entry={buildEntry({ sources: [buildSource()] })} />);

    expect(screen.getByRole("region", { name: "Profile at a glance" })).toBeInTheDocument();
    expect(screen.getByText("Profile at a glance")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Why this matters" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Record history" })).toBeInTheDocument();
    expect(screen.getByText("Person")).toBeInTheDocument();
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
      "https://atlas.rebuildingamerica.com/profiles/people/jane-doe",
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
      "https://atlas.rebuildingamerica.com/profiles/organizations/housing-justice-kc",
    );
  });
});
