// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingCheckout,
  readPendingCheckout,
  rememberPendingCheckout,
} from "@/domains/billing/pending-checkout";

describe("pending-checkout", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when no record is stored", () => {
    expect(readPendingCheckout()).toBeNull();
  });

  it("round-trips a record through localStorage with a startedAt timestamp", () => {
    rememberPendingCheckout({ product: "atlas_team", interval: "monthly" });
    const record = readPendingCheckout();
    expect(record?.product).toBe("atlas_team");
    expect(record?.interval).toBe("monthly");
    expect(typeof record?.startedAt).toBe("number");
  });

  it("clears the record on demand", () => {
    rememberPendingCheckout({ product: "atlas_pro", interval: "yearly" });
    clearPendingCheckout();
    expect(readPendingCheckout()).toBeNull();
  });

  it("treats records older than 24 hours as stale and self-clears them", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:00Z"));
    rememberPendingCheckout({ product: "atlas_team", interval: "yearly" });
    vi.setSystemTime(new Date("2026-04-02T01:00:00Z"));
    expect(readPendingCheckout()).toBeNull();
    expect(window.localStorage.getItem("atlas:pending-checkout")).toBeNull();
  });

  it("rejects malformed payloads instead of throwing", () => {
    window.localStorage.setItem("atlas:pending-checkout", "not-json");
    expect(readPendingCheckout()).toBeNull();
    window.localStorage.setItem("atlas:pending-checkout", JSON.stringify({ product: "wrong" }));
    expect(readPendingCheckout()).toBeNull();
  });
});
