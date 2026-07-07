// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    expect(screen.getByText("1 event")).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Firehose jump navigation" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Standard" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Transit board posts night bus hearing agenda")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute(
      "href",
      "https://detroit.example/agendas/night-bus",
    );
    expect(screen.queryByText(/dashboard/i)).not.toBeInTheDocument();
  });

  it("switches density without losing source access", async () => {
    const { FirehoseFeedView } = await import("@/domains/firehose/firehose-feed-page");
    const { listPublicFirehoseSignals } = await import("@/domains/firehose/public-feed");
    const snapshot = listPublicFirehoseSignals({ place: "detroit-mi" });
    const user = userEvent.setup();

    render(<FirehoseFeedView liveState="live" snapshot={snapshot} />);

    await user.click(screen.getByRole("button", { name: "Compact" }));
    expect(screen.queryByText(snapshot.signals[0]?.evidence.passage ?? "")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open source" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expanded" }));
    expect(screen.getByText("Published public meeting agenda")).toBeInTheDocument();
    expect(screen.getByText("86% confidence")).toBeInTheDocument();
  });

  it("shows a buffered update control instead of moving the reader", async () => {
    const { FirehoseFeedView } = await import("@/domains/firehose/firehose-feed-page");
    const { listPublicFirehoseSignals } = await import("@/domains/firehose/public-feed");
    const applyPendingSignals = vi.fn();
    const user = userEvent.setup();

    render(
      <FirehoseFeedView
        liveState="live"
        onApplyPendingSignals={applyPendingSignals}
        pendingSignalCount={17}
        snapshot={listPublicFirehoseSignals({})}
      />,
    );

    await user.click(screen.getByRole("button", { name: "17 new updates" }));

    expect(applyPendingSignals).toHaveBeenCalledOnce();
  });

  it("lets manually updated feeds refresh on demand", async () => {
    const { FirehoseFeedView } = await import("@/domains/firehose/firehose-feed-page");
    const { listPublicFirehoseSignals } = await import("@/domains/firehose/public-feed");
    const refreshSignals = vi.fn();
    const user = userEvent.setup();

    render(
      <FirehoseFeedView
        liveState="updated-manually"
        onRefreshSignals={refreshSignals}
        snapshot={listPublicFirehoseSignals({})}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(refreshSignals).toHaveBeenCalledOnce();
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
