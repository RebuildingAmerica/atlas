// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConfirmDialogProvider, useConfirmDialog } from "@/platform/ui/confirm-dialog";

function ConfirmTrigger(props: { onResult: (confirmed: boolean) => void }) {
  const { confirm } = useConfirmDialog();
  return (
    <button
      type="button"
      onClick={() => {
        void confirm({
          title: "Remove provider?",
          body: "This deletes the SAML provider configuration.",
          confirmLabel: "Remove",
          destructive: true,
        }).then(props.onResult);
      }}
    >
      Open dialog
    </button>
  );
}

describe("ConfirmDialogProvider", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves true when the confirm button is clicked", async () => {
    let result: boolean | null = null;
    render(
      <ConfirmDialogProvider>
        <ConfirmTrigger
          onResult={(confirmed) => {
            result = confirmed;
          }}
        />
      </ConfirmDialogProvider>,
    );

    fireEvent.click(screen.getByText("Open dialog"));
    expect(screen.getByText("Remove provider?")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Remove"));
      await Promise.resolve();
    });

    expect(result).toBe(true);
  });

  it("resolves false when the cancel button is clicked", async () => {
    let result: boolean | null = null;
    render(
      <ConfirmDialogProvider>
        <ConfirmTrigger
          onResult={(confirmed) => {
            result = confirmed;
          }}
        />
      </ConfirmDialogProvider>,
    );

    fireEvent.click(screen.getByText("Open dialog"));

    await act(async () => {
      fireEvent.click(screen.getByText("Cancel"));
      await Promise.resolve();
    });

    expect(result).toBe(false);
  });

  it("throws a clear error when used without a provider", () => {
    function BareTrigger() {
      useConfirmDialog();
      return null;
    }

    expect(() => render(<BareTrigger />)).toThrow(/ConfirmDialogProvider/);
  });
});
