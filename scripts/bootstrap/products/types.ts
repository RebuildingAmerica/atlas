export interface ProductBootstrapResult {
  success: boolean;
  followUpItems: string[];
}

export type BootstrapEnvironment = "test" | "live";
