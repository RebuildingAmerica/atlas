import type { ReactNode } from "react";

export interface PaginatedListShellProps<T> {
  items: readonly T[];
  total: number;
  nextCursor: string | null;
  /**
   * Fetch and append the next page. The button's `onClick` wraps the call
   * in `void` rather than passing it directly, so a rejected promise can
   * never surface as an unhandled rejection from a native DOM event handler.
   */
  onLoadMore: () => Promise<void>;
  isLoadingMore: boolean;
  emptyMessage: string;
  itemKey: (item: T) => string;
  children: (item: T) => ReactNode;
}

/**
 * Shared "count + rows + load more" shell for the two paginated MCP Apps
 * widgets (`SearchResultsList`, `ConnectionsGraph`): a "Showing N of TOTAL"
 * line, the row list itself (or an empty-state message), and a "Load more"
 * button when `nextCursor` isn't null. Each widget supplies only what
 * differs — its own row content (via `children`) and empty-state copy.
 *
 * Row content should NOT render its own `<li>`/border/padding — this shell
 * owns the list-item wrapper so both widgets get identical spacing/dividers
 * without duplicating those classes.
 *
 * Uses CSS container queries (`@container`), not viewport media queries, so
 * it reflows correctly whether it's rendered in a narrow chat sidebar or at
 * full width — same responsiveness convention as `EntityCard`.
 */
export function PaginatedListShell<T>({
  items,
  total,
  nextCursor,
  onLoadMore,
  isLoadingMore,
  emptyMessage,
  itemKey,
  children,
}: PaginatedListShellProps<T>) {
  return (
    <div className="@container">
      <div className="bg-ew-surface border-ew-border flex flex-col gap-3 rounded-2xl border p-4">
        <p className="text-ew-ink-soft text-xs font-medium">
          Showing {items.length} of {total}
        </p>

        {items.length > 0 ? (
          <ul className="flex flex-col">
            {items.map((item) => (
              <li
                key={itemKey(item)}
                className="border-ew-border border-b py-3 last:border-b-0"
              >
                {children(item)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ew-ink text-sm">{emptyMessage}</p>
        )}

        {nextCursor !== null ? (
          <button
            type="button"
            onClick={() => {
              void onLoadMore();
            }}
            disabled={isLoadingMore}
            className="bg-ew-muted text-ew-muted-ink self-start rounded-full px-3 py-1.5 text-sm font-medium disabled:opacity-60"
          >
            {isLoadingMore ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
