import { createSerializationAdapter } from "@tanstack/react-router";
import { AtlasApiError } from "@rebuildingamerica/atlas-api-client/orval/fetcher";
import {
  UserFacingError,
  userFacingApiDetail,
} from "@rebuildingamerica/atlas-api-client/user-facing-errors";

/** What crosses the server function boundary for a failed Atlas API call. */
export interface SerializedAtlasApiError {
  status: number;
  detail: string | null;
}

/**
 * Keeps a `UserFacingError` thrown in a server function recognizable in the
 * browser.
 *
 * TanStack Start otherwise rebuilds every thrown error as a plain `Error`, so
 * the screen could not tell a sentence written for the visitor from a message
 * naming a database table, and would have to hide both.
 */
export const userFacingErrorAdapter = createSerializationAdapter({
  key: "atlas-user-facing-error",
  test: (value): value is UserFacingError => value instanceof UserFacingError,
  toSerializable: (error) => error.message,
  fromSerializable: (message: string) => new UserFacingError(message),
});

/**
 * Keeps the status of an Atlas API failure from a server function, so the
 * browser shows the same sentence it would for a direct call.
 *
 * Only the detail `userFacingApiDetail` would show is sent. The raw body can
 * be a rate limiter's JSON or a proxy's HTML page, and it stays in the server
 * log.
 */
export const atlasApiErrorAdapter = createSerializationAdapter({
  key: "atlas-api-error",
  test: (value): value is AtlasApiError => value instanceof AtlasApiError,
  toSerializable: (error): SerializedAtlasApiError => ({
    status: error.status,
    detail: userFacingApiDetail(error),
  }),
  fromSerializable: ({ status, detail }: SerializedAtlasApiError) =>
    new AtlasApiError(status, detail === null ? "" : JSON.stringify({ detail })),
});
