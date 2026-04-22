/**
 * JSON-LD structured data for profile pages.
 *
 * Renders a `<script type="application/ld+json">` tag containing
 * schema.org Person or Organization markup. Included in the profile
 * page body so search engines can extract rich results.
 */
import type { Entry } from "@/types";

interface ProfileJsonLdProps {
  /** The actor entry to generate structured data for. */
  entry: Entry;
  /** The affiliated organization (for person profiles). */
  affiliatedOrg?: Entry | null;
  /** People affiliated with this organization (for org profiles). */
  affiliatedPeople?: Entry[];
}

/**
 * Render schema.org JSON-LD structured data for a profile page.
 *
 * Outputs Person or Organization markup with areaServed, knowsAbout,
 * memberOf, and sameAs properties for search engine rich results.
 */
export function ProfileJsonLd({ entry, affiliatedOrg, affiliatedPeople }: ProfileJsonLdProps) {
  const jsonLd =
    entry.type === "person"
      ? buildPersonSchema(entry, affiliatedOrg)
      : buildOrganizationSchema(entry, affiliatedPeople);

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

function buildPersonSchema(entry: Entry, affiliatedOrg?: Entry | null): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: entry.name,
    description: entry.description,
    url: `https://atlas.rebuildingamerica.com/profiles/people/${entry.slug}`,
  };

  if (entry.city && entry.state) {
    schema.areaServed = { "@type": "Place", name: `${entry.city}, ${entry.state}` };
  }

  if (entry.issue_areas.length > 0) {
    schema.knowsAbout = entry.issue_areas;
  }

  if (affiliatedOrg) {
    schema.memberOf = {
      "@type": "Organization",
      name: affiliatedOrg.name,
      url: `https://atlas.rebuildingamerica.com/profiles/organizations/${affiliatedOrg.slug}`,
    };
  }

  const sameAs = extractSocialUrls(entry);
  if (sameAs.length > 0) {
    schema.sameAs = sameAs;
  }

  return schema;
}

function buildOrganizationSchema(
  entry: Entry,
  affiliatedPeople?: Entry[],
): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: entry.name,
    description: entry.description,
    url: `https://atlas.rebuildingamerica.com/profiles/organizations/${entry.slug}`,
  };

  if (entry.city && entry.state) {
    schema.areaServed = { "@type": "Place", name: `${entry.city}, ${entry.state}` };
  }

  if (entry.issue_areas.length > 0) {
    schema.knowsAbout = entry.issue_areas;
  }

  if (affiliatedPeople && affiliatedPeople.length > 0) {
    schema.member = affiliatedPeople.map((person) => ({
      "@type": "Person",
      name: person.name,
      url: `https://atlas.rebuildingamerica.com/profiles/people/${person.slug}`,
    }));
  }

  const sameAs = extractSocialUrls(entry);
  if (sameAs.length > 0) {
    schema.sameAs = sameAs;
  }

  return schema;
}

/** Extract HTTP URLs from the social_media field for schema.org sameAs. */
function extractSocialUrls(entry: Entry): string[] {
  if (!entry.social_media) return [];
  return Object.values(entry.social_media).filter(
    (url): url is string => typeof url === "string" && url.startsWith("http"),
  );
}
