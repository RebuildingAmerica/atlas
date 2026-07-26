// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccountPasskeys } from "@/domains/access/pages/workspace/components/account/passkeys";

afterEach(() => {
  cleanup();
});

describe("AccountPasskeys", () => {
  const noop = () => undefined;

  const defaultProps = {
    editingPasskeyId: null,
    editingPasskeyName: "",
    isAddingPasskey: false,
    isDeletePending: false,
    isError: false,
    isRenamePending: false,
    onAddPasskey: noop,
    onCancelRename: noop,
    onDelete: noop,
    onRenameChange: noop,
    onStartRename: noop,
    onSubmitRename: noop,
  };

  it("renders each passkey with its enrollment date", () => {
    render(
      <AccountPasskeys
        {...defaultProps}
        onDelete={vi.fn()}
        passkeys={[
          {
            backedUp: true,
            createdAt: "2026-04-10T00:00:00.000Z",
            deviceType: "platform",
            id: "pk_1",
            name: "Laptop",
          },
        ]}
      />,
    );

    expect(screen.getByText("Laptop")).not.toBeNull();
    expect(screen.getByText(/Device passkey · synced · 4\/10\/2026/)).not.toBeNull();
  });

  it("counts zero passkeys while the enrollment list is still loading", () => {
    render(<AccountPasskeys {...defaultProps} passkeys={undefined} />);

    expect(screen.getByText("0")).not.toBeNull();
    expect(screen.queryByText("Could not load passkeys.")).toBeNull();
  });
});
