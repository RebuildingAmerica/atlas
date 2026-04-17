import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestHeaders: vi.fn(),
  sanitizeBrowserSessionHeaders: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: mocks.getRequestHeaders,
}));

vi.mock("@/domains/access/server/runtime", () => ({
  sanitizeBrowserSessionHeaders: mocks.sanitizeBrowserSessionHeaders,
}));

describe("getBrowserSessionHeaders", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getRequestHeaders.mockReset();
    mocks.sanitizeBrowserSessionHeaders.mockReset();
  });

  it("sanitizes the current request headers before exposing them to auth helpers", async () => {
    const requestHeaders = new Headers({
      cookie: "better-auth.session_token=test-token",
      "x-api-key": "atlas_secret_key",
    });
    const sanitizedHeaders = new Headers({
      cookie: "better-auth.session_token=test-token",
    });

    mocks.getRequestHeaders.mockReturnValue(requestHeaders);
    mocks.sanitizeBrowserSessionHeaders.mockReturnValue(sanitizedHeaders);

    const { getBrowserSessionHeaders } = await import("@/domains/access/server/request-headers");

    expect(getBrowserSessionHeaders()).toBe(sanitizedHeaders);
    expect(mocks.sanitizeBrowserSessionHeaders).toHaveBeenCalledWith(requestHeaders);
  });
});
