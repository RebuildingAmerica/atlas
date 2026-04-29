import type { ReactNode } from "react";

interface ComparisonFeatureRow {
  feature: string;
  free: ReactNode;
  pro: ReactNode;
  team: ReactNode;
}

const COMPARISON_TABLE: readonly ComparisonFeatureRow[] = [
  { feature: "Browse and search the Atlas", free: "✓", pro: "✓", team: "✓" },
  { feature: "Read any profile", free: "✓", pro: "✓", team: "✓" },
  { feature: "Discovery runs", free: "2 / month", pro: "Unlimited", team: "Unlimited" },
  {
    feature: "Shortlists",
    free: "1 list, 25 entries",
    pro: "Unlimited",
    team: "Shared, unlimited",
  },
  { feature: "CSV / JSON export", free: "—", pro: "✓", team: "✓" },
  { feature: "Public API", free: "100 / hour", pro: "1,000 / day key", team: "1,000 / day key" },
  { feature: "OAuth & MCP access", free: "—", pro: "✓", team: "✓" },
  { feature: "Watchlists & monitoring digests", free: "—", pro: "—", team: "✓" },
  { feature: "Slack integration", free: "—", pro: "—", team: "✓" },
  { feature: "Single Sign-On (SAML / OIDC)", free: "—", pro: "—", team: "Up to 50 members" },
  {
    feature: "Member management",
    free: "—",
    pro: "—",
    team: "Owner / admin / member roles",
  },
] as const;

/**
 * Side-by-side comparison table contrasting the Free / Atlas Pro /
 * Atlas Team plans on the pricing surface.  The data lives in a const
 * here so the table is easy to update without re-reading the JSX.
 */
export function PricingComparisonTable() {
  return (
    <div className="border-border mb-10 border-t pt-8">
      <p className="type-label-medium text-ink-muted mb-4 tracking-wider uppercase">
        Compare plans
      </p>
      <div className="border-border overflow-x-auto rounded-[1rem] border bg-white">
        <table className="w-full text-left">
          <thead>
            <tr className="border-border border-b">
              <th className="type-label-medium text-ink-muted px-4 py-3 font-medium">Feature</th>
              <th className="type-label-medium text-ink-muted px-4 py-3 font-medium">Free</th>
              <th className="type-label-medium text-ink-muted px-4 py-3 font-medium">Atlas Pro</th>
              <th className="type-label-medium text-ink-muted px-4 py-3 font-medium">Atlas Team</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON_TABLE.map((row, idx) => (
              <tr
                key={row.feature}
                className={idx === COMPARISON_TABLE.length - 1 ? "" : "border-border border-b"}
              >
                <td className="type-body-small text-ink-strong px-4 py-3 font-medium">
                  {row.feature}
                </td>
                <td className="type-body-small text-ink-soft px-4 py-3">{row.free}</td>
                <td className="type-body-small text-ink-soft px-4 py-3">{row.pro}</td>
                <td className="type-body-small text-ink-soft px-4 py-3">{row.team}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
