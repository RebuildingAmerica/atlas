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
  eyebrow: "Atlas",
  title: "Browse Atlas",
  description:
    "Search the public civic graph by place, issue area, source type, and actor type. Open any result to inspect the source-backed record behind it.",
  emptyAction: { label: "Discovery", to: "/discovery" },
  resultLabelPlural: "entries",
  resultsHeading: "Entries",
  searchPlaceholder: "Search place, issue, or name",
  showEntryTypeFilter: true,
};
