import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from "react";
import {
  applyIncomingFirehoseSignal,
  buildFirehoseFeedModel,
  flushPendingFirehoseSignals,
  type FirehoseDensity,
  type FirehoseFeedItem,
  type FirehoseFeedModel,
  type FirehoseJumpKind,
  type FirehoseJumpTarget,
  type FirehoseTimeBucket,
} from "./feed-model";
import {
  buildPublicFirehoseSearchParams,
  fetchPublicFirehoseSignals,
  isPublicFirehoseEvent,
  type PublicFirehoseLiveState,
  type PublicFirehoseSignal,
  type PublicFirehoseSnapshot,
} from "./public-feed";
import { chooseFirehoseLiveTransport, readFirehoseConnectionHints } from "./transport";

interface FirehoseFeedPageProps {
  initialSnapshot: PublicFirehoseSnapshot;
}

interface FirehoseFeedViewProps {
  liveState: PublicFirehoseLiveState;
  onApplyPendingSignals?: () => void;
  onReadingLatestChange?: (readingLatest: boolean) => void;
  onRefreshSignals?: () => Promise<void> | void;
  pendingSignalCount?: number;
  snapshot: PublicFirehoseSnapshot;
}

interface FirehoseSignalRowProps {
  density: FirehoseDensity;
  signal: PublicFirehoseSignal;
}

interface FirehoseBucketDividerProps {
  bucket: FirehoseTimeBucket;
}

interface FirehoseJumpNavigationProps {
  onSelectTarget: (target: FirehoseJumpTarget) => void;
  targets: FirehoseJumpTarget[];
}

interface FirehoseJumpGroupProps {
  label: string;
  onSelectTarget: (target: FirehoseJumpTarget) => void;
  targets: FirehoseJumpTarget[];
}

interface FirehoseJumpLinkProps {
  onSelectTarget: (target: FirehoseJumpTarget) => void;
  target: FirehoseJumpTarget;
}

interface FirehoseFeedItemRendererProps {
  density: FirehoseDensity;
  item: FirehoseFeedItem;
}

interface VirtualFirehoseFeedItemProps {
  density: FirehoseDensity;
  item: FirehoseFeedItem;
  measureElement: (element: Element | null) => void;
  style: CSSProperties;
}

interface FirehoseDensityOption {
  label: string;
  value: FirehoseDensity;
}

interface FirehoseLiveSnapshotState {
  pendingSignals: PublicFirehoseSignal[];
  snapshot: PublicFirehoseSnapshot;
}

interface FirehoseLiveResult {
  applyPendingSignals: () => void;
  liveState: PublicFirehoseLiveState;
  pendingSignalCount: number;
  refreshSignals: () => Promise<void>;
  setReadingLatest: (readingLatest: boolean) => void;
  snapshot: PublicFirehoseSnapshot;
}

interface LiveFailureState {
  sse: number;
  websocket: number;
}

type FirehoseTargetGroups = Record<FirehoseJumpKind, FirehoseJumpTarget[]>;

const DENSITY_OPTIONS: FirehoseDensityOption[] = [
  { label: "Compact", value: "compact" },
  { label: "Standard", value: "standard" },
  { label: "Expanded", value: "expanded" },
];
const FACET_TARGET_LIMIT = 6;
const LIVE_SOCKET_PROTOCOL = "atlas.firehose.public.v1";
const READING_LATEST_SCROLL_THRESHOLD = 72;
const VIRTUALIZED_ITEM_THRESHOLD = 40;

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function eventCountLabel(count: number): string {
  return `${count} ${count === 1 ? "event" : "events"}`;
}

function pendingUpdateLabel(count: number): string {
  return `${count} new ${count === 1 ? "update" : "updates"}`;
}

function jumpCountLabel(count: number): string {
  return `${count} ${count === 1 ? "jump" : "jumps"}`;
}

