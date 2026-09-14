import { isNotFound, isRedirect } from "@tanstack/react-router";

/**
 * Runs a public route's data call without letting its failure take over the page.
 *
 * A loader that throws replaces the whole page with an error state. Public
 * pages must degrade instead: the route renders its full layout, the section
 * that needed this data shows a loading placeholder, and the page's React
 * Query hook fetches it again in the browser. A missing record and a redirect
 * are answers rather than failures, so they still propagate.
 *
 * @param load - The loader's data call.
 * @returns The data, or `undefined` when the call failed for any other reason.
 */
export async function loadOrDegrade<T>(load: () => Promise<T>): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    if (isNotFound(error) || isRedirect(error)) {
      throw error;
    }
    return undefined;
  }
}
