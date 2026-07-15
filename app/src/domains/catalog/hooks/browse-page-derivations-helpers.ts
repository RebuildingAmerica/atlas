import { humanize } from "@/domains/catalog/catalog";
import type { SourcePattern } from "@rebuildingamerica/atlas-api-client";

const SOURCE_PATTERN_BRIEF_LABELS: Record<SourcePattern, string> = {
  multi_source: "Multi-source confirmation",
  single_source: "Single-source leads",
  social_only: "Social-only signals",
};

export function sourcePatternBriefLabel(value: string): string {
  return SOURCE_PATTERN_BRIEF_LABELS[value as SourcePattern] ?? humanize(value);
}
