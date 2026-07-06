import type { Source, SourcePattern, SourceType } from "./source";

export type EntryType = "person" | "organization" | "initiative" | "campaign" | "event";
export type EntrySlugScope = "people" | "organizations" | "initiatives" | "campaigns" | "events";
export type GeoSpecificity = "local" | "regional" | "statewide" | "national";
export type GeocodePrecision = "rooftop" | "city" | "state";
export type GeocodeSource = "census" | "gazetteer" | "manual";
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

export type ClaimEvidenceConfidence =
  "subject_verified" | "atlas_verified" | "corroborated" | "partial" | "unverified";

export interface ClaimEvidenceInfo {
  source_count: number;
  source_ids: string[];
  confidence: ClaimEvidenceConfidence;
  as_of?: string | null;
  verification_level: VerificationLevel;
}

export interface ClaimEvidenceSet {
  summary: ClaimEvidenceInfo;
  place: ClaimEvidenceInfo;
  issues: ClaimEvidenceInfo;
  contact: ClaimEvidenceInfo;
}

export interface ProfileAnswers {
  who: string;
  what_they_do: string;
  where: string;
  why_they_matter: string;
  how_atlas_knows: string;
}

/** Honest trust tier; never overclaims for thinly-sourced auto-discovered entries. */
export type TrustLevel = "subject_verified" | "atlas_verified" | "corroborated" | "unverified";

export interface TrustInfo {
  level: TrustLevel;
  /** Distinct registrable source domains backing the entity; null when not evaluated (e.g. list views). */
  independent_source_count: number | null;
  /** Whether the listed website is supported by a linked source; null when not evaluated. */
  website_grounded: boolean | null;
  /** Whether the listed email is supported by a linked source; null when not evaluated. */
  email_grounded: boolean | null;
}

export type ActorQualityLevel = "specific_actor" | "partial_actor" | "thin_record";

export interface ActorQualityInfo {
  level: ActorQualityLevel;
  score: number;
  total: number;
  present: string[];
  missing: string[];
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
  claim_evidence?: ClaimEvidenceSet;
  profile_answers?: ProfileAnswers;
  trust: TrustInfo;
  actor_quality?: ActorQualityInfo;
  issue_areas: string[];
  source_types: SourceType[];
  source_count: number;
  latest_source_date?: string;
  sources?: Source[];
  /** Human-readable URL slug for canonical profile URLs. */
  slug: string;
  /** Absolute URL to the entity's public profile page, when derivable. */
  profile_url?: string;
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

/** The kind of link behind a connection reason. */
export type ConnectionReasonKind =
  "same_organization" | "sourced_edge" | "co_mentioned" | "same_issue_area" | "same_geography";

/** Connection strength tier, derived from the normalized 0-100 strength. */
export type ConnectionTier = "strong" | "moderate" | "weak";

/** One explainable reason two actors are connected. */
export interface ConnectionReason {
  kind: ConnectionReasonKind;
  label: string;
  count: number | null;
  source_id?: string | null;
  relationship_type?: string | null;
}

/** A ranked actor connected to the current profile. */
export interface ConnectedActor {
  id: string;
  name: string;
  type: EntryType;
  slug: string | null;
  description_snippet: string | null;
  /** Raw weighted connection score. */
  score: number;
  /** Strength 0-100, relative to this profile's strongest connection. */
  strength: number;
  tier: ConnectionTier;
  /** Ordered strongest-first — the reasons behind the link. */
  reasons: ConnectionReason[];
  /** The single strongest reason, for compact display. */
  evidence: string;
}

/** An entry's ranked connection network, with the true total before paging. */
export interface ConnectionNetwork {
  actors: ConnectedActor[];
  total: number;
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
  source_patterns: FacetOption[];
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
  source_patterns?: SourcePattern[];
  /**
   * Optional affiliated-organization filter used by entry list API calls.
   */
  affiliated_org_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * A single placed civic actor, reduced to exactly what a map dot renders.
 *
 * Deliberately tiny so thousands can be sent for a viewport and re-clustered
 * client-side without a round trip. The `trust_level` mirrors the canonical,
 * never-overclaiming tiers so a dot's ring matches the profile it links to.
 */
export interface MapPoint {
  id: string;
  name: string;
  type: EntryType;
  /** Canonical profile slug, or null when the actor has none yet. */
  slug: string | null;
  place_label: string | null;
  geo_specificity: GeoSpecificity | null;
  geocode_precision: GeocodePrecision | null;
  geocode_source: GeocodeSource | null;
  lat: number;
  lng: number;
  issue_areas: string[];
  source_count: number;
  latest_source_date: string | null;
  trust_level: TrustLevel;
}

/** The placed actors inside a viewport, with an honest overflow signal. */
export interface MapPointCollection {
  points: MapPoint[];
  /** Placed actors inside the viewport before the cap. */
  total: number;
  /** True when the viewport held more actors than the returned limit. */
  capped: boolean;
}

/** A geographic bounding box for a map viewport query. */
export interface MapBounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/**
 * Viewport map query: the browse facet filters plus the bounding box and an
 * optional hard cap, mirroring the `/api/entities/map` contract exactly so the
 * map and the browse list never diverge.
 */
export interface MapPointParams {
  bounds: MapBounds;
  query?: string;
  states?: string[];
  cities?: string[];
  regions?: string[];
  issue_areas?: string[];
  entry_types?: EntryType[];
  source_types?: SourceType[];
  source_patterns?: SourcePattern[];
  limit?: number;
}
