import type { FileRouteTypes } from "@/routeTree.gen";

/** Every full path TanStack Router generates, e.g. `/browse` or `/profiles/people/$slug`. */
export type AtlasRoutePath = FileRouteTypes["fullPaths"];

/**
 * Which boot of the app a page is reachable in.
 *
 * `local` runs with `ATLAS_DEPLOY_MODE=local`, which grants a synthetic owner session for the
 * seeded `local` workspace. `session` runs the production-mode server and signs in for real,
 * which is the only way to reach the routes that `redirectIfLocalSession` bounces.
 */
export type ScreenshotMode = "local" | "session";

/** `full-page` stitches the whole scroll height; `viewport` captures only the 1440x900 frame. */
export type ScreenshotFrame = "full-page" | "viewport";

export interface SelectorWait {
  kind: "selector";
  selector: string;
}

export interface RoleWait {
  kind: "role";
  role: string;
  name: string;
}

/** Waits for the network to go quiet. The default when a route declares no explicit anchor. */
export interface SettledWait {
  kind: "settled";
}

/** Waits for the MapLibre canvas to size itself and its tile requests to drain. */
export interface MapWait {
  kind: "map";
}

export type ScreenshotWait = SelectorWait | RoleWait | SettledWait | MapWait;

/**
 * Resolves a path whose parameter is a seed-time UUID by following a link from an index page.
 *
 * Brief, saved-list and coverage-target ids are generated at seed time, so they cannot be
 * written into the manifest as literals.
 */
export interface ScreenshotDiscovery {
  fromPath: string;
  /** `RegExp` source, matched against each candidate anchor's pathname. */
  linkHrefPattern: string;
}

export interface ScreenshotClick {
  kind: "click";
  role: string;
  name: string;
}

export interface ScreenshotFill {
  kind: "fill";
  label: string;
  value: string;
}

export type ScreenshotInteraction = ScreenshotClick | ScreenshotFill;

export interface ScreenshotRoute {
  /** Output filename stem. Unique across the manifest. */
  name: string;
  /** Ties the entry back to `routeTree.gen.ts` so the coverage guard can see it. */
  routeId: AtlasRoutePath;
  /** Concrete URL to visit. Mutually exclusive with `discovery`. */
  path?: string;
  discovery?: ScreenshotDiscovery;
  mode: ScreenshotMode;
  /** Defaults to `full-page`. */
  frame?: ScreenshotFrame;
  search?: Readonly<Record<string, string>>;
  wait?: ScreenshotWait;
  interactions?: readonly ScreenshotInteraction[];
  /** Selectors blanked out in the PNG, for values that change between runs. */
  mask?: readonly string[];
  /** Set when the route intentionally lands somewhere other than the requested path. */
  expectPathname?: string;
  /**
   * Set when a non-200 document response is the correct answer.
   *
   * The 404 page necessarily returns 404, and the browser logs that as a failed resource load.
   * Declaring it here keeps a working page from being reported as a defect.
   */
  expectHttpStatus?: number;
  /** Surfaced in the audit index. Use it to explain a degraded or deliberately empty state. */
  note?: string;
}

export interface ExcludedRoute {
  reason: string;
}

export type CaptureStatus = "ok" | "degraded" | "redirected" | "failed";

export interface CaptureResult {
  name: string;
  routeId: string;
  mode: ScreenshotMode;
  requestedPath: string;
  finalPathname: string;
  status: CaptureStatus;
  httpStatus: number | null;
  durationMs: number;
  fontsLoaded: boolean;
  consoleErrors: readonly string[];
  pageErrors: readonly string[];
  failedRequests: readonly string[];
  error: string | null;
  note: string | null;
}
