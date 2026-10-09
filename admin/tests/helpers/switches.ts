import { screen } from "@testing-library/react";

/** The reason box on a switch card: 0 for discovery spend, 1 for checkout. */
export function reasonBox(index: 0 | 1): HTMLElement {
  const box = screen.getAllByRole("textbox")[index];
  if (!box) throw new Error(`No reason box at ${String(index)}`);
  return box;
}
