import { vi } from "vitest";

/**
 * Shared dependency mocks for the sign-in page unit tests.
 */
export const signInPageDependencyMocks = {
  getAuthClient: vi.fn(),
  getAuthConfig: vi.fn(),
  requestMagicLink: vi.fn(),
  resolveWorkspaceSSOSignIn: vi.fn(),
  setLastUsedAtlasLoginMethod: vi.fn(),
  waitForAtlasAuthenticatedSession: vi.fn(),
} as const;
