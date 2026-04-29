/**
 * ProfileIdentBar — top strip that locates the profile in the catalog.
 *
 * Renders a breadcrumb back through the directory (Profiles → People/Orgs →
 * place) plus a passive "Tracked since" timestamp. Verification status is
 * intentionally surfaced in the Data Quality panel below — the strip stays
 * navigation, not decoration.
 */
import { Link } from "@tanstack/react-router";
import type { Entry } from "@/types";

interface ProfileIdentBarProps {
  entry: Entry;
}

function formatTrackedSince(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatPlaceLabel(entry: Entry): string {
  if (entry.city && entry.state) {
    return `${entry.city.toUpperCase()}, ${entry.state}`;
  }
  if (entry.state) {
    return entry.state;
  }
  if (entry.region) {
    return entry.region.toUpperCase();
  }
  return "UNITED STATES";
}

export function ProfileIdentBar({ entry }: ProfileIdentBarProps) {
  const isOrg = entry.type === "organization";
  const placeLabel = formatPlaceLabel(entry);
  const trackedSince = formatTrackedSince(entry.first_seen);

  return (
    <header
      className="bg-ink-strong text-paper border-paper/10 flex flex-wrap items-center justify-between gap-3 border-b px-6 py-2.5 sm:px-8"
      aria-label="Profile location"
    >
      <nav aria-label="Catalog breadcrumb" className="font-mono text-[0.75rem] tracking-[0.06em]">
        <Link
          to="/profiles"
          className="text-paper/70 hover:text-paper hover:border-paper border-b border-transparent pb-px transition-colors"
        >
          PROFILES
        </Link>
        <span className="text-paper/40 mx-2" aria-hidden>
          ·
        </span>
        <Link
          to={isOrg ? "/profiles/organizations" : "/profiles/people"}
          className="text-paper/70 hover:text-paper hover:border-paper border-b border-transparent pb-px transition-colors"
        >
          {isOrg ? "ORGANIZATIONS" : "PEOPLE"}
        </Link>
        <span className="text-paper/40 mx-2" aria-hidden>
          ·
        </span>
        <span className="text-paper font-bold" aria-current="page">
          {placeLabel}
        </span>
      </nav>

      <span className="text-paper/70 font-mono text-[0.75rem] font-medium tracking-[0.06em]">
        Tracked since {trackedSince}
      </span>
    </header>
  );
}
