/**
 * Turns a TanStack route id into a regex its concrete URLs match.
 *
 * `/profiles/people/$slug` becomes `^/profiles/people/[^/]+$`, so the manifest test can prove
 * each declared path really belongs to the route it claims. Index routes carry a trailing
 * slash in the generated tree but are requested without one, so that slash is dropped.
 *
 * @param routeId - A full path from `routeTree.gen.ts`.
 * @returns A regex matching concrete URLs for that route.
 */
export function routeIdToPattern(routeId: string): RegExp {
  const source = routeId
    .split("/")
    .map((segment) =>
      segment.startsWith("$") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/")
    .replace(/(.)\/$/, "$1");
  return new RegExp(`^${source}$`);
}
