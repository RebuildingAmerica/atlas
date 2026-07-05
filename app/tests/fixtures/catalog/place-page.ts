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
  latest: [
    {
      id: "latest-1",
      title: "County commissioners advance bus stop shade and water funding",
      attribution: "Clark County agenda, Jul 2",
      href: "https://example.test/agenda",
      excerpt: "East-west routes and downtown transfer areas were named in public comment.",
      topics: ["Transit", "Heat"],
    },
  ],
  actors: {
    items: [
      {
        id: "actor-1",
        name: "RTC Southern Nevada",
        type: "organization",
        description: "Transit agency",
        work: "Maryland Parkway BRT, route frequency, bus stop heat",
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
      places: ["Maryland Parkway"],
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
      name: "The Strip",
      href: "/places/neighborhoods/the-strip-nv",
      kind: "corridor",
      latitude: 36.114647,
      longitude: -115.172813,
      summary: "Hospitality labor, tourism economy, transit access, public safety.",
      accent: "labor",
    },
    {
      name: "East Las Vegas",
      href: "/places/neighborhoods/east-las-vegas-nv",
      kind: "neighborhood",
      latitude: 36.162,
      longitude: -115.08,
      summary: "Tenant organizing, immigrant services, heat, bus reliability.",
      accent: "housing",
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
