import type { ReactNode } from "react";

export interface WidgetConnectionState<T> {
  /** Parsed tool result, or `null` until the first one arrives. */
  data: T | null;
  /** Set when the host connection itself failed (see `useWidgetToolConnection`). */
  error: Error | null;
}

export interface WidgetStatusProps<T> {
  state: WidgetConnectionState<T>;
  /** Safe, generic copy shown when `state.error` is set — never the raw error. */
  errorMessage: string;
  /**
   * Rendered once `state.data` is present, receiving the narrowed
   * non-`null` data. Widgets whose connection hook returns extra fields
   * (e.g. `loadMore`/`isLoadingMore` for the paginated widgets) read them
   * from their own `state` variable via closure at the call site — this
   * component only needs to know about `data`/`error`.
   */
  children: (data: T) => ReactNode;
}

/**
 * Shared error/loading/ready branching for a widget's mount entry point.
 * Every widget's connection hook (`useEntityCardData`, `useSearchResultsData`,
 * `useConnectionsData`) returns a `{ data, error, ... }` shape; this factors
 * out the three-way branch — log the real error and show a safe generic
 * message, or show a loading placeholder, or render — that would otherwise
 * be duplicated verbatim across each `*.entry.tsx` file.
 */
export function WidgetStatus<T>({
  state,
  errorMessage,
  children,
}: WidgetStatusProps<T>): ReactNode {
  if (state.error) {
    // Never surface `error.message`/details in the UI — log the real error
    // for diagnostics and show a safe, generic message instead.
    console.error(state.error);
    return <p className="text-ew-ink-soft p-4 text-sm">{errorMessage}</p>;
  }
  if (!state.data) {
    return <p className="text-ew-ink-soft p-4 text-sm">Loading…</p>;
  }
  return children(state.data);
}
