import { notFound, redirect } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { loadOrDegrade } from "@/platform/routes/load-or-degrade";

describe("loadOrDegrade", () => {
  it("passes data through", async () => {
    await expect(loadOrDegrade(() => Promise.resolve({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it("turns any failure into missing data so the page still renders", async () => {
    const rateLimited = Object.assign(new Error("Too many requests."), { status: 429 });

    await expect(loadOrDegrade(() => Promise.reject(rateLimited))).resolves.toBeUndefined();
    await expect(
      loadOrDegrade(() => Promise.reject(new TypeError("fetch failed"))),
    ).resolves.toBeUndefined();
  });

  it("still lets a missing record or a redirect answer the request", async () => {
    const missing = notFound();
    const moved = redirect({ to: "/" });

    await expect(loadOrDegrade(vi.fn().mockRejectedValue(missing))).rejects.toBe(missing);
    await expect(loadOrDegrade(vi.fn().mockRejectedValue(moved))).rejects.toBe(moved);
  });
});
