import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

/**
 * Registers visitor identity for server-side Atlas API calls before any loader runs.
 *
 * Every server render and server function passes through request middleware
 * first, so the first API call of a cold server already carries the visitor's
 * identity. The module is imported lazily to keep server-only code out of the
 * browser bundle.
 */
const identifyVisitorToAtlasApi = createMiddleware().server(async ({ next }) => {
  const { registerApiRequestIdentity } =
    await import("@/domains/access/server/api-request-identity");
  registerApiRequestIdentity();
  return next();
});

/** Limits CSRF checks to server functions, as TanStack Start's default middleware does. */
export function isServerFunctionRequest(ctx: { handlerType: string }): boolean {
  return ctx.handlerType === "serverFn";
}

export const startInstance = createStart(() => ({
  // Declaring request middleware replaces TanStack Start's default list, which
  // holds only CSRF protection for server functions, so it is restated here.
  requestMiddleware: [
    createCsrfMiddleware({ filter: isServerFunctionRequest }),
    identifyVisitorToAtlasApi,
  ],
}));
