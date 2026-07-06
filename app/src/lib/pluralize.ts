/**
 * Formats `count` alongside the correctly-pluralized form of `singular`,
 * e.g. `pluralize(1, "source packet")` -> `"1 source packet"` and
 * `pluralize(3, "source packet")` -> `"3 source packets"`. Pass `plural`
 * explicitly when the default `${singular}s` suffix isn't correct.
 */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
