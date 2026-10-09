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
    expect(screen.getByText("person@example.org")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse Atlas" })).toHaveAttribute("href", "/browse");
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
      expect(screen.getByRole("heading", { name: "You’re on the waitlist" })).toBeInTheDocument(),
    );
  });
  it("offers a fresh email link when a link is expired", async () => {
    mocks.link.mockRejectedValue(new Error("expired"));
    mount(<WaitlistLinkPage token="expired" kind="invite" />);
    expect(await screen.findByRole("link", { name: "Request a new email link" })).toHaveAttribute(
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
    await userEvent.click(screen.getByText("Add context (optional)"));
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
    expect(await screen.findByRole("heading", { name: "Link unavailable" })).toBeVisible();
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
    await userEvent.click(screen.getByText("Your details"));
    await userEvent.type(screen.getByLabelText("Name"), "New");
    await userEvent.type(screen.getByLabelText("Organization"), "Org");
    await userEvent.type(screen.getByLabelText("Intended use"), "Research");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be updated");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByText("Details saved.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep request" }));
    await userEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    await userEvent.click(screen.getByRole("button", { name: "Leave waitlist" }));
    await screen.findByRole("heading", { name: "You’ve left the waitlist" });
    await userEvent.click(screen.getByRole("button", { name: "Rejoin waitlist" }));
    expect(await screen.findByRole("heading", { name: "You’re on the waitlist" })).toBeVisible();
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
      await userEvent.selectOptions(
        screen.getByLabelText("Billing interval"),
        product === "atlas_research_pass" ? "once" : "yearly",
      );
      expect(screen.getByRole("link", { name: "Continue to signup and payment" })).toHaveAttribute(
        "href",
        "/onboarding",
      );
      view.unmount();
    },
  );
  it("offers a new account to anonymous invitees and a switch action for the wrong account", async () => {
    const invited: WaitlistRequest = { ...request, status: "invited", interval: "invalid" };
    const view = mount(<WaitlistRequestPanel initialRequest={invited} />);
    expect(screen.getByRole("link", { name: "Create a free account" })).toBeVisible();
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
    expect(screen.getByRole("heading", { name: "Your signup is complete" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open your account" })).toBeVisible();
    view.unmount();
    mount(
      <WaitlistRequestPanel
        initialRequest={{ ...request, status: "revoked", purchasedAt: "2026-10-09" }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "This invitation is no longer available" }),
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
    await screen.findByRole("heading", { name: "You can now sign up for Atlas Pro" });
    act(() => {
      client.setQueryData(["waitlist", "link", "fresh", "invite"], {
        ...request,
        status: "revoked",
      });
    });
    expect(
      await screen.findByRole("heading", { name: "This invitation is no longer available" }),
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
});
