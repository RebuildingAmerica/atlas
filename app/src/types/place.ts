import type { EntryType } from "./entry";
import type { SourceType } from "./source";

export type PlaceKind =
  | "polity"
  | "borough"
  | "city"
  | "county"
  | "metro"
  | "neighborhood"
  | "district"
  | "service_area"
  | "state";

export interface PlaceScopeLink {
  active: boolean;
  href: string;
  label: string;
}

export interface PlaceIdentity {
  display: string;
  kind: PlaceKind;
  name: string;
  scopes: PlaceScopeLink[];
  slug: string;
  sourceDataset?: string;
  sourceIdentifier?: string;
  sourceUrl?: string;
}

export interface PlaceFact {
  attribution?: string;
  label: string;
  value: string;
}

export interface PlaceLatestItem {
  attribution: string;
  dateLabel?: string;
  excerpt?: string;
  href: string;
  id: string;
  linkedActors: PlaceLatestLinkedActor[];
  linkedEntityIds: string[];
  sourceType: SourceType;
  title: string;
  topics: string[];
}

export interface PlaceLatestList {
  items: PlaceLatestItem[];
  nextCursor?: string;
}

export interface PlaceLatestParams {
  cursor?: string;
  limit?: number;
  query?: string;
  sourceTypes?: SourceType[];
}

export interface PlaceLatestLinkedActor {
  href: string;
  id: string;
  name: string;
}

export interface PlaceActorSummary {
  description: string;
  href: string;
  id: string;
  latest?: string;
  name: string;
  type: EntryType;
  work: string;
}

export interface PlaceActorList {
  items: PlaceActorSummary[];
  nextCursor?: string;
}

export interface PlaceIssueSummary {
  actors: string[];
  domain?: string;
  id: string;
  name: string;
  places: string[];
  records: string[];
}

export interface PlaceGovernmentLink {
  href: string;
  label: string;
}

export interface PlaceGovernmentSummary {
  links: PlaceGovernmentLink[];
  name: string;
  role: string;
}

export interface PlaceRelatedSummary {
  accent: "housing" | "labor" | "climate" | "democracy" | "education" | "health" | "neutral";
  href: string;
  kind: PlaceKind;
  latitude?: number;
  longitude?: number;
  name: string;
  sourceDataset?: string;
  sourceIdentifier?: string;
  sourceUrl?: string;
  summary: string;
}

export interface PlacePageData {
  actors: PlaceActorList;
  facts: PlaceFact[];
  governments: PlaceGovernmentSummary[];
  identity: PlaceIdentity;
  issues: PlaceIssueSummary[];
  latest: PlaceLatestList;
  places: PlaceRelatedSummary[];
  summaryFacts: PlaceFact[];
}
