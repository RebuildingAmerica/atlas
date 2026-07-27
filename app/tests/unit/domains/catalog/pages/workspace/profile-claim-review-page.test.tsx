// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileClaimResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas";
import { ProfileClaimReviewPage } from "@/domains/catalog/pages/workspace/profile-claim-review-page";
import { renderWithProviders } from "../../../../../helpers/render-with-providers";
import { stubFetch } from "../../../../../helpers/stub-fetch";
import type { StubbedFetch, StubbedResponse } from "../../../../../helpers/stub-fetch";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("ProfileClaimReviewPage", () => {
  interface RecordedRequest {
    body: unknown;
    method: string;
    path: string;
  }

  let http: StubbedFetch;
  let routes: Map<string, StubbedResponse>;

  beforeEach(() => {
    routes = new Map<string, StubbedResponse>();
    http = stubFetch((input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const target = `${init?.method ?? "GET"} ${url.pathname}`;
      return routes.get(target) ?? { body: { detail: `unrouted ${target}` }, status: 404 };
    });
  });

  function claim(overrides: Partial<ProfileClaimResponse> = {}): ProfileClaimResponse {
    return {
      created_at: "2026-07-07T12:00:00Z",
      entry_id: "entry_1",
      entry_name: "Mississippi Rising",
      entry_slug: "mississippi-rising",
      evidence: { relationship: "communications director" },
      id: "claim_1",
      proofs: [
        {
          created_at: "2026-07-07T12:00:00Z",
          id: "proof_1",
          metadata: { domain: "mississippirising.org" },
          proof_status: "pending",
          proof_summary: "Waiting for DNS record.",
          proof_type: "domain_dns",
        },
      ],
      status: "pending",
      tier: 2,
      updated_at: "2026-07-07T12:00:00Z",
      user_email: "operator@example.org",
      user_id: "user_1",
      ...overrides,
    };
  }

  function serveQueue(claims: ProfileClaimResponse[]): void {
    routes.set("GET /api/profiles/claims/review", {
      body: { items: claims, total: claims.length },
    });
  }

  function requests(): RecordedRequest[] {
    return http.requests.map((request) => ({
      body:
        typeof request.init?.body === "string"
          ? (JSON.parse(request.init.body) as unknown)
          : undefined,
      method: request.init?.method ?? "GET",
      path: new URL(request.url).pathname,
    }));
  }

  it("holds the queue placeholder rather than claiming zero while the queue loads", () => {
    serveQueue([claim()]);

    renderWithProviders(<ProfileClaimReviewPage />);

    expect(screen.getByText("Needs source review")).toBeInTheDocument();
    expect(screen.queryByText("No verifications waiting.")).toBeNull();
    expect(screen.getByText("Not checked")).toBeInTheDocument();
  });

  it("tells a reviewer the queue is clear when nothing is waiting", async () => {
    serveQueue([]);

    renderWithProviders(<ProfileClaimReviewPage />);

    expect(await screen.findByText("No verifications waiting.")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("shows a safe message instead of an empty queue when the load fails", async () => {
    routes.set("GET /api/profiles/claims/review", { body: "upstream exploded", status: 503 });

    renderWithProviders(<ProfileClaimReviewPage />);

    expect(
      await screen.findByText("Atlas is temporarily unavailable. Please try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No verifications waiting.")).toBeNull();
  });

  it("falls back to its own wording when the failure carries no message", async () => {
    // The network layer can reject with something that is not an Error at all
    // (an aborted request in some runtimes), which `stubFetch` cannot express.
    vi.stubGlobal(
      "fetch",
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- intentionally rejecting with a non-Error value
      vi.fn(() => Promise.reject("connection reset")),
    );

    renderWithProviders(<ProfileClaimReviewPage />);

    expect(await screen.findByText("Profile verifications could not load.")).toBeInTheDocument();
  });

  it("approves a claim with the reviewer's own note", async () => {
    const user = userEvent.setup();
    serveQueue([claim()]);
    routes.set("POST /api/profiles/claims/review/claim_1/approve", { body: claim() });

    renderWithProviders(<ProfileClaimReviewPage />);
    await screen.findByText("Mississippi Rising");

    await user.type(screen.getByRole("textbox", { name: "Reviewer note" }), "  Called the org.  ");
    await user.click(screen.getByRole("button", { name: "Approve Mississippi Rising" }));

    await waitFor(() => {
      expect(requests().find((request) => request.path.endsWith("/approve"))).toEqual({
        body: { note: "Called the org." },
        method: "POST",
        path: "/api/profiles/claims/review/claim_1/approve",
      });
    });
  });

  it("records why a claim was approved even when the reviewer wrote nothing", async () => {
    const user = userEvent.setup();
    serveQueue([claim()]);
    routes.set("POST /api/profiles/claims/review/claim_1/approve", { body: claim() });

    renderWithProviders(<ProfileClaimReviewPage />);
    await screen.findByText("Mississippi Rising");

    await user.click(screen.getByRole("button", { name: "Approve Mississippi Rising" }));

    await waitFor(() => {
      expect(requests().find((request) => request.path.endsWith("/approve"))?.body).toEqual({
        note: "Reviewer approved from profile verification queue.",
      });
    });
  });

  it("records why a claim was rejected even when the reviewer wrote nothing", async () => {
    const user = userEvent.setup();
    serveQueue([claim()]);
    routes.set("POST /api/profiles/claims/review/claim_1/reject", { body: claim() });

    renderWithProviders(<ProfileClaimReviewPage />);
    await screen.findByText("Mississippi Rising");

    await user.click(screen.getByRole("button", { name: "Reject Mississippi Rising" }));

    await waitFor(() => {
      expect(requests().find((request) => request.path.endsWith("/reject"))?.body).toEqual({
        note: "Reviewer could not confirm this representative.",
      });
    });
  });

  it("carries the reviewer's note through a rejection", async () => {
    const user = userEvent.setup();
    serveQueue([claim()]);
    routes.set("POST /api/profiles/claims/review/claim_1/reject", { body: claim() });

    renderWithProviders(<ProfileClaimReviewPage />);
    await screen.findByText("Mississippi Rising");

    await user.type(
      screen.getByRole("textbox", { name: "Reviewer note" }),
      "No public evidence found.",
    );
    await user.click(screen.getByRole("button", { name: "Reject Mississippi Rising" }));

    await waitFor(() => {
      expect(requests().find((request) => request.path.endsWith("/reject"))?.body).toEqual({
        note: "No public evidence found.",
      });
    });
  });

  it.each([
    [0, "All current"],
    [1, "1 needs attention"],
    [3, "3 need attention"],
  ])("reports %i linked identities needing attention as %s", async (needsAttention, label) => {
    const user = userEvent.setup();
    serveQueue([]);
    routes.set("POST /api/profiles/claims/review/atproto/revalidate", {
      body: { checked: 9, needs_attention: needsAttention },
    });

    renderWithProviders(<ProfileClaimReviewPage />);
    await screen.findByText("No verifications waiting.");

    await user.click(screen.getByRole("button", { name: "Recheck ATProto links" }));

    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it("says it is checking while the ATProto recheck is still running", async () => {
    const user = userEvent.setup();
    serveQueue([]);
    let resolveRecheck: (value: Response) => void = () => undefined;
    const servedRoutes = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname.endsWith("/atproto/revalidate")) {
        return new Promise<Response>((resolve) => {
          resolveRecheck = resolve;
        });
      }
      return servedRoutes(input, init);
    });

    renderWithProviders(<ProfileClaimReviewPage />);
    await screen.findByText("No verifications waiting.");

    await user.click(screen.getByRole("button", { name: "Recheck ATProto links" }));

    const button = screen.getByRole("button", { name: "Recheck ATProto links" });
    expect(button).toHaveTextContent("Checking");
    expect(button).toBeDisabled();

    resolveRecheck({
      json: () => Promise.resolve({ checked: 1, needs_attention: 0 }),
      ok: true,
      status: 200,
    } as unknown as Response);
    expect(await screen.findByText("All current")).toBeInTheDocument();
  });

  it("reads a claim with nothing attached without inventing detail", async () => {
    serveQueue([claim({ entry_slug: null, evidence: null, id: "claim_bare", proofs: undefined })]);

    renderWithProviders(<ProfileClaimReviewPage />);

    const card = (await screen.findByText("Mississippi Rising")).closest("article");
    if (!card) {
      throw new TypeError("Expected a review card for the claim.");
    }
    expect(within(card).getByText("No note provided.")).toBeInTheDocument();
    expect(within(card).getByText("No verification sources attached.")).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: /Open verification/ })).toBeNull();
  });
});
