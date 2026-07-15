import type { EntryType } from "@rebuildingamerica/atlas-api-client";

export type ProfileBrowseScope = "all" | "people" | "organizations";

export function lockedEntryTypesForScope(scope: ProfileBrowseScope): EntryType[] {
  if (scope === "people") {
    return ["person"];
  }

  if (scope === "organizations") {
    return ["organization"];
  }

  return ["person", "organization"];
}
