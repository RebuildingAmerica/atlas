/**
 * Shape captured from a thrown router redirect inside route-loader tests.
 * The mocked `redirect()` helper attaches the production options on the error
 * so tests can read them without depending on internal router types.
 */
export interface CapturedRouterRedirect {
  isRedirect: boolean;
  options: {
    to?: string;
    href?: string;
    params?: Record<string, string>;
    search?: Record<string, unknown>;
    statusCode?: number;
  };
}

/**
 * Awaits a function that is expected to throw a router redirect and returns
 * the captured redirect descriptor.  Throws if the function resolves without
 * throwing.
 *
 * @param run - The loader invocation expected to throw a redirect.
 */
export async function captureRouterRedirect(run: () => unknown): Promise<CapturedRouterRedirect> {
  try {
    await run();
  } catch (error) {
    return error as CapturedRouterRedirect;
  }
  throw new Error("Expected the loader to throw a router redirect.");
}
