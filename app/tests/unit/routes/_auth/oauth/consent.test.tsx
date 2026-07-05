// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access", () => ({
  OAuthConsentPage: ({
    clientId,
    scope,
    redirectUri,
  }: {
    clientId?: string;
    scope?: string;
    redirectUri?: string;
  }) => (
    <div
      data-testid="oauth-consent"
      data-client-id={clientId ?? ""}
      data-scope={scope ?? ""}
      data-redirect-uri={redirectUri ?? ""}
    />
  ),
  oauthConsentSearchSchema: { __schema: "consent" },
}));

describe("routes/_auth/oauth/consent", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("disables SSR and registers the consent search schema", async () => {
    const routeModule = await import("@/routes/_auth/oauth/consent");
    const { oauthConsentSearchSchema } = await import("@/domains/access");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    expect(Route.options.ssr).toBe(false);
    expect(Route.options.validateSearch).toBe(oauthConsentSearchSchema);
  });

  it("forwards search params to OAuthConsentPage", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({
      client_id: "atlas-cli",
      scope: "read",
      redirect_uri: "https://app.test/callback",
    });

    const routeModule = await import("@/routes/_auth/oauth/consent");
    const Route = asRouteStub(routeModule.Route);

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    const node = view.getByTestId("oauth-consent");
    expect(node.dataset.clientId).toBe("atlas-cli");
    expect(node.dataset.scope).toBe("read");
    expect(node.dataset.redirectUri).toBe("https://app.test/callback");
  });
});
