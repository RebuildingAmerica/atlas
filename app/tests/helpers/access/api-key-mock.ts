export interface CreateApiKeyMetadata {
  organizationId: string;
  userEmail: string;
}

export interface CreateApiKeyRequestBody {
  metadata: CreateApiKeyMetadata;
  userId: string;
  [key: string]: unknown;
}

export interface CreateApiKeyRequest {
  body: CreateApiKeyRequestBody;
}

export interface CreateApiKeyResult {
  key?: string;
}

export type CreateApiKeyMock = (input: CreateApiKeyRequest) => Promise<CreateApiKeyResult>;
