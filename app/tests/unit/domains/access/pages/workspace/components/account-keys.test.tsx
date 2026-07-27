// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AccountApiKeys } from "@/domains/access/pages/workspace/components/account/keys";

afterEach(() => {
  cleanup();
});

describe("AccountApiKeys", () => {
  it("reports zero keys while the key list is still loading", () => {
    render(
      <AccountApiKeys
        apiKeyName=""
        apiKeyScopes={[]}
        apiKeys={undefined}
        isCreatePending={false}
        isDeletePending={false}
        isError={false}
        onCreate={vi.fn()}
        onDelete={vi.fn()}
        onNameChange={vi.fn()}
        onToggleScope={vi.fn()}
      />,
    );

    expect(screen.getByText("Keys")).not.toBeNull();
    expect(screen.getByText("0")).not.toBeNull();
    expect(screen.queryByText("Unavailable")).toBeNull();
  });
});
