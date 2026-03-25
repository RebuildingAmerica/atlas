export type SourceType =
  | "news_article"
  | "op_ed"
  | "podcast"
  | "academic_paper"
  | "government_record"
  | "social_media"
  | "org_website"
  | "conference"
  | "video"
  | "report"
  | "other";

export type ExtractionMethod = "manual" | "ai_assisted" | "autodiscovery";

export interface Source {
  id: string;
  url: string;
  title?: string;
  publication?: string;
  published_date?: string; // date
  type: SourceType;
  ingested_at: string; // datetime
  extraction_method: ExtractionMethod;
  raw_content?: string;
  created_at: string; // datetime
}

export interface SourceListResponse {
  items: Source[];
  total: number;
  page?: number;
  page_size?: number;
}
