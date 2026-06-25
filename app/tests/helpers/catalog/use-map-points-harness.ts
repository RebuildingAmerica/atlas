import type { Mock } from "vitest";

/** The fields of the React Query config the map-points hook test asserts on. */
export interface MapPointsQueryConfig {
  queryKey: unknown;
  queryFn: () => Promise<unknown>;
  enabled: boolean;
  placeholderData: unknown;
  initialData?: unknown;
}

/** Read the most recent `useQuery` config passed by the hook under test. */
export function lastQueryConfig(useQueryMock: Mock): MapPointsQueryConfig {
  const calls = useQueryMock.mock.calls;
  return calls[calls.length - 1]?.[0] as MapPointsQueryConfig;
}
