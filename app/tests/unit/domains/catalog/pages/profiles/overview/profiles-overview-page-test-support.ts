import type { QueryClient } from "@tanstack/react-query";
import type { Entry, EntryType } from "@rebuildingamerica/atlas-api-client";
import { createEntryListFixture } from "../../../../../../fixtures/catalog/entry-list";

/** The catalog slice the overview page asks for, per scope. */
export interface CatalogSliceRequest {
  entryTypes: EntryType[];
  limit: number;
}

/**
 * Seeds one catalog slice into the cache the way the route loader would.
 *
 * @param queryClient - The client backing the render under test.
 * @param request - Which slice to fill.
 * @param entries - Entries to serve for it.
 */
export function seedCatalogSlice(
  queryClient: QueryClient,
  request: CatalogSliceRequest,
  entries: Entry[],
): void {
  queryClient.setQueryData(
    ["entries", { entry_types: request.entryTypes, limit: request.limit }],
    createEntryListFixture(entries),
  );
}
