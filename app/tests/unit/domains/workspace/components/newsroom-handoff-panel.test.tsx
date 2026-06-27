// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewsroomHandoffPanel } from "@/domains/workspace/components/newsroom-handoff-panel";

afterEach(() => {
  cleanup();
});

describe("NewsroomHandoffPanel", () => {
  it("renders a differentiated newsroom handoff with an assignment packet action", () => {
    const onCopy = vi.fn();

    render(
      <NewsroomHandoffPanel
        actorCount={3}
        sourceCount={8}
        noteCount={2}
        nextAction="Review latest source trail"
        packetText="Tenant desk packet"
        onCopyPacket={onCopy}
      />,
    );

    expect(screen.getByRole("region", { name: "Newsroom handoff" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Assignment packet" })).toBeInTheDocument();
    expect(screen.getByText("3 leads")).toBeInTheDocument();
    expect(screen.getByText("8 sources")).toBeInTheDocument();
    expect(screen.getByText("2 notes")).toBeInTheDocument();
    expect(screen.getByText("Source check")).toBeInTheDocument();
    expect(screen.getByText("Desk handoff")).toBeInTheDocument();
    expect(screen.getByText("CMS-ready slug")).toBeInTheDocument();
    expect(screen.getAllByTestId("newsroom-handoff-icon")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Copy assignment packet" }));

    expect(onCopy).toHaveBeenCalledWith("Tenant desk packet");
  });
});
