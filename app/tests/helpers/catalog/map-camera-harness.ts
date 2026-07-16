import type { FlyToCamera } from "@rebuildingamerica/atlas-catalog/map/map-camera";

/** A captured `flyTo` invocation from {@link flyToPlace}. */
export interface CapturedFly {
  center: [number, number];
  zoom: number;
  duration: number;
  curve: number;
  essential: boolean;
}

/** A captured `jumpTo` invocation from {@link flyToPlace}'s reduced-motion cut. */
export interface CapturedJump {
  center: [number, number];
  zoom: number;
}

/** A recording fake map plus the calls it captured. */
export interface FlyToHarness {
  map: FlyToCamera;
  flyCalls: CapturedFly[];
  jumpCalls: CapturedJump[];
}

/** Build a recording fake map so a test can assert how the camera was driven. */
export function createFlyToHarness(): FlyToHarness {
  const flyCalls: CapturedFly[] = [];
  const jumpCalls: CapturedJump[] = [];
  return {
    map: {
      flyTo: (options) => {
        flyCalls.push(options);
      },
      jumpTo: (options) => {
        jumpCalls.push(options);
      },
    },
    flyCalls,
    jumpCalls,
  };
}
