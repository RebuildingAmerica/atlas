import { useCallback, useRef, useState } from "react";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  CallToolResult,
  Implementation,
} from "@modelcontextprotocol/sdk/types.js";

type ArgumentsRef = ReturnType<typeof useRef<Record<string, unknown>>>;

interface UseWidgetToolConnectionOptions<TData> {
  /** MCP Apps `appInfo` this widget identifies itself with when connecting. */
  appInfo: Implementation;
  /** Narrow an MCP tool's `structuredContent` payload into `TData`, or `null` if it doesn't parse. */
  parse: (structuredContent: unknown) => TData | null;
  /**
   * Short, human name for this widget used in console diagnostics only
   * (e.g. `"entity-card widget"`) — never surfaced in the UI itself.
   */
  widgetLabel: string;
  /** The presentation type's name (e.g. `"EntityCardData"`), used in the same diagnostics. */
  typeName: string;
}

interface WidgetToolConnection<TData> {
  app: App | null;
  data: TData | null;
  setData: (data: TData) => void;
  /**
   * Set when the host connection itself failed (handshake/transport error,
   * surfaced by `useApp`) — distinct from a malformed tool payload, which is
   * logged as a console warning and otherwise leaves `data` as `null`.
   */
  error: Error | null;
  /**
   * The originating tool call's complete arguments, captured from
   * `app.ontoolinput`. Only meaningful for widgets that paginate
   * (`usePaginatedWidgetData` reads it to re-invoke the tool with the same
   * filters); harmless, unread state for a widget that doesn't.
   */
  originalArgumentsRef: ArgumentsRef;
}

/**
 * Shared connection plumbing every widget hook in this package needs:
 * create and connect to the MCP Apps host via `useApp`, capture the
 * originating tool call's arguments (`app.ontoolinput`), parse and store the
 * pushed tool result (`app.ontoolresult`), log runtime protocol errors
 * (`app.onerror` — `useApp`'s own `error` only reflects the initial connect
 * handshake, so a runtime error after a successful connection would
 * otherwise be silently dropped), and keep the document theme/styles/fonts
 * in sync with the host (`useHostStyles`).
 *
 * This is the exact plumbing `useEntityCardData`, `useSearchResultsData`,
 * and `useConnectionsData` each reimplemented identically before it was
 * factored out here — every widget's hook now only supplies what's actually
 * different about it: its `appInfo`, its parse function, and (for the two
 * paginated widgets) the tool name and page-merge logic layered on top by
 * `usePaginatedWidgetData`.
 *
 * Not exported from this package's public surface (`src/index.ts`) — it's
 * an internal implementation detail shared by the per-widget hook modules
 * in this directory (`entity-card-data.ts`, `search-results-data.ts`,
 * `connections-data.ts`).
 */
export function useWidgetToolConnection<TData>({
  appInfo,
  parse,
  widgetLabel,
  typeName,
}: UseWidgetToolConnectionOptions<TData>): WidgetToolConnection<TData> {
  const [data, setData] = useState<TData | null>(null);
  const originalArgumentsRef = useRef<Record<string, unknown>>({});

  const { app, error } = useApp({
    appInfo,
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolinput = (params) => {
        originalArgumentsRef.current = params.arguments ?? {};
      };
      app.ontoolresult = (result: CallToolResult) => {
        const parsed = parse(result.structuredContent);
        if (parsed) {
          setData(parsed);
        } else {
          console.warn(
            `${widgetLabel}: received a tool result that didn't parse into ${typeName}`,
            result.structuredContent,
          );
        }
      };
      // `useApp`'s own `error` return value only reflects the initial connect
      // handshake — it never updates for protocol-level errors that happen
      // after a successful connection. Without this, such errors (the
      // Protocol base class's `onerror`, invoked for the life of the
      // connection) would be silently dropped.
      app.onerror = (error: Error) => {
        console.error(error);
      };
    },
  });

  useHostStyles(app, app?.getHostContext());

  return { app, data, setData, error, originalArgumentsRef };
}

export interface WidgetConnectionState<TData> {
  /** Parsed tool result, or `null` until the first one arrives. */
  data: TData | null;
  /**
   * Set when the host connection itself failed (handshake/transport error,
   * surfaced by `useApp`) — distinct from a malformed tool payload, which is
   * logged as a console warning and otherwise leaves `data` as `null`.
   */
  error: Error | null;
}

