import type { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { vi } from "vitest";
import type { DiscoverySchedulesViewProps } from "@/domains/editorial/discovery-schedules-view";
import type { RenderWithProvidersOptions } from "../render-with-providers";
import {
  PAUSED_SCHEDULE,
  RENO_SCHEDULE,
  SCHEDULE_ISSUE_AREAS,
} from "../../fixtures/editorial/discovery-schedules";

/** Props for a loaded schedules view with two targets, with any value changed. */
export function schedulesViewProps(
  overrides: Partial<DiscoverySchedulesViewProps> = {},
): DiscoverySchedulesViewProps {
  return {
    formResetKey: 0,
    isCreating: false,
    isLoading: false,
    issueAreas: SCHEDULE_ISSUE_AREAS,
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onToggle: vi.fn(),
    schedules: [RENO_SCHEDULE, PAUSED_SCHEDULE],
    ...overrides,
  };
}

/** Seeds the issue taxonomy the way the discovery route loader would. */
export const SCHEDULE_TAXONOMY_SEED: RenderWithProvidersOptions = {
  seed: (client: QueryClient) => {
    client.setQueryData(["taxonomy"], { Housing: SCHEDULE_ISSUE_AREAS });
  },
};

/** The list item for the target titled `place`, such as "Reno, NV". */
export function scheduleRow(place: string): HTMLElement {
  const row = screen.getByRole("heading", { name: place }).closest("li");
  if (!row) throw new Error(`No schedule row for ${place}`);
  return row;
}

/** The form that adds a target. */
export function newScheduleForm(): HTMLFormElement {
  const form = screen.getByRole("button", { name: "Add target" }).closest("form");
  if (!form) throw new Error("No add-target form");
  return form;
}
