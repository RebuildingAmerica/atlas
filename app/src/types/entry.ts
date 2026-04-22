import type { Source, SourceType } from "./source";

export type EntryType = "person" | "organization" | "initiative" | "campaign" | "event";
export type GeoSpecificity = "local" | "regional" | "statewide" | "national";
export type ContactStatus = "not_contacted" | "contacted" | "responded" | "confirmed" | "declined";
export type Priority = "high" | "medium" | "low";

export interface Entry {
  id: string;
  type: EntryType;
  name: string;
  description: string;
  city?: string;
  state?: string;
  region?: string;
  geo_specificity: GeoSpecificity;
  full_address?: string;
  first_seen: string;
  last_seen: string;
  website?: string;
  email?: string;
  phone?: string;
  social_media?: Record<string, string>;
  affiliated_org_id?: string;
  active: boolean;
  verified: boolean;
  last_verified?: string;
  issue_areas: string[];
  source_types: SourceType[];
  source_count: number;
  latest_source_date?: string;
  sources?: Source[];
  slug: string;
  created_at: string;
  updated_at: string;
}

export type ConnectionType =
  | "same_organization"
  | "same_issue_area"
  | "same_geography"
  | "co_mentioned";

export interface ConnectedActor {
  id: string;
  name: string;
  type: EntryType;
  slug: string | null;
  description_snippet: string | null;
  evidence: string;
}

export interface ConnectionGroup {
  type: ConnectionType;
  actors: ConnectedActor[];
}

export interface FacetOption {
  value: string;
  count: number;
}

export interface EntrySearchFacets {
  states: FacetOption[];
  cities: FacetOption[];
  regions: FacetOption[];
  issue_areas: FacetOption[];
  entity_types: FacetOption[];
  source_types: FacetOption[];
}

export interface PaginationMeta {
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
}

export interface EntryListResponse {
  data: Entry[];
  pagination: PaginationMeta;
  facets: EntrySearchFacets;
}

export interface EntryFilterParams {
  query?: string;
  states?: string[];
  cities?: string[];
  regions?: string[];
  issue_areas?: string[];
  entry_types?: EntryType[];
  source_types?: SourceType[];
  /**
   * Optional affiliated-organization filter used by entry list API calls.
   */
  affiliated_org_id?: string;
  limit?: number;
  offset?: number;
}
