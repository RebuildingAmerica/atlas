import { useMap } from "react-map-gl/maplibre";
import { Minus, Plus, Locate } from "lucide-react";
import { flyToPlace } from "@/domains/catalog/map/map-camera";
import { CONUS_VIEW } from "@/domains/catalog/map/map-viewport";

interface MapControlsProps {
  /** Cut motion for visitors who prefer it: recenter jumps instead of gliding. */
  reducedMotion?: boolean;
}

/** A single square glass control button with a centered icon. */
function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="bg-surface-container-high/92 text-ink-soft hover:text-ink-strong shadow-soft border-border-strong flex h-11 w-11 items-center justify-center border backdrop-blur-md transition-colors first:rounded-t-[0.9rem] last:rounded-b-[0.9rem]"
    >
      {children}
    </button>
  );
}

/**
 * The map's bottom-right camera controls: zoom in, zoom out, and recenter.
 *
 * Restyled to the Atlas glass language rather than MapLibre's default chrome so
 * the controls feel like part of the page. Each button drives the live map
 * directly through `useMap`; recenter glides the camera back to the whole
 * country (or jumps, for reduced motion) so a visitor who has wandered into one
 * city is never stranded there. Before the map mounts the buttons are safe
 * no-ops rather than reaching for a camera that isn't there.
 */
export function MapControls({ reducedMotion = false }: MapControlsProps) {
  const map = useMap().current;

  return (
    <div className="pointer-events-auto flex flex-col">
      <ControlButton
        label="Zoom in"
        onClick={() => {
          map?.zoomIn();
        }}
      >
        <Plus className="h-5 w-5" aria-hidden />
      </ControlButton>
      <ControlButton
        label="Zoom out"
        onClick={() => {
          map?.zoomOut();
        }}
      >
        <Minus className="h-5 w-5" aria-hidden />
      </ControlButton>
      <ControlButton
        label="Recenter on the United States"
        onClick={() => {
          flyToPlace(map ?? null, CONUS_VIEW.center, CONUS_VIEW.zoom, { reducedMotion });
        }}
      >
        <Locate className="h-5 w-5" aria-hidden />
      </ControlButton>
    </div>
  );
}
