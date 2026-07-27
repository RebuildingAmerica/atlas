import { vi } from "vitest";

/** The endpoint result shape the stubbed `ctx.json` produces. */
export interface EndpointJsonResult {
  data: unknown;
  init: { status: number };
}

/** The ATProto sign-in endpoint as the stubbed `createAuthEndpoint` returns it. */
export type AtprotoSignInHandler = (ctx: AtprotoSignInContext) => Promise<EndpointJsonResult>;

export interface AtprotoSignInContext {
  body: { userId: string };
  context: {
    adapter: { findMany: ReturnType<typeof vi.fn> };
    internalAdapter: {
      createSession: ReturnType<typeof vi.fn>;
      findUserById: ReturnType<typeof vi.fn>;
    };
  };
  error: (code: string, init: { message: string }) => Error;
  json: (data: unknown, init: { status: number }) => EndpointJsonResult;
  request?: Request;
}

export interface AtprotoSignInContextOptions {
  /** Passkey rows the adapter reports for the user. */
  passkeys?: unknown[];
  /** Present when the call arrived over HTTP rather than through `auth.api`. */
  request?: Request;
  /** Session the internal adapter mints, or null when creation fails. */
  session?: { id: string } | null;
  /** The stored user, or null when no such account exists. */
  user?: { emailVerified: boolean; id: string } | null;
}

/**
 * Builds the endpoint context the ATProto sign-in handler reads from.
 *
 * @param userId - The user id the caller claims control of.
 * @param options - Stored state the handler should observe.
 */
export function buildAtprotoSignInContext(
  userId: string,
  options: AtprotoSignInContextOptions = {},
): AtprotoSignInContext {
  return {
    body: { userId },
    context: {
      adapter: {
        findMany: vi.fn().mockResolvedValue(options.passkeys ?? [{ id: "passkey_1" }]),
      },
      internalAdapter: {
        createSession: vi
          .fn()
          .mockResolvedValue(options.session === undefined ? { id: "session_1" } : options.session),
        findUserById: vi
          .fn()
          .mockResolvedValue(
            options.user === undefined ? { emailVerified: true, id: userId } : options.user,
          ),
      },
    },
    error: (code, init) => new Error(`${code}: ${init.message}`),
    json: (data, init) => ({ data, init }),
    request: options.request,
  };
}

interface PluginWithAtprotoEndpoint {
  endpoints: { completeAtprotoSignIn: AtprotoSignInHandler };
  id: string;
}

/**
 * Picks the Atlas ATProto sign-in plugin out of a Better Auth plugin list.
 *
 * @param plugins - The plugin array Atlas passed to `betterAuth`.
 */
export function findAtprotoSignInHandler(
  plugins: readonly unknown[] | undefined,
): AtprotoSignInHandler {
  if (!plugins) {
    throw new TypeError("Expected Better Auth to be configured with plugins.");
  }

  const plugin = plugins.find(
    (candidate): candidate is PluginWithAtprotoEndpoint =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { id?: unknown }).id === "atlas-atproto-sign-in",
  );
  if (!plugin) {
    throw new TypeError("Expected the Atlas ATProto sign-in plugin to be registered.");
  }
  return plugin.endpoints.completeAtprotoSignIn;
}
