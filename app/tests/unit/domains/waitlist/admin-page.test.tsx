// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WaitlistAdminPage } from "@/domains/waitlist/pages/waitlist-admin-page";
import type { WaitlistRequest } from "@/domains/waitlist/contracts";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  invite: vi.fn(),
  action: vi.fn(),
}));
vi.mock("@tanstack/react-router", async () =>
  (await import("../../../helpers/router-harness")).installRouterMocks(),
);
vi.mock("@/domains/waitlist/waitlist.functions", () => ({
  listWaitlistRequests: mocks.list,
  loadWaitlistStaffDetail: mocks.detail,
  inviteWaitlistRequests: mocks.invite,
  actOnWaitlistRequest: mocks.action,
}));
describe("staff waitlist screens", () => {
  const request: WaitlistRequest = {
    id: "first",
    email: "person@example.org",
    product: "atlas_pro",
    interval: null,
    status: "waiting",
    name: "",
    organization: "",
    intendedUse: "",
    confirmedAt: "2026-10-08",
    invitedAt: null,
    purchasedAt: null,
    createdAt: "2026-10-08",
  };
  const delivery = { id: "email", kind: "invite", status: "failed", createdAt: "2026-10-08" };
  function mount() {
    return render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <WaitlistAdminPage />
      </QueryClientProvider>,
    );
  }
  beforeEach(() => {
    mocks.list.mockResolvedValue({
      records: [{ request, deliveries: [] }],
      availability: { available: true, allowedOffers: ["atlas_pro:monthly"] },
    });
    mocks.detail.mockResolvedValue({ request, deliveries: [], events: [] });
    mocks.invite.mockResolvedValue({ results: [{ id: "first", message: "Invitation sent." }] });
    mocks.action.mockResolvedValue({ request: { ...request, status: "revoked" } });
  });
  it("renders the staff shell before optional data and provides retry after failure", async () => {
    mocks.list.mockRejectedValueOnce(new Error("offline"));
    mount();
    expect(screen.getByRole("heading", { name: "Waitlist" })).toBeVisible();
    await userEvent.click(await screen.findByRole("button", { name: "Retry queue" }));
    expect(await screen.findByRole("button", { name: request.email })).toBeVisible();
  });
  it("reviews exact selected recipients, supports individual and batch selection, and reports outcomes", async () => {
    mount();
    await screen.findByRole("button", { name: request.email });
    await userEvent.click(screen.getByLabelText(`Select ${request.email}`));
    await userEvent.click(screen.getByLabelText(`Select ${request.email}`));
    await userEvent.click(screen.getByRole("button", { name: "Select up to 50" }));
    await userEvent.click(screen.getByRole("button", { name: "Review 1 invitation" }));
    expect(screen.getByRole("region", { name: "Review invitations" })).toHaveTextContent(
      request.email,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    await userEvent.click(screen.getByRole("button", { name: "Send invitations" }));
    expect(await screen.findByText(`${request.email}: Invitation sent.`)).toBeVisible();
    expect(mocks.invite).toHaveBeenCalledWith({ data: { ids: ["first"] } });
  });
  it("filters by plan, purchase and search without making unconfirmed or paused requests eligible", async () => {
    mocks.list.mockResolvedValue({
      records: [
        {
          request: { ...request, name: "Reporter", organization: "Newsroom" },
          deliveries: [delivery],
        },
        {
          request: {
            ...request,
            id: "second",
            email: "team@example.org",
            product: "atlas_team",
            status: "unconfirmed",
            confirmedAt: null,
            purchasedAt: "2026-10-09",
          },
          deliveries: [],
        },
      ],
      availability: { available: false, allowedOffers: [] },
    });
    mount();
    await screen.findByText("New signups are paused.", {
      exact: false,
    });
    expect(screen.getByRole("button", { name: "Select up to 50" })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Status"), "purchased");
    expect(screen.getByRole("button", { name: "team@example.org" })).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText("Plan"), "atlas_team");
    await userEvent.type(screen.getByLabelText("Search requests"), "missing");
    expect(screen.getByText("No requests.")).toBeVisible();
    await userEvent.clear(screen.getByLabelText("Search requests"));
    await userEvent.selectOptions(screen.getByLabelText("Status"), "");
    await userEvent.selectOptions(screen.getByLabelText("Plan"), "");
    expect(screen.getByRole("button", { name: "Reporter" })).toBeVisible();
    expect(screen.getAllByText("Email not confirmed").length).toBeGreaterThan(0);
    expect(screen.getByText(/Email failed/)).toBeVisible();
  });
  it("shows private context, delivery history and audit attribution, and reviews revocation", async () => {
    mocks.list.mockResolvedValue({
      records: [{ request: { ...request, status: "invited" }, deliveries: [delivery] }],
      availability: { available: true, allowedOffers: ["atlas_pro:monthly"] },
    });
    mocks.detail.mockResolvedValue({
      request: { ...request, status: "invited" },
      deliveries: [delivery, { ...delivery, id: "confirm", kind: "confirm", status: "sent" }],
      events: [
        { id: "event", action: "invited", createdAt: "2026-10-08", actorId: "staff" },
        { id: "event2", action: "confirmed", createdAt: "2026-10-08", actorId: null },
      ],
    });
    mount();
    await userEvent.selectOptions(screen.getByLabelText("Status"), "invited");
    await userEvent.click(await screen.findByRole("button", { name: request.email }));
    const detail = await screen.findByRole("dialog", { name: "Request details" });
    expect(await within(detail).findByText("invited")).toBeVisible();
    expect(within(detail).getByText("invited").closest("li")).toHaveTextContent("staff");
    expect(within(detail).getAllByText("Not provided")).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "Withdraw invitation" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep invitation" }));
    await userEvent.click(screen.getByRole("button", { name: "Withdraw invitation" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    expect(await screen.findByText("Invitation withdrawn.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("dialog", { name: "Request details" })).not.toBeInTheDocument();
  });
  it("resends or retries an invitation without presenting unresolved email as sent", async () => {
    mocks.detail.mockResolvedValue({
      request: {
        ...request,
        status: "invited",
        name: "Reporter",
        organization: "Newsroom",
        intendedUse: "Reporting",
      },
      deliveries: [delivery],
      events: [],
    });
    mocks.action
      .mockResolvedValueOnce({ delivery: { status: "unresolved" } })
      .mockResolvedValueOnce({ delivery: { status: "sent" } });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: request.email }));
    await userEvent.click(await screen.findByRole("button", { name: "Resend invitation" }));
    expect(await screen.findByText("Invitation email needs attention.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Retry email" }));
    expect(await screen.findByText("Invitation sent.")).toBeVisible();
    expect(mocks.action).toHaveBeenLastCalledWith({
      data: { id: "first", action: "retry", deliveryId: "email" },
    });
  });
  it("keeps failed detail and invitation actions recoverable", async () => {
    mocks.detail.mockRejectedValueOnce(new Error("offline"));
    mocks.invite.mockRejectedValueOnce(new Error("offline"));
    mount();
    await userEvent.click(await screen.findByRole("button", { name: request.email }));
    expect(await screen.findByText("Request details couldn’t be loaded.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Close details" }));
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    await userEvent.click(screen.getByRole("button", { name: "Send invitations" }));
    await waitFor(() =>
      expect(screen.getByText("Invitations couldn’t be sent. Try again.")).toBeVisible(),
    );
  });
  it("keeps historical failed invitations inactive after withdrawal and reports unmatched batch outcomes", async () => {
    mocks.detail.mockResolvedValue({
      request: { ...request, status: "withdrawn" },
      deliveries: [delivery],
      events: [],
    });
    mocks.invite.mockResolvedValue({
      results: [{ id: "no-longer-listed", message: "Could not invite." }],
    });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: request.email }));
    await screen.findByText(/Invitation · Failed/);
    expect(screen.queryByRole("button", { name: "Retry email" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close details" }));
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    await userEvent.click(screen.getByRole("button", { name: "Send invitations" }));
    expect(await screen.findByText("Request: Could not invite.")).toBeVisible();
  });
  it("opens request details as a keyboard-dismissable dialog and retries in place", async () => {
    mocks.detail.mockRejectedValueOnce(new Error("offline"));
    mount();
    const trigger = await screen.findByRole("button", { name: request.email });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Request details" });
    await userEvent.click(await within(dialog).findByRole("button", { name: "Try again" }));
    expect(await within(dialog).findByText("person@example.org")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
  it("shows failed staff actions inside the open request and lets staff retry", async () => {
    mocks.detail.mockResolvedValue({
      request: { ...request, status: "invited" },
      deliveries: [],
      events: [],
    });
    mocks.action
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ delivery: { status: "sent" } });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: request.email }));
    const dialog = await screen.findByRole("dialog", { name: "Request details" });
    await userEvent.click(await within(dialog).findByRole("button", { name: "Resend invitation" }));
    expect(
      await within(dialog).findByText("This change couldn’t be saved. Try again."),
    ).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Resend invitation" }));
    expect(await within(dialog).findByText("Invitation sent.")).toBeVisible();
  });
});
