// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileResearchContext } from "@/domains/catalog/components/profiles/profile-research-context";
import { createEntryFixture as buildEntry } from "../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));

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

    expect(screen.getByRole("region", { name: "Research context" })).toBeInTheDocument();
    expect(
      screen.getByText("Runs tenant clinics and eviction defense outreach."),
    ).toBeInTheDocument();
    expect(screen.getByText("Issue focus")).toBeInTheDocument();
    expect(screen.getByText("Housing affordability · Tenant protections")).toBeInTheDocument();
    expect(screen.getByText("Place context")).toBeInTheDocument();
    expect(screen.getByText("Kansas City, MO · local")).toBeInTheDocument();
    expect(screen.getByText("Contact route")).toBeInTheDocument();
    expect(screen.getByText("Email · hello@housingjusticekc.org")).toBeInTheDocument();
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

    expect(screen.queryByText("Contact route")).not.toBeInTheDocument();
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

    expect(screen.getByText("Evidence snapshot")).toBeInTheDocument();
    expect(screen.getByText("Related actors")).toBeInTheDocument();
    expect(screen.getByText("Source trail")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add missing context" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Claim representation" })).toBeInTheDocument();
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

    expect(screen.getByRole("region", { name: "Primary research context" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Research facts" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Evidence snapshot" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Correction actions" })).toBeInTheDocument();
    expect(screen.getAllByTestId("research-context-icon").length).toBeGreaterThanOrEqual(4);
  });
});
