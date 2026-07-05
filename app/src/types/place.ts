import type { EntryType } from "./entry";

export type PlaceKind =
  | "polity"
  | "borough"
  | "city"
  | "county"
  | "metro"
  | "neighborhood"
  | "corridor"
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
}

export interface PlaceFact {
  attribution?: string;
  label: string;
  value: string;
}

export interface PlaceLatestItem {
  attribution: string;
  excerpt?: string;
  href: string;
  id: string;
  title: string;
  topics: string[];
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
  summary: string;
}

export interface PlacePageData {
  actors: PlaceActorList;
  facts: PlaceFact[];
  governments: PlaceGovernmentSummary[];
  identity: PlaceIdentity;
  issues: PlaceIssueSummary[];
  latest: PlaceLatestItem[];
  places: PlaceRelatedSummary[];
  summaryFacts: PlaceFact[];
}
