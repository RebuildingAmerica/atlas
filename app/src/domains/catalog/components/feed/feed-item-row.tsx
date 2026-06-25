import { Link } from "@tanstack/react-router";

/**
 * The data a single following-feed row renders: the actor that was mentioned
 * and the new source Atlas surfaced for them. Shared by the full activity feed
 * and the home activity band so both present a new source identically.
 */
export interface FeedItemRowData {
  /** Stable id of the actor the source mentions. */
  entry_id: string;
  /** Display name of the actor. */
  entry_name: string;
  /** Profile slug, when the actor has a published profile to link to. */
  entry_slug?: string;
  /** Actor type, used to choose the people/organizations profile segment. */
  entry_type: string;
  /** Stable id of the surfaced source. */
  source_id: string;
  /** Canonical URL of the surfaced source. */
  source_url: string;
  /** Source headline, when known. */
  source_title?: string;
  /** Publication that carried the source, when known. */
  source_publication?: string;
  /** ISO timestamp Atlas ingested the source. */
  ingested_at: string;
}

interface FeedItemRowProps {
  /** The feed item to render as an activity row. */
  item: FeedItemRowData;
}

/**
 * A single activity row: when an actor you follow appears in a new source.
 *
 * Renders the ingestion date, the actor name (linked to their profile when a
 * slug exists, plain text otherwise), and the new source as an external link
 * with its publication. Pure and props-driven so the activity feed and the
 * home activity band stay visually identical.
 */
export function FeedItemRow({ item }: FeedItemRowProps) {
  const segment = item.entry_type === "organization" ? "organizations" : "people";

  return (
    <li className="border-outline-variant bg-surface-container-lowest rounded-[1rem] border p-4">
      <p className="type-label-small text-ink-muted">
        {new Date(item.ingested_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </p>
      {item.entry_slug ? (
        <Link
          to={`/profiles/${segment}/$slug` as "/profiles/people/$slug"}
          params={{ slug: item.entry_slug }}
          className="type-title-medium text-ink-strong inline hover:underline"
        >
          {item.entry_name}
        </Link>
      ) : (
        <span className="type-title-medium text-ink-strong">{item.entry_name}</span>
      )}
      <p className="type-body-medium text-ink-soft mt-1">
        New source:{" "}
        <a
          href={item.source_url}
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          {item.source_title ?? item.source_url}
        </a>
        {item.source_publication ? ` · ${item.source_publication}` : null}
      </p>
    </li>
  );
}
