export interface IssueArea {
  slug: string;
  name: string;
  search_terms: string[];
  domain: string;
}

export interface IssueDomain {
  slug: string;
  name: string;
  issue_areas: IssueArea[];
}

export interface TaxonomyResponse {
  domains: IssueDomain[];
}
