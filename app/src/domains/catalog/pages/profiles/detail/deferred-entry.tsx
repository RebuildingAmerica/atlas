import type { ReactNode } from "react";
import {
  useProfileEntry,
  type ProfileEntryLookup,
} from "@/domains/catalog/hooks/use-profile-entry";
import { PublicDataFailure } from "@/platform/routes/public-data-failure";
import type { Entry } from "@rebuildingamerica/atlas-api-client";

interface DeferredEntryProps {
  /** The slug the page was opened with, and where to look it up. */
  lookup: ProfileEntryLookup;
  /** The page's frame with its entry-dependent parts held as placeholders. */
  placeholder: ReactNode;
  /** Renders the page once the entry has arrived. */
  children: (entry: Entry) => ReactNode;
}

/**
 * Fetches, in the browser, the entry a public route's loader could not.
 *
 * It is a component rather than a hook call in each route so the pages that
 * render with a loader entry never mount the retrying query at all. The
 * placeholder stays up during the bounded retry; an outage gets a retry action
 * and a missing record renders the same not-found page as the loader.
 */
export function DeferredEntry({ lookup, placeholder, children }: DeferredEntryProps) {
  const { data: entry, isError, refetch } = useProfileEntry(lookup);
  if (isError && !entry) return <PublicDataFailure onRetry={() => void refetch()} />;
  return entry === undefined ? placeholder : children(entry);
}
