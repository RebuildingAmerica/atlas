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
  eyebrow: "Directory",
  title: "Find people and groups",
  description: "Search by issue, place, or name.",
  emptyAction: { label: "Search", to: "/browse" },
  resultLabelPlural: "people and groups",
  resultsHeading: "People and groups",
  searchPlaceholder: "Try housing in Detroit",
  showEntryTypeFilter: true,
};
