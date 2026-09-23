// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SignatureQuote } from "@/domains/catalog/components/profiles/signature-quote";
import { createSourceFixture } from "../../../../fixtures/catalog/entries";

describe("SignatureQuote", () => {
  it("shows source context without attributing a verbatim quote", () => {
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

    expect(screen.getByRole("region", { name: "Source context" })).toBeInTheDocument();
    expect(screen.getByText("Jane leads the housing fight.")).toBeInTheDocument();
    expect(screen.queryByRole("blockquote")).not.toBeInTheDocument();
    expect(screen.getByText("Mississippi Today")).toBeInTheDocument();
    expect(screen.getByText(/Published Feb 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Source 02 of 2/)).toBeInTheDocument();
  });

  it("uses a neutral label when the source names no publication", () => {
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

    expect(screen.getByText("Source")).toBeInTheDocument();
  });

  it("does not present ingestion as a publication date", () => {
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

    expect(screen.queryByText(/May 2026/)).not.toBeInTheDocument();
  });

  it("stays off the profile when no source carries a quote", () => {
    const { container } = render(
      <SignatureQuote sources={[createSourceFixture({ extraction_context: undefined })]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not quote a profile's own description back as coverage", () => {
    const sentence =
      "Listed as PRESIDENT of Affordable Community Housing Trust on its IRS Form 990.";
    const { container } = render(
      <SignatureQuote
        description={`${sentence} `}
        sources={[
          createSourceFixture({
            extraction_context: sentence,
            publication: "ProPublica Nonprofit Explorer",
          }),
        ]}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("still quotes a source whose words differ from the description", () => {
    render(
      <SignatureQuote
        description="Listed as PRESIDENT of Affordable Community Housing Trust."
        sources={[
          createSourceFixture({
            extraction_context: "Listed as PRESIDENT of Affordable Community Housing Trust.",
          }),
          createSourceFixture({
            extraction_context: "Jon has chaired the trust since 2019.",
            id: "source-2",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Jon has chaired the trust since 2019.")).toBeInTheDocument();
  });
});
