import type { ReactNode } from "react";
import {
  useProfileEntry,
  type ProfileEntryLookup,
} from "@/domains/catalog/hooks/use-profile-entry";
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
 * placeholder stays up through every failed attempt, and a record that does
 * not exist renders the same not-found page a loader's `notFound` does.
 */
export function DeferredEntry({ lookup, placeholder, children }: DeferredEntryProps) {
  const entry = useProfileEntry(lookup);
  return entry === undefined ? placeholder : children(entry);
}
