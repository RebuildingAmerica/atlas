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
  const { data, isError, refetch } = useDegradedRouteData({ queryFn, queryKey });
  return (
    <div>
      <p data-testid="probe">{data ?? (isError ? "failed" : "waiting")}</p>
      {isError ? <button onClick={() => void refetch()}>Try again</button> : null}
    </div>
  );
}
