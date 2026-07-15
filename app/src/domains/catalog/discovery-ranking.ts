import type { Entry } from "@rebuildingamerica/atlas-api-client";

export interface DiscoveryRankingContext {
  cities?: string[];
  issue_areas?: string[];
  query?: string;
  regions?: string[];
  source_types?: string[];
  states?: string[];
}

interface RankedEntry {
  entry: Entry;
  index: number;
  score: number;
}

const TRUST_SCORE: Record<Entry["trust"]["level"], number> = {
  atlas_verified: 35,
  corroborated: 45,
  subject_verified: 45,
  unverified: 0,
};

function normalized(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

function includesNormalized(value: string | undefined, needle: string | undefined): boolean {
  const normalizedValue = normalized(value);
  const normalizedNeedle = normalized(needle);
  return Boolean(normalizedValue && normalizedNeedle && normalizedValue.includes(normalizedNeedle));
}

function sourceDateScore(entry: Entry): number {
  if (!entry.latest_source_date) {
    return 0;
  }

  const timestamp = new Date(entry.latest_source_date).getTime();
  if (Number.isNaN(timestamp)) {
    return 0;
  }

  const monthsOld = Math.max(0, (Date.now() - timestamp) / 2_592_000_000);
  return Math.max(0, 30 - monthsOld);
}

function hasPlaceMatch(entry: Entry, context: DiscoveryRankingContext): boolean {
  return Boolean(
    context.states?.includes(entry.state ?? "") ||
    context.cities?.some((city) => includesNormalized(entry.city, city)) ||
    context.regions?.some((region) => includesNormalized(entry.region, region)),
  );
}

function scoreEntry(entry: Entry, context: DiscoveryRankingContext): number {
  const query = normalized(context.query);
  let score = 0;

  if (query) {
    if (normalized(entry.name) === query) {
      score += 700;
    } else if (includesNormalized(entry.name, query)) {
      score += 250;
    }
    if (includesNormalized(entry.description, query)) {
      score += 45;
    }
  }

  const issueMatches =
    context.issue_areas?.filter((issueArea) => (entry.issue_areas ?? []).includes(issueArea))
      .length ?? 0;
  if (issueMatches > 0) {
    score += 160 + issueMatches * 30;
  }

  if (hasPlaceMatch(entry, context)) {
    score += 140;
    if (entry.geo_specificity === "local") {
      score += 35;
    }
  }

  const sourceTypeMatches =
    context.source_types?.filter((sourceType) =>
      (entry.source_types ?? []).some((entrySourceType) => entrySourceType === sourceType),
    ).length ?? 0;
  score += sourceTypeMatches * 35;

  score += Math.min(entry.source_count ?? 0, 8) * 8;
  score += entry.trust ? TRUST_SCORE[entry.trust.level] : 0;
  score += sourceDateScore(entry);

  if (entry.claim?.status === "verified") {
    score += 25;
  }

  if (entry.geo_specificity === "national" && (context.states?.length || context.cities?.length)) {
    score -= 40;
  }

  return score;
}

export function rankEntriesForDiscovery(
  entries: Entry[],
  context: DiscoveryRankingContext,
): Entry[] {
  return entries
    .map<RankedEntry>((entry, index) => ({
      entry,
      index,
      score: scoreEntry(entry, context),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.index - right.index;
    })
    .map((ranked) => ranked.entry);
}
