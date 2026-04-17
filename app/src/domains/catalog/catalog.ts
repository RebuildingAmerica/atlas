import type { EntryType, SourceType } from "@/types";

export const ENTITY_TYPE_LABELS: Record<EntryType, string> = {
  person: "People",
  organization: "Organizations",
  initiative: "Initiatives",
  campaign: "Campaigns",
  event: "Events",
};

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  news_article: "Local news",
  op_ed: "Opinion",
  podcast: "Podcasts",
  academic_paper: "Research",
  government_record: "Government records",
  social_media: "Social media",
  org_website: "Organization sites",
  conference: "Conferences",
  video: "Video",
  report: "Reports",
  other: "Other",
};

export const FEATURED_SOURCE_TYPES: SourceType[] = [
  "news_article",
  "podcast",
  "government_record",
  "org_website",
];

export const FEATURED_ENTRY_TYPES: EntryType[] = [
  "person",
  "organization",
  "initiative",
  "campaign",
];

export function humanize(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
