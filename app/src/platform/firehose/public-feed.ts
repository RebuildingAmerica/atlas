import {
  fetchPublicFirehoseSignals as fetchCatalogPublicFirehoseSignals,
  type PublicFirehoseFetcher,
  type PublicFirehoseSearchInput,
  type PublicFirehoseSnapshot,
} from "@rebuildingamerica/atlas-catalog/firehose/public-feed";
import { getServerApiBaseUrl } from "@/platform/config/app-config";

export type { PublicFirehoseSearchInput, PublicFirehoseSnapshot };

export async function fetchPublicFirehoseSignals(
  input: PublicFirehoseSearchInput = {},
  fetcher?: PublicFirehoseFetcher,
): Promise<PublicFirehoseSnapshot> {
  // The browser reaches the feed through this origin's relative path, and the
  // server-only API address cannot be resolved there: asking for it throws,
  // which would fail every browser fetch of the feed.
  const serverBaseUrl = typeof window === "undefined" ? getServerApiBaseUrl() : undefined;
  return await fetchCatalogPublicFirehoseSignals(input, fetcher, serverBaseUrl);
}
