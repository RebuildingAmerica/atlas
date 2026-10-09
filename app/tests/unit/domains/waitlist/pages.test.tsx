// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WaitlistPage } from "@/domains/waitlist/pages/waitlist-page";
import { createAtlasSessionFixture } from "../../../fixtures/access/sessions";
import type { WaitlistRequest } from "@/domains/waitlist/contracts";
import { WaitlistRequestPanel } from "@/domains/waitlist/pages/waitlist-request-panel";
import { WaitlistRequestPage, WaitlistLinkPage } from "@/domains/waitlist/pages/waitlist-link-page";
const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  link: vi.fn(),
  confirm: vi.fn(),
  session: vi.fn(),
  access: vi.fn(),
  update: vi.fn(),
  change: vi.fn(),
  request: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string;
    children: React.ReactNode;
    search?: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/domains/access/client/use-atlas-session", () => ({
  useAtlasSession: mocks.session,
}));
vi.mock("@/domains/waitlist/waitlist.functions", () => ({
  submitWaitlist: mocks.submit,
  loadWaitlistLink: mocks.link,
  confirmWaitlist: mocks.confirm,
  loadPaidAccess: mocks.access,
  updateWaitlistRequest: mocks.update,
  changeWaitlistRequest: mocks.change,
  loadWaitlistRequest: mocks.request,
}));
vi.mock("@/domains/access/client/sign-out", () => ({ signOutWithRedirect: mocks.signOut }));
describe("waitlist screens", () => {
  beforeEach(() => {
    mocks.session.mockReturnValue({ data: null });
    mocks.access.mockResolvedValue({ mode: "waitlist", admittedProducts: [], requests: [] });
  });
  function mount(content: React.ReactNode) {
    return render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        {content}
      </QueryClientProvider>,
    );
  }
  const request = {
    id: "request",
    email: "person@example.org",
    product: "atlas_pro" as const,
    interval: "monthly",
    status: "unconfirmed" as const,
    name: "",
    organization: "",
    intendedUse: "",
    createdAt: "2026-10-08T12:00:00Z",
    confirmedAt: null,
    invitedAt: null,
    purchasedAt: null,
  };

  it("joins without an account and preserves the selected plan", async () => {
    mocks.submit.mockResolvedValue({ status: "confirmation_pending" });
    mount(<WaitlistPage product="atlas_team" interval="yearly" />);
    await userEvent.type(screen.getByLabelText("Email"), "person@example.org");
    await userEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Check your email" })).toHaveFocus();
    expect(screen.getByText("person@example.org")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Browse Atlas" })).not.toBeInTheDocument();
  });
  it("retains entered values when sending fails", async () => {
    mocks.submit.mockRejectedValue(new Error("offline"));
    mount(<WaitlistPage product="atlas_pro" />);
    await userEvent.type(screen.getByLabelText("Email"), "person@example.org");
    await userEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not");
    expect(screen.getByLabelText("Email")).toHaveValue("person@example.org");
  });
  it("does not confirm from opening an email link", async () => {
    mocks.link.mockResolvedValue(request);
    mocks.confirm.mockResolvedValue({
      ...request,
      status: "waiting",
      confirmedAt: "2026-10-08T12:01:00Z",
    });
    mount(<WaitlistLinkPage token="test-token" kind="confirm" />);
    await screen.findByRole("button", { name: "Confirm email" });
    expect(mocks.confirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm email" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "You’re on the waitlist" })).toHaveFocus(),
    );
  });
  it("retries a temporary link failure without calling the invitation expired", async () => {
    mocks.link
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ...request, status: "invited", confirmedAt: "2026-10-09" });
    mount(<WaitlistLinkPage token="valid-token" kind="invite" />);
    expect(
      await screen.findByRole("heading", { name: "This request could not be opened" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "This link no longer works" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "You’re invited to Atlas Pro" }),
    ).toHaveFocus();
  });
  it("offers a fresh email link when a link is expired", async () => {
    mocks.link.mockResolvedValue(null);
    mount(<WaitlistLinkPage token="expired" kind="invite" />);
    expect(await screen.findByRole("link", { name: "Get a new link" })).toHaveAttribute(
      "href",
      "/waitlist",
    );
  });
  it("keeps optional context, plan changes and email recovery together", async () => {
    mocks.submit.mockResolvedValue({ status: "confirmation_pending" });
    mocks.access.mockResolvedValue({
      mode: "waitlist",
      admittedProducts: [],
      requests: [
        { ...request, status: "waiting" },
        { ...request, id: "team", product: "atlas_team", status: "invited" },
      ],
    });
    const view = mount(<WaitlistPage />);
    await screen.findByRole("region", { name: "Your requests" });
    const form = view.container.querySelector("form");
    if (!form) throw new Error("Expected signup form");
    fireEvent.submit(form);
    expect(mocks.submit).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Email"), "person@example.org");
    await userEvent.selectOptions(screen.getByLabelText("Plan"), "atlas_team");
    await userEvent.click(screen.getByText("About you (optional)"));
    await userEvent.type(screen.getByLabelText("Name"), "Reporter");
    await userEvent.type(screen.getByLabelText("Organization"), "Newsroom");
    await userEvent.type(screen.getByLabelText("What would you use Atlas for?"), "Reporting");
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "honeypot" } });
    await userEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
    await screen.findByRole("heading", { name: "Check your email" });
    expect(mocks.submit.mock.calls[0]?.[0]).toMatchObject({
      data: { name: "Reporter", product: "atlas_team", intendedUse: "Reporting" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect(screen.getByLabelText("Email", { exact: true })).toHaveFocus();
    expect(screen.getByLabelText("Email")).toHaveValue("person@example.org");
  });
  it("allows resending after the cooldown", async () => {
    mocks.submit.mockResolvedValue({ status: "confirmation_pending" });
    const realTimeout = window.setTimeout;
    let finishCooldown: (() => void) | undefined;
    vi.spyOn(window, "setTimeout").mockImplementation((handler, delay) => {
      if (delay === 60_000 && typeof handler === "function") {
        finishCooldown = handler as () => void;
        return realTimeout(() => undefined, 0) as unknown as ReturnType<typeof window.setTimeout>;
      }
      return realTimeout(handler, delay) as unknown as ReturnType<typeof window.setTimeout>;
    });
    mount(<WaitlistPage product="atlas_pro" />);
    await userEvent.type(screen.getByLabelText("Email"), "person@example.org");
    await userEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
    await screen.findByRole("heading", { name: "Check your email" });
    expect(screen.getByRole("button", { name: "Resend email" })).toBeDisabled();
    act(() => {
      finishCooldown?.();
    });
    await userEvent.click(screen.getByRole("button", { name: "Resend email" }));
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
  it("keeps a repeated temporary failure focused and retryable", async () => {
    mocks.link.mockRejectedValue(new Error("offline"));
    mount(<WaitlistLinkPage token="retry-failed" kind="invite" />);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "This request could not be opened" }),
    ).toHaveFocus();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });
  it.each([
    ["unconfirmed", "Confirm your email"],
    ["unavailable", "This link no longer works"],
  ] as const)("focuses the %s result after a successful retry", async (result, heading) => {
    mocks.link
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(result === "unavailable" ? null : request);
    mount(<WaitlistLinkPage token="retry-confirm" kind="confirm" />);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: heading })).toHaveFocus();
  });
  it("keeps a failed confirmation actionable", async () => {
    mocks.link.mockResolvedValue(request);
    mocks.confirm.mockRejectedValue(new Error("offline"));
    mount(<WaitlistLinkPage token="test" kind="confirm" />);
    await userEvent.click(await screen.findByRole("button", { name: "Confirm email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be confirmed");
  });
  it("loads a signed-in request and offers email recovery when access fails", async () => {
    mocks.request.mockResolvedValueOnce({ ...request, status: "waiting" });
    const view = mount(<WaitlistRequestPage id="request" />);
    expect(await screen.findByRole("heading", { name: "You’re on the waitlist" })).toBeVisible();
    view.unmount();
    mocks.request.mockRejectedValue(new Error("unavailable"));
    mount(<WaitlistRequestPage id="other" />);
    expect(
      await screen.findByRole("heading", { name: "This request could not be opened" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Get a new link" })).toBeVisible();
  });
  it.each([null, "2026-10-09"])(
    "offers the correct private invitation action after purchase %s",
    async (purchasedAt) => {
      mocks.session.mockReturnValue({
        data: createAtlasSessionFixture({ user: { email: request.email } }),
      });
      mocks.request.mockResolvedValue({
        ...request,
        status: "invited",
        confirmedAt: "2026-10-08",
        purchasedAt,
      });
      mount(<WaitlistRequestPage id="private-invitation" />);
      expect(
        await screen.findByRole("link", {
          name: purchasedAt ? "Open your account" : "Continue",
        }),
      ).toBeVisible();
      expect(
        screen.queryByRole("link", {
          name: purchasedAt ? "Continue" : "Open your account",
        }),
      ).not.toBeInTheDocument();
    },
  );
  it("retries a private request without losing keyboard focus", async () => {
    mocks.request
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ...request, status: "waiting", confirmedAt: "2026-10-09" });
    mount(<WaitlistRequestPage id="retry-private" />);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "You’re on the waitlist" })).toHaveFocus();
  });
  it("edits details, reports a failure, withdraws with confirmation, and rejoins", async () => {
    const waiting: WaitlistRequest = { ...request, status: "waiting", confirmedAt: "2026-10-08" };
    mocks.update
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ...waiting, name: "New" });
    mocks.change
      .mockResolvedValueOnce({ ...waiting, status: "withdrawn" })
      .mockResolvedValueOnce(waiting);
    mount(<WaitlistRequestPanel initialRequest={waiting} token="private" kind="manage" />);
    await userEvent.click(screen.getByRole("button", { name: "Edit details" }));
    await userEvent.type(screen.getByLabelText("Name"), "New");
    await userEvent.type(screen.getByLabelText("Organization"), "Org");
    await userEvent.type(screen.getByLabelText("What would you use Atlas for?"), "Research");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be updated");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByText("Details saved.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit details" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByLabelText("Name")).toHaveValue("New");
    await userEvent.click(screen.getByRole("button", { name: "Leave waitlist" }));
    await userEvent.click(screen.getByRole("button", { name: "Stay on waitlist" }));
    await userEvent.click(screen.getByRole("button", { name: "Leave waitlist" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, leave waitlist" }));
    expect(await screen.findByRole("heading", { name: "You’ve left the waitlist" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Rejoin waitlist" }));
    expect(await screen.findByRole("heading", { name: "You’re on the waitlist" })).toHaveFocus();
  });
  it.each(["atlas_pro", "atlas_team", "atlas_research_pass"] as const)(
    "offers the approved %s intervals to the matching verified account",
    async (product) => {
      mocks.session.mockReturnValue({
        data: createAtlasSessionFixture({ user: { email: request.email } }),
      });
      const view = mount(
        <WaitlistRequestPanel
          initialRequest={{
            ...request,
            interval: product === "atlas_pro" ? "monthly" : null,
            product,
            status: "invited",
          }}
        />,
      );
      await userEvent.click(
        screen.getByRole("radio", {
          name: product === "atlas_research_pass" ? "30 days" : "Annual",
        }),
      );
      expect(
        screen.getByRole("radio", {
          name: product === "atlas_research_pass" ? "30 days" : "Annual",
        }),
      ).toBeChecked();
      expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/onboarding");
      view.unmount();
    },
  );
  it("explains the subscription before continuing and reveals student pricing on request", async () => {
    mocks.session.mockReturnValue({
      data: createAtlasSessionFixture({ user: { email: request.email } }),
    });
    mount(
      <WaitlistRequestPanel
        initialRequest={{ ...request, status: "invited", confirmedAt: "2026-10-09" }}
      />,
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Monthly" })).toBeChecked();
    expect(screen.getByRole("region", { name: "Payment summary" })).toHaveTextContent(
      "$5 per month",
    );
    expect(screen.getByRole("region", { name: "Payment summary" })).toHaveTextContent(
      "Renews monthly until canceled",
    );
    await userEvent.click(screen.getByRole("radio", { name: "Annual" }));
    expect(screen.getByRole("region", { name: "Payment summary" })).toHaveTextContent(
      "$48 per year",
    );
    expect(screen.getByRole("region", { name: "Payment summary" })).toHaveTextContent(
      "Renews annually until canceled",
    );
    expect(
      screen.getByText("Next, choose your workspace. You’ll review the total before paying."),
    ).toBeVisible();
    const tools = screen.getByText(/API access with 1,000 requests per day/);
    expect(tools).not.toBeVisible();
    await userEvent.click(screen.getByText("Connected tools"));
    expect(tools).toBeVisible();
    await userEvent.click(screen.getByText("Student pricing"));
    await userEvent.click(screen.getByRole("radio", { name: "Student" }));
    expect(screen.getByRole("region", { name: "Payment summary" })).toHaveTextContent(
      "Student verification is required",
    );
  });
  it("offers a new account to anonymous invitees and a switch action for the wrong account", async () => {
    const invited: WaitlistRequest = { ...request, status: "invited", interval: "invalid" };
    const view = mount(<WaitlistRequestPanel initialRequest={invited} />);
    expect(screen.getByRole("link", { name: "Create a free account" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Monthly" })).toBeChecked();
    expect(screen.getByRole("region", { name: "Payment summary" })).toHaveTextContent(
      "$5 per month",
    );
    view.unmount();
    mocks.session.mockReturnValue({
      data: createAtlasSessionFixture({ user: { email: "wrong@example.org" } }),
    });
    mocks.signOut.mockImplementation(({ onError }: { onError: () => void }) => {
      onError();
      return Promise.resolve();
    });
    mount(<WaitlistRequestPanel initialRequest={invited} />);
    expect(screen.queryByRole("link", { name: "Create a free account" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Switch account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign out failed");
  });
  it("distinguishes purchased access from a revoked invitation", () => {
    const view = mount(
      <WaitlistRequestPanel
        initialRequest={{ ...request, status: "invited", purchasedAt: "2026-10-09" }}
      />,
    );
    expect(screen.getByRole("heading", { name: "You’re all set" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open your account" })).toBeVisible();
    view.unmount();
    mount(
      <WaitlistRequestPanel
        initialRequest={{ ...request, status: "revoked", purchasedAt: "2026-10-09" }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "This invitation has been withdrawn" }),
    ).toBeVisible();
  });

  it("removes signup permission after a refreshed request is revoked", async () => {
    mocks.link.mockResolvedValue({ ...request, status: "invited" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <WaitlistLinkPage token="fresh" kind="invite" />
      </QueryClientProvider>,
    );
    await screen.findByRole("heading", { name: "You’re invited to Atlas Pro" });
    act(() => {
      client.setQueryData(["waitlist", "link", "fresh", "invite"], {
        ...request,
        status: "revoked",
      });
    });
    expect(
      await screen.findByRole("heading", { name: "This invitation has been withdrawn" }),
    ).toBeVisible();
  });
  it("shows an unconfirmed private request honestly and allows explicit confirmation", async () => {
    mocks.session.mockReturnValue({
      data: createAtlasSessionFixture({ user: { email: request.email } }),
    });
    mocks.change.mockResolvedValue({ ...request, status: "waiting", confirmedAt: "2026-10-09" });
    mount(<WaitlistRequestPanel initialRequest={request} />);
    expect(screen.queryByText(/Your request.*is confirmed/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm request" }));
    expect(await screen.findByRole("heading", { name: "You’re on the waitlist" })).toBeVisible();
  });
  it("gives invitees a direct path to checkout without request-management controls", () => {
    mocks.session.mockReturnValue({
      data: createAtlasSessionFixture({ user: { email: request.email } }),
    });
    mount(
      <WaitlistRequestPanel
        initialRequest={{ ...request, status: "invited", confirmedAt: "2026-10-09" }}
      />,
    );
    expect(screen.getByRole("link", { name: "Continue" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Signup progress" })).not.toBeInTheDocument();
    expect(screen.queryByText(request.email)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decline invitation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage invitation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Browse Atlas" })).not.toBeInTheDocument();
  });
});
