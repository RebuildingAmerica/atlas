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
    internalSecret: "internal-test-secret",
    localMode: false,
    ...overrides,
  };
}

export function makeAuthenticatedSession() {
  return {
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

export function makeInternalAuthHeaders() {
  return {
    "X-Atlas-Actor-Email": "operator@atlas.test",
    "X-Atlas-Actor-Id": "user-123",
    "X-Atlas-Internal-Secret": "internal-test-secret",
    "X-Atlas-Organization-Id": "org-456",
  };
}
