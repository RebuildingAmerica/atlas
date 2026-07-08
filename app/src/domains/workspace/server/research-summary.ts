/**
 * SSR aggregate loader for the authenticated "Your Research" home.
 *
 * Calls the existing lists, feed, and research-request endpoints in parallel with
 * the signed-in user's identity, then folds them into a single serializable
 * {@link ResearchSummary} the home route seeds into React Query as
 * `initialData`. Upstream failures degrade to an empty-but-valid summary so the
 * page can render honest empty states instead of leaking a raw error.
 */
import { createServerFn } from "@tanstack/react-start";
import type { DiscoveryRunListResponse } from "@/types";
import { requestWorkspaceApi } from "./workspace-api";
import {
  buildWatchlists,
  issueLabel,
  issueWatchlistId,
  placeWatchlistId,
} from "./research-summary-watchlists";

/** Number of days that counts as "this week" for the activity headline. */
const WEEK_WINDOW_DAYS = 7;
/** Newest feed rows surfaced inline on the home activity band. */
const RECENT_ITEMS_LIMIT = 5;
/** Recent research requests surfaced on the home "pick up where you left off" strip. */
const RECENT_RUNS_LIMIT = 3;
/** Feed page size requested upstream so the week window and follow count are accurate. */
const FEED_LIMIT = 50;

/** A saved list reduced to the fields the home grid renders. */
export interface SavedListSummary {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
}

/** A single followed-actor activity row surfaced on the home activity band. */
export interface FeedActivityItem {
  entryId: string;
  entryName: string;
  entrySlug: string | null;
  entryType: string;
  sourceId: string;
  sourceUrl: string;
  sourceTitle: string | null;
  sourcePublication: string | null;
  ingestedAt: string;
}

/** Derived "what changed" band for the home activity surface. */
export interface ActivitySummary {
  newSourcesThisWeek: number;
  recentItems: FeedActivityItem[];
  followedActorCount: number;
}

/** A recent research request reduced to the fields the home strip renders. */
export interface RecentRunSummary {
  id: string;
  locationQuery: string;
  state: string;
  status: string;
  startedAt: string;
  issueAreas: string[];
}

/** At-a-glance counts for the home greeting band. */
export interface ResearchTotals {
  savedActors: number;
  listCount: number;
  runsThisMonth: number;
}

export type WatchlistKind = "place" | "issue" | "research_set";

/** A place or issue beat inferred from recent research activity. */
export interface WatchlistSummary {
  id: string;
  kind: WatchlistKind;
  label: string;
  detail: string;
  changedSinceLastTime: string;
}

export type ResearchTrendKind = "place" | "issue";

/** A repeated place or issue that appears across research requests over time. */
export interface ResearchTrend {
  id: string;
  kind: ResearchTrendKind;
  label: string;
  runCount: number;
  latestRunAt: string;
  signal: string;
}

/** The full serializable payload the home route renders from. */
export interface ResearchSummary {
  lists: SavedListSummary[];
  activity: ActivitySummary;
  recentRuns: RecentRunSummary[];
  researchTrends?: ResearchTrend[];
  totals: ResearchTotals;
  watchlists: WatchlistSummary[];
}

/** Raw saved-list row as returned by `GET /api/lists`. */
interface RawSavedList {
  id: string;
  name: string;
  description?: string | null;
  item_count?: number;
}

/** Raw following-feed row as returned by `GET /api/feed/following`. */
interface RawFeedItem {
  entry_id: string;
  entry_name: string;
  entry_slug?: string | null;
  entry_type: string;
  source_id: string;
  source_url: string;
  source_title?: string | null;
  source_publication?: string | null;
  ingested_at: string;
}

/** Raw following-feed envelope as returned by `GET /api/feed/following`. */
interface RawFeedResponse {
  items: RawFeedItem[];
}

