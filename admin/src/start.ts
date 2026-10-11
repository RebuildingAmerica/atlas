import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Every request — page, server function or asset — passes the admin's own
 * Access check before anything else runs. The gate module is imported lazily
 * so no server code reaches the browser bundle.
 */
export const accessGate = createMiddleware().server(async ({ next }) => {
  const { applyPageHeaders, gateRequest } = await import("@/server/gate");
  const { loadAdminRuntime } = await import("@/server/admin-runtime");
  const refusal = await gateRequest(getRequest(), loadAdminRuntime());
  if (refusal) return refusal;
  const result = await next();
  applyPageHeaders(result.response.headers);
  return result;
});

interface MiddlewareFilterContext {
  handlerType: string;
}

/** Limits CSRF checks to server functions, as TanStack Start's default middleware does. */
export function isServerFunctionRequest(ctx: MiddlewareFilterContext): boolean {
  return ctx.handlerType === "serverFn";
}

export const startInstance = createStart(() => ({
  // Declaring request middleware replaces TanStack Start's default list, which
  // holds only CSRF protection for server functions, so it is restated here.
  requestMiddleware: [
    accessGate,
    createCsrfMiddleware({ filter: isServerFunctionRequest }),
  ],
}));
