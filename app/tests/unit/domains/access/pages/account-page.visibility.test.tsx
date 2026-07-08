// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  accountPageMocks as mocks,
  setQueryResults,
} from "../../../../helpers/access/account-page-test-bed";
import {
  createAtlasSessionFixture,
  createAtlasWorkspace,
} from "../../../../fixtures/access/sessions";

describe("AccountPage", () => {
  it("renders gracefully when the session data is unavailable", async () => {
    mocks.useAtlasSession.mockReturnValue({ data: undefined });
    setQueryResults({ apiKeys: [], passkeys: [], scoutDevices: [] });
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);
    expect(screen.getByRole("heading", { name: "Account" })).not.toBeNull();
  });

  it("hides the API-key panel when capabilities omit api.keys", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: createAtlasSessionFixture({
        workspace: createAtlasWorkspace({
          resolvedCapabilities: {
            capabilities: ["research.run"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 0,
              api_requests_per_day: 0,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
        }),
      }),
    });
    setQueryResults({ apiKeys: [], passkeys: [], scoutDevices: [] });
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);
    expect(screen.queryByLabelText("Key name")).toBeNull();
    expect(screen.queryByText("Create an API key")).toBeNull();
  });

  it("hides security, developer access, and billing when running in local mode", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: createAtlasSessionFixture({
        isLocal: true,
        workspace: createAtlasWorkspace({
          resolvedCapabilities: {
            capabilities: ["research.run", "api.keys", "api.mcp"],
            limits: {
              research_runs_per_month: 2,
              max_shortlists: 1,
              max_shortlist_entries: 25,
              max_api_keys: 1,
              api_requests_per_day: 1000,
              public_api_requests_per_hour: 100,
              max_members: 1,
            },
          },
        }),
      }),
    });
    setQueryResults({ apiKeys: [], passkeys: [] });
    const { AccountPage } = await import("@/domains/access/pages/workspace/account-page");

    render(<AccountPage />);
    expect(screen.queryByText("Billing")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Developer" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Scout" })).toBeNull();
    expect(screen.queryByLabelText("Key name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add passkey" })).toBeNull();
  });
});