/** The empty-but-valid summary returned when upstream calls fail. */
function emptyResearchSummary(): ResearchSummary {
  return {
    lists: [],
    activity: { newSourcesThisWeek: 0, recentItems: [], followedActorCount: 0 },
    recentRuns: [],
    researchTrends: [],
    totals: { savedActors: 0, listCount: 0, runsThisMonth: 0 },
    watchlists: [],
  };
}

/** Project a raw saved-list row onto the home summary shape. */
function toSavedListSummary(list: RawSavedList): SavedListSummary {
  return {
    id: list.id,
    name: list.name,
    description: list.description ?? null,
    itemCount: list.item_count ?? 0,
  };
}

/** Project a raw feed row onto the home activity-item shape. */
function toFeedActivityItem(item: RawFeedItem): FeedActivityItem {
  return {
    entryId: item.entry_id,
    entryName: item.entry_name,
    entrySlug: item.entry_slug ?? null,
    entryType: item.entry_type,
    sourceId: item.source_id,
    sourceUrl: item.source_url,
    sourceTitle: item.source_title ?? null,
    sourcePublication: item.source_publication ?? null,
    ingestedAt: item.ingested_at,
  };
}

/** Project a raw research request onto the home recent-request shape. */
function toRecentRunSummary(run: DiscoveryRunListResponse["items"][number]): RecentRunSummary {
  return {
    id: run.id,
    locationQuery: run.location_query,
    state: run.state,
    status: run.status,
    startedAt: run.started_at,
    issueAreas: run.issue_areas,
  };
}

function trendSignal(count: number): string {
  return `${count} ${count === 1 ? "request" : "requests"} over time`;
}

function buildResearchTrends(runs: DiscoveryRunListResponse["items"]): ResearchTrend[] {
  const placeTrends = new Map<string, Omit<ResearchTrend, "signal">>();
  const issueTrends = new Map<string, Omit<ResearchTrend, "signal">>();

  runs.forEach((run) => {
    const startedAt = Date.parse(run.started_at);
    if (Number.isNaN(startedAt)) {
      return;
    }

    const placeId = placeWatchlistId(run.location_query, run.state);
    const currentPlace = placeTrends.get(placeId);
    placeTrends.set(placeId, {
      id: placeId,
      kind: "place",
      label: currentPlace?.label ?? run.location_query,
      latestRunAt:
        currentPlace && Date.parse(currentPlace.latestRunAt) > startedAt
          ? currentPlace.latestRunAt
          : run.started_at,
      runCount: (currentPlace?.runCount ?? 0) + 1,
    });

    run.issue_areas.forEach((issueArea) => {
      const issueId = issueWatchlistId(issueArea);
      const currentIssue = issueTrends.get(issueId);
      issueTrends.set(issueId, {
        id: issueId,
        kind: "issue",
        label: currentIssue?.label ?? issueLabel(issueArea),
        latestRunAt:
          currentIssue && Date.parse(currentIssue.latestRunAt) > startedAt
            ? currentIssue.latestRunAt
            : run.started_at,
        runCount: (currentIssue?.runCount ?? 0) + 1,
      });
    });
  });

  return [...placeTrends.values(), ...issueTrends.values()]
    .filter((trend) => trend.runCount > 1)
    .map((trend) => ({ ...trend, signal: trendSignal(trend.runCount) }))
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "place" ? -1 : 1;
      }
      return (
        right.runCount - left.runCount ||
        Date.parse(right.latestRunAt) - Date.parse(left.latestRunAt)
      );
    })
    .slice(0, 6);
}

/**
 * Count feed rows whose source was ingested within the trailing week window.
 *
 * @param items - Raw feed rows, each carrying an `ingested_at` timestamp.
 * @param now - The reference "now" the window is measured back from.
 * @returns The number of rows ingested within the last {@link WEEK_WINDOW_DAYS}.
 */
