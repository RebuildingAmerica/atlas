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
  return await fetchCatalogPublicFirehoseSignals(input, fetcher, getServerApiBaseUrl());
}
