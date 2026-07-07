// @vitest-environment jsdom

import "./profile-redesign-test-setup";

import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionCluster } from "@/domains/catalog/components/profiles/action-cluster";

const profileFollowMocks = vi.hoisted(() => ({
  useProfileFollow: vi.fn(),
  useFollowProfile: vi.fn(),
  useUnfollowProfile: vi.fn(),
}));

const savedListQueryMocks = vi.hoisted(() => ({
  useSavedLists: vi.fn(),
  useSavedListMembership: vi.fn(),
}));

const savedListMutationMocks = vi.hoisted(() => ({
  useCreateSavedList: vi.fn(),
  useAddSavedListItem: vi.fn(),
  useRemoveSavedListItem: vi.fn(),
}));

const workspaceWatchMocks = vi.hoisted(() => ({
  useWorkspaceWatchStatus: vi.fn(),
  useWatchWorkspaceResource: vi.fn(),
  useUnwatchWorkspaceResource: vi.fn(),
}));

vi.mock("@/domains/catalog/hooks/use-claims", () => ({
  useProfileFollow: profileFollowMocks.useProfileFollow,
  useFollowProfile: profileFollowMocks.useFollowProfile,
  useUnfollowProfile: profileFollowMocks.useUnfollowProfile,
  useSavedLists: savedListQueryMocks.useSavedLists,
  useSavedListMembership: savedListQueryMocks.useSavedListMembership,
  useCreateSavedList: savedListMutationMocks.useCreateSavedList,
  useAddSavedListItem: savedListMutationMocks.useAddSavedListItem,
  useRemoveSavedListItem: savedListMutationMocks.useRemoveSavedListItem,
}));
vi.mock("@/domains/workspace/hooks/use-workspace-watches", () => ({
  useWorkspaceWatchStatus: workspaceWatchMocks.useWorkspaceWatchStatus,
  useWatchWorkspaceResource: workspaceWatchMocks.useWatchWorkspaceResource,
  useUnwatchWorkspaceResource: workspaceWatchMocks.useUnwatchWorkspaceResource,
}));

beforeEach(() => {
  profileFollowMocks.useProfileFollow.mockReturnValue({ data: null, isLoading: false });
  profileFollowMocks.useFollowProfile.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  profileFollowMocks.useUnfollowProfile.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  savedListQueryMocks.useSavedLists.mockReturnValue({ data: [], isLoading: false });
  savedListQueryMocks.useSavedListMembership.mockReturnValue({ data: [], isLoading: false });
  savedListMutationMocks.useCreateSavedList.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  savedListMutationMocks.useAddSavedListItem.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  savedListMutationMocks.useRemoveSavedListItem.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  workspaceWatchMocks.useWorkspaceWatchStatus.mockReturnValue({
    data: { watch: null, watched: false },
    isLoading: false,
  });
  workspaceWatchMocks.useWatchWorkspaceResource.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
  workspaceWatchMocks.useUnwatchWorkspaceResource.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
});

