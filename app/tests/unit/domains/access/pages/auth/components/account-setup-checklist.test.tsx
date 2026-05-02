// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  AccountSetupChecklist,
  type AccountSetupChecklistItem,
} from "@/domains/access/pages/auth/components/account-setup-checklist";

afterEach(() => {
  cleanup();
});

describe("AccountSetupChecklist", () => {
  it("renders the required progress count and the last-checked label", () => {
    const checklist: readonly AccountSetupChecklistItem[] = [
      {
        complete: true,
        description: "Email verified.",
        kind: "required",
        title: "Verify email",
      },
      {
        complete: false,
        description: "Add a passkey.",
        kind: "recommended",
        title: "Register passkey",
      },
    ];

    render(<AccountSetupChecklist checklist={checklist} lastCheckedLabel="just now" />);

    expect(screen.getByText("1 of 1 required step complete")).not.toBeNull();
    expect(screen.getByText(/Last checked just now/)).not.toBeNull();
    expect(screen.getByText("Recommended")).not.toBeNull();
    expect(screen.getByText("Done")).not.toBeNull();
    expect(screen.getByText("Optional")).not.toBeNull();
  });

  it("pluralises the required step count and adds the all-complete suffix", () => {
    const checklist: readonly AccountSetupChecklistItem[] = [
      {
        complete: true,
        description: "Email verified.",
        kind: "required",
        title: "Verify email",
      },
      {
        complete: true,
        description: "Two-factor enabled.",
        kind: "required",
        title: "2FA",
      },
      {
        complete: true,
        description: "Passkey added.",
        kind: "recommended",
        title: "Passkey",
      },
    ];

    render(<AccountSetupChecklist checklist={checklist} lastCheckedLabel={null} />);

    expect(screen.getByText("2 of 2 required steps complete — passkey added too")).not.toBeNull();
    expect(screen.queryByText(/Last checked/)).toBeNull();
  });

  it("renders the pending badge when a required step is incomplete", () => {
    const checklist: readonly AccountSetupChecklistItem[] = [
      {
        complete: false,
        description: "Email not verified.",
        kind: "required",
        title: "Verify email",
      },
    ];

    render(<AccountSetupChecklist checklist={checklist} lastCheckedLabel={null} />);

    expect(screen.getByText("Pending")).not.toBeNull();
  });
});
