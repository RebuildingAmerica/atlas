// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileAnswerCard } from "@/domains/catalog/components/profiles/profile-answer-card";
import {
  createEntryFixture as buildEntry,
  createSourceFixture as buildSource,
} from "../../../../fixtures/catalog/entries";

afterEach(() => {
  cleanup();
});

describe("ProfileAnswerCard", () => {
  it("answers who, what, where, why, and how Atlas knows for a strong profile", () => {
    render(
      <ProfileAnswerCard
        entry={buildEntry({
          type: "organization",
          name: "Housing Justice KC",
          description: "Organizes tenants facing eviction.",
          city: "Kansas City",
          state: "MO",
          issue_areas: ["housing_affordability"],
          latest_source_date: "2026-04-15",
          source_count: 4,
          sources: [
            buildSource({
              publication: "Kansas City Beacon",
              extraction_context: "Housing Justice KC organizes eviction defense clinics.",
            }),
          ],
          trust: {
            level: "corroborated",
            independent_source_count: 3,
            website_grounded: true,
            email_grounded: false,
          },
          claim_evidence: {
            summary: {
              source_count: 4,
              source_ids: ["source-1", "source-2", "source-3", "source-4"],
              confidence: "corroborated",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
            place: {
              source_count: 2,
              source_ids: ["source-1", "source-2"],
              confidence: "corroborated",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
            issues: {
              source_count: 3,
              source_ids: ["source-1", "source-2", "source-3"],
              confidence: "corroborated",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
            contact: {
              source_count: 1,
              source_ids: ["source-4"],
              confidence: "partial",
              as_of: "2026-04-15",
              verification_level: "source-derived",
            },
          },
        })}
        issueAreaLabels={{ housing_affordability: "Housing affordability" }}
      />,
    );

    expect(screen.getByRole("region", { name: "Profile answers" })).toBeInTheDocument();
    expect(screen.getByText("Who")).toBeInTheDocument();
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByText("What they do")).toBeInTheDocument();
    expect(screen.getByText("Organizes tenants facing eviction.")).toBeInTheDocument();
    expect(screen.getByText("Where")).toBeInTheDocument();
    expect(screen.getByText("Kansas City, MO")).toBeInTheDocument();
    expect(screen.getByText("Why they matter")).toBeInTheDocument();
    expect(screen.getByText("4 sources · Housing affordability")).toBeInTheDocument();
    expect(screen.getByText("How Atlas knows")).toBeInTheDocument();
    expect(screen.getByText("4 sources · corroborated · Apr 2026")).toBeInTheDocument();
  });

  it("uses issue and source context when an entry has no description", () => {
    render(
      <ProfileAnswerCard
        entry={buildEntry({
          description: undefined,
          issue_areas: ["transit"],
          sources: [
            buildSource({
              extraction_context: "Jane Doe leads bus service advocacy.",
            }),
          ],
        })}
        issueAreaLabels={{ transit: "Transit" }}
      />,
    );

    expect(screen.getByText("3 sources · Transit")).toBeInTheDocument();
    expect(screen.getByText(/Jane Doe leads bus service advocacy/)).toBeInTheDocument();
  });

  it("uses API-provided profile answers when present", () => {
    render(
      <ProfileAnswerCard
        entry={buildEntry({
          description: "Local description",
          profile_answers: {
            who: "Organization",
            what_they_do: "Runs a tenant hotline.",
            where: "Gary, IN",
            why_they_matter: "5 sources · Housing",
            how_atlas_knows: "5 sources · corroborated · Apr 2026",
          },
        })}
        issueAreaLabels={{ housing_affordability: "Housing affordability" }}
      />,
    );

    expect(screen.getByText("Runs a tenant hotline.")).toBeInTheDocument();
    expect(screen.getByText("Gary, IN")).toBeInTheDocument();
    expect(screen.getByText("5 sources · corroborated · Apr 2026")).toBeInTheDocument();
    expect(screen.queryByText("Local description")).not.toBeInTheDocument();
  });
});
