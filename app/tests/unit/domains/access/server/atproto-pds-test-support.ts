/**
 * The account-creation payload Atlas hands the Atlas PDS agent. Mirrors the
 * fields `provisionManagedAtprotoIdentity` sends, so a test can read what the
 * adapter asked for without reaching through an untyped mock.
 */
export interface ManagedPdsAccountInput {
  email: string;
  handle: string;
  inviteCode?: string;
  password: string;
}

/**
 * What the stubbed PDS agent answers with. The session tokens are present on
 * the wire and must never travel back out of the adapter, so they stay part of
 * the shape the tests can assert against.
 */
export interface ManagedPdsAccountResult {
  data: {
    accessJwt?: string;
    did: string;
    handle: string;
    refreshJwt?: string;
  };
}

/** The stubbed `AtpAgent.createAccount` the PDS tests install. */
export type ManagedPdsCreateAccount = (
  input: ManagedPdsAccountInput,
) => Promise<ManagedPdsAccountResult>;
