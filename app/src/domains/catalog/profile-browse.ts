import type { EntryType } from "@/types";

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
