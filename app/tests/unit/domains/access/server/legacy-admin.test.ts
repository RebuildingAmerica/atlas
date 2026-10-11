import { expect, it } from "vitest";
import { legacyAdminResponse } from "../../../../../server/legacy-admin";

it.each([
  ["/admin", "https://atlas.test/editorial"],
  ["/admin/", "https://atlas.test/editorial/"],
  ["/admin/entries/p-1?view=review", "https://atlas.test/editorial/entries/p-1?view=review"],
  ["/admin/waitlist?status=waiting", "https://admin.test/waitlist?status=waiting"],
  ["/admin/waitlist/r-1", "https://admin.test/waitlist/r-1"],
  ["/admin/cloud-costs/daily", "https://admin.test/cloud-costs/daily"],
  ["/admin/discounts", "https://admin.test/discounts"],
  ["/admin/waitlisting", "https://atlas.test/editorial/waitlisting"],
])("preserves the destination of an old bookmark %s", (path, destination) => {
  const response = legacyAdminResponse(
    new Request(`https://atlas.test${path}`),
    "https://admin.test/",
  );
  expect(response?.status).toBe(308);
  expect(response?.headers.get("location")).toBe(destination);
  expect(response?.headers.get("cache-control")).toBe("private, no-store");
});

it.each([
  "",
  "http://admin.test",
  "https://admin.test/path",
  "https://admin.test/?query=one",
  "https://admin.test/#hash",
  "https://user:password@admin.test",
  "malformed",
])("refuses to misroute a platform bookmark with invalid configuration %s", (origin) => {
  expect(
    legacyAdminResponse(new Request("https://atlas.test/admin/waitlist"), origin)?.status,
  ).toBe(503);
});

it.each(["/", "/administrator", "/api/auth", "/editorial"])(
  "leaves the current route %s alone",
  (path) => {
    expect(
      legacyAdminResponse(new Request(`https://atlas.test${path}`), "https://admin.test"),
    ).toBeNull();
  },
);

it("keeps editorial bookmarks usable without a configured platform host", () => {
  expect(
    legacyAdminResponse(new Request("https://atlas.test/admin/entries"), undefined)?.headers.get(
      "location",
    ),
  ).toBe("https://atlas.test/editorial/entries");
});
