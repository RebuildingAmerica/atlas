// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFirehoseSignal } from "../../../helpers/firehose/signals";
import { installIntersectionObserverMock } from "../../../helpers/intersection-observer";

describe("FirehoseFeedView", () => {
  beforeEach(() => {
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

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
    expect(document.querySelector('time[datetime="2026-07-06T22:10:00Z"]')).toHaveClass(
      "type-title-small",
    );
    expect(screen.getByLabelText("Source from Detroit Transit Board")).toBeInTheDocument();
    expect(screen.getByText(/The board posted a hearing agenda/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute(
      "href",
      "https://detroit.example/agendas/night-bus",
    );
    expect(screen.queryByText(/dashboard/i)).not.toBeInTheDocument();
  });

  it("lets the page scroll with the feed while keeping jump navigation viewport-bounded", async () => {
    const { FirehoseFeedView } = await import("@/domains/firehose/firehose-feed-page");
    const { listPublicFirehoseSignals } = await import("@/domains/firehose/public-feed");

    render(
      <FirehoseFeedView
        liveState="live"
        snapshot={listPublicFirehoseSignals({ place: "detroit-mi" })}
      />,
    );

    const feedClassName = screen.getByRole("feed", { name: "Firehose events" }).className;
    expect(feedClassName).not.toContain("h-[72vh]");
    expect(feedClassName).not.toContain("min-h-[32rem]");
    expect(feedClassName).not.toContain("overflow-y-auto");

    const jumpNavigationClassName = screen.getByRole("navigation", {
      name: "Firehose jump navigation",
    }).className;
    expect(jumpNavigationClassName).toContain("lg:max-h-[calc(100vh-3rem)]");
    expect(jumpNavigationClassName).toContain("lg:overflow-y-auto");
  });

  it("gives mobile jump navigation a clear horizontal affordance", async () => {
    const { FirehoseFeedView } = await import("@/domains/firehose/firehose-feed-page");
    const { listPublicFirehoseSignals } = await import("@/domains/firehose/public-feed");

    const { container } = render(
      <FirehoseFeedView liveState="live" snapshot={listPublicFirehoseSignals({})} />,
    );

    const jumpScroller = container.querySelector("[data-firehose-jump-scroll]");
    expect(jumpScroller).toHaveClass("snap-x");
    expect(jumpScroller?.className).toContain("[mask-image:");
    expect(screen.getByRole("link", { name: /Now/ })).toHaveClass("snap-start");
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

  it("tracks whether the reader is at the latest item from the page scroll position", async () => {
    const { FirehoseFeedView } = await import("@/domains/firehose/firehose-feed-page");
    const { listPublicFirehoseSignals } = await import("@/domains/firehose/public-feed");
    const readingLatestChange = vi.fn();

    render(
      <FirehoseFeedView
        liveState="live"
        onReadingLatestChange={readingLatestChange}
        snapshot={listPublicFirehoseSignals({})}
      />,
    );

    await waitFor(() => {
      expect(readingLatestChange).toHaveBeenLastCalledWith(true);
    });

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 96,
    });
    fireEvent.scroll(window);

    expect(readingLatestChange).toHaveBeenLastCalledWith(false);
  });

  it("shows a Latest button after the reader scrolls away from the newest signals", async () => {
    const { FirehoseFeedView } = await import("@/domains/firehose/firehose-feed-page");
    const { listPublicFirehoseSignals } = await import("@/domains/firehose/public-feed");
    const user = userEvent.setup();

    render(<FirehoseFeedView liveState="live" snapshot={listPublicFirehoseSignals({})} />);

    expect(screen.queryByRole("button", { name: "Latest" })).not.toBeInTheDocument();

    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 240,
    });
    fireEvent.scroll(window);

    await user.click(screen.getByRole("button", { name: "Latest" }));

    expect(window.scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 0 });
  });

  it("marks the active jump bucket as the reader moves through the feed", async () => {
    const { FirehoseFeedView } = await import("@/domains/firehose/firehose-feed-page");
    const { listPublicFirehoseSignals } = await import("@/domains/firehose/public-feed");
    const baseSnapshot = listPublicFirehoseSignals({});
    const latest = baseSnapshot.signals[0];
    if (!latest) throw new Error("Expected Firehose fixture");
    const snapshot = {
      ...baseSnapshot,
      signals: [
        makeFirehoseSignal(latest, "latest-signal", "2026-07-06T23:59:00Z", {
          title: "Latest signal",
        }),
        makeFirehoseSignal(latest, "earlier-signal", "2026-07-06T21:30:00Z", {
          title: "Earlier signal",
        }),
      ],
    };

    render(<FirehoseFeedView liveState="live" snapshot={snapshot} />);

    const nowBucket = document.getElementById("firehose-bucket-now");
    const earlierBucket = document.getElementById("firehose-bucket-earlier_today");
    if (!nowBucket || !earlierBucket) throw new Error("Expected Firehose bucket anchors");
    const rect = (top: number): DOMRect => ({
      bottom: top + 12,
      height: 12,
      left: 0,
      right: 12,
      toJSON: () => ({}),
      top,
      width: 12,
      x: 0,
      y: top,
    });
    vi.spyOn(nowBucket, "getBoundingClientRect").mockReturnValue(rect(-180));
    vi.spyOn(earlierBucket, "getBoundingClientRect").mockReturnValue(rect(72));

    fireEvent.scroll(window);

    expect(screen.getByRole("link", { name: /Earlier today/ })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  it("pauses infinite loading after the page cap so the footer remains reachable", async () => {
    const { FirehoseFeedView } = await import("@/domains/firehose/firehose-feed-page");
    const { listPublicFirehoseSignals } = await import("@/domains/firehose/public-feed");
    const base = listPublicFirehoseSignals({}).signals[0];
    if (!base) throw new Error("Expected Firehose fixture");
    const snapshot = {
      ...listPublicFirehoseSignals({}),
      signals: Array.from({ length: 40 }, (_, index) =>
        makeFirehoseSignal(
          base,
          `signal-${index + 1}`,
          `2026-07-06T${String(23 - Math.floor(index / 3)).padStart(2, "0")}:${String(
            59 - index,
          ).padStart(2, "0")}:00Z`,
          { title: `Signal ${index + 1}` },
        ),
      ),
      summary: {
        latest_detected_at: "2026-07-06T23:59:00Z",
        total_signals: 40,
        visible_signals: 40,
      },
    };
    const user = userEvent.setup();
    const intersectionObserver = installIntersectionObserverMock();

    render(<FirehoseFeedView liveState="live" snapshot={snapshot} />);

    expect(screen.getByText("Signal 12")).toBeInTheDocument();
    expect(screen.queryByText("Signal 13")).not.toBeInTheDocument();

    act(() => {
      intersectionObserver.triggerIntersecting();
    });
    expect(screen.getByText("Signal 24")).toBeInTheDocument();
    expect(screen.queryByText("Signal 25")).not.toBeInTheDocument();

    act(() => {
      intersectionObserver.triggerIntersecting();
    });
    expect(screen.getByText("Signal 36")).toBeInTheDocument();
    expect(screen.queryByText("Signal 37")).not.toBeInTheDocument();
    expect(screen.getByText("36 of 40 shown")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep loading" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show more updates" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show more updates" }));

    expect(screen.getByText("Signal 40")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more updates" })).not.toBeInTheDocument();
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
