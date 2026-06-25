import { describe, expect, it } from "vitest";
import {
  ATLAS_API_ERROR_CODE,
  AtlasApiError,
  classifyAtlasApiStatus,
  extractAtlasApiErrorCode,
  isAtLimitError,
  resolveStartRunErrorMessage,
} from "@/domains/discovery/api-errors";

describe("discovery api-errors", () => {
  describe("AtlasApiError", () => {
    it("carries the code as both property and message so it survives serialization", () => {
      const error = new AtlasApiError(ATLAS_API_ERROR_CODE.AT_LIMIT);
      expect(error.code).toBe(ATLAS_API_ERROR_CODE.AT_LIMIT);
      expect(error.message).toBe(ATLAS_API_ERROR_CODE.AT_LIMIT);
      expect(error.name).toBe("AtlasApiError");
    });
  });

  describe("classifyAtlasApiStatus", () => {
    it("classifies 429 as at-limit", () => {
      expect(classifyAtlasApiStatus(429)).toBe(ATLAS_API_ERROR_CODE.AT_LIMIT);
    });

    it("classifies any 5xx as temporarily unavailable", () => {
      expect(classifyAtlasApiStatus(500)).toBe(ATLAS_API_ERROR_CODE.TEMPORARILY_UNAVAILABLE);
      expect(classifyAtlasApiStatus(503)).toBe(ATLAS_API_ERROR_CODE.TEMPORARILY_UNAVAILABLE);
    });

    it("classifies other non-ok statuses as a generic request failure", () => {
      expect(classifyAtlasApiStatus(404)).toBe(ATLAS_API_ERROR_CODE.REQUEST_FAILED);
      expect(classifyAtlasApiStatus(403)).toBe(ATLAS_API_ERROR_CODE.REQUEST_FAILED);
      expect(classifyAtlasApiStatus(400)).toBe(ATLAS_API_ERROR_CODE.REQUEST_FAILED);
    });
  });

  describe("extractAtlasApiErrorCode", () => {
    it("recovers the code from a plain Error whose message is a known code", () => {
      expect(extractAtlasApiErrorCode(new Error(ATLAS_API_ERROR_CODE.AT_LIMIT))).toBe(
        ATLAS_API_ERROR_CODE.AT_LIMIT,
      );
    });

    it("returns null for an Error with an unrecognized message", () => {
      expect(extractAtlasApiErrorCode(new Error("Boom"))).toBeNull();
    });

    it("returns null for a non-Error value", () => {
      expect(extractAtlasApiErrorCode("ATLAS_API_AT_LIMIT")).toBeNull();
    });
  });

  describe("resolveStartRunErrorMessage", () => {
    it("returns null for the at-limit case so the upgrade affordance handles it", () => {
      expect(
        resolveStartRunErrorMessage(new AtlasApiError(ATLAS_API_ERROR_CODE.AT_LIMIT)),
      ).toBeNull();
    });

    it("returns safe retry copy for the temporarily-unavailable case", () => {
      expect(
        resolveStartRunErrorMessage(
          new AtlasApiError(ATLAS_API_ERROR_CODE.TEMPORARILY_UNAVAILABLE),
        ),
      ).toBe("Atlas is temporarily unavailable. Try again in a moment.");
    });

    it("returns generic copy for a classified request failure", () => {
      expect(
        resolveStartRunErrorMessage(new AtlasApiError(ATLAS_API_ERROR_CODE.REQUEST_FAILED)),
      ).toBe("Could not start the run. Check the fields and try again.");
    });

    it("falls back to generic copy for an unclassified error", () => {
      expect(resolveStartRunErrorMessage(new Error("Fail"))).toBe(
        "Could not start the run. Check the fields and try again.",
      );
    });
  });

  describe("isAtLimitError", () => {
    it("is true only for the at-limit code", () => {
      expect(isAtLimitError(new AtlasApiError(ATLAS_API_ERROR_CODE.AT_LIMIT))).toBe(true);
      expect(isAtLimitError(new AtlasApiError(ATLAS_API_ERROR_CODE.REQUEST_FAILED))).toBe(false);
      expect(isAtLimitError(new Error("Fail"))).toBe(false);
      expect(isAtLimitError(null)).toBe(false);
    });
  });
});