export interface PaginatedWidgetConnectionState<TData>
  extends WidgetConnectionState<TData> {
  /**
   * Re-invoke the paginated tool with the original call's arguments plus the
   * next page's cursor, appending the new page's rows to the existing data
   * rather than replacing it.
   *
   * A no-op while `data` is `null`, there's no further page, or a previous
   * `loadMore` call is still in flight.
   */
  loadMore: () => Promise<void>;
  /** True while a `loadMore` call is in flight. */
  isLoadingMore: boolean;
}

interface UsePaginatedWidgetDataOptions<TData>
  extends UseWidgetToolConnectionOptions<TData> {
  /** MCP tool name `loadMore` re-invokes via `app.callServerTool`. */
  toolName: string;
  /**
   * Combine a freshly fetched page into the existing data, e.g. append the
   * new page's rows:
   * `(previous, page) => ({ ...page, items: [...previous.items, ...page.items] })`.
   *
   * A plain function supplied per widget, rather than this hook assuming
   * every `TData` has an `items` array it can splice generically: `TData` is
   * a single generic type parameter here, and TypeScript can't safely infer
   * or reconstruct an array's element type through a bare `{ items:
   * readonly unknown[] }` constraint — a concrete per-widget function keeps
   * both this hook and each widget's own data type fully type-checked
   * without a cast.
   */
  appendPage: (previous: TData, page: TData) => TData;
  /** The cursor to request next, or `null` when there's no further page. */
  getNextCursor: (data: TData) => string | null;
}

/**
 * Shared pagination mechanics for every widget in this package that loads
 * more than one page: connects and parses the same way
 * `useWidgetToolConnection` does, plus a `loadMore` that re-invokes
 * `toolName` via `app.callServerTool` with the original call's arguments
 * (captured from `app.ontoolinput`) plus the next cursor, and merges the
 * result into the existing data via `appendPage`.
 *
 * This `loadMore` — the guard clause, the `setIsLoadingMore` bracketing, the
 * `callServerTool` call, and the parse-or-warn/catch-and-log handling below
 * — was identical between `useSearchResultsData` and `useConnectionsData`
 * before being factored out here; only the tool name, parse function, and
 * page-merge logic actually differed between the two.
 */
export function usePaginatedWidgetData<TData>({
  appInfo,
  parse,
  widgetLabel,
  typeName,
  toolName,
  appendPage,
  getNextCursor,
}: UsePaginatedWidgetDataOptions<TData>): PaginatedWidgetConnectionState<TData> {
  const { app, data, setData, error, originalArgumentsRef } =
    useWidgetToolConnection({ appInfo, parse, widgetLabel, typeName });
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const loadMore = useCallback(async () => {
    if (!app || data === null || isLoadingMore) {
      return;
    }
    const nextCursor = getNextCursor(data);
    if (nextCursor == null) {
      return;
    }

    setIsLoadingMore(true);
    try {
      const result = await app.callServerTool({
        name: toolName,
        arguments: {
          ...originalArgumentsRef.current,
          cursor: nextCursor,
        },
      });
      const parsed = parse(result.structuredContent);
      if (parsed) {
        // `data` was already confirmed non-null by the guard above, and
        // this callback closes over that same value rather than reading
        // React's latest state via a functional updater — there's no
        // "previous state is absent" case to defend against within a
        // single `loadMore` call.
        setData(appendPage(data, parsed));
      } else {
        console.warn(
          `${widgetLabel}: loadMore received a tool result that didn't parse into ${typeName}`,
          result.structuredContent,
        );
      }
    } catch (loadMoreError) {
      // Never surface a raw error to the UI: log it and leave the existing
      // page of results in place so a transient failure doesn't blank the
      // widget. The user can retry via the same "Load more" control.
      console.error(loadMoreError);
    } finally {
      setIsLoadingMore(false);
    }
  }, [
    app,
    data,
    isLoadingMore,
    toolName,
    appendPage,
    getNextCursor,
    parse,
    widgetLabel,
    typeName,
    originalArgumentsRef,
    setData,
  ]);

  return { data, error, loadMore, isLoadingMore };
}
