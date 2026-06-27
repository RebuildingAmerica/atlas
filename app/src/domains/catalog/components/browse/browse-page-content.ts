import type { BrowseRouteSearch } from "@/domains/catalog/search-state";
import type { EntryType } from "@/types";

export interface BrowsePageContent {
  description: string;
  eyebrow: string;
  title: string;
  emptyAction?: {
    label: string;
    to: "/browse" | "/discovery" | "/profiles";
  };
  lockedEntryTypes?: EntryType[];
  resultLabelPlural?: string;
  resultsHeading?: string;
  searchPlaceholder?: string;
  showEntryTypeFilter?: boolean;
  scopeTabs?: {
    isActive?: boolean;
    label: string;
    search?: BrowseRouteSearch;
    to: "/profiles" | "/profiles/people" | "/profiles/organizations";
  }[];
}

export const DEFAULT_BROWSE_PAGE_CONTENT: BrowsePageContent = {
  eyebrow: "Research browser",
  title: "Source-linked civic research",
  description:
    "Find source-backed actors by place, issue, source type, and role. Open any result to inspect where the record came from and why it belongs in the local landscape.",
  emptyAction: { label: "Research", to: "/discovery" },
  resultLabelPlural: "entries",
  resultsHeading: "Entries",
  searchPlaceholder: "Search place, issue, or name",
  showEntryTypeFilter: true,
};
