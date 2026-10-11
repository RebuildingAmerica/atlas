export function baseRuntimeConfig(overrides: Record<string, unknown> = {}) {
  return {
    anonymousRateLimit: {
      enabled: true,
      readsPerMinute: 30,
      totalPerHour: 120,
      trustedProxyHops: 1,
      writesPerMinute: 10,
    },
    apiBaseUrl: "https://api.atlas.test",
    edgeOriginSecret: "edge-test-secret",
    internalSecret: "internal-test-secret",
    localMode: false,
    ...overrides,
  };
}

export function makeAuthenticatedSession() {
  return {
    accountReady: true,
    user: {
      email: "operator@atlas.test",
      id: "user-123",
    },
    workspace: {
      activeOrganization: {
        id: "org-456",
      },
    },
  };
}

export function makeAppActorHeaders() {
  return {
    "X-Atlas-Actor-Assertion": "signed.app.assertion",
  };
}
