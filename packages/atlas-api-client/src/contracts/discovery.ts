export type DiscoveryStatus = "running" | "completed" | "failed";
export type DiscoveryResearchGoal =
  "landscape_scan" | "interview_leads" | "partner_scan" | "ecosystem_map";
export type DiscoveryConfidenceState = "corroborated" | "partial" | "unverified";

export interface DiscoveryResearchLead {
  entry_id: string;
  name: string;
  type: string;
  why_it_matters: string;
  source_count: number;
  confidence?: DiscoveryConfidenceState;
  latest_source_date?: string | null;
}

export interface DiscoveryResearchSource {
  source_id: string;
  title: string;
  url: string;
  publication?: string | null;
  published_date?: string | null;
  why_it_matters: string;
}

export interface DiscoveryResearchGap {
  label: string;
  detail: string;
}

export interface DiscoveryResearchSummary {
  brief: string;
  ranked_leads: DiscoveryResearchLead[];
  key_sources: DiscoveryResearchSource[];
  gaps: DiscoveryResearchGap[];
  reasoning_signals: string[];
}

export interface DiscoveryRun {
  id: string;
  location_query: string; // e.g. "Kansas City, MO"
  state: string; // 2-letter code
  research_goal: DiscoveryResearchGoal;
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
  research_summary?: DiscoveryResearchSummary | null;
}

export interface DiscoveryRunListResponse {
  items: DiscoveryRun[];
  total: number;
  page?: number;
  page_size?: number;
}

export type DiscoveryJobStatus =
  "queued" | "claimed" | "running" | "completed" | "failed" | "cancelled";

export interface DiscoveryJobQueueStatusCounts {
  claimed: number;
  failed: number;
  queued: number;
  running: number;
}

export type DiscoveryJobProgressValue =
  | string
  | number
  | boolean
  | DiscoveryJobProgressValue[]
  | { [key: string]: DiscoveryJobProgressValue };

export type DiscoveryJobProgress = Record<string, DiscoveryJobProgressValue>;

export interface DiscoveryJobQueueItem {
  claimed_by?: string | null;
  claimed_until?: string | null;
  completed_at?: string | null;
  created_at: string;
  error_message?: string | null;
  id: string;
  issue_areas: string[];
  location_query: string;
  max_retries: number;
  next_attempt_at?: string | null;
  progress?: DiscoveryJobProgress | null;
  retry_count: number;
  run_id: string;
  started_at?: string | null;
  state: string;
  status: DiscoveryJobStatus;
}

export interface DiscoveryJobQueueResponse {
  items: DiscoveryJobQueueItem[];
  status_counts: DiscoveryJobQueueStatusCounts;
  total: number;
}

export interface StartDiscoveryRequest {
  location_query: string;
  state: string;
  issue_areas: string[];
  research_goal: DiscoveryResearchGoal;
}
