export type AuthProvider = 'feishu';

export interface AuthIdentityRecord {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerSubject: string;
  enabled: boolean;
  lastVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type PasswordCredentialState = 'bootstrap_required' | 'active';

export interface PasswordCredentialRecord {
  userId: string;
  passwordHash: string;
  state: PasswordCredentialState;
  changedAt?: string;
}
