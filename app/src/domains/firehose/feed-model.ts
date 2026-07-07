import { mergePublicFirehoseSignal, type PublicFirehoseSignal } from "./public-feed";

export type FirehoseBucketId = "now" | "last_15m" | "last_hour" | "earlier_today";
export type FirehoseDensity = "compact" | "standard" | "expanded";
export type FirehoseJumpKind = "time" | "issue" | "place" | "source";

export interface FirehoseTimeBucket {
  anchorId: string;
  count: number;
  id: FirehoseBucketId;
  label: string;
  latestDetectedAt: string | null;
  signals: PublicFirehoseSignal[];
}

export interface FirehoseJumpTarget {
  anchorId: string;
  count: number;
  id: string;
  kind: FirehoseJumpKind;
  label: string;
}

export interface FirehoseBucketItem {
  bucket: FirehoseTimeBucket;
  id: string;
  kind: "bucket";
}

export interface FirehoseSignalItem {
  bucketId: FirehoseBucketId;
  id: string;
  kind: "signal";
  signal: PublicFirehoseSignal;
}

export type FirehoseFeedItem = FirehoseBucketItem | FirehoseSignalItem;

export interface FirehoseFeedModel {
  buckets: FirehoseTimeBucket[];
  items: FirehoseFeedItem[];
  jumpTargets: FirehoseJumpTarget[];
  latestDetectedAt: string | null;
  totalSignals: number;
}

export interface FirehoseSignalBufferState {
  pendingSignals: PublicFirehoseSignal[];
  signals: PublicFirehoseSignal[];
}

interface FirehoseTimeBucketConfig {
  id: FirehoseBucketId;
  label: string;
  maxAgeMs: number | null;
}

interface FirehoseFacetTargetAccumulator {
  anchorId: string;
  count: number;
  id: string;
  kind: Exclude<FirehoseJumpKind, "time">;
  label: string;
}

type FirehoseFacetAccumulatorMap = Map<string, FirehoseFacetTargetAccumulator>;

const MINUTE_MS = 60 * 1000;

const TIME_BUCKETS: FirehoseTimeBucketConfig[] = [
  { id: "now", label: "Now", maxAgeMs: 5 * MINUTE_MS },
  { id: "last_15m", label: "Last 15m", maxAgeMs: 15 * MINUTE_MS },
  { id: "last_hour", label: "Last hour", maxAgeMs: 60 * MINUTE_MS },
  { id: "earlier_today", label: "Earlier today", maxAgeMs: null },
];

function compareSignalsNewestFirst(
  left: PublicFirehoseSignal,
  right: PublicFirehoseSignal,
): number {
  return right.detected_at.localeCompare(left.detected_at);
}

function slugifyLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unknown";
}

function bucketIdForSignal(
  signal: PublicFirehoseSignal,
  latestDetectedAt: string | null,
): FirehoseBucketId {
  if (!latestDetectedAt) {
    return "earlier_today";
  }

  const latestTime = Date.parse(latestDetectedAt);
  const signalTime = Date.parse(signal.detected_at);
  const ageMs = Math.max(0, latestTime - signalTime);
  const bucket = TIME_BUCKETS.find(
    (config) => config.maxAgeMs === null || ageMs <= config.maxAgeMs,
  );
  return bucket?.id ?? "earlier_today";
}

function buildEmptyBucket(config: FirehoseTimeBucketConfig): FirehoseTimeBucket {
  return {
    anchorId: `firehose-bucket-${config.id}`,
    count: 0,
    id: config.id,
    label: config.label,
    latestDetectedAt: null,
    signals: [],
  };
}

function incrementFacetTarget(
  targets: FirehoseFacetAccumulatorMap,
  kind: Exclude<FirehoseJumpKind, "time">,
  label: string,
  signal: PublicFirehoseSignal,
): void {
  const id = `${kind}-${slugifyLabel(label)}`;
  const existingTarget = targets.get(id);
  if (existingTarget) {
    existingTarget.count += 1;
    return;
  }

  targets.set(id, {
    anchorId: `firehose-signal-${signal.id}`,
    count: 1,
    id,
    kind,
    label,
  });
}

