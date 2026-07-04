export type DiscoveryEventName =
  | "catalog_filter_removed"
  | "catalog_profile_opened"
  | "catalog_results_rendered"
  | "catalog_search_submitted"
  | "catalog_sources_inspected"
  | "catalog_zero_results";

export type DiscoveryEventValue = boolean | number | string | null | undefined;

export type DiscoveryEventProperties = Record<string, DiscoveryEventValue>;

export interface DiscoveryEventDetail {
  name: DiscoveryEventName;
  properties: DiscoveryEventProperties;
}

export function trackDiscoveryEvent(
  name: DiscoveryEventName,
  properties: DiscoveryEventProperties = {},
): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<DiscoveryEventDetail>("atlas:discovery", {
      detail: { name, properties },
    }),
  );
}
