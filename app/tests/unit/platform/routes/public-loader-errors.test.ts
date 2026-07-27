import { describe, expect, it } from "vitest";
import { isRecoverablePublicLoaderError } from "@/platform/routes/public-loader-errors";

describe("isRecoverablePublicLoaderError", () => {
  it("treats an Atlas outage message as recoverable", () => {
    expect(
      isRecoverablePublicLoaderError(new Error("Atlas is temporarily unavailable. Try again.")),
    ).toBe(true);
  });

  it("treats any server-side status as recoverable, however it is carried", () => {
    expect(isRecoverablePublicLoaderError(Object.assign(new Error("Boom"), { status: 503 }))).toBe(
      true,
    );
    expect(
      isRecoverablePublicLoaderError(
        Object.assign(new Error("Boom"), { response: { status: 500 } }),
      ),
    ).toBe(true);
  });

  it("treats an HTTP transport failure as recoverable by name or message", () => {
    expect(
      isRecoverablePublicLoaderError(Object.assign(new Error("Boom"), { name: "HTTPError" })),
    ).toBe(true);
    expect(isRecoverablePublicLoaderError(new Error("HTTPError"))).toBe(true);
  });

  it("lets a client-side status and a plain coding error through to the crash", () => {
    expect(
      isRecoverablePublicLoaderError(Object.assign(new Error("Not found"), { status: 404 })),
    ).toBe(false);
    expect(
      isRecoverablePublicLoaderError(
        Object.assign(new Error("Not found"), { response: { status: "500" } }),
      ),
    ).toBe(false);
    expect(isRecoverablePublicLoaderError(new TypeError("x is not a function"))).toBe(false);
  });

  it("does not recover from something that was never an error", () => {
    expect(isRecoverablePublicLoaderError("Atlas is temporarily unavailable")).toBe(false);
    expect(isRecoverablePublicLoaderError(undefined)).toBe(false);
  });
});
