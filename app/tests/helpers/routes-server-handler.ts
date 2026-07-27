import { asRouteStub } from "./router-harness";

/**
 * Invokes a route's server-side `GET` handler the way the server runtime does.
 *
 * Every `src/routes/api/**` suite otherwise repeats the same six lines of
 * reaching into `Route.options.server.handlers` and narrowing the result.
 *
 * @param route - The `Route` exported by the route module under test.
 * @param request - The incoming request; omit for handlers that ignore it.
 * @returns The response the handler produced.
 */
export async function callRouteGet(route: unknown, request?: Request): Promise<Response> {
  const handlers = asRouteStub(route).options.server?.handlers;
  if (!handlers?.GET) throw new Error("Expected a GET handler");
  return (await handlers.GET(request === undefined ? {} : { request })) as Response;
}
