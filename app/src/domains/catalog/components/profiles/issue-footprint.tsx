import { groupIssueAreasByDomain } from "@/domains/catalog/taxonomy-domains";

interface IssueFootprintProps {
  issueAreas: string[];
  issueAreaLabels?: Record<string, string>;
  showLabel?: boolean;
}

function humanize(slug: string): string {
  return slug
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function IssueFootprint({
  issueAreas,
  issueAreaLabels = {},
  showLabel = true,
}: IssueFootprintProps) {
  const grouped = groupIssueAreasByDomain(issueAreas);

  if (grouped.size === 0) return null;

  return (
    <div className="space-y-3">
      {showLabel ? <p className="type-label-medium text-ink-muted">Issue footprint</p> : null}

      <div className="grid gap-3 md:grid-cols-2">
        {Array.from(grouped.entries()).map(([domain, slugs]) => (
          <div
            key={domain}
            className="bg-surface-container-low space-y-2 rounded-[0.875rem] px-4 py-4"
          >
            <p className="type-label-medium text-ink-muted">{domain}</p>
            <div className="flex flex-wrap gap-2">
              {slugs.map((slug) => (
                <span
                  key={slug}
                  className="type-label-medium bg-accent-soft text-accent-ink inline-block rounded-full px-3 py-1 font-semibold"
                >
                  {issueAreaLabels[slug] ?? humanize(slug)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
