import type { Source, SourceType } from "./source";

export type EntryType = "person" | "organization" | "initiative" | "campaign" | "event";
export type GeoSpecificity = "local" | "regional" | "statewide" | "national";
export type ContactStatus = "not_contacted" | "contacted" | "responded" | "confirmed" | "declined";
export type Priority = "high" | "medium" | "low";

export type ClaimStatus = "unclaimed" | "pending" | "verified" | "revoked";
export type VerificationLevel = "source-derived" | "atlas-verified" | "subject-verified";

export interface ClaimStatusInfo {
  status: ClaimStatus;
  claimed_by_user_id?: string;
  claim_verified_at?: string;
  verification_level: VerificationLevel;
}

export interface Entry {
  id: string;
  type: EntryType;
  name: string;
  description: string;
  custom_bio?: string;
  photo_url?: string;
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
  preferred_contact_channel?: string;
  affiliated_org_id?: string;
  active: boolean;
  verified: boolean;
  last_verified?: string;
  claim: ClaimStatusInfo;
  issue_areas: string[];
  source_types: SourceType[];
  source_count: number;
  latest_source_date?: string;
  sources?: Source[];
  /** Human-readable URL slug for canonical profile URLs. */
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface ProfileClaim {
  id: string;
  entry_id: string;
  entry_slug?: string;
  entry_name: string;
  user_id: string;
  user_email: string;
  status: "pending" | "verified" | "rejected" | "revoked";
  tier: 1 | 2;
  evidence?: unknown;
  verified_at?: string;
  rejected_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface SavedListSummary {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface SavedListItem {
  list_id: string;
  entry_id: string;
  note?: string;
  added_at: string;
  entry?: Entry;
}

export interface SavedList extends SavedListSummary {
  items: SavedListItem[];
}

export interface ProfileFollow {
  user_id: string;
  entry_id: string;
  subscribed_to: "sources" | "all";
  created_at: string;
}

export interface FollowingFeedItem {
  entry_id: string;
  entry_name: string;
  entry_slug?: string;
  entry_type: EntryType;
  source_id: string;
  source_url: string;
  source_title?: string;
  source_publication?: string;
  ingested_at: string;
}

/** Relationship categories used to group connected actors on profile pages. */
export type ConnectionType =
  | "same_organization"
  | "same_issue_area"
  | "same_geography"
  | "co_mentioned";

/** An actor related to the current profile, with evidence explaining the link. */
export interface ConnectedActor {
  id: string;
  name: string;
  type: EntryType;
  slug: string | null;
  description_snippet: string | null;
  /** Human-readable explanation of why this actor is connected (e.g., "Both mentioned in: KC Star"). */
  evidence: string;
}

/** A group of related actors sharing a common relationship type. */
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
