import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { lookupAccount } from "@/generated/platform-api";

const lookupInputSchema = z.object({
  query: z.string().trim().min(1, "Type an email address or a workspace slug."),
});

/**
 * Looks up an account by email, or a workspace by slug. The API records the
 * lookup under the operator, because reading a customer's account is itself
 * sensitive.
 */
export const findAccount = createServerFn({ method: "POST" })
  .validator(lookupInputSchema)
  .handler(async ({ data }) => {
    return await lookupAccount({ query: data.query });
  });
