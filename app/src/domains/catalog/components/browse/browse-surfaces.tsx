import { STATE_NAME_BY_CODE } from "@rebuildingamerica/atlas-catalog/us-state-grid";

export interface BrowseSurfaceState {
  count: number;
  intensity: number;
  state: string;
}

interface GridSurfaceProps {
  onSelectState: (state: string) => void;
  selectedState?: string;
  states: BrowseSurfaceState[];
}

interface ListSurfaceProps {
  onSelectState: (state: string) => void;
  selectedState?: string;
  states: BrowseSurfaceState[];
}

/**
 * Dense state grid used for non-map browse views.
 */
export function GridSurface({ onSelectState, selectedState, states }: GridSurfaceProps) {
  return (
    <div className="grid gap-x-4 gap-y-3 py-2 md:grid-cols-2 lg:py-3 xl:grid-cols-3">
      {states.map((state) => {
        const isSelected = selectedState === state.state;

        return (
          <button
            key={state.state}
            type="button"
            aria-pressed={isSelected}
            onClick={() => {
              onSelectState(state.state);
            }}
            className={[
              "border-border border-b pb-3 text-left transition-all",
              isSelected ? "border-ink-strong" : "hover:border-border-strong",
            ].join(" ")}
          >
            <p className="type-title-large text-ink-strong">
              {STATE_NAME_BY_CODE[state.state] ?? state.state}
            </p>
            <p className="type-body-medium text-ink-soft mt-1.5">{state.count} matching records</p>
            <div className="bg-surface-alt mt-3 h-2 rounded-full">
              <div
                className="bg-accent h-full rounded-full"
                style={{ width: `${Math.max(state.intensity * 100, 12)}%` }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Ranked state list used for browse list mode.
 */
export function ListSurface({ onSelectState, selectedState, states }: ListSurfaceProps) {
  return (
    <div className="divide-border divide-y py-1">
      {states.map((state, index) => {
        const isSelected = selectedState === state.state;

        return (
          <button
            key={state.state}
            type="button"
            aria-pressed={isSelected}
            onClick={() => {
              onSelectState(state.state);
            }}
            className={[
              "grid w-full gap-2.5 py-3 text-left transition-colors md:grid-cols-[2.5rem_minmax(0,1fr)_auto]",
              isSelected ? "text-ink-strong" : "hover:text-ink-strong",
            ].join(" ")}
          >
            <span className="type-body-small text-ink-muted">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <p className="type-title-medium text-ink-strong">
                {STATE_NAME_BY_CODE[state.state] ?? state.state}
              </p>
              <p className="type-body-medium text-ink-soft mt-1">{state.state}</p>
            </div>
            <span className="type-body-medium text-ink-muted">{state.count} records</span>
          </button>
        );
      })}
    </div>
  );
}
