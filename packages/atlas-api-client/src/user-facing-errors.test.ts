import { describe, expect, it } from "vitest";
import { ATLAS_API_ERROR_MESSAGES, AtlasApiError } from "./orval/fetcher";
import { UserFacingError, userFacingApiDetail, userFacingErrorMessage } from "./user-facing-errors";

const FALLBACK = "Could not save changes.";

function apiError(status: number, detail: unknown): AtlasApiError {
  return new AtlasApiError(status, JSON.stringify({ detail }));
}

describe("userFacingApiDetail", () => {
  it.each([400, 409, 410, 422])("returns the API's sentence for a %i response", (status) => {
    expect(userFacingApiDetail(apiError(status, "  DNS TXT record not found.  "))).toBe(
      "DNS TXT record not found.",
    );
  });

  it.each([401, 403, 404, 429, 500, 503])("ignores the body of a %i response", (status) => {
    expect(userFacingApiDetail(apiError(status, "Too many requests."))).toBeNull();
  });

  it("ignores FastAPI field-error arrays, empty details, and bodies without a detail", () => {
    expect(userFacingApiDetail(apiError(422, [{ loc: ["body"], msg: "field required" }]))).toBeNull();
    expect(userFacingApiDetail(apiError(400, "   "))).toBeNull();
    expect(userFacingApiDetail(new AtlasApiError(400, JSON.stringify({ error: "x" })))).toBeNull();
    expect(userFacingApiDetail(new AtlasApiError(400, "null"))).toBeNull();
  });

  it("ignores bodies that are not JSON, stack traces, markup, and overlong text", () => {
    expect(userFacingApiDetail(new AtlasApiError(400, "<html>Bad Request</html>"))).toBeNull();
    expect(userFacingApiDetail(apiError(400, "Traceback:\n  File x"))).toBeNull();
    expect(userFacingApiDetail(apiError(400, "<b>bad</b>"))).toBeNull();
    expect(userFacingApiDetail(apiError(400, "a".repeat(301)))).toBeNull();
  });

  it("returns null for anything that is not an Atlas API error", () => {
    expect(userFacingApiDetail(new Error('{"detail":"x"}'))).toBeNull();
    expect(userFacingApiDetail("DNS TXT record not found.")).toBeNull();
  });
});

describe("userFacingErrorMessage", () => {
  it("shows a message written for the visitor", () => {
    expect(userFacingErrorMessage(new UserFacingError("Add a domain first."), FALLBACK)).toBe(
      "Add a domain first.",
    );
    expect(new UserFacingError("x").name).toBe("UserFacingError");
  });

  it("prefers the API's sentence and otherwise uses the status sentence", () => {
    expect(userFacingErrorMessage(apiError(409, "Claim is pending."), FALLBACK)).toBe(
      "Claim is pending.",
    );
    expect(userFacingErrorMessage(apiError(429, "Too many requests."), FALLBACK)).toBe(
      ATLAS_API_ERROR_MESSAGES.busy,
    );
  });

  it("uses the fallback for internal errors and thrown values", () => {
    expect(userFacingErrorMessage(new Error("Auth database unavailable"), FALLBACK)).toBe(FALLBACK);
    expect(userFacingErrorMessage(new TypeError("Failed to fetch"), FALLBACK)).toBe(FALLBACK);
    expect(userFacingErrorMessage("boom", FALLBACK)).toBe(FALLBACK);
  });
});
