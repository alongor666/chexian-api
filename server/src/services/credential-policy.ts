import { AppError } from '../middleware/error.js';
import { escapeSqlValue } from '../utils/security.js';
import { duckdbService } from './duckdb.js';
import type { PasswordCredentialRecord } from './auth-model.js';
import { persistAccessControlState } from './access-control.js';

function mapPasswordCredential(row: Record<string, unknown>): PasswordCredentialRecord {
  return {
    userId: String(row.user_id),
    passwordHash: String(row.password_hash),
    state: String(row.state) as PasswordCredentialRecord['state'],
    changedAt: row.changed_at ? String(row.changed_at) : undefined,
  };
}

export async function getPasswordCredential(userId: string): Promise<PasswordCredentialRecord | null> {
  const rows = await duckdbService.query(`
    SELECT user_id, password_hash, state, changed_at
    FROM PasswordCredential
    WHERE user_id = '${escapeSqlValue(userId)}'
    LIMIT 1
  `);
  return rows[0] ? mapPasswordCredential(rows[0]) : null;
}

export async function upsertPasswordCredential(record: PasswordCredentialRecord): Promise<void> {
  await duckdbService.query(`DELETE FROM PasswordCredential WHERE user_id = '${escapeSqlValue(record.userId)}'`);
  await duckdbService.query(`
    INSERT INTO PasswordCredential (user_id, password_hash, state, changed_at, updated_at)
    VALUES (
      '${escapeSqlValue(record.userId)}',
      '${escapeSqlValue(record.passwordHash)}',
      '${escapeSqlValue(record.state)}',
      ${record.changedAt ? `'${escapeSqlValue(record.changedAt)}'` : 'NULL'},
      '${escapeSqlValue(new Date().toISOString())}'
    )
  `);
  await persistAccessControlState();
}

export async function getAuthMethods(userId: string): Promise<Array<'password' | 'feishu'>> {
  const methods: Array<'password' | 'feishu'> = [];
  if (await getPasswordCredential(userId)) methods.push('password');
  const identities = await duckdbService.query(`
    SELECT provider
    FROM AuthIdentity
    WHERE user_id = '${escapeSqlValue(userId)}' AND enabled = true
  `);
  if (identities.some((row) => row.provider === 'feishu')) methods.push('feishu');
  return methods;
}

export async function assertPasswordAllowed(userId: string): Promise<PasswordCredentialRecord> {
  const credential = await getPasswordCredential(userId);
  if (!credential) throw new AppError(403, 'AUTH_METHOD_NOT_ALLOWED');
  return credential;
}

export async function assertPatAllowed(userId: string): Promise<void> {
  await assertPasswordAllowed(userId);
}

export async function credentialSetupRequired(userId: string): Promise<boolean> {
  const credential = await getPasswordCredential(userId);
  return credential?.state === 'bootstrap_required';
}
