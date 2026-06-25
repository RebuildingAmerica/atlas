/** A captured `easeTo` invocation from the panel-camera hook. */
export interface PanelEaseCall {
  center: [number, number];
  duration: number;
  padding: { top: number; bottom: number; left: number; right: number };
}

/** The minimal camera surface the panel-camera hook drives. */
export interface PanelCameraMap {
  easeTo: (options: PanelEaseCall) => void;
}

/** Shared, mockable map state for the panel-camera hook test. */
export interface PanelCameraControl {
  map: PanelCameraMap | null;
  calls: PanelEaseCall[];
}

/** Build a fresh, empty control so each test starts clean. */
export function createPanelCameraControl(): PanelCameraControl {
  return { map: null, calls: [] };
}

/** Install a recording fake map into the control, ready for `useMap` to hand back. */
export function installPanelCameraMap(control: PanelCameraControl): void {
  control.calls = [];
  control.map = {
    easeTo: (options) => {
      control.calls.push(options);
    },
  };
}
