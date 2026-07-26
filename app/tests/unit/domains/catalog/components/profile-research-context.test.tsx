// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileResearchContext } from "@/domains/catalog/components/profiles/profile-research-context";
import { createEntryFixture as buildEntry } from "../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

afterEach(() => {
  cleanup();
});

describe("ProfileResearchContext", () => {
  it("summarizes issue, place, contact, and last-seen signals as source context", () => {
    render(
      <ProfileResearchContext
        entry={buildEntry({
          description: "Runs tenant clinics and eviction defense outreach.",
          city: "Kansas City",
          state: "MO",
          latest_source_date: "2026-04-15T00:00:00Z",
          email: "hello@housingjusticekc.org",
          website: "https://housingjusticekc.org",
          preferred_contact_channel: "Email",
          issue_areas: ["housing_affordability", "tenant_protections"],
        })}
        issueAreaLabels={{
          housing_affordability: "Housing affordability",
          tenant_protections: "Tenant protections",
        }}
      />,
    );

    expect(screen.getByRole("region", { name: "Why this matters" })).toBeInTheDocument();
    expect(
      screen.getByText("Runs tenant clinics and eviction defense outreach."),
    ).toBeInTheDocument();
    const facts = within(screen.getByRole("group", { name: "Quick facts" }));
    expect(facts.getByText("Issues")).toBeInTheDocument();
    expect(screen.getByText("Housing affordability · Tenant protections")).toBeInTheDocument();
    expect(facts.getByText("Place")).toBeInTheDocument();
    expect(screen.getByText("Kansas City, MO")).toBeInTheDocument();
    expect(facts.getByText("Contact")).toBeInTheDocument();
    expect(screen.getByText("hello@housingjusticekc.org")).toBeInTheDocument();
    expect(screen.getByText("Last seen")).toBeInTheDocument();
    expect(screen.getByText("Apr 2026")).toBeInTheDocument();
  });

  it("omits contact details when no public contact route exists", () => {
    render(
      <ProfileResearchContext
        entry={buildEntry({
          email: undefined,
          website: undefined,
          phone: undefined,
          preferred_contact_channel: undefined,
        })}
        issueAreaLabels={{ housing_affordability: "Housing affordability" }}
      />,
    );

    const facts = within(screen.getByRole("group", { name: "Quick facts" }));
    expect(facts.queryByText("Contact")).not.toBeInTheDocument();
  });

  it("keeps correction actions practical without self-referential reuse-loop copy", () => {
    render(
      <ProfileResearchContext
        entry={buildEntry({
          slug: "housing-justice-kc",
          source_count: 4,
          issue_areas: ["housing_affordability"],
        })}
        issueAreaLabels={{ housing_affordability: "Housing affordability" }}
      />,
    );

    expect(screen.getByText("Evidence")).toBeInTheDocument();
    expect(screen.getByText("Related people and groups")).toBeInTheDocument();
    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add missing context" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Verify representation" })).toBeInTheDocument();
    expect(screen.queryByText("Record reuse loop")).not.toBeInTheDocument();
    expect(screen.queryByText("Reusable research record")).not.toBeInTheDocument();
    expect(screen.queryByText("Reuse with more confidence")).not.toBeInTheDocument();
  });

  it("separates the profile narrative, scan facts, and correction actions into distinct regions", () => {
    render(
      <ProfileResearchContext
        entry={buildEntry({
          description: "Runs tenant clinics and eviction defense outreach.",
          source_count: 4,
          issue_areas: ["housing_affordability"],
        })}
        issueAreaLabels={{ housing_affordability: "Housing affordability" }}
      />,
    );

    expect(screen.getByRole("region", { name: "Profile summary" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Quick facts" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Evidence" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Corrections" })).toBeInTheDocument();
    expect(screen.getAllByTestId("research-context-icon").length).toBeGreaterThanOrEqual(4);
  });
});
