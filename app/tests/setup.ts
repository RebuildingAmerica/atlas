import { afterEach } from "vitest";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

/**
 * Minimal `matchMedia` so components that ask about reduced motion or colour
 * scheme render instead of throwing. jsdom ships no implementation at all.
 */
function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        addEventListener: () => undefined,
        addListener: () => undefined,
        dispatchEvent: () => false,
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: () => undefined,
        removeListener: () => undefined,
      }) as MediaQueryList,
  });
}

/**
 * Observer stubs. jsdom implements neither, and a component that constructs one
 * on mount fails before it renders anything worth asserting on.
 */
function installObservers(): void {
  class NoopObserver {
    disconnect(): void {
      // Nothing to tear down; this observer never fires.
    }
    observe(): void {
      // Layout never changes under jsdom, so there is nothing to report.
    }
    takeRecords(): [] {
      return [];
    }
    unobserve(): void {
      // Symmetry with observe(); no bookkeeping to undo.
    }
  }

  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: NoopObserver,
  });
  Object.defineProperty(window, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: NoopObserver,
  });
}

/**
 * A clipboard that records rather than writes, so copy affordances are
 * assertable. jsdom exposes `navigator` without `clipboard`.
 */
function installClipboard(): void {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: {
      readText: () => Promise.resolve(""),
      writeText: () => Promise.resolve(),
    },
  });
}

if (typeof window !== "undefined" && typeof window.document !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });

  Object.defineProperty(window.HTMLFormElement.prototype, "requestSubmit", {
    configurable: true,
    value(this: HTMLFormElement, submitter?: HTMLElement | null) {
      const submitEvent = new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        submitter: submitter ?? null,
      });

      this.dispatchEvent(submitEvent);
    },
  });

  installMatchMedia();
  installObservers();
  installClipboard();

  // Registered once here rather than in each of the 200-odd component files
  // that used to import it themselves.
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => {
    cleanup();
  });
}
