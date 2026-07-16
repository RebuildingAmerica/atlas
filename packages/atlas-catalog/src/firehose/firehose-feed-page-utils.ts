import type {
  FirehoseDensity,
  FirehoseFeedItem,
  FirehoseFeedModel,
  FirehoseJumpTarget,
} from "./feed-model";
import type { PublicFirehoseLiveState } from "./public-feed";

export interface FirehoseDensityOption {
  label: string;
  value: FirehoseDensity;
}

export type FirehoseTargetGroups = Record<
  "issue" | "place" | "source" | "time",
  FirehoseJumpTarget[]
>;

export const DENSITY_OPTIONS: FirehoseDensityOption[] = [
  { label: "Compact", value: "compact" },
  { label: "Standard", value: "standard" },
  { label: "Expanded", value: "expanded" },
];

export const FACET_TARGET_LIMIT = 6;
export const LIVE_SOCKET_PROTOCOL = "atlas.firehose.public.v1";
export const READING_LATEST_SCROLL_THRESHOLD = 72;
export const VIRTUALIZED_ITEM_THRESHOLD = 40;

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export function eventCountLabel(count: number): string {
  return `${count} ${count === 1 ? "event" : "events"}`;
}

export function pendingUpdateLabel(count: number): string {
  return `${count} new ${count === 1 ? "update" : "updates"}`;
}

export function jumpCountLabel(count: number): string {
  return `${count} ${count === 1 ? "jump" : "jumps"}`;
}

export function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}% confidence`;
}

export function liveStateLabel(value: PublicFirehoseLiveState): string {
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

export function signalTypeLabel(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function groupJumpTargets(targets: FirehoseJumpTarget[]): FirehoseTargetGroups {
  return {
    issue: targets.filter((target) => target.kind === "issue").slice(0, FACET_TARGET_LIMIT),
    place: targets.filter((target) => target.kind === "place").slice(0, FACET_TARGET_LIMIT),
    source: targets.filter((target) => target.kind === "source").slice(0, FACET_TARGET_LIMIT),
    time: targets.filter((target) => target.kind === "time"),
  };
}

export function itemAnchorIndex(model: FirehoseFeedModel): Record<string, number> {
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

export function estimateFeedItemSize(
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
