import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AdminPageHeader,
  AdminPageShell,
} from "@rebuildingamerica/atlas-ui/layout/admin-portal";

export const Route = createFileRoute("/")({
  component: OverviewPage,
});

interface Destination {
  description: string;
  label: string;
  to: "/discounts" | "/cloud-costs" | "/switches" | "/accounts";
}

const DESTINATIONS: readonly Destination[] = [
  {
    label: "Discount requests",
    description:
      "Approve or decline discounted access. The applicant hears back by email.",
    to: "/discounts",
  },
  {
    label: "Cloud costs",
    description:
      "Discovery spend against its ceilings, and the free-tier guardrails.",
    to: "/cloud-costs",
  },
  {
    label: "Switches",
    description:
      "Stop discovery spend or pause sales in under a minute, without a release.",
    to: "/switches",
  },
  {
    label: "Accounts",
    description:
      "Find an account or workspace and see what it holds and why, without production SQL.",
    to: "/accounts",
  },
];

export function OverviewPage() {
  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Platform"
        title="Atlas platform admin"
        description="Atlas-owned administration for the managed service. Editorial review stays in the Atlas app, where every instance operator has it."
      />
      <ul className="grid gap-4 sm:grid-cols-2">
        {DESTINATIONS.map((destination) => (
          <li key={destination.to}>
            <Link
              to={destination.to}
              className="border-border bg-surface-container-lowest hover:border-border-strong block rounded-lg border p-5"
            >
              <p className="type-title-medium text-ink-strong">
                {destination.label}
              </p>
              <p className="type-body-small text-ink-soft mt-1">
                {destination.description}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </AdminPageShell>
  );
}
