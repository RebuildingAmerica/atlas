import { useSyncExternalStore } from "react";

export type DeviceColorScheme = "light" | "dark";

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function subscribeToDeviceScheme(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }

  const media = window.matchMedia(DARK_SCHEME_QUERY);
  media.addEventListener("change", onStoreChange);
  return () => {
    media.removeEventListener("change", onStoreChange);
  };
}

function getDeviceSchemeSnapshot(): DeviceColorScheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }

  return window.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light";
}

export function useDeviceColorScheme(): DeviceColorScheme {
  return useSyncExternalStore(subscribeToDeviceScheme, getDeviceSchemeSnapshot, () => "light");
}
