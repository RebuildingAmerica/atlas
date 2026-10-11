import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPageHeaders,
  gateRequest,
  PAGE_HEADERS,
  REFUSAL_HEADERS,
} from "@/server/gate";
import {
  ADMIN_ORIGIN,
  makeRuntime,
  signedInRequest,
} from "../helpers/admin-fixtures";

describe("the admin gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers 503 and names no detail when the admin is not configured", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const refusal = await gateRequest(
      new Request(`${ADMIN_ORIGIN}/`),
      new Error("ATLAS_API_URL is required."),
    );

    expect(refusal?.status).toBe(503);
    expect(await refusal?.text()).toBe(
      "The Atlas platform admin is not configured.",
    );
    for (const [name, value] of Object.entries(REFUSAL_HEADERS)) {
      expect(refusal?.headers.get(name)).toBe(value);
    }
    expect(error).toHaveBeenCalledWith("Platform admin is not configured", {
      reason: "ATLAS_API_URL is required.",
    });
  });

  it("refuses a caller Access did not sign in, logging why but not saying", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { runtime } = await makeRuntime();

    const refusal = await gateRequest(
      new Request(`${ADMIN_ORIGIN}/discounts`),
      runtime,
    );

    expect(refusal?.status).toBe(403);
    expect(await refusal?.text()).toBe(
      "You do not have access to the Atlas platform admin.",
    );
    expect(warn).toHaveBeenCalledWith("Refused a platform admin request", {
      reason: "missing",
    });
  });

  it("lets a signed-in operator read", async () => {
    const { keys, runtime } = await makeRuntime();

    expect(await gateRequest(await signedInRequest(keys), runtime)).toBeNull();
  });

  it("refuses a change sent from another origin", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { keys, runtime } = await makeRuntime();
    const request = await signedInRequest(keys, {
      method: "POST",
      headers: { Origin: "https://evil.example.test" },
    });

    const refusal = await gateRequest(request, runtime);

    expect(refusal?.status).toBe(403);
    expect(warn).toHaveBeenCalledWith("Refused a platform admin request", {
      reason: "cross_origin",
    });
  });

  it("lets a signed-in operator make a change from the admin itself", async () => {
    const { keys, runtime } = await makeRuntime();
    const request = await signedInRequest(keys, {
      method: "POST",
      headers: { Origin: ADMIN_ORIGIN },
    });

    expect(await gateRequest(request, runtime)).toBeNull();
  });

  it("preserves the waitlist's stricter no-referrer policy", () => {
    const headers = new Headers({ "Referrer-Policy": "no-referrer" });
    applyPageHeaders(headers);
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Cache-Control")).toBe("no-store");
  });
  it("marks every page private and unframeable", () => {
    const headers = new Headers({ "Cache-Control": "public" });

    applyPageHeaders(headers);

    for (const [name, value] of Object.entries(PAGE_HEADERS))
      expect(headers.get(name)).toBe(value);
  });
});
