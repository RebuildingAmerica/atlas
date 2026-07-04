export interface AdapterUpdateInput {
  model: string;
  update: Record<string, unknown>;
  where: { field: string; value: string }[];
}

export type AdapterUpdate = (input: AdapterUpdateInput) => Promise<unknown>;
export type AdapterCreate = (input: unknown) => Promise<unknown>;
export type AdapterFindOne = (input?: unknown) => Promise<unknown>;
export type UserLookup = (input: unknown) => Promise<unknown>;
export type UserUpdate = (userId: string, input: unknown) => Promise<unknown>;
export type EnsureAuthReady = () => Promise<unknown>;
export type GrantWorkspaceProduct = (input: unknown) => Promise<unknown>;
