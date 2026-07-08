import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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

export function FirehoseFeedView({
  liveState,
  onApplyPendingSignals,
  onReadingLatestChange,
  onRefreshSignals,
  pendingSignalCount = 0,
  snapshot,
}: FirehoseFeedViewProps) {
  const [density, setDensity] = useState<FirehoseDensity>("standard");
  const [canVirtualize, setCanVirtualize] = useState(false);
  const feedViewportRef = useRef<HTMLDivElement>(null);
  const model = useMemo(() => buildFirehoseFeedModel(snapshot.signals), [snapshot.signals]);
  const anchorIndexes = useMemo(() => itemAnchorIndex(model), [model]);
  const shouldVirtualize = canVirtualize && model.items.length > VIRTUALIZED_ITEM_THRESHOLD;
  const rssParams = buildPublicFirehoseSearchParams(snapshot.query).toString();
  const rssHref = rssParams ? `/firehose.rss?${rssParams}` : "/firehose.rss";
  const estimateSize = useCallback(
    (index: number) => estimateFeedItemSize(model.items[index], density),
    [density, model.items],
  );
  const rowVirtualizer = useVirtualizer({
    count: model.items.length,
    estimateSize,
    getScrollElement: () => feedViewportRef.current,
    overscan: 10,
  });
  const virtualItems = shouldVirtualize ? rowVirtualizer.getVirtualItems() : [];

  const handleJumpTarget = useCallback(
    (target: FirehoseJumpTarget) => {
      const index = anchorIndexes[target.anchorId];
      if (index === undefined) {
        return;
      }

      if (shouldVirtualize) {
        rowVirtualizer.scrollToIndex(index, { align: "start" });
        return;
      }

      document.getElementById(target.anchorId)?.scrollIntoView({ block: "start" });
    },
    [anchorIndexes, rowVirtualizer, shouldVirtualize],
  );

  const handleViewportScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      onReadingLatestChange?.(event.currentTarget.scrollTop <= READING_LATEST_SCROLL_THRESHOLD);
    },
    [onReadingLatestChange],
  );

  useEffect(() => {
    setCanVirtualize(typeof ResizeObserver !== "undefined");
  }, []);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [density, rowVirtualizer]);

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
                {eventCountLabel(model.totalSignals)}
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
            <FirehoseJumpNavigation onSelectTarget={handleJumpTarget} targets={model.jumpTargets} />
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
              <div
                aria-label="Firehose events"
                className="border-outline-variant bg-surface-container-lowest h-[72vh] min-h-[32rem] overflow-y-auto rounded-lg border"
                onScroll={handleViewportScroll}
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
                            top: virtualItem.start,
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
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
