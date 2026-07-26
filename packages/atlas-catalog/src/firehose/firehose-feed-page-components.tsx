import clsx from "clsx";
import { useMemo, type CSSProperties } from "react";
import { useDateTimeFormatter } from "@rebuildingamerica/atlas-ui/format/date-time";
import type {
  FirehoseDensity,
  FirehoseFeedItem,
  FirehoseJumpTarget,
  FirehoseTimeBucket,
} from "./feed-model";
import type { PublicFirehoseSignal } from "./public-feed";
import {
  confidenceLabel,
  eventCountLabel,
  formatTimestamp,
  groupJumpTargets,
  jumpCountLabel,
  signalTypeLabel,
} from "./firehose-feed-page-utils";

interface FirehoseSignalRowProps {
  density: FirehoseDensity;
  signal: PublicFirehoseSignal;
}

interface FirehoseBucketDividerProps {
  bucket: FirehoseTimeBucket;
}

interface FirehoseJumpNavigationProps {
  activeTargetId: string | null;
  onSelectTarget: (target: FirehoseJumpTarget) => void;
  targets: FirehoseJumpTarget[];
}

interface FirehoseJumpGroupProps {
  activeTargetId: string | null;
  label: string;
  onSelectTarget: (target: FirehoseJumpTarget) => void;
  targets: FirehoseJumpTarget[];
}

interface FirehoseJumpLinkProps {
  activeTargetId: string | null;
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

export function FirehoseJumpNavigation({
  activeTargetId,
  onSelectTarget,
  targets,
}: FirehoseJumpNavigationProps) {
  const groupedTargets = useMemo(() => groupJumpTargets(targets), [targets]);

  return (
    <nav
      aria-label="Firehose jump navigation"
      className="border-outline-variant bg-surface-container-low sticky top-0 z-20 -mx-4 min-w-0 overflow-hidden border-y px-4 py-3 sm:-mx-6 sm:px-6 lg:top-6 lg:order-2 lg:mx-0 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:rounded-lg lg:border lg:p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-3 lg:mb-3">
        <p className="type-label-medium text-ink-strong">Jump</p>
        <span className="type-label-small text-ink-muted">{jumpCountLabel(targets.length)}</span>
      </div>
      <div
        className="flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain [mask-image:linear-gradient(90deg,transparent,black_1rem,black_calc(100%_-_1rem),transparent)] pb-1 lg:block lg:space-y-4 lg:overflow-visible lg:[mask-image:none] lg:pb-0"
        data-firehose-jump-scroll
      >
        <FirehoseJumpGroup
          activeTargetId={activeTargetId}
          label="Time"
          onSelectTarget={onSelectTarget}
          targets={groupedTargets.time}
        />
        <FirehoseJumpGroup
          activeTargetId={activeTargetId}
          label="Issues"
          onSelectTarget={onSelectTarget}
          targets={groupedTargets.issue}
        />
        <FirehoseJumpGroup
          activeTargetId={activeTargetId}
          label="Places"
          onSelectTarget={onSelectTarget}
          targets={groupedTargets.place}
        />
        <FirehoseJumpGroup
          activeTargetId={activeTargetId}
          label="Sources"
          onSelectTarget={onSelectTarget}
          targets={groupedTargets.source}
        />
      </div>
    </nav>
  );
}

function FirehoseJumpGroup({
  activeTargetId,
  label,
  onSelectTarget,
  targets,
}: FirehoseJumpGroupProps) {
  if (targets.length === 0) {
    return null;
  }

  return (
    <div className="min-w-44 shrink-0 snap-start lg:min-w-0">
      <p className="type-label-small text-ink-muted mb-1">{label}</p>
      <div className="space-y-1">
        {targets.map((target) => (
          <FirehoseJumpLink
            activeTargetId={activeTargetId}
            key={target.id}
            onSelectTarget={onSelectTarget}
            target={target}
          />
        ))}
      </div>
    </div>
  );
}

function FirehoseJumpLink({ activeTargetId, onSelectTarget, target }: FirehoseJumpLinkProps) {
  const isActive = activeTargetId === target.id;

  return (
    <a
      aria-current={isActive ? "location" : undefined}
      className={clsx(
        "type-label-small focus-visible:ring-accent flex min-h-8 snap-start items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none",
        isActive
          ? "bg-surface-container text-ink-strong shadow-sm"
          : "text-ink-soft hover:bg-surface-container hover:text-ink-strong",
      )}
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
  const formatDateTime = useDateTimeFormatter();
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
  const sourceLabel = `Source from ${signal.evidence.publisher}`;

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
          density === "compact" ? "sm:grid-cols-[7.5rem_1fr]" : "sm:grid-cols-[9rem_1fr]",
        )}
      >
        <div className="space-y-2">
          <time
            className="type-title-small text-ink-strong block tabular-nums"
            dateTime={signal.detected_at}
          >
            {formatTimestamp(formatDateTime, signal.detected_at)}
          </time>
          <p className="type-label-small text-accent">{signalTypeLabel(signal.signal_type)}</p>
        </div>
        <div className={clsx("min-w-0", density === "compact" ? "space-y-2" : "space-y-3")}>
          <div className="space-y-1">
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
          <div
            aria-label={sourceLabel}
            className="border-outline-variant bg-surface-container-low rounded-md border px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="type-label-medium text-ink-strong">{signal.evidence.publisher}</p>
              <a
                className="type-label-medium text-ink-strong underline underline-offset-4"
                href={signal.evidence.source_url}
                rel="noreferrer"
                target="_blank"
              >
                Open source
              </a>
            </div>
            {showEvidence ? (
              <p className="type-body-small text-ink-soft border-outline-variant mt-2 border-l pl-3">
                {signal.evidence.passage}
              </p>
            ) : null}
          </div>
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
          </div>
        </div>
      </div>
    </article>
  );
}

export function FirehoseFeedItemRenderer({ density, item }: FirehoseFeedItemRendererProps) {
  if (item.kind === "bucket") {
    return <FirehoseBucketDivider bucket={item.bucket} />;
  }

  return <FirehoseSignalRow density={density} signal={item.signal} />;
}

export function VirtualFirehoseFeedItem({
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