function countNewSourcesThisWeek(items: RawFeedItem[], now: number): number {
  const windowStart = now - WEEK_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return items.filter((item) => {
    const ingested = Date.parse(item.ingested_at);
    return !Number.isNaN(ingested) && ingested >= windowStart;
  }).length;
}

/**
 * Count distinct followed actors implied by the feed's entry ids.
 *
 * The platform has no REST endpoint that lists a user's follows with profile
 * data, so the home derives the follow count from the distinct entries present
 * in the activity feed.
 *
 * @param items - Raw feed rows, each tied to an `entry_id`.
 * @returns The number of unique `entry_id`s across the feed.
 */
function countFollowedActors(items: RawFeedItem[]): number {
  return new Set(items.map((item) => item.entry_id)).size;
}

/**
 * Count research requests started within the calendar month of the reference time.
 *
 * Backs the honest free-request counter on the home recent-research strip. The
 * window is the UTC calendar month so it resets exactly when the monthly run
 * allowance does.
 *
 * @param runs - Research requests, each carrying a `started_at` timestamp.
 * @param now - The reference "now" whose calendar month defines the window.
 * @returns The number of requests started in the same UTC month and year as `now`.
 */
function countRunsThisMonth(runs: DiscoveryRunListResponse["items"], now: number): number {
  const reference = new Date(now);
  const referenceMonth = reference.getUTCMonth();
  const referenceYear = reference.getUTCFullYear();
  return runs.filter((run) => {
    const started = Date.parse(run.started_at);
    if (Number.isNaN(started)) {
      return false;
    }
    const startedDate = new Date(started);
    return (
      startedDate.getUTCMonth() === referenceMonth && startedDate.getUTCFullYear() === referenceYear
    );
  }).length;
}

/**
 * Fold the three upstream payloads into the serializable research summary.
 *
 * @param lists - Raw saved lists from `GET /api/lists`.
 * @param feed - Raw following-feed envelope from `GET /api/feed/following`.
 * @param runs - Research-request list from `GET /api/discovery-runs`.
 * @param now - Reference "now" used for the trailing-week activity window.
 * @returns The computed {@link ResearchSummary}.
 */
export function buildResearchSummary(
  lists: RawSavedList[],
  feed: RawFeedResponse,
  runs: DiscoveryRunListResponse,
  now: number,
): ResearchSummary {
  const listSummaries = lists.map(toSavedListSummary);
  const feedItems = feed.items;
  return {
    lists: listSummaries,
    activity: {
      newSourcesThisWeek: countNewSourcesThisWeek(feedItems, now),
      recentItems: feedItems.slice(0, RECENT_ITEMS_LIMIT).map(toFeedActivityItem),
      followedActorCount: countFollowedActors(feedItems),
    },
    recentRuns: runs.items.slice(0, RECENT_RUNS_LIMIT).map(toRecentRunSummary),
    researchTrends: buildResearchTrends(runs.items),
    totals: {
      savedActors: listSummaries.reduce((sum, list) => sum + list.itemCount, 0),
      listCount: listSummaries.length,
      runsThisMonth: countRunsThisMonth(runs.items, now),
    },
    watchlists: buildWatchlists(listSummaries, runs.items),
  };
}

/**
 * Load and aggregate the authenticated user's research summary for SSR.
 *
 * @returns The computed {@link ResearchSummary}, or an empty-but-valid summary
 *   if any upstream call fails.
 */
export const loadResearchSummary = createServerFn({ method: "GET" }).handler(
  async (): Promise<ResearchSummary> => {
    try {
      const [lists, feed, runs] = await Promise.all([
        requestWorkspaceApi<RawSavedList[]>("/lists"),
        requestWorkspaceApi<RawFeedResponse>(`/feed/following?limit=${FEED_LIMIT}`),
        requestWorkspaceApi<DiscoveryRunListResponse>("/discovery-runs"),
      ]);
      return buildResearchSummary(lists, feed, runs, Date.now());
    } catch {
      return emptyResearchSummary();
    }
  },
);
