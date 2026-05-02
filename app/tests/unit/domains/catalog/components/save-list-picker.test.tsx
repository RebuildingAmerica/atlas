// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const claimsMocks = vi.hoisted(() => ({
  useSavedLists: vi.fn(),
  useSavedListMembership: vi.fn(),
  useCreateSavedList: vi.fn(),
  useAddSavedListItem: vi.fn(),
  useRemoveSavedListItem: vi.fn(),
}));

vi.mock("@/domains/catalog/hooks/use-claims", () => claimsMocks);

import { SaveListPicker } from "@/domains/catalog/components/profiles/save-list-picker";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  claimsMocks.useSavedLists.mockReturnValue({ data: [], isLoading: false });
  claimsMocks.useSavedListMembership.mockReturnValue({ data: [], isLoading: false });
  claimsMocks.useCreateSavedList.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  claimsMocks.useAddSavedListItem.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  claimsMocks.useRemoveSavedListItem.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
});

describe("SaveListPicker", () => {
  it("renders nothing when not open", () => {
    const { container } = render(
      <SaveListPicker entryId="entry-1" open={false} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a loading message while lists are loading", () => {
    claimsMocks.useSavedLists.mockReturnValue({ data: undefined, isLoading: true });
    render(<SaveListPicker entryId="entry-1" open onClose={vi.fn()} />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it("shows the empty state when the user has no lists", () => {
    render(<SaveListPicker entryId="entry-1" open onClose={vi.fn()} />);
    expect(screen.getByText(/don't have any lists/i)).toBeInTheDocument();
  });

  it("renders each list with a pluralized actor count", () => {
    claimsMocks.useSavedLists.mockReturnValue({
      data: [
        { id: "l1", name: "Reading", item_count: 1 },
        { id: "l2", name: "Watchlist", item_count: 5 },
      ],
      isLoading: false,
    });
    render(<SaveListPicker entryId="entry-1" open onClose={vi.fn()} />);
    expect(screen.getByText("Reading")).toBeInTheDocument();
    expect(screen.getByText("1 actor")).toBeInTheDocument();
    expect(screen.getByText("5 actors")).toBeInTheDocument();
  });

  it("shows a check when the entry is already in the list", () => {
    claimsMocks.useSavedLists.mockReturnValue({
      data: [{ id: "l1", name: "Reading", item_count: 0 }],
      isLoading: false,
    });
    claimsMocks.useSavedListMembership.mockReturnValue({ data: ["l1"], isLoading: false });
    const { container } = render(<SaveListPicker entryId="entry-1" open onClose={vi.fn()} />);
    expect(container.querySelector("svg.lucide-check")).not.toBeNull();
  });

  it("removes the entry when clicking a list it already belongs to", async () => {
    const removeMutate = vi.fn().mockResolvedValue(undefined);
    const addMutate = vi.fn().mockResolvedValue(undefined);
    claimsMocks.useSavedLists.mockReturnValue({
      data: [{ id: "l1", name: "Reading", item_count: 0 }],
      isLoading: false,
    });
    claimsMocks.useSavedListMembership.mockReturnValue({ data: ["l1"], isLoading: false });
    claimsMocks.useRemoveSavedListItem.mockReturnValue({
      mutateAsync: removeMutate,
      isPending: false,
    });
    claimsMocks.useAddSavedListItem.mockReturnValue({
      mutateAsync: addMutate,
      isPending: false,
    });

    render(<SaveListPicker entryId="entry-1" open onClose={vi.fn()} />);
    await act(async () => {
      screen.getByRole("button", { name: /Reading/ }).click();
      await Promise.resolve();
    });

    expect(removeMutate).toHaveBeenCalledWith({ listId: "l1", entryId: "entry-1" });
    expect(addMutate).not.toHaveBeenCalled();
  });

  it("adds the entry when clicking a list it does not belong to", async () => {
    const addMutate = vi.fn().mockResolvedValue(undefined);
    claimsMocks.useSavedLists.mockReturnValue({
      data: [{ id: "l1", name: "Reading", item_count: 0 }],
      isLoading: false,
    });
    claimsMocks.useAddSavedListItem.mockReturnValue({
      mutateAsync: addMutate,
      isPending: false,
    });

    render(<SaveListPicker entryId="entry-1" open onClose={vi.fn()} />);
    await act(async () => {
      screen.getByRole("button", { name: /Reading/ }).click();
      await Promise.resolve();
    });

    expect(addMutate).toHaveBeenCalledWith({
      listId: "l1",
      body: { entry_id: "entry-1" },
    });
  });

  it("calls onClose when clicking outside the picker", () => {
    const onClose = vi.fn();
    render(<SaveListPicker entryId="entry-1" open onClose={onClose} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onClose when clicking inside the picker", () => {
    const onClose = vi.fn();
    render(<SaveListPicker entryId="entry-1" open onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when pressing Escape", () => {
    const onClose = vi.fn();
    render(<SaveListPicker entryId="entry-1" open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores other key presses", () => {
    const onClose = vi.fn();
    render(<SaveListPicker entryId="entry-1" open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the empty-state when the user opens create then cancels back", () => {
    render(<SaveListPicker entryId="entry-1" open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Create a new list/i }));
    expect(screen.getByPlaceholderText(/New list name/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(screen.queryByPlaceholderText(/New list name/i)).not.toBeInTheDocument();
    expect(screen.getByText(/don't have any lists/i)).toBeInTheDocument();
  });

  it("creates a list and adds the entry on submit", async () => {
    const created = { id: "new-list", name: "Heroes", item_count: 0 };
    const createMutate = vi.fn().mockResolvedValue(created);
    const addMutate = vi.fn().mockResolvedValue(undefined);
    claimsMocks.useCreateSavedList.mockReturnValue({
      mutateAsync: createMutate,
      isPending: false,
    });
    claimsMocks.useAddSavedListItem.mockReturnValue({
      mutateAsync: addMutate,
      isPending: false,
    });

    render(<SaveListPicker entryId="entry-1" open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Create a new list/i }));
    fireEvent.change(screen.getByPlaceholderText(/New list name/i), {
      target: { value: "Heroes" },
    });
    await act(async () => {
      screen.getByRole("button", { name: /^Create$/ }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createMutate).toHaveBeenCalledWith({ name: "Heroes" });
    expect(addMutate).toHaveBeenCalledWith({
      listId: "new-list",
      body: { entry_id: "entry-1" },
    });
  });

  it("treats missing list and membership data as empty", () => {
    claimsMocks.useSavedLists.mockReturnValue({ data: undefined, isLoading: false });
    claimsMocks.useSavedListMembership.mockReturnValue({ data: undefined, isLoading: false });
    render(<SaveListPicker entryId="entry-1" open onClose={vi.fn()} />);
    expect(screen.getByText(/don't have any lists/i)).toBeInTheDocument();
  });

  it("renders an empty list grid when lists are undefined but the user is creating", () => {
    claimsMocks.useSavedLists.mockReturnValue({ data: undefined, isLoading: false });
    render(<SaveListPicker entryId="entry-1" open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Create a new list/i }));
    expect(screen.getByPlaceholderText(/New list name/i)).toBeInTheDocument();
    expect(screen.queryByText(/don't have any lists/i)).not.toBeInTheDocument();
  });

  it("ignores create submissions when the name is whitespace", async () => {
    const createMutate = vi.fn();
    claimsMocks.useCreateSavedList.mockReturnValue({
      mutateAsync: createMutate,
      isPending: false,
    });
    render(<SaveListPicker entryId="entry-1" open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Create a new list/i }));
    fireEvent.change(screen.getByPlaceholderText(/New list name/i), {
      target: { value: "   " },
    });
    await act(async () => {
      screen.getByRole("button", { name: /^Create$/ }).click();
      await Promise.resolve();
    });
    expect(createMutate).not.toHaveBeenCalled();
  });
});
