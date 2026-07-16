import { useEffect } from "react";

/**
 * Attaches a `beforeunload` listener that warns the operator before they
 * navigate away with unsaved form data.  Browsers ignore the message in
 * `event.returnValue` and show their generic "Leave site?" dialog, but the
 * `event.preventDefault()` call is what triggers the prompt at all.
 *
 * @param dirty - Whether the form currently has unsaved changes.
 */
export function useDirtyFormGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [dirty]);
}
