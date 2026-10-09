import { createServerFn } from "@tanstack/react-start";
import { getCloudCostPosture } from "@/generated/platform-api";

/** Loads the current cloud-cost posture and guardrail checks. */
export const loadCloudCostPosture = createServerFn({ method: "GET" }).handler(
  async () => {
    return await getCloudCostPosture();
  },
);
