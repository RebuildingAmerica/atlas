import { Badge } from "@/platform/ui/badge";
import type { Source, SourceType } from "@/types";

type AppearancesMode = "person" | "organization";

interface AppearancesListProps {
  sources: Source[];
  mode: AppearancesMode;
}

const SOURCE_TYPE_COLORS: Record<string, string> = {
  news_article: "var(--color-ink-strong)",
  podcast: "var(--color-accent)",
  report: "var(--color-accent-soft)",
};

function getSourceTypeColor(type: SourceType): string {
  return SOURCE_TYPE_COLORS[type] ?? "var(--color-surface-container-high)";
}

function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function SourceTypeBadge({ type }: { type: SourceType }) {
  const color = getSourceTypeColor(type);
  return (
    <span
      className="type-label-small inline-block rounded-full px-2 py-0.5 font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {humanize(type)}
    </span>
  );
}

function CompactSourceRow({ source }: { source: Source }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <SourceTypeBadge type={source.type} />
      {source.publication ? (
        <span className="type-body-medium text-ink-soft">{source.publication}</span>
      ) : null}
      {source.published_date ? (
        <span className="type-body-small text-ink-muted">{source.published_date}</span>
      ) : null}
    </div>
  );
}

function ExpandedSource({ source }: { source: Source }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SourceTypeBadge type={source.type} />
        {source.publication ? (
          <span className="type-body-medium text-ink-soft font-medium">{source.publication}</span>
        ) : null}
        {source.published_date ? (
          <span className="type-body-small text-ink-muted">{source.published_date}</span>
        ) : null}
      </div>
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="type-title-medium text-accent block hover:underline"
      >
        {source.title ?? source.url}
      </a>
      {source.extraction_context ? (
        <div
          className="border-l-accent rounded-r-lg border-l-[3px] py-2 pr-3 pl-3"
          style={{ backgroundColor: "var(--color-surface-container-lowest)" }}
        >
          <p className="type-body-medium text-ink-soft">{source.extraction_context}</p>
        </div>
      ) : null}
    </div>
  );
}

interface CoverageBarProps {
  sources: Source[];
}

function CoverageBar({ sources }: CoverageBarProps) {
  const typeCounts = new Map<SourceType, number>();
  for (const source of sources) {
    typeCounts.set(source.type, (typeCounts.get(source.type) ?? 0) + 1);
  }
  const total = sources.length;
  const segments = Array.from(typeCounts.entries());

  return (
    <div className="space-y-2">
      <div className="flex h-1.5 overflow-hidden rounded-full">
        {segments.map(([type, count]) => (
          <div
            key={type}
            className="h-full"
            style={{
              width: `${(count / total) * 100}%`,
              backgroundColor: getSourceTypeColor(type),
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {segments.map(([type, count]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: getSourceTypeColor(type) }}
            />
            <span className="type-label-small text-ink-muted">
              {humanize(type)} ({count})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AppearancesList({ sources, mode }: AppearancesListProps) {
  if (sources.length === 0) {
    return (
      <div className="space-y-3">
        <p className="type-label-small text-ink-muted tracking-widest uppercase">
          {mode === "person" ? "Appearances & mentions" : "Appearances & coverage"}
        </p>
        <p className="type-body-medium text-ink-muted">No linked sources yet.</p>
      </div>
    );
  }

  const sectionTitle = mode === "person" ? "Appearances & mentions" : "Appearances & coverage";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="type-label-small text-ink-muted tracking-widest uppercase">{sectionTitle}</p>
        <Badge>{sources.length}</Badge>
      </div>

      {mode === "organization" ? <CoverageBar sources={sources} /> : null}

      {mode === "person"
        ? sources.map((source, index) =>
            index === 0 ? (
              <ExpandedSource key={source.id} source={source} />
            ) : (
              <CompactSourceRow key={source.id} source={source} />
            ),
          )
        : sources.map((source) => <CompactSourceRow key={source.id} source={source} />)}

      <button
        type="button"
        className="type-label-medium border-border-strong text-ink-muted hover:bg-surface-container w-full rounded-xl border border-dashed py-2.5 text-center transition-colors"
      >
        View all {sources.length} appearances
      </button>
    </div>
  );
}
