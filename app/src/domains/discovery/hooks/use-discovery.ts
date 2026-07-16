import { createDiscoveryHooks } from "@rebuildingamerica/atlas-catalog/discovery/create-discovery-hooks";
import {
  getDiscoveryRun,
  listDiscoveryJobQueue,
  listDiscoveryRuns,
  startDiscoveryRun,
} from "@/domains/discovery/functions";

export const {
  discoveryRunQueryOptions,
  discoveryRunsQueryOptions,
  useDiscoveryJobQueue,
  useDiscoveryRun,
  useDiscoveryRuns,
  useStartDiscovery,
} = createDiscoveryHooks({
  getRun: async (id) => await getDiscoveryRun({ data: { id } }),
  listJobQueue: async (limit) => await listDiscoveryJobQueue({ data: { limit } }),
  listRuns: async () => await listDiscoveryRuns(),
  startRun: async (data) => await startDiscoveryRun({ data }),
});
