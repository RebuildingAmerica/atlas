import { groupIssueAreasByDomain } from "@/domains/catalog/taxonomy-domains";

interface IssueFootprintProps {
  issueAreas: string[];
  issueAreaLabels?: Record<string, string>;
}

function humanize(slug: string): string {
  return slug
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function IssueFootprint({ issueAreas, issueAreaLabels = {} }: IssueFootprintProps) {
  const grouped = groupIssueAreasByDomain(issueAreas);

  if (grouped.size === 0) return null;

  return (
    <div className="space-y-3">
      <p className="type-label-small tracking-widest text-[var(--ink-muted)] uppercase">
        Issue footprint
      </p>

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([domain, slugs]) => (
          <div key={domain} className="space-y-1.5">
            <p className="type-label-small text-[var(--ink-muted)]">{domain}</p>
            <div className="flex flex-wrap gap-2">
              {slugs.map((slug) => (
                <span
                  key={slug}
                  className="type-label-medium inline-block rounded-full bg-[var(--accent-soft)] px-3 py-1 font-semibold text-[var(--accent-ink)]"
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
