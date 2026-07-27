// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SignatureQuote } from "@/domains/catalog/components/profiles/signature-quote";
import { createSourceFixture } from "../../../../fixtures/catalog/entries";

describe("SignatureQuote", () => {
  it("pulls the first quote-bearing source and credits its publication and month", () => {
    render(
      <SignatureQuote
        sources={[
          createSourceFixture({ extraction_context: "   ", id: "source-0" }),
          createSourceFixture({
            extraction_context: "Jane leads the housing fight.",
            id: "source-1",
            publication: "Mississippi Today",
            published_date: "2026-02-01",
          }),
        ]}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Signature quote from coverage" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Jane leads the housing fight.")).toBeInTheDocument();
    expect(screen.getByText("Mississippi Today")).toBeInTheDocument();
    expect(screen.getByText(/Feb 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Source 02 of 2/)).toBeInTheDocument();
  });

  it("credits Atlas when the source names no publication", () => {
    render(
      <SignatureQuote
        sources={[
          createSourceFixture({
            extraction_context: "Jane leads the housing fight.",
            publication: undefined,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Atlas coverage")).toBeInTheDocument();
  });

  it("dates the credit from ingestion when the publisher gave no date", () => {
    render(
      <SignatureQuote
        sources={[
          createSourceFixture({
            extraction_context: "Jane leads the housing fight.",
            ingested_at: "2026-05-04T00:00:00Z",
            published_date: undefined,
          }),
        ]}
      />,
    );

    expect(screen.getByText(/May 2026/)).toBeInTheDocument();
  });

  it("stays off the profile when no source carries a quote", () => {
    const { container } = render(
      <SignatureQuote sources={[createSourceFixture({ extraction_context: undefined })]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
