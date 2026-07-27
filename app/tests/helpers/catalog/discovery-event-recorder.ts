import type { DiscoveryEventDetail } from "@/domains/catalog/discovery-events";

export interface DiscoveryEventRecorder {
  /** Every `atlas:discovery` event seen since recording started, in order. */
  events: DiscoveryEventDetail[];
  /** Stop listening. Safe to call more than once. */
  stop: () => void;
}

/**
 * Records the analytics events a catalog surface announces on the window.
 *
 * `trackDiscoveryEvent` dispatches a real `atlas:discovery` CustomEvent rather
 * than calling an injected client, so a test can assert on what the surface
 * reported without mocking the module out from under the component.
 *
 * @returns A recorder holding the events seen so far, plus its own teardown.
 */
export function recordDiscoveryEvents(): DiscoveryEventRecorder {
  const events: DiscoveryEventDetail[] = [];

  const handler = (event: Event): void => {
    events.push((event as CustomEvent<DiscoveryEventDetail>).detail);
  };

  window.addEventListener("atlas:discovery", handler);

  return {
    events,
    stop: () => {
      window.removeEventListener("atlas:discovery", handler);
    },
  };
}
