// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeadQualitySignals } from "@/domains/catalog/components/profiles/lead-quality-signals";
import { createEntryFixture } from "../../../../fixtures/catalog/entries";
import { isoDaysAgo } from "./lead-quality-signals-test-support";

describe("LeadQualitySignals", () => {
  it("labels the reach of a regional record", () => {
    render(<LeadQualitySignals entry={createEntryFixture({ geo_specificity: "regional" })} />);
    expect(screen.getByText("Regional lead")).toBeInTheDocument();
  });

  it("labels the reach of a statewide record", () => {
    render(<LeadQualitySignals entry={createEntryFixture({ geo_specificity: "statewide" })} />);
    expect(screen.getByText("Statewide lead")).toBeInTheDocument();
  });

  it("calls a source from the last quarter recent", () => {
    render(
      <LeadQualitySignals entry={createEntryFixture({ latest_source_date: isoDaysAgo(10) })} />,
    );
    expect(screen.getByText("Recent source")).toBeInTheDocument();
  });

  it("calls a source from the last half-year aging", () => {
    render(
      <LeadQualitySignals entry={createEntryFixture({ latest_source_date: isoDaysAgo(120) })} />,
    );
    expect(screen.getByText("Aging source")).toBeInTheDocument();
  });

  it("calls anything older than that an older source", () => {
    render(
      <LeadQualitySignals entry={createEntryFixture({ latest_source_date: isoDaysAgo(400) })} />,
    );
    expect(screen.getByText("Older source")).toBeInTheDocument();
  });

  it("treats an unparseable source date as old rather than fresh", () => {
    render(
      <LeadQualitySignals
        entry={createEntryFixture({ last_seen: "unknown", latest_source_date: undefined })}
      />,
    );
    expect(screen.getByText("Older source")).toBeInTheDocument();
  });

  it("calls a record with two source types diversely sourced", () => {
    render(
      <LeadQualitySignals
        entry={createEntryFixture({ source_types: ["news_article", "podcast"] })}
      />,
    );
    expect(screen.getByText("Diverse sources")).toBeInTheDocument();
  });

  it("calls a record backed by two independent sources diversely sourced", () => {
    render(
      <LeadQualitySignals
        entry={createEntryFixture({
          source_types: ["news_article"],
          trust: {
            level: "corroborated",
            independent_source_count: 2,
            website_grounded: null,
            email_grounded: null,
          },
        })}
      />,
    );
    expect(screen.getByText("Diverse sources")).toBeInTheDocument();
  });

  it("flags a thin source mix", () => {
    render(<LeadQualitySignals entry={createEntryFixture({ source_types: ["news_article"] })} />);
    expect(screen.getByText("Limited source mix")).toBeInTheDocument();
  });

  it("marks a verified, reachable, well-sourced record partner-ready", () => {
    render(
      <LeadQualitySignals
        entry={createEntryFixture({
          claim: { status: "verified", verification_level: "subject-verified" },
          email: "hello@example.org",
          source_count: 4,
        })}
      />,
    );
    expect(screen.getByText("Partner-ready")).toBeInTheDocument();
    expect(screen.getByText("Reachable")).toBeInTheDocument();
  });

  it("calls a corroborated, reachable record a strong partner lead", () => {
    render(
      <LeadQualitySignals
        entry={createEntryFixture({
          social_media: { bluesky: "@jane.bsky.social" },
          trust: {
            level: "corroborated",
            independent_source_count: null,
            website_grounded: null,
            email_grounded: null,
          },
        })}
      />,
    );
    expect(screen.getByText("Strong partner lead")).toBeInTheDocument();
  });

  it("tells a researcher to qualify an unverified record with no way to reach it", () => {
    render(<LeadQualitySignals entry={createEntryFixture()} />);
    expect(screen.getByText("Qualify before outreach")).toBeInTheDocument();
    expect(screen.getByText("No public contact")).toBeInTheDocument();
  });
});