describe("ActionCluster", () => {
  const baseProps = {
    entryId: "entry-1",
    entrySlug: "jane-doe-a3f2",
    shareUrl: "https://example.com/jane",
    shareTitle: "Jane Doe",
    profilePath: "/profiles/people/jane-doe",
    sourcesHref: "#reporting-trail",
  };

  it("keeps source inspection in the public action strip", () => {
    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    expect(screen.getByRole("link", { name: /inspect sources/i })).toHaveAttribute(
      "href",
      "#reporting-trail",
    );
  });

  it("renders the Share button always", () => {
    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
  });

  it("renders a mailto link when email is supplied", () => {
    render(<ActionCluster {...baseProps} email="jane@example.org" isSignedIn={false} />);
    const link = screen.getByRole("link", { name: /contact/i });
    expect(link).toHaveAttribute("href", "mailto:jane@example.org");
  });

  it("hides the Contact link when no email is supplied", () => {
    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    expect(screen.queryByRole("link", { name: /contact/i })).not.toBeInTheDocument();
  });

  it("renders Save and Follow as sign-in links when anonymous", () => {
    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    const save = screen.getByRole("link", { name: /save/i });
    const follow = screen.getByRole("link", { name: /follow/i });
    expect(save).toHaveAttribute("href", expect.stringContaining("/sign-in"));
    expect(follow).toHaveAttribute("href", expect.stringContaining("/sign-in"));
  });

  it("renders Save and Follow as buttons when signed in", () => {
    render(<ActionCluster {...baseProps} isSignedIn />);
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /follow/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("opens the save-list picker on Save click when signed in", () => {
    render(<ActionCluster {...baseProps} isSignedIn />);
    const saveButton = screen.getByRole("button", { name: /save/i });
    expect(saveButton).toHaveAttribute("aria-expanded", "false");
    expect(saveButton).toHaveAttribute("aria-controls", "profile-save-list-picker");

    fireEvent.click(saveButton);

    expect(saveButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: /save to list/i })).toHaveAttribute(
      "id",
      "profile-save-list-picker",
    );
  });

  it("copies the URL to clipboard when Web Share is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    const button = screen.getByRole("button", { name: /share/i });
    button.click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).toHaveBeenCalledWith("https://example.com/jane");
  });

  it("shows the 'Link copied' label after a clipboard copy and resets after timeout", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    const button = screen.getByRole("button", { name: /share/i });
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: /link copied/i })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();
  });

  it("uses the Web Share API when available and shows the 'Shared' label", async () => {
    vi.useFakeTimers();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      writable: true,
      value: share,
    });

    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    await act(async () => {
      screen.getByRole("button", { name: /share/i }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(share).toHaveBeenCalledWith({
      url: "https://example.com/jane",
      title: "Jane Doe",
    });
    expect(screen.getByRole("button", { name: /^shared$/i })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();

    Reflect.deleteProperty(navigator, "share");
  });

  it("falls through to the clipboard path when navigator.share rejects", async () => {
    const share = vi.fn().mockRejectedValue(new Error("denied"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      writable: true,
      value: share,
    });
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    await act(async () => {
      screen.getByRole("button", { name: /share/i }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(share).toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("https://example.com/jane");

    Reflect.deleteProperty(navigator, "share");
  });

  it("invokes the follow mutation when the user is not yet following", async () => {
    const followMutate = vi.fn().mockResolvedValue(undefined);
    profileFollowMocks.useProfileFollow.mockReturnValue({ data: null, isLoading: false });
    profileFollowMocks.useFollowProfile.mockReturnValue({
      mutateAsync: followMutate,
      isPending: false,
    });

    render(<ActionCluster {...baseProps} isSignedIn />);
    await act(async () => {
      screen.getByRole("button", { name: /follow updates/i }).click();
      await Promise.resolve();
    });

    expect(followMutate).toHaveBeenCalledWith("jane-doe-a3f2");
  });

  it("invokes the unfollow mutation when the user is already following", async () => {
    const unfollowMutate = vi.fn().mockResolvedValue(undefined);
    profileFollowMocks.useProfileFollow.mockReturnValue({
      data: { followed: true },
      isLoading: false,
    });
    profileFollowMocks.useUnfollowProfile.mockReturnValue({
      mutateAsync: unfollowMutate,
      isPending: false,
    });

    render(<ActionCluster {...baseProps} isSignedIn />);
    expect(screen.getByRole("button", { name: /following/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await act(async () => {
      screen.getByRole("button", { name: /following/i }).click();
      await Promise.resolve();
    });

    expect(unfollowMutate).toHaveBeenCalledWith("jane-doe-a3f2");
  });

  it("watches the entry in the active workspace when the profile is not watched", async () => {
    const watchMutate = vi.fn().mockResolvedValue(undefined);
    workspaceWatchMocks.useWorkspaceWatchStatus.mockReturnValue({
      data: { watch: null, watched: false },
      isLoading: false,
    });
    workspaceWatchMocks.useWatchWorkspaceResource.mockReturnValue({
      mutateAsync: watchMutate,
      isPending: false,
    });

    render(
      <ActionCluster {...baseProps} isSignedIn workspaceId="org_123" workspaceWatchingEnabled />,
    );
    expect(screen.getByRole("button", { name: /^watch$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await act(async () => {
      screen.getByRole("button", { name: /^watch$/i }).click();
      await Promise.resolve();
    });

    expect(workspaceWatchMocks.useWorkspaceWatchStatus).toHaveBeenCalledWith(
      {
        resourceId: "entry-1",
        resourceType: "entry",
      },
      true,
      "org_123",
    );
    expect(watchMutate).toHaveBeenCalledWith({
      notificationPreference: "digest",
      resourceId: "entry-1",
      resourceType: "entry",
    });
  });

  it("unwatches the entry in the active workspace when the profile is watched", async () => {
    const unwatchMutate = vi.fn().mockResolvedValue(undefined);
    workspaceWatchMocks.useWorkspaceWatchStatus.mockReturnValue({
      data: {
        watch: {
          created_at: "2026-06-25T00:00:00Z",
          created_by: "user_1",
          id: "watch_1",
          notification_preference: "digest",
          org_id: "org_1",
          resource_id: "entry-1",
          resource_type: "entry",
          updated_at: "2026-06-25T00:00:00Z",
        },
        watched: true,
      },
      isLoading: false,
    });
    workspaceWatchMocks.useUnwatchWorkspaceResource.mockReturnValue({
      mutateAsync: unwatchMutate,
      isPending: false,
    });

    render(<ActionCluster {...baseProps} isSignedIn workspaceWatchingEnabled />);
    expect(screen.getByRole("button", { name: /^watching$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await act(async () => {
      screen.getByRole("button", { name: /^watching$/i }).click();
      await Promise.resolve();
    });

    expect(unwatchMutate).toHaveBeenCalledWith({
      resourceId: "entry-1",
      resourceType: "entry",
    });
  });

  it("leaves the share label unchanged when both Web Share and clipboard fail", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    render(<ActionCluster {...baseProps} isSignedIn={false} />);
    const button = screen.getByRole("button", { name: /^share$/i });
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();
  });

  it("closes the save-list picker when the picker requests close", () => {
    savedListQueryMocks.useSavedLists.mockReturnValue({
      data: [{ id: "list-1", name: "Reading", item_count: 0 }],
      isLoading: false,
    });

    render(<ActionCluster {...baseProps} isSignedIn />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(screen.getByRole("dialog", { name: /save to list/i })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /save to list/i })).not.toBeInTheDocument();
  });
});
