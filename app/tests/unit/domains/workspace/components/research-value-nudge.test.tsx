// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ResearchValueNudge,
  type ResearchValueGate,
} from "@/domains/workspace/components/research-value-nudge";
import type { SerializedResolvedCapabilities } from "@rebuildingamerica/atlas-access/workspace/capabilities";
import type { AtlasCapability } from "@rebuildingamerica/atlas-access/workspace/capabilities";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("ResearchValueNudge", () => {
  afterEach(() => {
    cleanup();
  });

  interface CapabilityOverrides {
    caps: AtlasCapability[];
    maxEntries: number | null;
    maxLists: number | null;
    runsPerMonth: number | null;
  }

  function limitOf(
    overrides: Partial<CapabilityOverrides>,
    key: keyof CapabilityOverrides,
    fallback: number,
  ): number | null {
    if (key in overrides) {
      const value = overrides[key];
      return typeof value === "number" || value === null ? value : fallback;
    }
    return fallback;
  }

  function capabilities(overrides: Partial<CapabilityOverrides>): SerializedResolvedCapabilities {
    return {
      capabilities: overrides.caps ?? [],
      limits: {
        research_runs_per_month: limitOf(overrides, "runsPerMonth", 2),
        max_shortlists: limitOf(overrides, "maxLists", 1),
        max_shortlist_entries: limitOf(overrides, "maxEntries", 25),
        max_api_keys: 0,
        api_requests_per_day: 0,
        public_api_requests_per_hour: 100,
        max_members: 1,
      },
    };
  }

  function exportGate(itemCount: number): ResearchValueGate {
    return { kind: "export", itemCount };
  }

  function alertsGate(followedActorCount: number): ResearchValueGate {
    return { kind: "alerts", followedActorCount };
  }

  function unlimitedGate(
    overrides: Partial<{
      isFreeTier: boolean;
      savedActors: number;
      listCount: number;
      runsThisMonth: number;
    }>,
  ): ResearchValueGate {
    return {
      kind: "unlimited",
      isFreeTier: overrides.isFreeTier ?? true,
      savedActors: overrides.savedActors ?? 0,
      listCount: overrides.listCount ?? 1,
      runsThisMonth: overrides.runsThisMonth ?? 0,
    };
  }

  function link() {
    return screen.getByRole("link");
  }

  describe("local mode and missing session", () => {
    it("renders nothing in local mode", () => {
      const { container } = render(
        <ResearchValueNudge capabilities={capabilities({})} isLocal gate={exportGate(3)} />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it("renders nothing when no capabilities are available", () => {
      const { container } = render(
        <ResearchValueNudge capabilities={null} isLocal={false} gate={exportGate(3)} />,
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("export gate", () => {
    it("shows for a free user with a non-empty list and links to the Pro intent", () => {
      render(
        <ResearchValueNudge capabilities={capabilities({})} isLocal={false} gate={exportGate(3)} />,
      );

      expect(screen.getByText("Export this list")).toBeInTheDocument();
      expect(link()).toHaveAttribute("data-link-to", "/pricing");
      expect(link()).toHaveAttribute("data-link-search", JSON.stringify({ intent: "atlas_pro" }));
    });

    it("hides when the list is empty", () => {
      const { container } = render(
        <ResearchValueNudge capabilities={capabilities({})} isLocal={false} gate={exportGate(0)} />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it("hides for a Pro user who already has the export capability", () => {
      const { container } = render(
        <ResearchValueNudge
          capabilities={capabilities({ caps: ["workspace.export"] })}
          isLocal={false}
          gate={exportGate(3)}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("alerts gate", () => {
    it("shows for a free user tracking actors and links to the Team intent", () => {
      render(
        <ResearchValueNudge capabilities={capabilities({})} isLocal={false} gate={alertsGate(3)} />,
      );

      expect(screen.getByText("Get alerts when they're in the news")).toBeInTheDocument();
      expect(screen.getByText(/You're tracking 3 actors/)).toBeInTheDocument();
      expect(link()).toHaveAttribute("data-link-search", JSON.stringify({ intent: "atlas_team" }));
    });

    it("uses singular copy when tracking exactly one actor", () => {
      render(
        <ResearchValueNudge capabilities={capabilities({})} isLocal={false} gate={alertsGate(1)} />,
      );

      expect(screen.getByText(/You're tracking 1 actor\./)).toBeInTheDocument();
    });

    it("hides when no actors are followed", () => {
      const { container } = render(
        <ResearchValueNudge capabilities={capabilities({})} isLocal={false} gate={alertsGate(0)} />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it("hides for a Team user who already has watchlists", () => {
      const { container } = render(
        <ResearchValueNudge
          capabilities={capabilities({ caps: ["monitoring.watchlists"] })}
          isLocal={false}
          gate={alertsGate(3)}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("unlimited gate", () => {
    it("shows when nearing the saved-actor limit and links to the Pro intent", () => {
      render(
        <ResearchValueNudge
          capabilities={capabilities({})}
          isLocal={false}
          gate={unlimitedGate({ savedActors: 20, listCount: 1 })}
        />,
      );

      expect(screen.getByText("Unlock unlimited research")).toBeInTheDocument();
      expect(screen.getByText(/You've saved 20 across 1 free list\./)).toBeInTheDocument();
      expect(link()).toHaveAttribute("data-link-search", JSON.stringify({ intent: "atlas_pro" }));
    });

    it("shows when at the list limit and uses plural list copy", () => {
      render(
        <ResearchValueNudge
          capabilities={capabilities({})}
          isLocal={false}
          gate={unlimitedGate({ savedActors: 0, listCount: 1, runsThisMonth: 0 })}
        />,
      );

      expect(screen.getByText(/across 1 free list\./)).toBeInTheDocument();
    });

    it("shows when at the monthly-run limit", () => {
      render(
        <ResearchValueNudge
          capabilities={capabilities({ maxLists: null })}
          isLocal={false}
          gate={unlimitedGate({ savedActors: 0, listCount: 0, runsThisMonth: 2 })}
        />,
      );

      expect(screen.getByText("Unlock unlimited research")).toBeInTheDocument();
      expect(screen.getByText(/across 0 free lists\./)).toBeInTheDocument();
    });

    it("hides for a paid user even when nearing a limit", () => {
      const { container } = render(
        <ResearchValueNudge
          capabilities={capabilities({})}
          isLocal={false}
          gate={unlimitedGate({ isFreeTier: false, savedActors: 25 })}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it("hides for a free user comfortably under every limit", () => {
      const { container } = render(
        <ResearchValueNudge
          capabilities={capabilities({})}
          isLocal={false}
          gate={unlimitedGate({ savedActors: 1, listCount: 0, runsThisMonth: 0 })}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it("never nears an unlimited (null) entries limit on its own", () => {
      const { container } = render(
        <ResearchValueNudge
          capabilities={capabilities({ maxEntries: null, maxLists: null, runsPerMonth: null })}
          isLocal={false}
          gate={unlimitedGate({ savedActors: 9999, listCount: 9999, runsThisMonth: 9999 })}
        />,
      );
      expect(container).toBeEmptyDOMElement();
    });

    it("treats a zero free limit as already met", () => {
      render(
        <ResearchValueNudge
          capabilities={capabilities({ maxLists: 0, maxEntries: null, runsPerMonth: null })}
          isLocal={false}
          gate={unlimitedGate({ savedActors: 0, listCount: 0, runsThisMonth: 0 })}
        />,
      );

      expect(screen.getByText("Unlock unlimited research")).toBeInTheDocument();
    });
  });
});
