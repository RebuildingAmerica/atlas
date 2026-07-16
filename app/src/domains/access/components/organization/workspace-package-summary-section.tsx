import {
  hasSerializedCapability,
  type AtlasCapability,
  type AtlasProduct,
  type SerializedResolvedCapabilities,
} from "@rebuildingamerica/atlas-access/workspace/capabilities";
import { PRODUCT_LABELS } from "@/domains/billing/product-labels";

/**
 * One package-gated access line shown to workspace admins.
 */
interface PackageAccessItem {
  capability: AtlasCapability;
  label: string;
}

/**
 * Props for the workspace package summary section.
 */
interface WorkspacePackageSummarySectionProps {
  activeProducts: AtlasProduct[];
  capabilities: SerializedResolvedCapabilities;
}

const PACKAGE_ACCESS_ITEMS: PackageAccessItem[] = [
  { capability: "workspace.export", label: "Exports" },
  { capability: "monitoring.watchlists", label: "Monitoring" },
  { capability: "auth.sso", label: "SSO" },
  { capability: "auth.scim", label: "SCIM" },
];

/**
 * Formats a numeric limit for compact admin display.
 *
 * @param value - The resolved limit value, where null means unlimited.
 * @param unlimitedLabel - Label to use for unlimited limits.
 * @param unit - Unit label for numeric limits.
 */
function formatLimit(value: number | null, unlimitedLabel: string, unit: string): string {
  if (value === null) {
    return unlimitedLabel;
  }

  return `${new Intl.NumberFormat("en-US").format(value)} ${unit}`;
}

/**
 * Compact package and entitlement summary for organization admins.
 *
 * This renders the package grants already present in the session so admins can
 * reconcile contract scope with the product surfaces available to the team.
 */
export function WorkspacePackageSummarySection({
  activeProducts,
  capabilities,
}: WorkspacePackageSummarySectionProps) {
  const packageLabels =
    activeProducts.length > 0
      ? activeProducts.map((product) => PRODUCT_LABELS[product]).join(", ")
      : "Free access";
  const seatLimit = formatLimit(capabilities.limits.max_members, "Unlimited members", "members");
  const apiLimit = formatLimit(
    capabilities.limits.api_requests_per_day,
    "Unlimited API requests/day",
    "API requests/day",
  );
  const researchLimit = formatLimit(
    capabilities.limits.research_runs_per_month,
    "Unlimited research runs",
    "research runs/month",
  );

  return (
    <article className="border-border bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <h2 className="type-title-large text-ink-strong">Package access</h2>
        <p className="type-body-medium text-ink-soft">{packageLabels}</p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="border-border bg-surface-container-lowest rounded-[1rem] border p-3">
          <dt className="type-label-small text-ink-muted uppercase">Seats</dt>
          <dd className="type-title-small text-ink-strong mt-1">{seatLimit}</dd>
        </div>
        <div className="border-border bg-surface-container-lowest rounded-[1rem] border p-3">
          <dt className="type-label-small text-ink-muted uppercase">API</dt>
          <dd className="type-title-small text-ink-strong mt-1">{apiLimit}</dd>
        </div>
        <div className="border-border bg-surface-container-lowest rounded-[1rem] border p-3">
          <dt className="type-label-small text-ink-muted uppercase">Research</dt>
          <dd className="type-title-small text-ink-strong mt-1">{researchLimit}</dd>
        </div>
      </dl>

      <div className="grid gap-2 sm:grid-cols-2">
        {PACKAGE_ACCESS_ITEMS.map((item) => {
          const included = hasSerializedCapability(capabilities, item.capability);
          return (
            <div
              className="border-border bg-surface-container-lowest flex items-center justify-between gap-3 rounded-[1rem] border px-3 py-2"
              key={item.capability}
            >
              <span className="type-body-medium text-ink-strong">{item.label}</span>
              <span
                className={
                  included ? "type-label-small text-primary" : "type-label-small text-outline"
                }
              >
                {included ? "Included" : "Not included"}
              </span>
            </div>
          );
        })}
      </div>
    </article>
  );
}
