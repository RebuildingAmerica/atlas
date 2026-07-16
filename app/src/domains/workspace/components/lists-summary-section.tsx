/**
 * "Your lists at a glance" grid for the research home.
 *
 * Surfaces the user's saved lists as cards linking into each list, plus a way
 * to start a new list and reach the full lists surface. When the user has no
 * lists yet, it explains how lists get built rather than showing an empty grid.
 */
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Plus } from "lucide-react";
import type { SerializedResolvedCapabilities } from "@rebuildingamerica/atlas-access/workspace/capabilities";
import type { SavedListSummary } from "../server/research-summary";
import { ResearchValueNudge } from "./research-value-nudge";

interface ListsSummarySectionProps {
  /** The user's saved lists from the research loader. */
  lists: SavedListSummary[];
  /** The serialized capability/limit set from the session, or null when none. */
  capabilities: SerializedResolvedCapabilities | null;
  /** Whether the deployment is running in local (single-user) mode. */
  isLocal: boolean;
}

interface ListCardProps {
  /** The saved list this card represents. */
  list: SavedListSummary;
}

/**
 * A single saved-list card linking into the list detail surface.
 */
function ListCard({ list }: ListCardProps) {
  const actorsLabel = list.itemCount === 1 ? "actor" : "actors";

  return (
    <Link
      to="/lists/$id"
      params={{ id: list.id }}
      className="border-outline-variant bg-surface-container-lowest block space-y-1 rounded-[1rem] border p-4"
    >
      <span className="type-title-medium text-ink-strong inline-flex items-center gap-2">
        {list.name}
        <ArrowUpRight className="text-ink-muted h-4 w-4" aria-hidden />
      </span>
      {list.description ? (
        <span className="type-body-small text-ink-soft line-clamp-2 block">{list.description}</span>
      ) : null}
      <span className="type-label-small text-ink-muted block">
        {list.itemCount} {actorsLabel}
      </span>
    </Link>
  );
}

/**
 * The home lists grid, server-default from the loader summary.
 */
export function ListsSummarySection({ lists, capabilities, isLocal }: ListsSummarySectionProps) {
  const largestList = lists.reduce((max, list) => Math.max(max, list.itemCount), 0);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="type-headline-small text-ink-strong">Your lists</h2>
        <Link to="/lists" className="type-label-large text-ink-strong underline">
          All lists
        </Link>
      </div>

      {lists.length === 0 ? (
        <div className="border-outline-variant bg-surface-container space-y-2 rounded-[1rem] border p-5">
          <p className="type-body-medium text-ink-strong">You haven&apos;t built any lists yet.</p>
          <p className="type-body-small text-ink-soft">
            Save actors into named lists to organize a research thread or an outreach push.{" "}
            <Link to="/lists" className="text-accent underline">
              Start a list
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {lists.map((list) => (
            <ListCard key={list.id} list={list} />
          ))}
          <Link
            to="/lists"
            className="border-outline-variant text-ink-soft flex items-center justify-center gap-2 rounded-[1rem] border border-dashed p-4"
          >
            <Plus className="h-4 w-4" aria-hidden />
            <span className="type-label-large">New list</span>
          </Link>
        </div>
      )}

      <ResearchValueNudge
        capabilities={capabilities}
        isLocal={isLocal}
        gate={{ kind: "export", itemCount: largestList }}
      />
    </section>
  );
}