function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}% confidence`;
}

function transportUrl(pathname: string, snapshot: PublicFirehoseSnapshot): string {
  const params = buildPublicFirehoseSearchParams(snapshot.query);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return `${pathname}${suffix}`;
}

function websocketUrl(snapshot: PublicFirehoseSnapshot): string {
  const basePath = transportUrl("/api/firehose/public/socket", snapshot);
  if (typeof window === "undefined") {
    return basePath;
  }
  const url = new URL(basePath, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function snapshotWithSignals(
  snapshot: PublicFirehoseSnapshot,
  signals: PublicFirehoseSignal[],
): PublicFirehoseSnapshot {
  return {
    ...snapshot,
    signals,
    summary: {
      latest_detected_at: signals[0]?.detected_at ?? null,
      total_signals: signals.length,
      visible_signals: signals.length,
    },
  };
}

function usePublicFirehoseLive(initialSnapshot: PublicFirehoseSnapshot): FirehoseLiveResult {
  const [streamState, setStreamState] = useState<FirehoseLiveSnapshotState>(() => ({
    pendingSignals: [],
    snapshot: initialSnapshot,
  }));
  const [liveState, setLiveState] = useState<PublicFirehoseLiveState>("updated-manually");
  const [failures, setFailures] = useState<LiveFailureState>({ sse: 0, websocket: 0 });
  const readingLatestRef = useRef(true);

  const applyLiveSignal = useCallback((incomingSignal: PublicFirehoseSignal) => {
    setStreamState((current) => {
      const nextSignals = applyIncomingFirehoseSignal(
        {
          pendingSignals: current.pendingSignals,
          signals: current.snapshot.signals,
        },
        incomingSignal,
        readingLatestRef.current,
      );
      return {
        pendingSignals: nextSignals.pendingSignals,
        snapshot: snapshotWithSignals(current.snapshot, nextSignals.signals),
      };
    });
  }, []);

  const applyPendingSignals = useCallback(() => {
    setStreamState((current) => {
      const nextSignals = flushPendingFirehoseSignals({
        pendingSignals: current.pendingSignals,
        signals: current.snapshot.signals,
      });
      return {
        pendingSignals: nextSignals.pendingSignals,
        snapshot: snapshotWithSignals(current.snapshot, nextSignals.signals),
      };
    });
    readingLatestRef.current = true;
  }, []);

  const refreshSignals = useCallback(async () => {
    const snapshot = await fetchPublicFirehoseSignals(initialSnapshot.query);
    setStreamState({
      pendingSignals: [],
      snapshot,
    });
    readingLatestRef.current = true;
    setLiveState("updated-manually");
  }, [initialSnapshot]);

  const setReadingLatest = useCallback((readingLatest: boolean) => {
    readingLatestRef.current = readingLatest;
  }, []);

  useEffect(() => {
    setStreamState({
      pendingSignals: [],
      snapshot: initialSnapshot,
    });
  }, [initialSnapshot]);

  useEffect(() => {
    const hints = readFirehoseConnectionHints();
    const transport = chooseFirehoseLiveTransport({
      ...hints,
      recentSseFailures: failures.sse,
      recentWebSocketFailures: failures.websocket,
    });
    if (transport === "paused") {
      setLiveState("offline");
      return undefined;
    }

    if (transport === "websocket" && typeof window.WebSocket !== "undefined") {
      setLiveState("reconnecting");
      const socket = new WebSocket(websocketUrl(initialSnapshot), LIVE_SOCKET_PROTOCOL);
      socket.addEventListener("open", () => {
        setLiveState("live");
      });
      socket.addEventListener("message", (message: MessageEvent<string>) => {
        const parsed: unknown = JSON.parse(message.data);
        if (!isPublicFirehoseEvent(parsed) || parsed.type !== "firehose.signal") {
          return;
        }
        applyLiveSignal(parsed.signal);
      });
      socket.addEventListener("close", () => {
        setLiveState("reconnecting");
        setFailures((current) => ({ ...current, websocket: current.websocket + 1 }));
      });
      socket.addEventListener("error", () => {
        setLiveState("reconnecting");
        setFailures((current) => ({ ...current, websocket: current.websocket + 1 }));
      });
      return () => {
        socket.close();
      };
    }

    if (transport === "sse" && typeof window.EventSource !== "undefined") {
      setLiveState("reconnecting");
      const source = new EventSource(transportUrl("/api/firehose/public/events", initialSnapshot));
      source.addEventListener("open", () => {
        setLiveState("live");
      });
      source.addEventListener("firehose.signal", (event) => {
        const message = event as MessageEvent<string>;
        const parsed: unknown = JSON.parse(message.data);
        if (!isPublicFirehoseEvent(parsed) || parsed.type !== "firehose.signal") {
          return;
        }
        applyLiveSignal(parsed.signal);
      });
      source.addEventListener("error", () => {
        setLiveState("reconnecting");
        setFailures((current) => ({ ...current, sse: current.sse + 1 }));
      });
      return () => {
        source.close();
      };
    }

    const interval = window.setInterval(() => {
      void refreshSignals();
    }, 30000);
    return () => {
      window.clearInterval(interval);
    };
  }, [applyLiveSignal, failures.sse, failures.websocket, initialSnapshot, refreshSignals]);

  return {
    applyPendingSignals,
    liveState,
    pendingSignalCount: streamState.pendingSignals.length,
    refreshSignals,
    setReadingLatest,
    snapshot: streamState.snapshot,
  };
}

function liveStateLabel(value: PublicFirehoseLiveState): string {
  if (value === "live") {
    return "Live";
  }
  if (value === "reconnecting") {
    return "Reconnecting";
  }
  if (value === "offline") {
    return "Offline";
  }
  return "Updated manually";
}

function signalTypeLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function groupJumpTargets(targets: FirehoseJumpTarget[]): FirehoseTargetGroups {
  return {
    issue: targets.filter((target) => target.kind === "issue").slice(0, FACET_TARGET_LIMIT),
    place: targets.filter((target) => target.kind === "place").slice(0, FACET_TARGET_LIMIT),
    source: targets.filter((target) => target.kind === "source").slice(0, FACET_TARGET_LIMIT),
    time: targets.filter((target) => target.kind === "time"),
  };
}

function itemAnchorIndex(model: FirehoseFeedModel): Record<string, number> {
  const indexes: Record<string, number> = {};
  model.items.forEach((item, index) => {
    indexes[item.id] = index;
    if (item.kind === "bucket") {
      indexes[item.bucket.anchorId] = index;
    } else {
      indexes[`firehose-signal-${item.signal.id}`] = index;
    }
  });
  return indexes;
}

function estimateFeedItemSize(
  item: FirehoseFeedItem | undefined,
  density: FirehoseDensity,
): number {
  if (!item || item.kind === "bucket") {
    return 58;
  }

  if (density === "compact") {
    return 122;
  }
  if (density === "expanded") {
    return 292;
  }
  return 220;
}

function densityButtonClass(selected: boolean): string {
  return clsx(
    "type-label-small rounded-md px-3 py-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
    selected ? "bg-ink-strong text-surface" : "text-ink-soft hover:bg-surface-container",
  );
}

function FirehoseJumpNavigation({ onSelectTarget, targets }: FirehoseJumpNavigationProps) {
  const groupedTargets = useMemo(() => groupJumpTargets(targets), [targets]);

  return (
    <nav
      aria-label="Firehose jump navigation"
      className="border-outline-variant bg-surface-container-low sticky top-0 z-20 -mx-4 min-w-0 overflow-hidden border-y px-4 py-3 sm:-mx-6 sm:px-6 lg:top-6 lg:order-2 lg:mx-0 lg:self-start lg:rounded-lg lg:border lg:p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-3 lg:mb-3">
        <p className="type-label-medium text-ink-strong">Jump</p>
        <span className="type-label-small text-ink-muted">{jumpCountLabel(targets.length)}</span>
      </div>
      <div className="flex min-w-0 gap-3 overflow-x-auto pb-1 lg:block lg:max-h-[calc(100vh-8rem)] lg:space-y-4 lg:overflow-y-auto lg:pb-0">
        <FirehoseJumpGroup
          label="Time"
          onSelectTarget={onSelectTarget}
          targets={groupedTargets.time}
        />
        <FirehoseJumpGroup
          label="Issues"
          onSelectTarget={onSelectTarget}
          targets={groupedTargets.issue}
        />
        <FirehoseJumpGroup
          label="Places"
          onSelectTarget={onSelectTarget}
          targets={groupedTargets.place}
        />
        <FirehoseJumpGroup
          label="Sources"
          onSelectTarget={onSelectTarget}
          targets={groupedTargets.source}
        />
      </div>
    </nav>
  );
}

function FirehoseJumpGroup({ label, onSelectTarget, targets }: FirehoseJumpGroupProps) {
  if (targets.length === 0) {
    return null;
  }

  return (
    <div className="min-w-44 shrink-0 lg:min-w-0">
      <p className="type-label-small text-ink-muted mb-1">{label}</p>
      <div className="space-y-1">
        {targets.map((target) => (
          <FirehoseJumpLink key={target.id} onSelectTarget={onSelectTarget} target={target} />
        ))}
      </div>
    </div>
  );
}

function FirehoseJumpLink({ onSelectTarget, target }: FirehoseJumpLinkProps) {
  return (
    <a
      className="type-label-small text-ink-soft hover:bg-surface-container hover:text-ink-strong focus-visible:ring-accent flex min-h-8 items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      href={`#${target.anchorId}`}
      onClick={(event) => {
        event.preventDefault();
        onSelectTarget(target);
      }}
    >
      <span className="truncate">{target.label}</span>
      <span className="text-ink-muted tabular-nums">{target.count}</span>
    </a>
  );
}

