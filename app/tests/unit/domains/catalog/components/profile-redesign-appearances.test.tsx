// @vitest-environment jsdom

import "./profile-redesign-test-setup";

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppearancesList } from "@/domains/catalog/components/profiles/appearances-list";
import { createSourceFixture as buildSource } from "../../../../fixtures/catalog/entries";

describe("AppearancesList", () => {
  it("summarizes sources as evidence packets with quoted extraction context", () => {
    render(
      <AppearancesList
        mode="organization"
        sources={[
          buildSource({
            extraction_context: "The coalition hosts a tenant hotline.",
            publication: "MS Today",
            type: "news_article",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Evidence packets")).toBeInTheDocument();
    expect(screen.getByText("1 source packet")).toBeInTheDocument();
    expect(screen.getByText("1 source type")).toBeInTheDocument();
    expect(screen.getByText("Quoted evidence")).toBeInTheDocument();
    expect(screen.getByTestId("private-notes-source-source-1")).toBeInTheDocument();
  });

  it("anchors source packets for relationship evidence links", () => {
    render(<AppearancesList mode="organization" sources={[buildSource({ id: "source-1" })]} />);

    expect(document.getElementById("source-source-1")).not.toBeNull();
  });

  it("surfaces API-provided stale source warnings on evidence packets", () => {
    render(
      <AppearancesList
        mode="organization"
        sources={[
          buildSource({
            freshness: {
              staleness_status: "stale",
              staleness_reason: "Most recent source record date is more than a year old.",
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Stale source")).toBeInTheDocument();
    expect(
      screen.getByText("Most recent source record date is more than a year old."),
    ).toBeInTheDocument();
  });

  it("names the aging and undated warnings the API sends", () => {
    const aging = render(
      <AppearancesList
        mode="organization"
        sources={[
          buildSource({
            freshness: {
              staleness_status: "aging",
              staleness_reason: "Newest source is over six months old.",
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Aging source")).toBeInTheDocument();
    aging.unmount();

    render(
      <AppearancesList
        mode="organization"
        sources={[
          buildSource({
            freshness: {
              staleness_status: "unknown",
              staleness_reason: "No source carries a publication date.",
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Undated source")).toBeInTheDocument();
  });

  it("stays quiet about freshness when the API sends a status but no reason", () => {
    render(
      <AppearancesList
        mode="organization"
        sources={[buildSource({ freshness: { staleness_status: "stale", staleness_reason: "" } })]}
      />,
    );
    expect(screen.queryByText("Stale source")).not.toBeInTheDocument();
  });

  it("leads with the newest packet and stacks the rest beneath it", () => {
    render(
      <AppearancesList
        mode="person"
        sources={[
          buildSource({
            id: "older",
            published_date: "2025-01-04",
            title: "Older coverage",
            type: "report",
          }),
          buildSource({
            id: "newest",
            published_date: "2026-05-01",
            title: "Newest coverage",
            type: "news_article",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Appearances & mentions")).toBeInTheDocument();
    expect(screen.getByText("2 source packets")).toBeInTheDocument();
    expect(screen.getByText("2 source types")).toBeInTheDocument();
    // The lead packet is the only one that gets the full expanded treatment.
    expect(screen.getByRole("link", { name: "Newest coverage" })).toHaveClass("type-title-medium");
    expect(screen.getByRole("link", { name: "Older coverage" })).toHaveClass("type-body-medium");
    expect(screen.getByText("News Article")).toBeInTheDocument();
    expect(screen.getByText("Report")).toBeInTheDocument();
  });

  it("shows the raw URL and no publication line for a bare packet", () => {
    render(
      <AppearancesList
        mode="person"
        sources={[
          buildSource({ id: "lead", published_date: "2026-05-01", title: "Lead" }),
          buildSource({
            id: "bare",
            extraction_context: undefined,
            publication: undefined,
            published_date: undefined,
            title: undefined,
            type: "other",
            url: "https://example.com/bare",
          }),
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "https://example.com/bare" })).toHaveAttribute(
      "href",
      "https://example.com/bare",
    );
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("says plainly when a profile has no linked sources", () => {
    render(<AppearancesList mode="person" sources={[]} />);
    expect(screen.getByText("Appearances & mentions")).toBeInTheDocument();
    expect(screen.getByText("No linked sources yet.")).toBeInTheDocument();
  });
  it("shows a lone bare packet by its URL with nothing it does not know", () => {
    render(
      <AppearancesList
        mode="person"
        sources={[
          buildSource({
            extraction_context: undefined,
            publication: undefined,
            published_date: undefined,
            title: undefined,
            url: "https://example.com/bare",
          }),
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "https://example.com/bare" })).toHaveAttribute(
      "href",
      "https://example.com/bare",
    );
    expect(screen.queryByText("Quoted evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Mississippi Today")).not.toBeInTheDocument();
  });

  it("orders undated packets by when Atlas ingested them", () => {
    render(
      <AppearancesList
        mode="person"
        sources={[
          buildSource({
            id: "older",
            ingested_at: "2025-01-01T00:00:00Z",
            published_date: undefined,
            title: "Older ingest",
          }),
          buildSource({
            id: "newer",
            ingested_at: "2026-06-01T00:00:00Z",
            published_date: undefined,
            title: "Newer ingest",
          }),
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Newer ingest" })).toHaveClass("type-title-medium");
    expect(screen.getByRole("link", { name: "Older ingest" })).toHaveClass("type-body-medium");
  });
});
