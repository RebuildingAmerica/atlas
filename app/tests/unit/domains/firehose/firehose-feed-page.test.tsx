// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

describe("FirehoseFeedView", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a simple live-file feed with timestamps and source links", async () => {
    const { FirehoseFeedView } = await import("@/domains/firehose/firehose-feed-page");
    const { listPublicFirehoseSignals } = await import("@/domains/firehose/public-feed");

    render(
      <FirehoseFeedView
        liveState="live"
        snapshot={listPublicFirehoseSignals({ place: "detroit-mi" })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Firehose" })).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Transit board posts night bus hearing agenda")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute(
      "href",
      "https://detroit.example/agendas/night-bus",
    );
    expect(screen.queryByText(/dashboard/i)).not.toBeInTheDocument();
  });

  it("renders a plain empty state", async () => {
    const { FirehoseFeedView } = await import("@/domains/firehose/firehose-feed-page");
    const { listPublicFirehoseSignals } = await import("@/domains/firehose/public-feed");

    render(
      <FirehoseFeedView
        liveState="updated-manually"
        snapshot={listPublicFirehoseSignals({ place: "missing-place" })}
      />,
    );

    expect(screen.getByText("No public signals listed.")).toBeInTheDocument();
  });
});
