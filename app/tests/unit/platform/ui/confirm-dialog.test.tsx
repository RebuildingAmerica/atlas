// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogProvider, useConfirmDialog } from "@/platform/ui/confirm-dialog";

describe("ConfirmDialogProvider", () => {
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

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
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

  it("renders the default confirm and cancel labels for non-destructive prompts", () => {
    function DefaultsTrigger(props: { onResult: (confirmed: boolean) => void }) {
      const { confirm } = useConfirmDialog();
      return (
        <button
          type="button"
          onClick={() => {
            void confirm({ title: "Save changes?", body: "Continue?" }).then(props.onResult);
          }}
        >
          Open
        </button>
      );
    }

    render(
      <ConfirmDialogProvider>
        <DefaultsTrigger
          onResult={() => {
            // no-op
          }}
        />
      </ConfirmDialogProvider>,
    );

    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
  });

  it("resolves false when the operator dismisses the dialog via the backdrop", async () => {
    let result: boolean | null = null;
    function DefaultsTrigger(props: { onResult: (confirmed: boolean) => void }) {
      const { confirm } = useConfirmDialog();
      return (
        <button
          type="button"
          onClick={() => {
            void confirm({ title: "Continue?", body: "ok?" }).then(props.onResult);
          }}
        >
          Open
        </button>
      );
    }

    render(
      <ConfirmDialogProvider>
        <DefaultsTrigger
          onResult={(confirmed) => {
            result = confirmed;
          }}
        />
      </ConfirmDialogProvider>,
    );

    fireEvent.click(screen.getByText("Open"));
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    const backdrop = document.querySelector(".fixed.inset-0.bg-black\\/40");
    if (!backdrop) throw new Error("Expected confirm dialog backdrop");
    vi.spyOn(console, "error").mockImplementation((message?: unknown) => {
      if (message === "There are no focusable elements inside the <FocusTrap />") return;
      throw new Error(String(message));
    });
    vi.spyOn(console, "warn").mockImplementation((message?: unknown) => {
      if (message === "There are no focusable elements inside the <FocusTrap />") return;
      throw new Error(String(message));
    });

    await act(async () => {
      fireEvent.mouseDown(backdrop);
      fireEvent.mouseUp(backdrop);
      fireEvent.click(backdrop);
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
