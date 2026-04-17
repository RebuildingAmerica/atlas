import { useMemo } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import usAtlasStates from "us-atlas/states-10m.json";
import { buildUsMapStateStyles, getStateCodeFromFips } from "@/domains/catalog/us-map";
import { STATE_NAME_BY_CODE } from "@/domains/catalog/us-state-grid";

interface UsMapSurfaceProps {
  stateDensity: { state: string; count: number; intensity: number }[];
  selectedState?: string;
  onSelectState: (state: string) => void;
}

interface MapGeography {
  id: string | number;
  rsmKey: string;
  properties: {
    name: string;
  };
}

export function UsMapSurface({ stateDensity, selectedState, onSelectState }: UsMapSurfaceProps) {
  const stylesByState = useMemo(() => buildUsMapStateStyles(stateDensity), [stateDensity]);
  const maxCount = useMemo(
    () => stateDensity.reduce((currentMax, state) => Math.max(currentMax, state.count), 0),
    [stateDensity],
  );

  return (
    <div>
      <div className="bg-surface-container-lowest">
        <ComposableMap
          projection="geoAlbersUsa"
          width={975}
          height={610}
          className="h-auto w-full"
          aria-label="United States map"
        >
          <Geographies geography={usAtlasStates}>
            {({ geographies }) =>
              (geographies as MapGeography[]).map((geography) => {
                const stateCode = getStateCodeFromFips(geography.id);
                const stateName = stateCode
                  ? (STATE_NAME_BY_CODE[stateCode] ?? geography.properties.name)
                  : geography.properties.name;
                const density = stateCode ? stylesByState[stateCode] : undefined;
                const isSelected = stateCode === selectedState;
                const fill = isSelected
                  ? "rgba(208, 117, 52, 0.92)"
                  : density
                    ? `rgba(208, 117, 52, ${0.16 + density.intensity * 0.64})`
                    : "rgba(255,255,255,0.96)";

                return (
                  <Geography
                    key={geography.rsmKey}
                    geography={geography}
                    aria-label={
                      stateCode ? `${stateName}, ${density?.count ?? 0} results` : stateName
                    }
                    onClick={() => {
                      if (stateCode) {
                        onSelectState(stateCode);
                      }
                    }}
                    style={{
                      default: {
                        fill,
                        stroke: "rgba(79, 63, 47, 0.35)",
                        strokeWidth: isSelected ? 1.8 : 0.9,
                        outline: "none",
                        transition: "fill 160ms ease, stroke 160ms ease",
                        cursor: stateCode ? "pointer" : "default",
                      },
                      hover: {
                        fill: isSelected ? "rgba(208, 117, 52, 0.92)" : "rgba(208, 117, 52, 0.72)",
                        stroke: "rgba(79, 63, 47, 0.78)",
                        strokeWidth: isSelected ? 1.8 : 1.2,
                        outline: "none",
                        cursor: stateCode ? "pointer" : "default",
                      },
                      pressed: {
                        fill: "rgba(177, 93, 35, 0.95)",
                        stroke: "rgba(79, 63, 47, 0.9)",
                        strokeWidth: 1.8,
                        outline: "none",
                        cursor: stateCode ? "pointer" : "default",
                      },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ComposableMap>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
        <p className="type-body-small text-ink-muted">Darker states have more results.</p>
        <div className="flex items-center gap-2">
          <span className="type-label-small text-ink-muted">0</span>
          <div className="bg-accent-soft h-2 w-24 rounded-full">
            <div className="bg-accent h-full w-2/3 rounded-full" />
          </div>
          <span className="type-label-small text-ink-muted">{maxCount}</span>
        </div>
      </div>
    </div>
  );
}
