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
});
