import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Button } from "./button";

/**
 * Options describing one confirmation prompt.
 */
export interface ConfirmDialogOptions {
  body: ReactNode;
  cancelLabel?: string;
  confirmLabel?: string;
  destructive?: boolean;
  title: string;
}

interface ResolvableConfirmRequest extends ConfirmDialogOptions {
  resolve: (confirmed: boolean) => void;
}

interface ConfirmDialogContextValue {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

/**
 * Mounts the singleton confirmation dialog and exposes a `confirm()` helper
 * via context.  Wrap the app once at the root; per-feature code calls
 * `useConfirmDialog().confirm({ … })` to prompt and awaits the boolean.
 *
 * @param props - The component props.
 * @param props.children - The application tree to wrap.
 */
export function ConfirmDialogProvider(props: { children: ReactNode }) {
  const [request, setRequest] = useState<ResolvableConfirmRequest | null>(null);

  const confirm = useCallback((options: ConfirmDialogOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setRequest({ ...options, resolve });
    });
  }, []);

  const settle = useCallback(
    (confirmed: boolean) => {
      if (!request) return;
      request.resolve(confirmed);
      setRequest(null);
    },
    [request],
  );

  return (
    <ConfirmDialogContext.Provider value={{ confirm }}>
      {props.children}
      <Dialog
        open={request !== null}
        onClose={() => {
          settle(false);
        }}
        className="relative z-50"
      >
        <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="border-outline-variant bg-surface w-full max-w-md space-y-4 rounded-[1.25rem] border p-6 shadow-xl">
            {request ? (
              <>
                <DialogTitle className="type-title-large text-on-surface">
                  {request.title}
                </DialogTitle>
                <div className="type-body-medium text-outline">{request.body}</div>
                <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      settle(false);
                    }}
                  >
                    {request.cancelLabel ?? "Cancel"}
                  </Button>
                  <Button
                    variant={request.destructive ? "primary" : "secondary"}
                    onClick={() => {
                      settle(true);
                    }}
                  >
                    {request.confirmLabel ?? "Confirm"}
                  </Button>
                </div>
              </>
            ) : null}
          </DialogPanel>
        </div>
      </Dialog>
    </ConfirmDialogContext.Provider>
  );
}

/**
 * Hook returning a `confirm()` function that opens the singleton dialog.
 * Throws when called outside `ConfirmDialogProvider` so missing wiring fails
 * at the call site rather than silently no-op'ing.
 */
export function useConfirmDialog(): ConfirmDialogContextValue {
  const value = useContext(ConfirmDialogContext);
  if (value === null) {
    throw new Error(
      "useConfirmDialog must be used inside a <ConfirmDialogProvider>; mount one near the router root.",
    );
  }
  return value;
}
