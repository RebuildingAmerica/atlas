import { useRef, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ACTOR_SORTS, ACTOR_TYPES, actorStatusText } from "./place-page-utils";
import type {
  EntryType,
  PlaceActorList,
  PlaceActorParams,
  PlaceActorSort,
  PlaceActorSummary,
  PlaceKind,
} from "@/types";

interface ActorCardProps {
  actor: PlaceActorSummary;
}

interface ActorDirectoryProps {
  initialActors: PlaceActorList;
  placeKind: PlaceKind;
  placeSlug: string;
}

interface ActorGroup {
  actors: PlaceActorSummary[];
  label: string;
}

interface ActorListProps {
  actors: PlaceActorSummary[];
  sort: PlaceActorSort;
}

interface ActorLoadParams {
  cursor?: string;
  nextQuery?: string;
  nextSort?: PlaceActorSort;
  nextType?: EntryType | null;
}

function ActorCard({ actor }: ActorCardProps) {
  return (
    <article className="bg-surface-container-lowest rounded-lg p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <a href={actor.href} className="type-title-medium text-ink-strong hover:text-accent">
            {actor.name}
          </a>
          <p className="type-body-small text-ink-muted mt-1 font-medium">{actor.description}</p>
        </div>
        <span className="type-label-medium bg-surface-container text-ink-soft rounded-full px-3 py-1">
          {actor.type}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="bg-surface-container-low rounded-lg px-3 py-2">
          <p className="type-label-small text-ink-muted">Work</p>
          <p className="type-body-small text-ink-strong mt-1">{actor.work}</p>
        </div>
        {actor.latest ? (
          <div className="bg-surface-container-low rounded-lg px-3 py-2">
            <p className="type-label-small text-ink-muted">Latest</p>
            <p className="type-body-small text-ink-strong mt-1">{actor.latest}</p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function actorInitial(name: string) {
  const initial = name.trim().charAt(0).toUpperCase();
  return /^[A-Z0-9]$/.test(initial) ? initial : "#";
}

function groupActorsByInitial(actors: ActorGroup["actors"]): ActorGroup[] {
  const groups = new Map<string, ActorGroup["actors"]>();
  actors.forEach((actor) => {
    const label = actorInitial(actor.name);
    const group = groups.get(label) ?? [];
    group.push(actor);
    groups.set(label, group);
  });
  return [...groups.entries()].map(([label, groupActors]) => ({
    actors: groupActors,
    label,
  }));
}

function ActorList({ actors, sort }: ActorListProps) {
  if (actors.length === 0) {
    return (
      <p className="type-body-medium text-ink-soft bg-surface-container-lowest rounded-lg p-4">
        No people or organizations listed.
      </p>
    );
  }

  if (sort === "name") {
    return (
      <div className="space-y-5">
        {groupActorsByInitial(actors).map((group) => (
          <div key={group.label}>
            <h3 className="type-label-large text-ink-muted mb-2">{group.label}</h3>
            <div className="grid gap-3">
              {group.actors.map((actor) => (
                <ActorCard key={actor.id} actor={actor} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {actors.map((actor) => (
        <ActorCard key={actor.id} actor={actor} />
      ))}
    </div>
  );
}

export function ActorDirectory({ initialActors, placeKind, placeSlug }: ActorDirectoryProps) {
  const [actors, setActors] = useState(initialActors);
  const [query, setQuery] = useState("");
  const [selectedType, setSelectedType] = useState<EntryType | null>(null);
  const [selectedSort, setSelectedSort] = useState<PlaceActorSort>("relevance");
  const [isActorLoading, setIsActorLoading] = useState(false);
  const [actorError, setActorError] = useState<string | null>(null);
  const actorRequestId = useRef(0);

  async function loadActors(params: ActorLoadParams) {
    const requestId = actorRequestId.current + 1;
    actorRequestId.current = requestId;
    setIsActorLoading(true);
    setActorError(null);

    try {
      const loadParams: PlaceActorParams = { limit: 20 };
      loadParams.kind = placeKind;
      const nextQuery = params.nextQuery?.trim();
      if (params.cursor) {
        loadParams.cursor = params.cursor;
      }
      if (nextQuery) {
        loadParams.query = nextQuery;
      }
      if (params.nextSort) {
        loadParams.sort = params.nextSort;
      }
      if (params.nextType) {
        loadParams.type = params.nextType;
      }

      const next = await api.places.listActors(placeSlug, loadParams);
      if (actorRequestId.current !== requestId) {
        return;
      }
      setActors((current) => ({
        items: params.cursor ? [...current.items, ...next.items] : next.items,
        nextCursor: next.nextCursor,
      }));
    } catch {
      if (actorRequestId.current === requestId) {
        setActorError("People and organizations could not load.");
      }
    } finally {
      if (actorRequestId.current === requestId) {
        setIsActorLoading(false);
      }
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadActors({ nextQuery: query, nextSort: selectedSort, nextType: selectedType });
  }

  function chooseType(value: EntryType | null) {
    setSelectedType(value);
    void loadActors({ nextQuery: query, nextSort: selectedSort, nextType: value });
  }

  function chooseSort(value: PlaceActorSort) {
    setSelectedSort(value);
    void loadActors({ nextQuery: query, nextSort: value, nextType: selectedType });
  }

  return (
    <div className="space-y-4" aria-busy={isActorLoading}>
      <form onSubmit={submitSearch} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <label className="sr-only" htmlFor="place-actor-search">
          Search people and organizations
        </label>
        <input
          id="place-actor-search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="type-body-medium bg-surface-container-lowest text-ink-strong placeholder:text-ink-muted focus:ring-civic rounded-lg px-4 py-3 outline-none focus:ring-2 lg:flex-1"
          placeholder="Search people, organizations, work"
        />
        <label className="sr-only" htmlFor="place-actor-sort">
          Sort people and organizations
        </label>
        <select
          id="place-actor-sort"
          value={selectedSort}
          onChange={(event) => {
            chooseSort(event.target.value as PlaceActorSort);
          }}
          className="type-body-medium bg-surface-container-lowest text-ink-strong focus:ring-civic rounded-lg px-4 py-3 outline-none focus:ring-2"
          disabled={isActorLoading}
        >
          {ACTOR_SORTS.map((sort) => (
            <option key={sort.value} value={sort.value}>
              {sort.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={isActorLoading}
          className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 transition-colors disabled:opacity-60"
        >
          <Search className="h-4 w-4" aria-hidden />
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-2" role="group" aria-label="People and organizations type">
        <button
          type="button"
          disabled={isActorLoading}
          aria-pressed={selectedType === null}
          onClick={() => {
            chooseType(null);
          }}
          className={cn(
            "type-label-large rounded-full px-3 py-1.5 transition-colors disabled:opacity-60",
            selectedType === null
              ? "bg-ink-strong text-surface"
              : "bg-surface-container text-ink-soft hover:text-ink-strong",
          )}
        >
          All
        </button>
        {ACTOR_TYPES.map((type) => (
          <button
            key={type.value}
            type="button"
            disabled={isActorLoading}
            aria-pressed={selectedType === type.value}
            onClick={() => {
              chooseType(type.value);
            }}
            className={cn(
              "type-label-large rounded-full px-3 py-1.5 transition-colors disabled:opacity-60",
              selectedType === type.value
                ? "bg-ink-strong text-surface"
                : "bg-surface-container text-ink-soft hover:text-ink-strong",
            )}
          >
            {type.label}
          </button>
        ))}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {actorStatusText(isActorLoading, actors.items.length)}
      </p>

      {actorError ? (
        <p
          role="alert"
          className="type-body-medium border-error bg-error-container text-on-error-container rounded-lg border p-4"
        >
          {actorError}
        </p>
      ) : null}

      <ActorList actors={actors.items} sort={selectedSort} />

      {actors.nextCursor ? (
        <div className="flex justify-center">
          <button
            type="button"
            disabled={isActorLoading}
            onClick={() => {
              void loadActors({
                cursor: actors.nextCursor,
                nextQuery: query,
                nextSort: selectedSort,
                nextType: selectedType,
              });
            }}
            className="type-label-large bg-surface-container text-ink-strong hover:bg-surface-container-high rounded-full px-4 py-2 transition-colors disabled:opacity-60"
          >
            {isActorLoading ? "Loading" : "Show more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
