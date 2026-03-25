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
  state?: string; // 2-letter code
  region?: string;
  geo_specificity: GeoSpecificity;
  first_seen?: string; // date
  last_seen?: string; // date
  website?: string;
  email?: string;
  phone?: string;
  social_media?: Record<string, string>; // {platform: handle} pairs
  affiliated_org_id?: string; // uuid
  active: boolean;
  verified: boolean;
  last_verified?: string; // date
  contact_status: ContactStatus;
  editorial_notes?: string;
  priority?: Priority;
  created_at: string; // datetime
  updated_at: string; // datetime
}

export interface EntryListResponse {
  items: Entry[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface EntryFilterParams {
  query?: string;
  type?: EntryType;
  state?: string;
  geo_specificity?: GeoSpecificity;
  contact_status?: ContactStatus;
  verified?: boolean;
  page?: number;
  page_size?: number;
}
