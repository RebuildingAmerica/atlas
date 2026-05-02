// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OAuthClientSummary } from "@/domains/access/pages/auth/components/oauth-client-summary";

afterEach(() => {
  cleanup();
});

describe("OAuthClientSummary", () => {
  it("renders the icon, name, uri, and redirect host when client info is fully populated", () => {
    render(
      <OAuthClientSummary
        clientId="client_1"
        clientInfo={{
          name: "Third Party",
          icon: "https://example/icon.png",
          uri: "https://app.test",
        }}
        redirectHostname="app.test"
      />,
    );

    expect(screen.getAllByText("Third Party").length).toBeGreaterThan(0);
    expect(screen.getByText("https://app.test")).not.toBeNull();
    expect(screen.getByText("app.test")).not.toBeNull();
  });

  it("falls back to the initial avatar and 'Unknown app' label when client info is missing", () => {
    render(<OAuthClientSummary clientId="client_2" clientInfo={null} redirectHostname={null} />);

    expect(screen.getAllByText("Unknown app").length).toBeGreaterThan(0);
    // The avatar fallback uses the first letter of the name in uppercase.
    expect(screen.getByText("U")).not.toBeNull();
  });

  it("surfaces the CIMD client-document line when the client id looks like a URL", () => {
    render(
      <OAuthClientSummary
        clientId="https://atlas.example/.well-known/oauth-client"
        clientInfo={{ name: "CIMD App" }}
        redirectHostname={null}
      />,
    );

    expect(
      screen.getByText(/Client ID document: https:\/\/atlas.example\/.well-known\/oauth-client/),
    ).not.toBeNull();
  });
});