function sortFacetTargets(
  targets: FirehoseFacetAccumulatorMap,
  kind: Exclude<FirehoseJumpKind, "time">,
): FirehoseJumpTarget[] {
  return [...targets.values()]
    .filter((target) => target.kind === kind)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function buildFacetJumpTargets(signals: PublicFirehoseSignal[]): FirehoseJumpTarget[] {
  const targets: FirehoseFacetAccumulatorMap = new Map();
  signals.forEach((signal) => {
    signal.issues.forEach((issue) => {
      incrementFacetTarget(targets, "issue", issue.label, signal);
    });
    signal.places.forEach((place) => {
      incrementFacetTarget(targets, "place", place.label, signal);
    });
    incrementFacetTarget(targets, "source", signal.evidence.publisher, signal);
  });

  return [
    ...sortFacetTargets(targets, "issue"),
    ...sortFacetTargets(targets, "place"),
    ...sortFacetTargets(targets, "source"),
  ];
}

export function buildFirehoseFeedModel(signals: PublicFirehoseSignal[]): FirehoseFeedModel {
  const sortedSignals = [...signals].sort(compareSignalsNewestFirst);
  const latestDetectedAt = sortedSignals[0]?.detected_at ?? null;
  const bucketsById = new Map<FirehoseBucketId, FirehoseTimeBucket>(
    TIME_BUCKETS.map((config) => [config.id, buildEmptyBucket(config)]),
  );

  sortedSignals.forEach((signal) => {
    const bucketId = bucketIdForSignal(signal, latestDetectedAt);
    const bucket = bucketsById.get(bucketId);
    if (!bucket) {
      return;
    }

    bucket.signals.push(signal);
    bucket.count = bucket.signals.length;
    bucket.latestDetectedAt = bucket.signals[0]?.detected_at ?? null;
  });

  const buckets = TIME_BUCKETS.map((config) => bucketsById.get(config.id))
    .filter((bucket): bucket is FirehoseTimeBucket => Boolean(bucket))
    .filter((bucket) => bucket.count > 0);
  const items = buckets.flatMap((bucket): FirehoseFeedItem[] => [
    { bucket, id: bucket.anchorId, kind: "bucket" },
    ...bucket.signals.map((signal): FirehoseSignalItem => ({
      bucketId: bucket.id,
      id: `firehose-signal-${signal.id}`,
      kind: "signal",
      signal,
    })),
  ]);
  const timeJumpTargets = buckets.map((bucket): FirehoseJumpTarget => ({
    anchorId: bucket.anchorId,
    count: bucket.count,
    id: `time-${bucket.id}`,
    kind: "time",
    label: bucket.label,
  }));

  return {
    buckets,
    items,
    jumpTargets: [...timeJumpTargets, ...buildFacetJumpTargets(sortedSignals)],
    latestDetectedAt,
    totalSignals: sortedSignals.length,
  };
}

export function applyIncomingFirehoseSignal(
  state: FirehoseSignalBufferState,
  incomingSignal: PublicFirehoseSignal,
  readingLatest: boolean,
): FirehoseSignalBufferState {
  if (readingLatest) {
    return {
      pendingSignals: state.pendingSignals,
      signals: mergePublicFirehoseSignal(state.signals, incomingSignal),
    };
  }

  return {
    pendingSignals: mergePublicFirehoseSignal(state.pendingSignals, incomingSignal),
    signals: state.signals,
  };
}

export function flushPendingFirehoseSignals(
  state: FirehoseSignalBufferState,
): FirehoseSignalBufferState {
  return {
    pendingSignals: [],
    signals: state.pendingSignals.reduce(
      (signals, pendingSignal) => mergePublicFirehoseSignal(signals, pendingSignal),
      state.signals,
    ),
  };
}
