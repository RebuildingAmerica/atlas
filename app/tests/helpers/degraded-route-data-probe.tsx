import type { QueryKey } from "@tanstack/react-query";
import { useDegradedRouteData } from "@/platform/routes/use-degraded-route-data";

export interface DegradedRouteDataProbeProps {
  queryFn: () => Promise<string>;
  queryKey: QueryKey;
}

/**
 * Renders what `useDegradedRouteData` returns, so a test can watch a degraded
 * route move from its placeholder to its data.
 */
export function DegradedRouteDataProbe({ queryFn, queryKey }: DegradedRouteDataProbeProps) {
  const data = useDegradedRouteData({ queryFn, queryKey });
  return <p data-testid="probe">{data ?? "waiting"}</p>;
}
