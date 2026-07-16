import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { FirehoseDensity, FirehoseJumpTarget } from "./feed-model";
import { buildFirehoseFeedModel } from "./feed-model";
import { buildPublicFirehoseSearchParams } from "./public-feed";
import type { PublicFirehoseLiveState, PublicFirehoseSnapshot } from "./public-feed";
import {
  DENSITY_OPTIONS,
  READING_LATEST_SCROLL_THRESHOLD,
  VIRTUALIZED_ITEM_THRESHOLD,
  eventCountLabel,
  estimateFeedItemSize,
  itemAnchorIndex,
  liveStateLabel,
  pendingUpdateLabel,
} from "./firehose-feed-page-utils";
import {
  FirehoseJumpNavigation,
  FirehoseFeedItemRenderer,
  VirtualFirehoseFeedItem,
} from "./firehose-feed-page-components";

interface FirehoseFeedViewProps {
  liveState: PublicFirehoseLiveState;
  onApplyPendingSignals?: () => void;
  onReadingLatestChange?: (readingLatest: boolean) => void;
  onRefreshSignals?: () => void;
  pendingSignalCount?: number;
  snapshot: PublicFirehoseSnapshot;
}

interface FirehoseInfiniteFeedState {
  infiniteLoadingEnabled: boolean;
  pagesLoadedSinceResume: number;
  visibleSignalCount: number;
}

const INFINITE_FEED_PAGE_SIZE = 12;
const INFINITE_FEED_AUTO_PAGE_CAP = 3;
const ACTIVE_BUCKET_TOP_OFFSET = 96;

function initialInfiniteFeedState(totalSignals: number): FirehoseInfiniteFeedState {
  const visibleSignalCount = Math.min(INFINITE_FEED_PAGE_SIZE, totalSignals);
  const pagesLoadedSinceResume = visibleSignalCount > 0 ? 1 : 0;
  return {
    infiniteLoadingEnabled:
      visibleSignalCount < totalSignals && pagesLoadedSinceResume < INFINITE_FEED_AUTO_PAGE_CAP,
    pagesLoadedSinceResume,
    visibleSignalCount,
  };
}

function revealNextFirehosePage(
  current: FirehoseInfiniteFeedState,
  totalSignals: number,
  options: { resetPageCap: boolean },
): FirehoseInfiniteFeedState {
  const pagesLoadedSinceResume = options.resetPageCap ? 0 : current.pagesLoadedSinceResume;
  const visibleSignalCount = Math.min(
    current.visibleSignalCount + INFINITE_FEED_PAGE_SIZE,
    totalSignals,
  );
  const nextPagesLoadedSinceResume = pagesLoadedSinceResume + 1;
  return {
    infiniteLoadingEnabled:
      visibleSignalCount < totalSignals && nextPagesLoadedSinceResume < INFINITE_FEED_AUTO_PAGE_CAP,
    pagesLoadedSinceResume: nextPagesLoadedSinceResume,
    visibleSignalCount,
  };
}

function visibleEventCountLabel(visibleCount: number, totalCount: number): string {
  if (visibleCount >= totalCount) {
    return eventCountLabel(totalCount);
  }
  return `${visibleCount} of ${eventCountLabel(totalCount)}`;
}

