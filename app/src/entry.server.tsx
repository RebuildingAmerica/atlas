import { createStartHandler } from "@tanstack/react-start/server";
import { createRouter } from "./router";

// TanStack Start's type for createStartHandler doesn't match its documented
// usage pattern — suppress this single call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
export default createStartHandler({ createRouter } as any);
