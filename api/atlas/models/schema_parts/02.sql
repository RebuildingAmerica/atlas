-- Public place page context. These rows hold human-facing civic geography
-- context that complements actor/source search results.
CREATE TABLE IF NOT EXISTS place_contexts (
    place_key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('polity', 'borough', 'city', 'county', 'metro', 'neighborhood', 'district', 'service_area', 'state')),
    source_dataset TEXT,
    source_identifier TEXT,
    source_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS place_scope_links (
    place_key TEXT NOT NULL REFERENCES place_contexts(place_key) ON DELETE CASCADE,
    label TEXT NOT NULL,
    href TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (place_key, href)
);

CREATE TABLE IF NOT EXISTS place_query_filters (
    id TEXT PRIMARY KEY,
    place_key TEXT NOT NULL REFERENCES place_contexts(place_key) ON DELETE CASCADE,
    city TEXT,
    state TEXT,
    region TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS place_summary_facts (
    place_key TEXT NOT NULL REFERENCES place_contexts(place_key) ON DELETE CASCADE,
    label TEXT NOT NULL,
    value TEXT NOT NULL,
    attribution TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (place_key, label)
);

CREATE TABLE IF NOT EXISTS place_governments (
    id TEXT PRIMARY KEY,
    place_key TEXT NOT NULL REFERENCES place_contexts(place_key) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS place_government_links (
    government_id TEXT NOT NULL REFERENCES place_governments(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    href TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (government_id, href)
);

CREATE TABLE IF NOT EXISTS place_related_places (
    id TEXT PRIMARY KEY,
    place_key TEXT NOT NULL REFERENCES place_contexts(place_key) ON DELETE CASCADE,
    name TEXT NOT NULL,
    href TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('polity', 'borough', 'city', 'county', 'metro', 'neighborhood', 'district', 'service_area', 'state')),
    source_dataset TEXT,
    source_identifier TEXT,
    source_url TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    summary TEXT NOT NULL,
    accent TEXT NOT NULL CHECK(accent IN ('climate', 'democracy', 'education', 'health', 'housing', 'labor', 'neutral')),
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_place_scope_links_place ON place_scope_links(place_key);
CREATE INDEX IF NOT EXISTS idx_place_query_filters_place ON place_query_filters(place_key);
CREATE INDEX IF NOT EXISTS idx_place_summary_facts_place ON place_summary_facts(place_key);
CREATE INDEX IF NOT EXISTS idx_place_governments_place ON place_governments(place_key);
CREATE INDEX IF NOT EXISTS idx_place_government_links_government
    ON place_government_links(government_id);
CREATE INDEX IF NOT EXISTS idx_place_related_places_place ON place_related_places(place_key);
ALTER TABLE place_related_places ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE place_related_places ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE place_related_places ADD COLUMN IF NOT EXISTS source_dataset TEXT;
ALTER TABLE place_related_places ADD COLUMN IF NOT EXISTS source_identifier TEXT;
ALTER TABLE place_related_places ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE place_contexts ADD COLUMN IF NOT EXISTS source_dataset TEXT;
ALTER TABLE place_contexts ADD COLUMN IF NOT EXISTS source_identifier TEXT;
ALTER TABLE place_contexts ADD COLUMN IF NOT EXISTS source_url TEXT;

INSERT INTO place_contexts (
    place_key, name, display, kind, source_dataset, source_identifier, source_url
)
VALUES (
    'las-vegas-nv',
    'Las Vegas',
    'Las Vegas, NV',
    'polity',
    'Atlas civic place composition',
    'atlas:place-composition/las-vegas-nv',
    NULL
)
ON CONFLICT (place_key) DO UPDATE SET
    name = EXCLUDED.name,
    display = EXCLUDED.display,
    kind = EXCLUDED.kind,
    source_dataset = EXCLUDED.source_dataset,
    source_identifier = EXCLUDED.source_identifier,
    source_url = EXCLUDED.source_url,
    updated_at = NOW();

INSERT INTO place_contexts (
    place_key, name, display, kind, source_dataset, source_identifier, source_url
)
VALUES
    (
        'city:las-vegas-nv',
        'City of Las Vegas',
        'City of Las Vegas, NV',
        'city',
        'U.S. Census Bureau Places',
        'census:place/3240000',
        'https://www.census.gov/quickfacts/fact/table/lasvegascitynevada/PST045225'
    ),
    (
        'county:clark-county-nv',
        'Clark County',
        'Clark County, NV',
        'county',
        'U.S. Census Bureau Counties',
        'census:county/32003',
        'https://www.census.gov/quickfacts/fact/table/clarkcountynevada/PST045225'
    ),
    (
        'metro:las-vegas-henderson-paradise-nv',
        'Las Vegas-Henderson-Paradise Metro',
        'Las Vegas-Henderson-Paradise, NV Metro Area',
        'metro',
        'U.S. Office of Management and Budget Core Based Statistical Areas',
        'omb:cbsa/29820',
        'https://www.whitehouse.gov/wp-content/uploads/2023/07/OMB-Bulletin-23-01.pdf'
    ),
    (
        'city:henderson-nv',
        'Henderson',
        'Henderson, NV',
        'city',
        'U.S. Census Bureau Places',
        'census:place/3231900',
        'https://www.census.gov/programs-surveys/geography.html'
    ),
    (
        'city:north-las-vegas-nv',
        'North Las Vegas',
        'North Las Vegas, NV',
        'city',
        'U.S. Census Bureau Places',
        'census:place/3251800',
        'https://www.census.gov/programs-surveys/geography.html'
    )
ON CONFLICT (place_key) DO UPDATE SET
    name = EXCLUDED.name,
    display = EXCLUDED.display,
    kind = EXCLUDED.kind,
    source_dataset = EXCLUDED.source_dataset,
    source_identifier = EXCLUDED.source_identifier,
    source_url = EXCLUDED.source_url,
    updated_at = NOW();

INSERT INTO place_scope_links (place_key, label, href, active, sort_order)
VALUES
    ('las-vegas-nv', 'Valley', '/places/las-vegas-nv', TRUE, 10),
    ('las-vegas-nv', 'City', '/places/cities/las-vegas-nv', FALSE, 20),
    ('las-vegas-nv', 'Clark County', '/places/counties/clark-county-nv', FALSE, 30),
    ('las-vegas-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', FALSE, 40),
    ('las-vegas-nv', 'Henderson', '/places/cities/henderson-nv', FALSE, 50),
    ('las-vegas-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', FALSE, 60)
ON CONFLICT (place_key, href) DO UPDATE SET
    label = EXCLUDED.label,
    active = EXCLUDED.active,
    sort_order = EXCLUDED.sort_order;

INSERT INTO place_scope_links (place_key, label, href, active, sort_order)
VALUES
    ('city:las-vegas-nv', 'Valley', '/places/las-vegas-nv', FALSE, 10),
    ('city:las-vegas-nv', 'City', '/places/cities/las-vegas-nv', TRUE, 20),
    ('city:las-vegas-nv', 'Clark County', '/places/counties/clark-county-nv', FALSE, 30),
    ('city:las-vegas-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', FALSE, 40),
    ('city:las-vegas-nv', 'Henderson', '/places/cities/henderson-nv', FALSE, 50),
    ('city:las-vegas-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', FALSE, 60),
    ('county:clark-county-nv', 'Valley', '/places/las-vegas-nv', FALSE, 10),
    ('county:clark-county-nv', 'City', '/places/cities/las-vegas-nv', FALSE, 20),
    ('county:clark-county-nv', 'Clark County', '/places/counties/clark-county-nv', TRUE, 30),
    ('county:clark-county-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', FALSE, 40),
    ('county:clark-county-nv', 'Henderson', '/places/cities/henderson-nv', FALSE, 50),
    ('county:clark-county-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', FALSE, 60),
    ('metro:las-vegas-henderson-paradise-nv', 'Valley', '/places/las-vegas-nv', FALSE, 10),
    ('metro:las-vegas-henderson-paradise-nv', 'City', '/places/cities/las-vegas-nv', FALSE, 20),
    ('metro:las-vegas-henderson-paradise-nv', 'Clark County', '/places/counties/clark-county-nv', FALSE, 30),
    ('metro:las-vegas-henderson-paradise-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', TRUE, 40),
    ('metro:las-vegas-henderson-paradise-nv', 'Henderson', '/places/cities/henderson-nv', FALSE, 50),
    ('metro:las-vegas-henderson-paradise-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', FALSE, 60),
    ('city:henderson-nv', 'Valley', '/places/las-vegas-nv', FALSE, 10),
    ('city:henderson-nv', 'City', '/places/cities/las-vegas-nv', FALSE, 20),
    ('city:henderson-nv', 'Clark County', '/places/counties/clark-county-nv', FALSE, 30),
    ('city:henderson-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', FALSE, 40),
    ('city:henderson-nv', 'Henderson', '/places/cities/henderson-nv', TRUE, 50),
    ('city:henderson-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', FALSE, 60),
    ('city:north-las-vegas-nv', 'Valley', '/places/las-vegas-nv', FALSE, 10),
    ('city:north-las-vegas-nv', 'City', '/places/cities/las-vegas-nv', FALSE, 20),
    ('city:north-las-vegas-nv', 'Clark County', '/places/counties/clark-county-nv', FALSE, 30),
    ('city:north-las-vegas-nv', 'Metro', '/places/metros/las-vegas-henderson-paradise-nv', FALSE, 40),
    ('city:north-las-vegas-nv', 'Henderson', '/places/cities/henderson-nv', FALSE, 50),
    ('city:north-las-vegas-nv', 'North Las Vegas', '/places/cities/north-las-vegas-nv', TRUE, 60)
ON CONFLICT (place_key, href) DO UPDATE SET
    label = EXCLUDED.label,
    active = EXCLUDED.active,
    sort_order = EXCLUDED.sort_order;

INSERT INTO place_query_filters (id, place_key, city, state, region, sort_order)
VALUES
    ('las-vegas-nv-las-vegas', 'las-vegas-nv', 'Las Vegas', 'NV', NULL, 10),
    ('las-vegas-nv-henderson', 'las-vegas-nv', 'Henderson', 'NV', NULL, 20),
    ('las-vegas-nv-north-las-vegas', 'las-vegas-nv', 'North Las Vegas', 'NV', NULL, 30),
    ('city-las-vegas-nv', 'city:las-vegas-nv', 'Las Vegas', 'NV', NULL, 10),
    ('county-clark-county-nv-las-vegas', 'county:clark-county-nv', 'Las Vegas', 'NV', NULL, 10),
    ('county-clark-county-nv-henderson', 'county:clark-county-nv', 'Henderson', 'NV', NULL, 20),
    ('county-clark-county-nv-north-las-vegas', 'county:clark-county-nv', 'North Las Vegas', 'NV', NULL, 30),
    ('metro-las-vegas-henderson-paradise-nv-las-vegas', 'metro:las-vegas-henderson-paradise-nv', 'Las Vegas', 'NV', NULL, 10),
    ('metro-las-vegas-henderson-paradise-nv-henderson', 'metro:las-vegas-henderson-paradise-nv', 'Henderson', 'NV', NULL, 20),
    ('metro-las-vegas-henderson-paradise-nv-north-las-vegas', 'metro:las-vegas-henderson-paradise-nv', 'North Las Vegas', 'NV', NULL, 30),
    ('city-henderson-nv', 'city:henderson-nv', 'Henderson', 'NV', NULL, 10),
    ('city-north-las-vegas-nv', 'city:north-las-vegas-nv', 'North Las Vegas', 'NV', NULL, 10)
ON CONFLICT (id) DO UPDATE SET
    place_key = EXCLUDED.place_key,
    city = EXCLUDED.city,
    state = EXCLUDED.state,
    region = EXCLUDED.region,
    sort_order = EXCLUDED.sort_order;

INSERT INTO place_summary_facts (place_key, label, value, attribution, sort_order)
VALUES
    ('las-vegas-nv', 'Metro', 'Las Vegas-Henderson-Paradise', NULL, 10),
    ('las-vegas-nv', 'County', 'Clark County', NULL, 20),
    ('las-vegas-nv', 'Valley cities', 'Las Vegas, Henderson, North Las Vegas', NULL, 30),
    ('las-vegas-nv', 'Largest work base', 'Tourism, service, logistics', NULL, 40),
    ('las-vegas-nv', 'Active issues', 'Housing, transit, heat, water', NULL, 50)
ON CONFLICT (place_key, label) DO UPDATE SET
    value = EXCLUDED.value,
    attribution = EXCLUDED.attribution,
    sort_order = EXCLUDED.sort_order;

INSERT INTO place_governments (id, place_key, name, role, sort_order)
VALUES
    ('las-vegas-nv-city', 'las-vegas-nv', 'City of Las Vegas', 'Mayor and council, city budget, planning, public works, city services.', 10),
    ('las-vegas-nv-clark-county', 'las-vegas-nv', 'Clark County', 'County commission, courts, public health, regional services, unincorporated areas.', 20),
    ('las-vegas-nv-rtc', 'las-vegas-nv', 'RTC Southern Nevada', 'Transit planning, bus operations, and regional transportation projects.', 30),
    ('las-vegas-nv-snwa', 'las-vegas-nv', 'Southern Nevada Water Authority', 'Regional water supply, conservation policy, and drought planning.', 40)
ON CONFLICT (id) DO UPDATE SET
    place_key = EXCLUDED.place_key,
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    sort_order = EXCLUDED.sort_order;

INSERT INTO place_government_links (government_id, label, href, sort_order)
VALUES
    ('las-vegas-nv-city', 'Council agendas', 'https://www.lasvegasnevada.gov/Government', 10),
    ('las-vegas-nv-clark-county', 'Commission agendas', 'https://www.clarkcountynv.gov/', 10),
    ('las-vegas-nv-rtc', 'Board meetings', 'https://www.rtcsnv.com/', 10),
    ('las-vegas-nv-snwa', 'Water plans', 'https://www.snwa.com/', 10)
ON CONFLICT (government_id, href) DO UPDATE SET
    label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order;

DELETE FROM place_related_places
WHERE id IN (
    'las-vegas-nv-strip',
    'las-vegas-nv-east-las-vegas',
    'las-vegas-nv-historic-westside',
    'las-vegas-nv-maryland-parkway',
    'las-vegas-nv-boulder-highway'
);
