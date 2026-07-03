/** Identity and account domain types shared across processes and services. */

export type AuthProviderId = 'google' | 'github' | 'microsoft' | 'apple' | 'email';

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
}

/** A single federated identity linked to a user (one user may link several). */
export interface AuthIdentity {
  provider: AuthProviderId;
  providerUserId: string;
  email: string | null;
}
