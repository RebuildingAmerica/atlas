import { createHash } from "node:crypto";

const sort = (value) =>
  Array.isArray(value)
    ? value.map(sort)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sort(value[key])]),
        )
      : value;
export const canonicalDigest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(sort(value)))
    .digest("hex");