function FirehoseBucketDivider({ bucket }: FirehoseBucketDividerProps) {
  return (
    <div
      className="border-outline-variant bg-surface-container-lowest scroll-mt-4 border-b px-4 py-3"
      id={bucket.anchorId}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="type-title-small text-ink-strong">{bucket.label}</h2>
        <span
          aria-label={eventCountLabel(bucket.count)}
          className="type-label-small text-ink-muted"
        >
          {bucket.count}
        </span>
      </div>
    </div>
  );
}

function FirehoseSignalRow({ density, signal }: FirehoseSignalRowProps) {
  const labels = useMemo(
    () => [
      ...signal.places.map((place) => place.label),
      ...signal.issues.map((issue) => issue.label),
    ],
    [signal.issues, signal.places],
  );
  const showSummary = density !== "compact";
  const showEvidence = density !== "compact";
  const showExpandedDetails = density === "expanded";
  const titleId = `firehose-signal-title-${signal.id}`;

  return (
    <article
      aria-labelledby={titleId}
      className={clsx(
        "border-outline-variant scroll-mt-4 border-b px-4",
        density === "compact" ? "py-3" : "py-5",
      )}
      id={`firehose-signal-${signal.id}`}
    >
      <div
        className={clsx(
          "grid gap-3",
          density === "compact" ? "sm:grid-cols-[7rem_1fr]" : "sm:grid-cols-[8.5rem_1fr]",
        )}
      >
        <div className="space-y-1">
          <time className="type-label-small text-ink-muted block" dateTime={signal.detected_at}>
            {formatTimestamp(signal.detected_at)}
          </time>
          <p className="type-label-small text-ink-muted line-clamp-2">
            {signal.evidence.publisher}
          </p>
        </div>
        <div className={clsx("min-w-0", density === "compact" ? "space-y-2" : "space-y-3")}>
          <div className="space-y-1">
            <p className="type-label-small text-accent">{signalTypeLabel(signal.signal_type)}</p>
            <h3
              className={clsx(
                "text-ink-strong",
                density === "compact" ? "type-title-medium" : "type-title-large",
              )}
              id={titleId}
            >
              {signal.title}
            </h3>
          </div>
          {showSummary ? <p className="type-body-medium text-ink-soft">{signal.summary}</p> : null}
          {showEvidence ? (
            <p className="type-body-small text-ink-muted border-outline-variant border-l pl-3">
              {signal.evidence.passage}
            </p>
          ) : null}
          {showExpandedDetails ? (
            <dl className="border-outline-variant grid gap-3 border-t pt-3 sm:grid-cols-2">
              <div>
                <dt className="type-label-small text-ink-muted">Basis</dt>
                <dd className="type-body-small text-ink-strong">{signal.public_realm_basis}</dd>
              </div>
              <div>
                <dt className="type-label-small text-ink-muted">Confidence</dt>
                <dd className="type-body-small text-ink-strong">
                  {confidenceLabel(signal.confidence)}
                </dd>
              </div>
            </dl>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {labels.map((label) => (
              <span
                className="type-label-small bg-surface-container text-ink-soft rounded-md px-2 py-1"
                key={label}
              >
                {label}
              </span>
            ))}
            <a
              className="type-label-medium text-ink-strong ml-auto inline-flex underline underline-offset-4"
              href={signal.evidence.source_url}
              rel="noreferrer"
              target="_blank"
            >
              Open source
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

function FirehoseFeedItemRenderer({ density, item }: FirehoseFeedItemRendererProps) {
  if (item.kind === "bucket") {
    return <FirehoseBucketDivider bucket={item.bucket} />;
  }

  return <FirehoseSignalRow density={density} signal={item.signal} />;
}

function VirtualFirehoseFeedItem({
  density,
  item,
  measureElement,
  style,
}: VirtualFirehoseFeedItemProps) {
  return (
    <div data-index={item.id} ref={measureElement} style={style}>
      <FirehoseFeedItemRenderer density={density} item={item} />
    </div>
  );
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
                  onClick={() => {
                    void onRefreshSignals();
                  }}
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
                  className={densityButtonClass(density === option.value)}
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

export function FirehoseFeedPage({ initialSnapshot }: FirehoseFeedPageProps) {
  const live = usePublicFirehoseLive(initialSnapshot);
  return (
    <FirehoseFeedView
      liveState={live.liveState}
      onApplyPendingSignals={live.applyPendingSignals}
      onReadingLatestChange={live.setReadingLatest}
      onRefreshSignals={live.refreshSignals}
      pendingSignalCount={live.pendingSignalCount}
      snapshot={live.snapshot}
    />
  );
}
