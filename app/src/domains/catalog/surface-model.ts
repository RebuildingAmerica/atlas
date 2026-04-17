import type { FacetOption } from "@/types";

export interface StateDensity {
  state: string;
  count: number;
  intensity: number;
}

export function buildStateDensity(states: FacetOption[]): StateDensity[] {
  if (states.length === 0) {
    return [];
  }

  const max = Math.max(...states.map((state) => state.count));

  return states.map((state) => ({
    state: state.value,
    count: state.count,
    intensity: max === 0 ? 0 : Number((state.count / max).toFixed(2)),
  }));
}
