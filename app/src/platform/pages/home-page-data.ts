import { ArrowRight, ExternalLink, MapPinned } from "lucide-react";
import { ENTITY_TYPE_LABELS, SOURCE_TYPE_LABELS, humanize } from "@/domains/catalog/catalog";
import { STATE_NAME_BY_CODE } from "@/domains/catalog/us-state-grid";
import type {
  Entry,
  EntrySearchFacets,
  EntryType,
  FacetOption,
  SourceType,
} from "@rebuildingamerica/atlas-api-client";

export interface HomeFacetTile {
  count: string;
  label: string;
  href: string;
}

export const ISSUE_CHIPS = [
  "Housing",
  "Climate",
  "Criminal Justice",
  "Education",
  "Voting Rights",
  "Immigration",
] as const;

export const TYPE_LABELS: Record<EntryType, string> = {
  campaign: "campaign",
  event: "event",
  initiative: "initiative",
  organization: "org",
  person: "person",
};

export const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

function countLabel(count: number): string {
  return count === 1 ? "1 record" : `${NUMBER_FORMATTER.format(count)} records`;
}

function sortFacets(facets: FacetOption[] | undefined): FacetOption[] {
  return [...(facets ?? [])].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function formatStatCount(value: number | undefined): string {
  if (value === undefined || value <= 0) {
    return "";
  }

  return NUMBER_FORMATTER.format(value);
}

export function browseUrl(query: string): string {
  return `/browse?query=${encodeURIComponent(query)}&offset=0`;
}

function browseFilterUrl(
  key: "cities" | "entry_types" | "issue_areas" | "regions" | "source_types" | "states",
  value: string,
): string {
  return `/browse?${key}=${encodeURIComponent(value)}&offset=0`;
}

export function humanizeIssue(value: string | undefined): string {
  if (!value) {
    return "Unlisted";
  }

  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function buildHomeIssueTiles(facets: EntrySearchFacets | undefined): HomeFacetTile[] {
  return sortFacets(facets?.issue_areas)
    .slice(0, 8)
    .map((facet) => ({
      count: countLabel(facet.count),
      href: browseFilterUrl("issue_areas", facet.value),
      label: humanizeIssue(facet.value),
    }));
}

export function buildHomePlaceTiles(facets: EntrySearchFacets | undefined): HomeFacetTile[] {
  return [
    ...sortFacets(facets?.states).map((facet) => ({
      count: countLabel(facet.count),
      href: browseFilterUrl("states", facet.value),
      label: STATE_NAME_BY_CODE[facet.value] ?? facet.value,
    })),
    ...sortFacets(facets?.cities).map((facet) => ({
      count: countLabel(facet.count),
      href: browseFilterUrl("cities", facet.value),
      label: facet.value,
    })),
    ...sortFacets(facets?.regions).map((facet) => ({
      count: countLabel(facet.count),
      href: browseFilterUrl("regions", facet.value),
      label: facet.value,
    })),
  ].slice(0, 8);
}

export function buildHomeSourceTiles(facets: EntrySearchFacets | undefined): HomeFacetTile[] {
  return sortFacets(facets?.source_types)
    .slice(0, 6)
    .map((facet) => ({
      count: countLabel(facet.count),
      href: browseFilterUrl("source_types", facet.value),
      label: SOURCE_TYPE_LABELS[facet.value as SourceType] ?? humanize(facet.value),
    }));
}

export function buildHomeTypeTiles(facets: EntrySearchFacets | undefined): HomeFacetTile[] {
  return sortFacets(facets?.entity_types)
    .slice(0, 5)
    .map((facet) => ({
      count: countLabel(facet.count),
      href: browseFilterUrl("entry_types", facet.value),
      label: ENTITY_TYPE_LABELS[facet.value as EntryType] ?? humanize(facet.value),
    }));
}

export function formatLocation(entry: Entry): string {
  return [entry.city, entry.state].filter(Boolean).join(", ") || entry.region || "Place not listed";
}

export function profileHref(entry: Entry): string {
  if (!entry.slug) {
    return "/browse";
  }

  switch (entry.type) {
    case "campaign":
      return `/profiles/campaigns/${entry.slug}`;
    case "event":
      return `/profiles/events/${entry.slug}`;
    case "initiative":
      return `/profiles/initiatives/${entry.slug}`;
    case "organization":
      return `/profiles/organizations/${entry.slug}`;
    case "person":
      return `/profiles/people/${entry.slug}`;
  }
}

export { ArrowRight, ExternalLink, MapPinned };
