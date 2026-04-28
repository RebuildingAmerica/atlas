import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Severity-style hint for a toast.  Drives the accent color and the
 * `role`/`aria-live` semantics so screen readers announce errors more
 * urgently than confirmations.
 */
export type ToastTone = "info" | "success" | "error";

/**
 * Options accepted by `useToast().show(…)`.
 */
export interface ToastOptions {
  durationMs?: number;
  tone?: ToastTone;
}

interface ActiveToast {
  durationMs: number;
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  show: (message: string, options?: ToastOptions) => void;
  success: (message: string, options?: Omit<ToastOptions, "tone">) => void;
  error: (message: string, options?: Omit<ToastOptions, "tone">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 4_000;

/**
 * Mounts the toast queue and exposes a `useToast()` hook.  Toasts are
 * announced through an `aria-live` region so screen-reader users hear them,
 * stack vertically when multiple fire in quick succession, and dismiss
 * automatically after `durationMs` (default 4 s).
 *
 * @param props - Component props.
 * @param props.children - The application tree to wrap.
 */
export function ToastProvider(props: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const nextIdRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((message: string, options?: ToastOptions) => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setToasts((current) => [
      ...current,
      {
        durationMs: options?.durationMs ?? DEFAULT_DURATION_MS,
        id,
        message,
        tone: options?.tone ?? "info",
      },
    ]);
  }, []);

  const success = useCallback(
    (message: string, options?: Omit<ToastOptions, "tone">) => {
      show(message, { ...options, tone: "success" });
    },
    [show],
  );

  const error = useCallback(
    (message: string, options?: Omit<ToastOptions, "tone">) => {
      show(message, { ...options, tone: "error" });
    },
    [show],
  );

  return (
    <ToastContext.Provider value={{ show, success, error }}>
      {props.children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * Hook returning the toast helpers.  Throws when called outside a provider
 * so missing wiring fails at the call site.
 */
export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (value === null) {
    throw new Error(
      "useToast must be used inside a <ToastProvider>; mount one near the router root.",
    );
  }
  return value;
}

interface ToastViewportProps {
  onDismiss: (id: number) => void;
  toasts: ActiveToast[];
}

/**
 * Renders the stack of active toasts and the live region.  Errors get
 * `role="alert"` (assertive); other toasts get `role="status"` (polite).
 *
 * @param props - The viewport props.
 * @param props.onDismiss - Callback invoked when a toast should be removed.
 * @param props.toasts - Toasts currently visible.
 */
function ToastViewport({ onDismiss, toasts }: ToastViewportProps) {
  return (
    <div
      className="pointer-events-none fixed top-4 right-4 z-50 flex flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  onDismiss: (id: number) => void;
  toast: ActiveToast;
}

/**
 * Single toast row.  Sets up its own auto-dismiss timer that the user can
 * override by clicking Dismiss; the inner role flips between status and
 * alert based on the toast's tone.
 *
 * @param props - The item props.
 * @param props.onDismiss - Removal callback.
 * @param props.toast - The toast being rendered.
 */
function ToastItem({ onDismiss, toast }: ToastItemProps) {
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      onDismiss(toast.id);
    }, toast.durationMs);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [onDismiss, toast.durationMs, toast.id]);

  const toneClassName =
    toast.tone === "error"
      ? "border-error bg-error-container text-on-error-container"
      : toast.tone === "success"
        ? "border-outline-variant bg-surface text-on-surface"
        : "border-outline-variant bg-surface text-on-surface";

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex max-w-sm items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg ${toneClassName}`}
    >
      <p className="type-body-medium flex-1">{toast.message}</p>
      <button
        type="button"
        className="type-label-medium text-outline hover:text-on-surface"
        onClick={() => {
          onDismiss(toast.id);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
