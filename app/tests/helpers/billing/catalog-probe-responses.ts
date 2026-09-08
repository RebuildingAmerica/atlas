/**
 * Builds a minimal fetch Response stand-in for the catalog availability probe.
 *
 * The probe only reads `ok` and `json()`, so a full Response is unnecessary
 * and would drag the undici types into every consuming test.
 *
 * @param body - Parsed JSON body the probe should observe.
 * @param ok - Whether the response should report a 2xx status.
 * @returns An object shaped like the part of Response the probe touches.
 */
export function catalogProbeResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}
