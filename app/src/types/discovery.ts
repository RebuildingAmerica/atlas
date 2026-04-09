export type DiscoveryStatus = "running" | "completed" | "failed";

export interface DiscoveryRun {
  id: string;
  location_query: string; // e.g. "Kansas City, MO"
  state: string; // 2-letter code
  issue_areas: string[]; // list of issue area slugs
  queries_generated: number;
  sources_fetched: number;
  sources_processed: number;
  entries_extracted: number;
  entries_after_dedup: number;
  entries_confirmed: number;
  started_at: string; // datetime
  completed_at?: string; // datetime
  status: DiscoveryStatus;
}

export interface DiscoveryRunListResponse {
  items: DiscoveryRun[];
  total: number;
  page?: number;
  page_size?: number;
}

export interface StartDiscoveryRequest {
  location_query: string;
  state: string;
  issue_areas: string[];
}
