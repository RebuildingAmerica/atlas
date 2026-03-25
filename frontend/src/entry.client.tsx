import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import { createRouter } from "./router";

const router = createRouter();

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - StartClient accepts router but types are incomplete
const element = <StartClient router={router} />;

hydrateRoot(document, element);
