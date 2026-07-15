export interface IssueArea {
  slug: string;
  name: string;
  description: string;
}

export type TaxonomyResponse = Record<string, IssueArea[]>;
