import type { EntityCardData, EntityType } from "../../types";
import { TrustBadgeRow } from "../trust-badge-row/trust-badge-row";

const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  person: "Person",
  organization: "Organization",
  initiative: "Initiative",
  campaign: "Campaign",
  event: "Event",
};

/**
 * "Organization · Columbus, OH" — humanized type, then location when known.
 * `type` is always present, so the type label is never omitted; only the
 * location half is conditional, and no stray separator is ever rendered.
 */
function buildSubtitle(data: EntityCardData): string {
  const typeLabel = ENTITY_TYPE_LABELS[data.type];
  return data.place_label ? `${typeLabel} · ${data.place_label}` : typeLabel;
}

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
            <p className="text-ew-ink-soft text-sm">{buildSubtitle(data)}</p>
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
