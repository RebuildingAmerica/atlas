import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  listPlatformSwitches,
  setPlatformSwitch,
} from "@/generated/platform-api";

const switchInputSchema = z.object({
  engaged: z.boolean(),
  name: z.enum(["discovery_spend", "checkout"]),
  reason: z
    .string()
    .trim()
    .min(3, "Say why, so whoever reads this later understands it."),
});

/** Loads every switch with who last changed it and why. */
export const loadSwitches = createServerFn({ method: "GET" }).handler(
  async () => {
    return await listPlatformSwitches();
  },
);

/** Engages or releases one switch; the API records the operator and reason. */
export const flipSwitch = createServerFn({ method: "POST" })
  .validator(switchInputSchema)
  .handler(async ({ data }) => {
    return await setPlatformSwitch(data.name, {
      engaged: data.engaged,
      reason: data.reason,
    });
  });
