import { describe, expect, it } from "vitest";
import { AtlasApiError } from "@rebuildingamerica/atlas-api-client/orval/fetcher";
import {
  UserFacingError,
  userFacingErrorMessage,
} from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import {
  atlasApiErrorAdapter,
  userFacingErrorAdapter,
} from "@/platform/errors/error-serialization";

describe("userFacingErrorAdapter", () => {
  it("rebuilds a visitor-facing error in the browser with its sentence intact", () => {
    const error = new UserFacingError("This workspace cannot invite members.");

    expect(userFacingErrorAdapter.test(error)).toBe(true);
    expect(userFacingErrorAdapter.test(new Error("Auth database unavailable"))).toBe(false);

    const rebuilt = userFacingErrorAdapter.fromSerializable(
      userFacingErrorAdapter.toSerializable(error),
    );
    expect(rebuilt).toBeInstanceOf(UserFacingError);
    expect(userFacingErrorMessage(rebuilt, "fallback")).toBe(
      "This workspace cannot invite members.",
    );
  });
});

describe("atlasApiErrorAdapter", () => {
  it("sends the status and the visitor-facing detail, never the raw body", () => {
    const error = new AtlasApiError(409, JSON.stringify({ detail: "DNS TXT record not found." }));

    expect(atlasApiErrorAdapter.test(error)).toBe(true);
    expect(atlasApiErrorAdapter.test(new Error("x"))).toBe(false);

    const serialized = atlasApiErrorAdapter.toSerializable(error);
    expect(serialized).toEqual({ detail: "DNS TXT record not found.", status: 409 });

    const rebuilt = atlasApiErrorAdapter.fromSerializable(serialized);
    expect(rebuilt).toBeInstanceOf(AtlasApiError);
    expect(rebuilt.status).toBe(409);
    expect(userFacingErrorMessage(rebuilt, "fallback")).toBe("DNS TXT record not found.");
  });

  it("drops a rate limiter's body and keeps the status sentence", () => {
    const serialized = atlasApiErrorAdapter.toSerializable(
      new AtlasApiError(429, '{"detail":"Too many requests."}'),
    );
    expect(serialized).toEqual({ detail: null, status: 429 });

    const rebuilt = atlasApiErrorAdapter.fromSerializable(serialized);
    expect(rebuilt.body).toBe("");
    expect(userFacingErrorMessage(rebuilt, "fallback")).toBe(
      "Atlas is busy right now. Try again in a moment.",
    );
  });
});
