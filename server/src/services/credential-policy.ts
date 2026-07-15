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
  // PAT 会话的 userId = JWT userId（= 用户名，见 auth.ts login / issueCookieSession），
  // 而全员密码改造（2026-07-11）后 PasswordCredential.user_id 存的是 UserAccount.id（uuid）。
  // 只按原值查会键不匹配 → 所有密码登录用户创建 PAT 恒 403（2026-07-15 本地实测发现）。
  // 修复：先按原值查（兼容 user_id 直接命中，如单测/历史行），未命中再经 UserAccount.username 解析。
  const direct = await getPasswordCredential(userId);
  if (direct) return;
  const rows = await duckdbService.query(`
    SELECT pc.user_id
    FROM PasswordCredential pc
    JOIN UserAccount ua ON ua.id = pc.user_id
    WHERE ua.username = '${escapeSqlValue(userId)}'
    LIMIT 1
  `);
  if (rows.length === 0) throw new AppError(403, 'AUTH_METHOD_NOT_ALLOWED');
}

export async function credentialSetupRequired(userId: string): Promise<boolean> {
  const credential = await getPasswordCredential(userId);
  return credential?.state === 'bootstrap_required';
}
