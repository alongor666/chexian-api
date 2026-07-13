import crypto from 'crypto';
import { pinyin } from 'pinyin-pro';
import { escapeSqlValue } from '../utils/security.js';
import { AppError } from '../middleware/error.js';
import { duckdbService } from './duckdb.js';
import {
  createFeishuUserWithIdentity,
  getUserById,
  persistAccessControlState,
  reactivateFeishuUserEntitlement,
  updateFeishuUserEntitlement,
  refreshActiveUsernames,
  type AccessUser,
} from './access-control.js';
import type { AuthIdentityRecord } from './auth-model.js';

const provisioningLocks = new Map<string, Promise<FindOrCreateResult>>();
const TOMBSTONE_HASH = '$2b$10$FeishuOnlyTombstone000000000000000000000000000000000u';

export interface FindOrCreateResult {
  user: AccessUser;
  identity: AuthIdentityRecord;
  created: boolean;
}

export function buildFeishuUsername(displayName: string, feishuUserId: string): string {
  const stem = pinyin(displayName, { toneType: 'none', type: 'array' })
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 48) || 'feishu';
  const suffix = crypto.createHash('sha256').update(feishuUserId).digest('hex').slice(0, 6);
  return `${stem}_${suffix}`;
}

function mapIdentity(row: Record<string, unknown>): AuthIdentityRecord {
  return {
    id: String(row.id), userId: String(row.user_id), provider: 'feishu',
    providerSubject: String(row.provider_subject), enabled: Boolean(row.enabled),
    lastVerifiedAt: row.last_verified_at ? String(row.last_verified_at) : undefined,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export async function findFeishuIdentity(feishuUserId: string): Promise<AuthIdentityRecord | null> {
  const rows = await duckdbService.query(`
    SELECT * FROM AuthIdentity
    WHERE provider = 'feishu' AND provider_subject = '${escapeSqlValue(feishuUserId)}'
    LIMIT 1
  `);
  return rows[0] ? mapIdentity(rows[0]) : null;
}

export async function listEnabledFeishuIdentities(): Promise<AuthIdentityRecord[]> {
  const rows = await duckdbService.query(`SELECT * FROM AuthIdentity WHERE provider = 'feishu' AND enabled = true`);
  return rows.map(mapIdentity);
}

export async function disableFeishuIdentity(providerSubject: string): Promise<void> {
  const identity = await findFeishuIdentity(providerSubject);
  if (!identity) return;
  const now = new Date().toISOString();
  await duckdbService.query(`UPDATE AuthIdentity SET enabled = false, updated_at = '${escapeSqlValue(now)}' WHERE id = '${escapeSqlValue(identity.id)}'`);
  await duckdbService.query(`UPDATE UserAccount SET active = false, updated_at = CURRENT_TIMESTAMP WHERE id = '${escapeSqlValue(identity.userId)}'`);
  await persistAccessControlState();
  await refreshActiveUsernames();
}

export async function findFeishuAccount(feishuUserId: string): Promise<{ user: AccessUser; identity: AuthIdentityRecord } | null> {
  const identity = await findFeishuIdentity(feishuUserId);
  if (!identity || !identity.enabled) return null;
  const user = await getUserById(identity.userId);
  return user?.active ? { user, identity } : null;
}

async function provision(input: {
  feishuUserId: string; displayName: string; role: 'org_user'; organization: string; branchCode: string;
}): Promise<FindOrCreateResult> {
  const historicalIdentity = await findFeishuIdentity(input.feishuUserId);
  const now = new Date().toISOString();
  if (historicalIdentity) {
    const historicalUser = await getUserById(historicalIdentity.userId);
    if (!historicalUser) throw new AppError(500, '飞书身份绑定的账号不存在');
    if (historicalIdentity.enabled && !historicalUser.active) {
      throw new AppError(403, 'Account disabled');
    }
    const user = historicalIdentity.enabled
      ? await updateFeishuUserEntitlement(historicalUser, input)
      : await reactivateFeishuUserEntitlement(historicalUser, input);
    await duckdbService.query(`UPDATE AuthIdentity SET enabled = true, last_verified_at = '${escapeSqlValue(now)}', updated_at = '${escapeSqlValue(now)}' WHERE id = '${escapeSqlValue(historicalIdentity.id)}'`);
    await persistAccessControlState();
    return {
      user,
      identity: { ...historicalIdentity, enabled: true, lastVerifiedAt: now, updatedAt: now },
      created: false,
    };
  }
  const identityId = crypto.randomUUID();
  const user = await createFeishuUserWithIdentity({
    username: buildFeishuUsername(input.displayName, input.feishuUserId),
    displayName: input.displayName, role: input.role, organization: input.organization,
    branchCode: input.branchCode, passwordHash: TOMBSTONE_HASH,
    identityId, providerSubject: input.feishuUserId, verifiedAt: now,
  });
  const identity: AuthIdentityRecord = {
    id: identityId, userId: user.id, provider: 'feishu', providerSubject: input.feishuUserId,
    enabled: true, lastVerifiedAt: now, createdAt: now, updatedAt: now,
  };
  return { user, identity, created: true };
}

export async function findOrCreateFeishuAccount(input: {
  feishuUserId: string; displayName: string; role: 'org_user'; organization: string; branchCode: string;
}): Promise<FindOrCreateResult> {
  const inFlight = provisioningLocks.get(input.feishuUserId);
  if (inFlight) return inFlight;
  const request = provision(input);
  provisioningLocks.set(input.feishuUserId, request);
  try { return await request; } finally { provisioningLocks.delete(input.feishuUserId); }
}
