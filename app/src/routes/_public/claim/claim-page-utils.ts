import type { ProfileClaimResponse } from "@/lib/generated/atlas";
import type { Entry } from "@/types";

export interface ClaimStatusInfo {
  label: string;
  variant: "default" | "success" | "warning" | "info";
}

export function safeSourceCount(entry: Entry): number {
  return typeof entry.source_count === "number" ? entry.source_count : 0;
}

export function formatEntryLocation(entry: Entry): string | null {
  const parts = [entry.city, entry.state, entry.region].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(", ");
  }
  return entry.full_address ?? null;
}

export function entryTypeLabel(type: Entry["type"]): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function claimStatusLabel(entry: Entry, claim?: ProfileClaimResponse): ClaimStatusInfo {
  if (claim?.status === "verified" || entry.claim?.status === "verified") {
    return { label: "Subject verified", variant: "success" };
  }
  if (claim?.status === "pending" || entry.claim?.status === "pending") {
    return { label: "Under review", variant: "warning" };
  }
  if (entry.trust?.level === "atlas_verified") {
    return { label: "Atlas verified", variant: "info" };
  }
  if (entry.trust?.level === "corroborated") {
    return { label: "Corroborated", variant: "info" };
  }
  return { label: "Source linked", variant: "default" };
}
