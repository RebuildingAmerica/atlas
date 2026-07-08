import { useRef, useState, type FormEvent } from "react";
import { ExternalLink, Search } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { LATEST_SOURCE_TYPES, formatSourceType, latestStatusText } from "./place-page-utils";
import type { PlaceKind, PlaceLatestItem, PlaceLatestList, SourceType } from "@/types";

interface LatestListProps {
  items: PlaceLatestItem[];
}

interface LatestFeedProps {
  initialLatest: PlaceLatestList;
  placeKind: PlaceKind;
  placeSlug: string;
}

interface LatestLoadParams {
  cursor?: string;
  nextQuery?: string;
  nextSourceType?: SourceType | null;
}

function LatestList({ items }: LatestListProps) {
  if (items.length === 0) {
    return (
      <p className="type-body-medium text-ink-soft bg-surface-container-lowest rounded-lg p-4">
        No recent activity listed.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <article key={item.id} className="bg-surface-container-lowest rounded-lg p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap gap-2">
                <span className="type-label-medium text-ink-muted">
                  {formatSourceType(item.sourceType)}
                </span>
                {item.dateLabel ? (
                  <span className="type-label-medium text-ink-muted">{item.dateLabel}</span>
                ) : null}
              </div>
              <a
                href={item.href}
                className="type-title-large text-ink-strong hover:text-accent inline-flex items-start gap-2 transition-colors"
              >
                <span>{item.title}</span>
                <ExternalLink className="mt-1 h-4 w-4 shrink-0" aria-hidden />
              </a>
              <p className="type-body-small text-ink-muted font-medium">{item.attribution}</p>
              {item.excerpt ? (
                <p className="type-body-medium text-ink-soft max-w-3xl">{item.excerpt}</p>
              ) : null}
              {item.linkedActors.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {item.linkedActors.map((actor) => (
                    <a
                      key={actor.id}
                      href={actor.href}
                      className="type-label-medium bg-surface-container text-ink-soft hover:text-ink-strong rounded-full px-3 py-1"
                    >
                      {actor.name}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
            {item.topics.length > 0 ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                {item.topics.map((topic) => (
                  <span
                    key={topic}
                    className="type-label-medium bg-surface-container text-ink-soft rounded-full px-3 py-1"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export function LatestFeed({ initialLatest, placeKind, placeSlug }: LatestFeedProps) {
  const [latest, setLatest] = useState(initialLatest);
  const [query, setQuery] = useState("");
  const [selectedSourceType, setSelectedSourceType] = useState<SourceType | null>(null);
  const [isLatestLoading, setIsLatestLoading] = useState(false);
  const [latestError, setLatestError] = useState<string | null>(null);
  const latestRequestId = useRef(0);

  async function loadLatest(params: LatestLoadParams) {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setIsLatestLoading(true);
    setLatestError(null);

    try {
      const next = await api.places.listLatest(placeSlug, {
        cursor: params.cursor,
        kind: placeKind,
        limit: 10,
        query: params.nextQuery?.trim() || undefined,
        sourceTypes: params.nextSourceType ? [params.nextSourceType] : undefined,
      });
      if (latestRequestId.current !== requestId) {
        return;
      }
      setLatest((current) => ({
        items: params.cursor ? [...current.items, ...next.items] : next.items,
        nextCursor: next.nextCursor,
      }));
    } catch {
      if (latestRequestId.current === requestId) {
        setLatestError("Latest activity could not load.");
      }
    } finally {
      if (latestRequestId.current === requestId) {
        setIsLatestLoading(false);
      }
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadLatest({ nextQuery: query, nextSourceType: selectedSourceType });
  }

  function chooseSourceType(value: SourceType | null) {
    setSelectedSourceType(value);
    void loadLatest({ nextQuery: query, nextSourceType: value });
  }

  return (
    <div className="space-y-4" aria-busy={isLatestLoading}>
      <form onSubmit={submitSearch} className="flex flex-col gap-3 lg:flex-row">
        <label className="sr-only" htmlFor="place-latest-search">
          Search latest activity
        </label>
        <input
          id="place-latest-search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="type-body-medium bg-surface-container-lowest text-ink-strong placeholder:text-ink-muted focus:ring-civic rounded-lg px-4 py-3 outline-none focus:ring-2 lg:flex-1"
          placeholder="Search latest activity"
        />
        <button
          type="submit"
          disabled={isLatestLoading}
          className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 transition-colors disabled:opacity-60"
        >
          <Search className="h-4 w-4" aria-hidden />
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Latest activity source">
        <button
          type="button"
          disabled={isLatestLoading}
          aria-pressed={selectedSourceType === null}
          onClick={() => {
            chooseSourceType(null);
          }}
          className={cn(
            "type-label-large rounded-full px-3 py-1.5 transition-colors disabled:opacity-60",
            selectedSourceType === null
              ? "bg-ink-strong text-surface"
              : "bg-surface-container text-ink-soft hover:text-ink-strong",
          )}
        >
          All
        </button>
        {LATEST_SOURCE_TYPES.map((sourceType) => (
          <button
            key={sourceType.value}
            type="button"
            disabled={isLatestLoading}
            aria-pressed={selectedSourceType === sourceType.value}
            onClick={() => {
              chooseSourceType(sourceType.value);
            }}
            className={cn(
              "type-label-large rounded-full px-3 py-1.5 transition-colors disabled:opacity-60",
              selectedSourceType === sourceType.value
                ? "bg-ink-strong text-surface"
                : "bg-surface-container text-ink-soft hover:text-ink-strong",
            )}
          >
            {sourceType.label}
          </button>
        ))}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {latestStatusText(isLatestLoading, latest.items.length)}
      </p>

      {latestError ? (
        <p
          role="alert"
          className="type-body-medium border-error bg-error-container text-on-error-container rounded-lg border p-4"
        >
          {latestError}
        </p>
      ) : null}

      <LatestList items={latest.items} />

      {latest.nextCursor ? (
        <div className="flex justify-center">
          <button
            type="button"
            disabled={isLatestLoading}
            onClick={() => {
              void loadLatest({
                cursor: latest.nextCursor,
                nextQuery: query,
                nextSourceType: selectedSourceType,
              });
            }}
            className="type-label-large bg-surface-container text-ink-strong hover:bg-surface-container-high rounded-full px-4 py-2 transition-colors disabled:opacity-60"
          >
            {isLatestLoading ? "Loading" : "Show more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
