/**
 * Runs a TanStack Start request middleware's server function directly, the
 * way the runtime calls it, with `next` standing in for the rest of the request.
 */

export interface MiddlewareResult {
  response: Response;
}

interface NextOptions {
  next: () => Promise<MiddlewareResult>;
}

type ServerFn = (options: NextOptions) => Promise<MiddlewareResult | Response>;

interface RequestMiddleware {
  options: { server?: unknown };
}

export function runServerMiddleware(
  middleware: RequestMiddleware,
  next: () => Promise<MiddlewareResult>,
): Promise<MiddlewareResult | Response> {
  const server = middleware.options.server as ServerFn;
  return server({ next });
}
