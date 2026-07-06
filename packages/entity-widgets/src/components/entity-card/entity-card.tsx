import type { EntityCardData } from "../../types";
import { formatEntityTypeAndPlace } from "../../lib/entity-type-labels";
import { TrustBadgeRow } from "../trust-badge-row/trust-badge-row";

export interface EntityCardProps {
  data: EntityCardData;
}

/**
 * Compact "entity card" — the MVP widget UI, rendered both as an inline MCP
 * App widget (~320px, a chat host's sidebar) and inside the main web app
 * (full-width). Uses CSS container queries (`@container`/`@sm:` on the
 * card's own container, not `@media`) so it reflows correctly at either
 * size regardless of the surrounding page's viewport.
 */
export function EntityCard({ data }: EntityCardProps) {
  return (
    <div className="@container">
      <article className="bg-ew-surface border-ew-border flex flex-col gap-3 rounded-2xl border p-4">
        <div className="flex items-center gap-3">
          {data.photo_url ? (
            <img
              src={data.photo_url}
              alt=""
              className="h-10 w-10 shrink-0 rounded-full object-cover @sm:h-12 @sm:w-12"
            />
          ) : (
            <div
              aria-hidden="true"
              className="bg-ew-surface-alt text-ew-ink-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-semibold @sm:h-12 @sm:w-12"
            >
              {data.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="text-ew-ink truncate text-base font-bold">
              {data.name}
            </h3>
            <p className="text-ew-ink-soft text-sm">
              {formatEntityTypeAndPlace(data)}
            </p>
          </div>
        </div>

        <TrustBadgeRow
          verificationLevel={data.trust_level}
          sourceCount={data.source_count}
        />

        {data.description ? (
          <p className="text-ew-ink line-clamp-2 text-sm @sm:line-clamp-3">
            {data.description}
          </p>
        ) : null}

        {data.profile_url ? (
          <a
            href={data.profile_url}
            className="text-ew-link self-start text-sm font-medium hover:underline"
          >
            View full profile on Atlas →
          </a>
        ) : null}
      </article>
    </div>
  );
}
