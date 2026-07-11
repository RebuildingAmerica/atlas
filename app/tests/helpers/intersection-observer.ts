import { vi } from "vitest";

export interface IntersectionObserverMockController {
  triggerIntersecting: () => void;
}

export function installIntersectionObserverMock(): IntersectionObserverMockController {
  let intersectionCallback: IntersectionObserverCallback | undefined;
  const observer = {
    disconnect: vi.fn(),
    observe: vi.fn(),
    root: null,
    rootMargin: "",
    scrollMargin: "",
    takeRecords: vi.fn((): IntersectionObserverEntry[] => []),
    thresholds: [],
    unobserve: vi.fn(),
  } satisfies IntersectionObserver;

  class MockIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "";
    readonly scrollMargin = "";
    readonly thresholds = [];

    constructor(callback: IntersectionObserverCallback) {
      intersectionCallback = callback;
    }

    disconnect = observer.disconnect;
    observe = observer.observe;
    takeRecords = observer.takeRecords;
    unobserve = observer.unobserve;
  }

  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: MockIntersectionObserver,
  });

  return {
    triggerIntersecting: () => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], observer);
    },
  };
}
