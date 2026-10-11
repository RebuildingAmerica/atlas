import { screen } from "@testing-library/react";
import { vi } from "vitest";
import type { TakedownsViewProps } from "@/domains/editorial/takedowns-view";
import { DANA_TAKEDOWN, HELD_TAKEDOWN } from "../../fixtures/editorial/takedowns";

/** Props for a loaded takedowns view with two standing takedowns, with any value changed. */
export function takedownsViewProps(
  overrides: Partial<TakedownsViewProps> = {},
): TakedownsViewProps {
  return {
    formResetKey: 0,
    isCreating: false,
    isLoading: false,
    onCreate: vi.fn(),
    onRestore: vi.fn(),
    takedowns: [DANA_TAKEDOWN, HELD_TAKEDOWN],
    ...overrides,
  };
}

/** The form that takes a profile down. */
export function takedownForm(): HTMLFormElement {
  const form = screen.getByRole("button", { name: /Take down|Taking down/ }).closest("form");
  if (!form) throw new Error("No takedown form");
  return form;
}
