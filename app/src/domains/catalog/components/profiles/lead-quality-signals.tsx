import { Badge } from "@rebuildingamerica/atlas-ui/ui/badge";
import type { Entry } from "@rebuildingamerica/atlas-api-client";

interface LeadQualitySignalsProps {
  entry: Entry;
}

interface LeadSignal {
  key: string;
  label: string;
}

const RECENT_SOURCE_DAYS = 90;
const AGING_SOURCE_DAYS = 180;

function daysSince(iso: string, now = new Date()): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

function localnessSignal(entry: Entry): LeadSignal {
  if (entry.geo_specificity === "local" && (entry.city || entry.state || entry.region)) {
    return { key: "localness", label: "Local lead" };
  }
  if (entry.geo_specificity === "regional") {
    return { key: "localness", label: "Regional lead" };
  }
  if (entry.geo_specificity === "statewide") {
    return { key: "localness", label: "Statewide lead" };
  }
  return { key: "localness", label: "National reach" };
}

function recencySignal(entry: Entry): LeadSignal {
  const freshnessSource = entry.latest_source_date ?? entry.last_seen;
  const age = daysSince(freshnessSource);
  if (age <= RECENT_SOURCE_DAYS) {
    return { key: "recency", label: "Recent source" };
  }
  if (age <= AGING_SOURCE_DAYS) {
    return { key: "recency", label: "Aging source" };
  }
  return { key: "recency", label: "Older source" };
}

function sourceDiversitySignal(entry: Entry): LeadSignal {
  const typeCount = new Set(entry.source_types).size;
  const independentCount = entry.trust.independent_source_count ?? 0;
  if (typeCount >= 2 || independentCount >= 2) {
    return { key: "source-diversity", label: "Diverse sources" };
  }
  if (entry.source_count <= 1 || typeCount <= 1) {
    return { key: "source-diversity", label: "Limited source mix" };
  }
  return { key: "source-diversity", label: "Source mix unknown" };
}

function hasReachableContact(entry: Entry): boolean {
  const socialHandles = Object.values(entry.social_media ?? {}).filter(Boolean);
  return Boolean(entry.website || entry.email || entry.phone || socialHandles.length > 0);
}

function reachabilitySignal(entry: Entry): LeadSignal {
  if (hasReachableContact(entry)) {
    return { key: "reachability", label: "Reachable" };
  }
  return { key: "reachability", label: "No public contact" };
}

function partnerQualificationSignal(entry: Entry): LeadSignal {
  const reachable = hasReachableContact(entry);
  const verified =
    entry.claim.status === "verified" ||
    entry.trust.level === "subject_verified" ||
    entry.trust.level === "atlas_verified";

  if (verified && reachable && entry.source_count >= 2) {
    return { key: "partner-qualification", label: "Partner-ready" };
  }
  if (entry.trust.level === "corroborated" && reachable) {
    return { key: "partner-qualification", label: "Strong partner lead" };
  }
  if (entry.trust.level === "unverified" || entry.source_count <= 1 || !reachable) {
    return { key: "partner-qualification", label: "Qualify before outreach" };
  }
  return { key: "partner-qualification", label: "Confirm partner fit" };
}

export function buildLeadQualitySignals(entry: Entry): LeadSignal[] {
  return [
    partnerQualificationSignal(entry),
    localnessSignal(entry),
    recencySignal(entry),
    sourceDiversitySignal(entry),
    reachabilitySignal(entry),
  ];
}

export function LeadQualitySignals({ entry }: LeadQualitySignalsProps) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Lead-quality signals">
      {buildLeadQualitySignals(entry).map((signal) => (
        <Badge key={signal.key}>{signal.label}</Badge>
      ))}
    </div>
  );
}
