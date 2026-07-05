export type SourceType =
  | "news_article"
  | "op_ed"
  | "podcast"
  | "academic_paper"
  | "government_record"
  | "social_media"
  | "community_archive"
  | "org_website"
  | "conference"
  | "video"
  | "report"
  | "other";

export type ExtractionMethod = "manual" | "ai_assisted" | "autodiscovery";
export type SourcePattern = "single_source" | "multi_source" | "social_only";

export type StalenessStatus = "fresh" | "aging" | "stale" | "unknown";

export interface FreshnessInfo {
  updated_at?: string | null;
  created_at?: string | null;
  last_seen?: string | null;
  last_verified?: string | null;
  latest_source_date?: string | null;
  published_date?: string | null;
  ingested_at?: string | null;
  staleness_status: StalenessStatus;
  staleness_reason: string;
}

export interface Source {
  id: string;
  url: string;
  title?: string;
  publication?: string;
  published_date?: string; // date
  type: SourceType;
  ingested_at: string; // datetime
  extraction_method: ExtractionMethod;
  extraction_context?: string;
  linked_entity_ids: string[];
  linked_entities: SourceLinkedEntity[];
  freshness?: FreshnessInfo;
  raw_content?: string;
  created_at: string; // datetime
}

export interface SourceLinkedEntity {
  id: string;
  name: string;
  slug?: string | null;
  type: string;
}

export interface SourceListResponse {
  items: Source[];
  total: number;
  page?: number;
  page_size?: number;
}