export function FirehoseFeedView({
  liveState,
  onApplyPendingSignals,
  onReadingLatestChange,
  onRefreshSignals,
  pendingSignalCount = 0,
  snapshot,
}: FirehoseFeedViewProps) {
  const [density, setDensity] = useState<FirehoseDensity>("standard");
  const [activeJumpTargetId, setActiveJumpTargetId] = useState<string | null>(null);
  const [canVirtualize, setCanVirtualize] = useState(false);
  const [feedScrollMargin, setFeedScrollMargin] = useState(0);
  const [infiniteFeedState, setInfiniteFeedState] = useState<FirehoseInfiniteFeedState>(() =>
    initialInfiniteFeedState(snapshot.signals.length),
  );
  const [readingLatest, setReadingLatest] = useState(true);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const feedViewportRef = useRef<HTMLDivElement>(null);
  const rssParams = buildPublicFirehoseSearchParams(snapshot.query).toString();
  const rssHref = rssParams ? `/firehose.rss?${rssParams}` : "/firehose.rss";
  const totalSignalCount = snapshot.signals.length;
  const visibleSignalCount = Math.min(infiniteFeedState.visibleSignalCount, totalSignalCount);
  const visibleSignals = useMemo(
    () => snapshot.signals.slice(0, visibleSignalCount),
    [snapshot.signals, visibleSignalCount],
  );
  const model = useMemo(() => buildFirehoseFeedModel(visibleSignals), [visibleSignals]);
  const anchorIndexes = useMemo(() => itemAnchorIndex(model), [model]);
  const shouldVirtualize = canVirtualize && model.items.length > VIRTUALIZED_ITEM_THRESHOLD;
  const hasMoreSignals = visibleSignalCount < totalSignalCount;
  const totalSignalCountRef = useRef(totalSignalCount);
  const canAutoObserveInfiniteScroll = typeof IntersectionObserver !== "undefined";
  const showKeepLoading =
    hasMoreSignals && (!infiniteFeedState.infiniteLoadingEnabled || !canAutoObserveInfiniteScroll);
  const estimateSize = useCallback(
    (index: number) => estimateFeedItemSize(model.items[index], density),
    [density, model.items],
  );
  const rowVirtualizer = useWindowVirtualizer({
    count: model.items.length,
    estimateSize,
    overscan: 10,
    scrollMargin: feedScrollMargin,
  });
  const virtualItems = shouldVirtualize ? rowVirtualizer.getVirtualItems() : [];
  const latestButtonVisible = !readingLatest && snapshot.signals.length > 0;
  const fallbackActiveJumpTargetId =
    activeJumpTargetId ?? model.jumpTargets.find((target) => target.kind === "time")?.id ?? null;

  const handleJumpTarget = useCallback(
    (target: FirehoseJumpTarget) => {
      const index = anchorIndexes[target.anchorId];
      if (index === undefined) {
        return;
      }

      setActiveJumpTargetId(target.id);
      if (shouldVirtualize) {
        rowVirtualizer.scrollToIndex(index, { align: "start" });
        return;
      }

      document.getElementById(target.anchorId)?.scrollIntoView({ block: "start" });
    },
    [anchorIndexes, rowVirtualizer, shouldVirtualize],
  );
  const revealNextPage = useCallback(
    (options: { resetPageCap: boolean }) => {
      setInfiniteFeedState((current) => revealNextFirehosePage(current, totalSignalCount, options));
    },
    [totalSignalCount],
  );
  const resumeInfiniteLoading = useCallback(() => {
    revealNextPage({ resetPageCap: true });
  }, [revealNextPage]);
  const returnToLatest = useCallback(() => {
    setReadingLatest(true);
    onReadingLatestChange?.(true);
    window.scrollTo({ behavior: "smooth", top: 0 });
  }, [onReadingLatestChange]);

  useEffect(() => {
    totalSignalCountRef.current = totalSignalCount;
  }, [totalSignalCount]);

  useEffect(() => {
    setInfiniteFeedState(initialInfiniteFeedState(totalSignalCountRef.current));
  }, [rssParams]);

  useEffect(() => {
    setInfiniteFeedState((current) => {
      if (current.visibleSignalCount <= totalSignalCount) {
        return current;
      }

      const visibleSignalCount = Math.min(current.visibleSignalCount, totalSignalCount);
      return {
        infiniteLoadingEnabled:
          visibleSignalCount < totalSignalCount &&
          current.pagesLoadedSinceResume < INFINITE_FEED_AUTO_PAGE_CAP,
        pagesLoadedSinceResume: current.pagesLoadedSinceResume,
        visibleSignalCount,
      };
    });
  }, [totalSignalCount]);

  useEffect(() => {
    setCanVirtualize(typeof ResizeObserver !== "undefined");
  }, []);

  useEffect(() => {
    const handleWindowScroll = () => {
      const nextReadingLatest = window.scrollY <= READING_LATEST_SCROLL_THRESHOLD;
      setReadingLatest(nextReadingLatest);
      onReadingLatestChange?.(nextReadingLatest);

      const activeBucket = model.buckets.reduce<string | null>((currentBucketId, bucket) => {
        const bucketElement = document.getElementById(bucket.anchorId);
        if (!bucketElement) {
          return currentBucketId;
        }

        if (bucketElement.getBoundingClientRect().top <= ACTIVE_BUCKET_TOP_OFFSET) {
          return bucket.id;
        }

        return currentBucketId;
      }, model.buckets[0]?.id ?? null);
      setActiveJumpTargetId(activeBucket ? `time-${activeBucket}` : null);
    };

    handleWindowScroll();
    window.addEventListener("scroll", handleWindowScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleWindowScroll);
    };
  }, [model.buckets, onReadingLatestChange]);

  useEffect(() => {
    const measureFeedOffset = () => {
      setFeedScrollMargin(feedViewportRef.current?.offsetTop ?? 0);
    };

    measureFeedOffset();
    window.addEventListener("resize", measureFeedOffset);

    return () => {
      window.removeEventListener("resize", measureFeedOffset);
    };
  }, [snapshot.signals.length]);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [density, rowVirtualizer]);

  useEffect(() => {
    if (
      !hasMoreSignals ||
      !infiniteFeedState.infiniteLoadingEnabled ||
      !canAutoObserveInfiniteScroll
    ) {
      return;
    }

    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        revealNextPage({ resetPageCap: false });
      }
    });
    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [
    canAutoObserveInfiniteScroll,
    hasMoreSignals,
    infiniteFeedState.infiniteLoadingEnabled,
    revealNextPage,
  ]);

  return (
    <div className="bg-surface min-h-screen">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <header className="border-outline-variant mb-5 border-b pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <h1 className="type-display-small text-ink-strong">Firehose</h1>
              <p className="type-body-large text-ink-soft">
                Latest source-backed public civic updates.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="type-label-medium bg-surface-container text-ink-strong rounded-md px-3 py-1.5">
                {liveStateLabel(liveState)}
              </span>
              {liveState === "updated-manually" && onRefreshSignals ? (
                <button
                  className="type-label-medium border-outline-variant text-ink-strong hover:bg-surface-container focus-visible:ring-accent rounded-md border px-3 py-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  onClick={onRefreshSignals}
                  type="button"
                >
                  Refresh
                </button>
              ) : null}
              <span className="type-label-medium text-ink-soft border-outline-variant rounded-md border px-3 py-1.5">
                {visibleEventCountLabel(visibleSignalCount, totalSignalCount)}
              </span>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <a
              className="type-label-medium text-accent underline underline-offset-4"
              href={rssHref}
            >
              RSS feed
            </a>
            <div
              aria-label="Feed density"
              className="bg-surface-container-lowest border-outline-variant inline-flex rounded-lg border p-1"
              role="group"
            >
              {DENSITY_OPTIONS.map((option) => (
                <button
                  aria-pressed={density === option.value}
                  className={
                    density === option.value
                      ? "type-label-small bg-ink-strong text-surface focus-visible:ring-accent rounded-md px-3 py-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                      : "type-label-small text-ink-soft hover:bg-surface-container focus-visible:ring-accent rounded-md px-3 py-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  }
                  key={option.value}
                  onClick={() => {
                    setDensity(option.value);
                  }}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        {snapshot.signals.length === 0 ? (
          <p className="type-body-medium text-ink-strong py-8">No public signals listed.</p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <FirehoseJumpNavigation
              activeTargetId={fallbackActiveJumpTargetId}
              onSelectTarget={handleJumpTarget}
              targets={model.jumpTargets}
            />
            <section className="min-w-0 lg:order-1" aria-label="Firehose event stream">
              {pendingSignalCount > 0 && onApplyPendingSignals ? (
                <div className="sticky top-16 z-10 mb-3 flex justify-center lg:top-4">
                  <button
                    className="type-label-medium bg-ink-strong text-surface hover:bg-ink focus-visible:ring-accent rounded-md px-4 py-2 shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    onClick={onApplyPendingSignals}
                    type="button"
                  >
                    {pendingUpdateLabel(pendingSignalCount)}
                  </button>
                </div>
              ) : null}
              {latestButtonVisible ? (
                <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
                  <button
                    className="type-label-medium bg-ink-strong text-surface hover:bg-ink focus-visible:ring-accent pointer-events-auto rounded-full px-4 py-2 shadow-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    onClick={returnToLatest}
                    type="button"
                  >
                    Latest
                  </button>
                </div>
              ) : null}
              <div
                aria-label="Firehose events"
                className="border-outline-variant bg-surface-container-lowest rounded-lg border"
                ref={feedViewportRef}
                role="feed"
              >
                {shouldVirtualize ? (
                  <div
                    style={{
                      height: rowVirtualizer.getTotalSize(),
                      position: "relative",
                    }}
                  >
                    {virtualItems.map((virtualItem) => {
                      const item = model.items[virtualItem.index];
                      if (!item) {
                        return null;
                      }

                      return (
                        <VirtualFirehoseFeedItem
                          density={density}
                          item={item}
                          key={item.id}
                          measureElement={rowVirtualizer.measureElement}
                          style={{
                            left: 0,
                            position: "absolute",
                            top: virtualItem.start - rowVirtualizer.options.scrollMargin,
                            width: "100%",
                          }}
                        />
                      );
                    })}
                  </div>
                ) : (
                  model.items.map((item) => (
                    <FirehoseFeedItemRenderer density={density} item={item} key={item.id} />
                  ))
                )}
              </div>
              {hasMoreSignals && infiniteFeedState.infiniteLoadingEnabled ? (
                <div aria-hidden="true" className="h-8" ref={loadMoreSentinelRef} />
              ) : null}
              {showKeepLoading ? (
                <div className="border-outline-variant mt-5 border-t pt-5">
                  <div className="border-outline-variant bg-surface-container-lowest flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 shadow-sm">
                    <p className="type-label-medium text-ink-soft">
                      {visibleSignalCount} of {totalSignalCount} shown
                    </p>
                    <button
                      className="type-label-medium bg-ink-strong text-surface hover:bg-ink focus-visible:ring-accent rounded-md px-4 py-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                      onClick={resumeInfiniteLoading}
                      type="button"
                    >
                      Show more updates
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
