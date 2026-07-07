import type { ReactNode } from "react";
import type {
  EntryType,
  PlaceActorList,
  PlaceActorSort,
  PlaceActorSummary,
  PlaceFact,
  PlaceGovernmentSummary,
  PlaceIssueSummary,
  PlaceKind,
  PlaceLatestItem,
  PlaceLatestList,
  PlacePageData,
  PlaceRelatedSummary,
  PlaceScopeLink,
  SourceType,
} from "@/types";

export interface PlacePageProps {
  data: PlacePageData;
}

export interface PlaceSectionProps {
  children: ReactNode;
  id: string;
  title: string;
}

export interface ScopeNavProps {
  name: string;
  scopes: PlaceScopeLink[];
}

export interface SummaryFactStripProps {
  facts: PlaceFact[];
}

export interface FactGridProps {
  facts: PlaceFact[];
}

export interface LatestListProps {
  items: PlaceLatestItem[];
}

export interface LatestFeedProps {
  initialLatest: PlaceLatestList;
  placeKind: PlaceKind;
  placeSlug: string;
}

export interface LatestLoadParams {
  cursor?: string;
  nextQuery?: string;
  nextSourceType?: SourceType | null;
}

export interface ActorCardProps {
  actor: PlaceActorSummary;
}

export interface ActorDirectoryProps {
  initialActors: PlaceActorList;
  placeKind: PlaceKind;
  placeSlug: string;
}

export interface ActorLoadParams {
  cursor?: string;
  nextQuery?: string;
  nextSort?: PlaceActorSort;
  nextType?: EntryType | null;
}

export interface ActorListProps {
  actors: PlaceActorSummary[];
  sort: PlaceActorSort;
}

export interface ActorGroup {
  actors: PlaceActorSummary[];
  label: string;
}

export interface IssueGridProps {
  issues: PlaceIssueSummary[];
}

export interface IssueLineProps {
  label: string;
  values: string[];
}

export interface GovernmentListProps {
  governments: PlaceGovernmentSummary[];
}

export interface PlaceCardProps {
  place: PlaceRelatedSummary;
  places: PlaceRelatedSummary[];
}

export interface PlaceGridProps {
  places: PlaceRelatedSummary[];
}

export interface PlaceHighlightsProps {
  places: PlaceRelatedSummary[];
}

export interface SectionNavItem {
  id: string;
  label: string;
}

export interface CoordinateBounds {
  maxLat: number;
  maxLng: number;
  minLat: number;
  minLng: number;
}

export interface SvgPoint {
  x: number;
  y: number;
}

export type CoordinatePlace = PlaceRelatedSummary & {
  latitude: number;
  longitude: number;
};
