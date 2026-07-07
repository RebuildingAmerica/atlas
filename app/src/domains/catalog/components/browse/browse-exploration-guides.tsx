import { Compass, MapPin, Tags, Users } from "lucide-react";
import { ENTITY_TYPE_LABELS } from "@/domains/catalog/catalog";
import { STATE_NAME_BY_CODE } from "@/domains/catalog/us-state-grid";
import type { EntryType } from "@/types";
import type { BrowseSurfaceState } from "./browse-surfaces";

export interface BrowseIssueStarter {
  label: string;
  slug: string;
}

export interface BrowseCollectionFunnel {
  id: string;
  label: string;
  meta: string;
  onSelect: () => void;
}

interface BrowseExplorationGuidesProps {
  collectionFunnels: BrowseCollectionFunnel[];
  entryTypes: EntryType[];
  issues: BrowseIssueStarter[];
  onSelectEntryType: (entryType: EntryType) => void;
  onSelectIssue: (slug: string) => void;
  onSelectState: (state: string) => void;
  states: BrowseSurfaceState[];
}

/**
 * Public browse shortcuts that make the directory legible as place-first and
 * issue-first exploration, while still using the canonical browse filters.
 */
export function BrowseExplorationGuides({
  collectionFunnels,
  entryTypes,
  issues,
  onSelectEntryType,
  onSelectIssue,
  onSelectState,
  states,
}: BrowseExplorationGuidesProps) {
  if (states.length === 0 && issues.length === 0 && entryTypes.length === 0) {
    return null;
  }

  const placeStarters = states.slice(0, 3);
  const issueStarters = issues.slice(0, 4);
  const actorTypeStarters = entryTypes.slice(0, 4);
  const funnels = collectionFunnels.slice(0, 3);

  return (
    <section
      aria-label="Browse starting points"
      className="bg-surface-container-lowest rounded-[1.45rem] px-4 py-4 lg:px-5"
    >
      <div className="grid gap-5 lg:grid-cols-3 lg:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MapPin className="text-accent h-4 w-4" aria-hidden />
            <h2 className="type-title-small text-ink-strong">Browse by place</h2>
          </div>
          <p className="type-body-small text-ink-muted mt-1">Popular places.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {placeStarters.map((state) => {
              const stateName = STATE_NAME_BY_CODE[state.state] ?? state.state;
              return (
                <button
                  key={state.state}
                  type="button"
                  aria-label={`${stateName} people and groups ${state.count} records`}
                  onClick={() => {
                    onSelectState(state.state);
                  }}
                  className="bg-surface hover:bg-surface-container text-ink-strong inline-flex max-w-full items-center gap-2 rounded-full px-3 py-2 text-left transition-colors"
                >
                  <span className="type-label-large truncate">{stateName}</span>
                  <span className="type-body-small text-ink-muted shrink-0">
                    {state.count} records
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-border min-w-0 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
          <div className="flex items-center gap-2">
            <Tags className="text-accent h-4 w-4" aria-hidden />
            <h2 className="type-title-small text-ink-strong">Browse by issue</h2>
          </div>
          <p className="type-body-small text-ink-muted mt-1">Popular issues.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {issueStarters.map((issue) => (
              <button
                key={issue.slug}
                type="button"
                aria-label={`${issue.label} landscape`}
                onClick={() => {
                  onSelectIssue(issue.slug);
                }}
                className="type-label-large bg-surface text-ink-soft hover:bg-surface-container hover:text-ink-strong rounded-full px-3 py-2 transition-colors"
              >
                {issue.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-border min-w-0 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
          <div className="flex items-center gap-2">
            <Users className="text-accent h-4 w-4" aria-hidden />
            <h2 className="type-title-small text-ink-strong">Browse by actor type</h2>
          </div>
          <p className="type-body-small text-ink-muted mt-1">All actor types.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {actorTypeStarters.map((entryType) => (
              <button
                key={entryType}
                type="button"
                aria-label={`${ENTITY_TYPE_LABELS[entryType]} profiles`}
                onClick={() => {
                  onSelectEntryType(entryType);
                }}
                className="type-label-large bg-surface text-ink-soft hover:bg-surface-container hover:text-ink-strong rounded-full px-3 py-2 transition-colors"
              >
                {ENTITY_TYPE_LABELS[entryType]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {funnels.length > 0 ? (
        <div className="border-border mt-4 border-t pt-3">
          <div className="flex items-center gap-2">
            <Compass className="text-accent h-4 w-4" aria-hidden />
            <h2 className="type-title-small text-ink-strong">Guided paths</h2>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {funnels.map((funnel) => (
              <button
                key={funnel.id}
                type="button"
                aria-label={`${funnel.label} guided path`}
                onClick={funnel.onSelect}
                className="bg-surface hover:bg-surface-container min-w-0 rounded-[0.9rem] px-3 py-2 text-left transition-colors"
              >
                <span className="type-label-large text-ink-strong block truncate">
                  {funnel.label}
                </span>
                <span className="type-body-small text-ink-muted mt-1 block truncate">
                  {funnel.meta}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
