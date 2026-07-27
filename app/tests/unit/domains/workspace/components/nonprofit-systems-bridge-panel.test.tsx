// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NonprofitSystemsBridgePanel } from "@/domains/workspace/components/nonprofit-systems-bridge-panel";

describe("NonprofitSystemsBridgePanel", () => {
  it("separates adjacent nonprofit systems with hierarchy and copies a bridge packet", () => {
    const copyPacket = vi.fn();
    render(
      <NonprofitSystemsBridgePanel
        actorCount={3}
        sourceCount={8}
        noteCount={2}
        workspaceName="Housing Justice Coalition"
        packetText="Housing Justice Coalition systems bridge"
        onCopyPacket={copyPacket}
      />,
    );

    expect(screen.getByRole("region", { name: "Nonprofit systems bridge" })).toBeInTheDocument();
    expect(screen.getByText("Adjacent system packet")).toBeInTheDocument();
    expect(screen.getByText("Advocacy CRM")).toBeInTheDocument();
    expect(screen.getByText("Grant diligence")).toBeInTheDocument();
    expect(screen.getByText("Coalition ops")).toBeInTheDocument();
    expect(screen.getByText("3 actors")).toBeInTheDocument();
    expect(screen.getByText("8 sources")).toBeInTheDocument();
    expect(screen.getByText("2 notes")).toBeInTheDocument();
    expect(screen.getByText("Housing Justice Coalition")).toBeInTheDocument();
    expect(screen.getAllByTestId("nonprofit-systems-bridge-icon")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Copy systems packet" }));

    expect(copyPacket).toHaveBeenCalledWith("Housing Justice Coalition systems bridge");
  });

  it("reads a single actor, source, and note in the singular", () => {
    render(
      <NonprofitSystemsBridgePanel
        actorCount={1}
        sourceCount={1}
        noteCount={1}
        workspaceName="Housing Justice Coalition"
        packetText="Housing Justice Coalition systems bridge"
        onCopyPacket={vi.fn()}
      />,
    );

    expect(screen.getByText("1 actor")).toBeInTheDocument();
    expect(screen.getByText("1 source")).toBeInTheDocument();
    expect(screen.getByText("1 note")).toBeInTheDocument();
  });
});
