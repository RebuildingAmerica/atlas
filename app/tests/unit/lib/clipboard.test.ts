// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyToClipboard } from "@/lib/clipboard";

describe("copyToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true when navigator.clipboard.writeText resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const result = await copyToClipboard("hello");

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("returns false when navigator is unavailable", async () => {
    vi.stubGlobal("navigator", undefined);
    expect(await copyToClipboard("x")).toBe(false);
  });

  it("returns false when navigator.clipboard is missing", async () => {
    vi.stubGlobal("navigator", {});
    expect(await copyToClipboard("x")).toBe(false);
  });

  it("returns false when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyToClipboard("x")).toBe(false);
  });
});
