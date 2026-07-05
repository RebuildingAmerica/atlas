import type { PlacePageData } from "@/types";

export const placePageFixture = {
  identity: {
    name: "Las Vegas",
    slug: "las-vegas-nv",
    display: "Las Vegas, NV",
    kind: "polity",
    scopes: [
      { label: "Valley", href: "/places/las-vegas-nv", active: true },
      { label: "City", href: "/places/cities/las-vegas-nv", active: false },
      { label: "Clark County", href: "/places/counties/clark-county-nv", active: false },
    ],
  },
  summaryFacts: [
    { label: "Metro", value: "Las Vegas-Henderson-Paradise" },
    { label: "County", value: "Clark County" },
    { label: "Largest work base", value: "Tourism, service, logistics" },
  ],
  latest: {
    items: [
      {
        id: "latest-1",
        title: "County commissioners advance bus stop shade and water funding",
        attribution: "Clark County agenda, Jul 2",
        dateLabel: "Jul 2",
        href: "https://example.test/agenda",
        linkedActors: [
          {
            id: "actor-1",
            name: "RTC Southern Nevada",
            href: "/profiles/organizations/rtc-southern-nevada",
          },
        ],
        linkedEntityIds: ["actor-1"],
        sourceType: "government_record",
        excerpt: "East-west routes and downtown transfer areas were named in public comment.",
        topics: ["Transit", "Heat"],
      },
    ],
    nextCursor: "10",
  },
  actors: {
    items: [
      {
        id: "actor-1",
        name: "RTC Southern Nevada",
        type: "organization",
        description: "Transit agency",
        work: "Bus service, route frequency, bus stop heat",
        latest: "Final design review",
        href: "/profiles/organizations/rtc-southern-nevada",
      },
    ],
    nextCursor: "20",
  },
  issues: [
    {
      id: "transit",
      name: "Transit and mobility",
      domain: "transportation",
      actors: ["RTC Southern Nevada"],
      places: ["Henderson", "North Las Vegas"],
      records: ["RTC board packet", "FTA grant file"],
    },
  ],
  facts: [
    {
      label: "Rent-burdened households",
      value: "31%",
      attribution: "HUD CHAS, 2023",
    },
  ],
  governments: [
    {
      name: "Clark County",
      role: "County commission, courts, public health, regional services.",
      links: [{ label: "Commission agendas", href: "https://example.test/commission" }],
    },
  ],
  places: [
    {
      name: "Henderson",
      href: "/places/cities/henderson-nv",
      kind: "city",
      latitude: 36.039525,
      longitude: -114.981721,
      summary: "Housing growth, water, parks, transit access, public safety.",
      accent: "neutral",
      sourceDataset: "U.S. Census Bureau Places",
      sourceIdentifier: "census:place/3231900",
      sourceUrl: "https://www.census.gov/programs-surveys/geography.html",
    },
    {
      name: "North Las Vegas",
      href: "/places/cities/north-las-vegas-nv",
      kind: "city",
      latitude: 36.2,
      longitude: -115.12,
      summary: "Industrial growth, housing, transit access, parks, and public safety.",
      accent: "neutral",
      sourceDataset: "U.S. Census Bureau Places",
      sourceIdentifier: "census:place/3251800",
      sourceUrl: "https://www.census.gov/programs-surveys/geography.html",
    },
  ],
} satisfies PlacePageData;

export const placeCityRouteFixture = {
  ...placePageFixture,
  identity: {
    ...placePageFixture.identity,
    kind: "city",
  },
} satisfies PlacePageData;

export const placeBoroughRouteFixture = {
  ...placePageFixture,
  identity: {
    ...placePageFixture.identity,
    kind: "borough",
  },
} satisfies PlacePageData;
