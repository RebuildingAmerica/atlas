/** Decodes one base64url JWT segment as JSON. */
export function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}
