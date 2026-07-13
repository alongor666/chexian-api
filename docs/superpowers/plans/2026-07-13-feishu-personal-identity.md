# Feishu Personal Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将运城部门飞书成员从共享 `sx_yuncheng` 改为稳定身份绑定的一人一账号，并让飞书专属账号在模型层不具备密码、找回和 PAT 能力。

**Architecture:** `UserAccount` 继续承载授权与 active 生命周期；新增 `AuthIdentity` 绑定飞书 `user_id`，新增 `PasswordCredential` 表达密码能力。飞书部门解析使用共享 application client 和 `member/not_member/unavailable` 三态；首次登录原子创建个人账号，JWT 记录 `amr=['feishu']`，密码链统一经过 credential policy。

**Tech Stack:** TypeScript, Express, DuckDB, better-sqlite3, Vitest, Bun, React.

---

## File map

**Create**

- `server/src/services/auth-identity.ts`：外部身份 CRUD、稳定用户名生成、飞书个人账号原子开户。
- `server/src/services/credential-policy.ts`：密码凭据 CRUD 与统一能力判断。
- `server/src/services/feishu-app-client.ts`：共享 tenant token 缓存、超时和飞书服务端请求。
- `server/src/services/feishu-identity-reconciler.ts`：定时复核已绑定飞书账号并执行有界权限回收。
- `server/src/config/feishu-department-entitlements.ts`：部门到权限模板的唯一配置。
- `server/src/services/__tests__/auth-identity.test.ts`：身份唯一性、同名和并发开户。
- `server/src/services/__tests__/auth-credential-policy.test.ts`：密码/PAT/重置能力回归。
- `server/src/services/__tests__/feishu-personal-identity.test.ts`：部门三态和个人账号解析。
- `server/src/services/__tests__/feishu-identity-reconciler.test.ts`：定时对账、不可用不误停和幂等启动。
- `src/shared/contexts/__tests__/PermissionContext.test.tsx`：前端认证能力响应契约。

**Modify**

- `server/src/services/duckdb-init-tables.ts`：新增 `AuthIdentity`、`PasswordCredential` 表和唯一索引。
- `server/src/services/state-db-schema.ts`：append-only 新增 SQLite migration。
- `server/src/services/access-control.ts`：snapshot v2、凭据/身份持久化、个人账号创建与停用。
- `server/src/services/access-control-store.ts`：SQLite snapshot 双写身份与凭据。
- `server/src/services/auth.ts`：密码登录、pns、会话 `amr` 与 refresh 语义。
- `server/src/services/activation-token.ts`：签发与消费前检查 password capability。
- `server/src/services/personal-access-token.ts`：飞书专属账号创建 PAT 时 fail-closed。
- `server/src/services/notify.ts`：复用 `feishu-app-client.ts`。
- `server/src/services/feishu.ts`：部门解析、个人映射和显式 deny 优先级。
- `server/src/routes/feishu-auth.ts`：login 自动开户；reset 仅允许密码账号。
- `server/src/routes/auth.ts`：改密、管理员令牌、PAT 和 `/me` 契约。
- `server/src/middleware/auth.ts`：JWT 增加 `sub/amr/identityId` 并在 refresh 中保留。
- `server/src/config/env.ts`、`.env.example`：默认关闭的部门个人开户开关。
- `src/shared/api/types.ts`、`src/shared/contexts/PermissionContext.tsx`：消费 `authMethods/canChangePassword`。

## Task 1: Add identity and credential persistence primitives

**Files:**
- Modify: `server/src/services/duckdb-init-tables.ts`
- Modify: `server/src/services/state-db-schema.ts`
- Modify: `server/src/services/access-control-store.ts`
- Test: `server/src/services/__tests__/state-db.test.ts`

- [ ] **Step 1: Write failing migration tests**

Add assertions that migrations append IDs 8 and 9 and create both unique identity and password credential tables:

```ts
expect(MIGRATIONS.at(-2)).toMatchObject({ id: 8 });
expect(MIGRATIONS.at(-2)?.sql).toContain('UNIQUE(provider, provider_subject)');
expect(MIGRATIONS.at(-1)).toMatchObject({ id: 9 });
expect(MIGRATIONS.at(-1)?.sql).toContain('password_credentials');
```

- [ ] **Step 2: Run the migration test and verify RED**

Run: `cd server && bun run test --run src/services/__tests__/state-db.test.ts`

Expected: FAIL because migration 8/9 and the tables do not exist.

- [ ] **Step 3: Add append-only SQLite migrations and DuckDB tables**

Append migrations without editing IDs 1-7:

```ts
{
  id: 8,
  description: 'auth identities for external login providers',
  sql: `
    CREATE TABLE IF NOT EXISTS auth_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider, provider_subject)
    );
    CREATE INDEX IF NOT EXISTS idx_auth_identities_user ON auth_identities(user_id);
  `,
},
{
  id: 9,
  description: 'password credentials separated from access users',
  sql: `
    CREATE TABLE IF NOT EXISTS password_credentials (
      user_id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('bootstrap_required', 'active')),
      changed_at TEXT,
      updated_at TEXT NOT NULL
    );
  `,
},
```

Create matching DuckDB tables and a unique index on `(provider, provider_subject)`.

- [ ] **Step 4: Extend SQLite snapshot types and replaceAll/readAll**

Define shared records:

```ts
export interface AuthIdentityRecord {
  id: string;
  userId: string;
  provider: 'feishu';
  providerSubject: string;
  enabled: boolean;
  lastVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PasswordCredentialRecord {
  userId: string;
  passwordHash: string;
  state: 'bootstrap_required' | 'active';
  changedAt?: string;
}
```

Extend `AccessControlSnapshot` with `identities` and `passwordCredentials`; delete and insert child tables before users are replaced, then restore identities/credentials after users.

- [ ] **Step 5: Run persistence tests and server typecheck**

Run:

```bash
cd server
bun run test --run src/services/__tests__/state-db.test.ts src/services/__tests__/access-control-store.test.ts
bun x tsc --noEmit
```

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/duckdb-init-tables.ts server/src/services/state-db-schema.ts server/src/services/access-control-store.ts server/src/services/__tests__
git commit -m "feat(auth): add identity and credential persistence"
```

## Task 2: Add credential policy with legacy password backfill

**Files:**
- Create: `server/src/services/credential-policy.ts`
- Create: `server/src/services/__tests__/auth-credential-policy.test.ts`
- Modify: `server/src/services/access-control.ts`
- Modify: `server/src/services/auth.ts`

- [ ] **Step 1: Write failing policy tests**

Cover these exact cases:

```ts
expect(await getAuthMethods(passwordUser.id)).toEqual(['password']);
expect(await getAuthMethods(feishuOnlyUser.id)).toEqual(['feishu']);
await expect(assertPasswordAllowed(feishuOnlyUser.id)).rejects.toMatchObject({
  statusCode: 403,
  message: 'AUTH_METHOD_NOT_ALLOWED',
});
expect(await credentialSetupRequired(passwordBootstrapUser.id)).toBe(true);
expect(await credentialSetupRequired(feishuOnlyUser.id)).toBe(false);
```

- [ ] **Step 2: Run the policy test and verify RED**

Run: `cd server && bun run test --run src/services/__tests__/auth-credential-policy.test.ts`

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement credential policy**

Expose this interface:

```ts
export async function getPasswordCredential(userId: string): Promise<PasswordCredentialRecord | null>;
export async function upsertPasswordCredential(record: PasswordCredentialRecord): Promise<void>;
export async function getAuthMethods(userId: string): Promise<Array<'password' | 'feishu'>>;
export async function assertPasswordAllowed(userId: string): Promise<PasswordCredentialRecord>;
export async function credentialSetupRequired(userId: string): Promise<boolean>;
```

`assertPasswordAllowed` returns 403 `AUTH_METHOD_NOT_ALLOWED` when no password credential exists.

- [ ] **Step 4: Upgrade access-control snapshot to version 2**

Persist:

```ts
interface UserStoreData {
  version: 2;
  exportedAt: string;
  users: AccessUser[];
  roles: AccessRole[];
  identities: AuthIdentityRecord[];
  passwordCredentials: PasswordCredentialRecord[];
}
```

When loading legacy version 1, backfill one password credential per existing user:

```ts
{
  userId: user.id,
  passwordHash: user.passwordHash,
  state: user.passwordChangedAt ? 'active' : 'bootstrap_required',
  changedAt: user.passwordChangedAt,
}
```

Preset and administrator-created users continue to receive password credentials. Feishu automatic provisioning uses a separate API that does not create one.

- [ ] **Step 5: Route auth pns through credential state**

Change `isPasswordNotSetForUsername` and login construction to await `credentialSetupRequired(user.id)`. Preserve the JWT field name `pns` for compatibility, but stop inferring it from missing `password_changed_at`.

- [ ] **Step 6: Run password regression tests**

Run:

```bash
cd server
bun run test --run src/services/__tests__/auth-credential-policy.test.ts src/services/__tests__/auth-password-change.test.ts src/services/__tests__/auth-sx-active-gate.test.ts
bun x tsc --noEmit
```

Expected: policy tests and all existing password tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/credential-policy.ts server/src/services/access-control.ts server/src/services/auth.ts server/src/services/__tests__
git commit -m "refactor(auth): derive password setup from credentials"
```

## Task 3: Enforce password and PAT capabilities at every write boundary

**Files:**
- Modify: `server/src/services/activation-token.ts`
- Modify: `server/src/services/personal-access-token.ts`
- Modify: `server/src/routes/auth.ts`
- Test: `server/src/services/__tests__/activation-token.test.ts`
- Test: `server/src/services/__tests__/password-reset-token.test.ts`
- Test: `server/src/services/__tests__/personal-access-token.test.ts`
- Test: `server/src/services/__tests__/auth-credential-policy.test.ts`

- [ ] **Step 1: Write failing boundary tests**

For a Feishu-only account, assert:

```ts
await expect(authService.login(username, 'anything')).rejects.toMatchObject({ statusCode: 403 });
await expect(authService.changePassword(username, undefined, 'BrandNew#2026')).rejects.toMatchObject({ statusCode: 403 });
await expect(createActivationToken(input)).rejects.toMatchObject({ statusCode: 403 });
await expect(createPasswordResetToken(input)).rejects.toMatchObject({ statusCode: 403 });
await expect(createPat(patInput)).rejects.toMatchObject({ statusCode: 403 });
```

- [ ] **Step 2: Run boundary tests and verify RED**

Run the four selected test files. Expected: Feishu-only cases FAIL because current services only check account existence/active state.

- [ ] **Step 3: Add service-layer guards**

Call `assertPasswordAllowed(user.id)` before password verification, change, activation token creation, reset token creation and token consumption. Add `assertPatAllowed(userId)` that rejects accounts with no password credential during this pilot.

Keep route checks as defense-in-depth, but service checks are mandatory so alternate callers cannot bypass policy.

- [ ] **Step 4: Update `/me` response**

Return:

```ts
{
  ...rest,
  authMethods,
  canChangePassword: authMethods.includes('password'),
  mustChangePassword: req.user.pns === true || undefined,
  hasPassword: passwordCredential?.state === 'active',
}
```

- [ ] **Step 5: Run auth route and credential regressions**

Run:

```bash
cd server
bun run test --run src/services/__tests__/activation-token.test.ts src/services/__tests__/password-reset-token.test.ts src/services/__tests__/personal-access-token.test.ts src/services/__tests__/auth-credential-policy.test.ts
bun x tsc --noEmit
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/activation-token.ts server/src/services/personal-access-token.ts server/src/routes/auth.ts server/src/services/__tests__
git commit -m "fix(auth): enforce credential capabilities"
```

## Task 4: Extract shared Feishu application client

**Files:**
- Create: `server/src/services/feishu-app-client.ts`
- Modify: `server/src/services/notify.ts`
- Test: `server/src/services/__tests__/notify-password-event.test.ts`
- Create: `server/src/services/__tests__/feishu-app-client.test.ts`

- [ ] **Step 1: Write failing client tests**

Test cache hit, five-minute early refresh, concurrent first request, timeout, HTTP failure, business-code failure and log redaction. The public API is:

```ts
export async function getFeishuTenantAccessToken(input: {
  appId: string;
  appSecret: string;
}): Promise<string>;

export async function feishuAppGetJson<T>(input: {
  appId: string;
  appSecret: string;
  url: string;
  timeoutMs?: number;
}): Promise<T>;
```

- [ ] **Step 2: Run client tests and verify RED**

Run: `cd server && bun run test --run src/services/__tests__/feishu-app-client.test.ts`

Expected: FAIL because the shared client does not exist.

- [ ] **Step 3: Move token lifecycle out of notify.ts**

Use a cache keyed by app ID and an in-flight promise map:

```ts
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const tokenInFlight = new Map<string, Promise<string>>();
const REFRESH_AHEAD_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;
```

Always use `AbortSignal.timeout(timeoutMs)`. Error messages may contain HTTP status and Feishu code/msg, but never app secret or token.

- [ ] **Step 4: Rewire notify and run tests**

`notify.ts` imports `getFeishuTenantAccessToken` and deletes its private cache implementation. Preserve `__resetTenantTokenCacheForTest` via a test-only reset export from the client.

Run notification and new client tests. Expected: PASS with unchanged notification semantics.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/feishu-app-client.ts server/src/services/notify.ts server/src/services/__tests__
git commit -m "refactor(feishu): share application token client"
```

## Task 5: Add department entitlement resolver with tri-state errors

**Files:**
- Create: `server/src/config/feishu-department-entitlements.ts`
- Modify: `server/src/config/env.ts`
- Modify: `.env.example`
- Modify: `server/src/services/feishu.ts`
- Create: `server/src/services/__tests__/feishu-personal-identity.test.ts`

- [ ] **Step 1: Write failing department tests**

Lock the resolver contract:

```ts
expect(result).toEqual({ status: 'member', entitlement: expect.objectContaining({ organization: '运城', branchCode: 'SX' }) });
expect(nonMember).toEqual({ status: 'not_member' });
expect(apiFailure).toEqual({ status: 'unavailable', reason: expect.any(String) });
```

Also assert the feature flag off path performs zero network calls and explicit personal `deny` returns before department resolution.

- [ ] **Step 2: Run resolver tests and verify RED**

Run the new test. Expected: FAIL because entitlement configuration and tri-state resolver do not exist.

- [ ] **Step 3: Add entitlement configuration and startup validation**

Create the exact pilot entry:

```ts
export const FEISHU_DEPARTMENT_ENTITLEMENTS = [{
  feishuDeptId: 'od-395bce9db9d4acccae3e6da8d25cb672',
  feishuDeptName: '运城',
  role: 'org_user' as const,
  organization: '运城',
  branchCode: 'SX',
}];
```

Reject duplicate department IDs, invalid branch code and missing organization at module initialization.

- [ ] **Step 4: Add feature flag and resolver**

Add `FEISHU_DEPARTMENT_PERSONAL_ACCOUNTS_ENABLED`, default empty/off, to `feishuEnv` and `.env.example`.

Implement:

```ts
export type DepartmentEntitlementResolution =
  | { status: 'member'; entitlement: FeishuDepartmentEntitlement }
  | { status: 'not_member' }
  | { status: 'unavailable'; reason: string };
```

Call `/contact/v3/users/{user_id}?department_id_type=open_department_id&user_id_type=user_id`. Validate HTTP status, Feishu `code`, and `data.user.department_ids` array.

- [ ] **Step 5: Run resolver and existing mapping tests**

Run:

```bash
cd server
bun run test --run src/services/__tests__/feishu-personal-identity.test.ts ../tests/api/feishu-mapping-path.test.ts
bun x tsc --noEmit
```

Expected: all selected tests PASS.

- [ ] **Step 6: Commit**

```bash
git add .env.example server/src/config server/src/services/feishu.ts server/src/services/__tests__/feishu-personal-identity.test.ts
git commit -m "feat(feishu): resolve department entitlements safely"
```

## Task 6: Implement personal identity provisioning and session claims

**Files:**
- Create: `server/src/services/auth-identity.ts`
- Create: `server/src/services/__tests__/auth-identity.test.ts`
- Modify: `server/src/services/access-control.ts`
- Modify: `server/src/services/auth.ts`
- Modify: `server/src/middleware/auth.ts`
- Modify: `server/src/routes/feishu-auth.ts`
- Modify: `server/src/routes/__tests__/feishu-auth-intent.test.ts`

- [ ] **Step 1: Write failing identity tests**

Cover stable binding, name changes, same-name users and concurrent provisioning:

```ts
expect(first.user.id).toBe(second.user.id);
expect(afterRename.user.username).toBe(first.user.username);
expect(afterRename.user.displayName).toBe('张伟新名');
expect(userA.username).not.toBe(userB.username);
expect(new Set(concurrent.map((r) => r.user.id))).toHaveLength(1);
```

- [ ] **Step 2: Run identity tests and verify RED**

Run the new test. Expected: FAIL because identity CRUD and provisioning do not exist.

- [ ] **Step 3: Implement deterministic readable usernames**

Use `pinyin-pro` for the readable stem and Node `crypto` for identity suffix:

```ts
const stem = pinyin(displayName, { toneType: 'none', type: 'array' })
  .join('')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '') || 'feishu';
const suffix = crypto.createHash('sha256').update(feishuUserId).digest('hex').slice(0, 6);
return `${stem}_${suffix}`;
```

Add dependency with `cd server && bun add pinyin-pro` and commit `server/package.json` plus root `bun.lock` with this task.

- [ ] **Step 4: Implement atomic find-or-create**

Expose:

```ts
export async function findOrCreateFeishuAccount(input: {
  feishuUserId: string;
  displayName: string;
  role: 'org_user';
  organization: string;
  branchCode: string;
}): Promise<{ user: AccessUser; identity: AuthIdentityRecord; created: boolean }>;
```

Serialize by `feishuUserId` in-process and rely on the database unique constraint as the final guard. Create a tombstone legacy hash only to satisfy transitional `UserAccount.passwordHash`; do not create `PasswordCredential`.

- [ ] **Step 5: Issue Feishu-authenticated sessions**

Extend session input and JWT payload:

```ts
authMethod?: 'password' | 'feishu';
identityId?: string;
sub?: string;
```

Feishu session contains `sub=user.id`, `userId=user.id`, `amr=['feishu']`, `identityId`, and no `pns`. Refresh preserves these fields.

- [ ] **Step 6: Separate login and reset intent**

Login intent calls department resolver then `findOrCreateFeishuAccount`. Reset intent may resolve a personal `AuthIdentity`, but calls `assertPasswordAllowed(user.id)` before signing a reset token; Feishu-only users receive the existing uniform reset failure.

- [ ] **Step 7: Run identity and callback regressions**

Run:

```bash
cd server
bun run test --run src/services/__tests__/auth-identity.test.ts src/services/__tests__/feishu-personal-identity.test.ts src/routes/__tests__/feishu-auth-intent.test.ts
bun x tsc --noEmit
```

Expected: all tests PASS, including reset intent producing no reset cookie for Feishu-only accounts.

- [ ] **Step 8: Commit**

```bash
git add server/package.json bun.lock server/src/services/auth-identity.ts server/src/services/access-control.ts server/src/services/auth.ts server/src/middleware/auth.ts server/src/routes/feishu-auth.ts server/src/services/__tests__ server/src/routes/__tests__
git commit -m "feat(feishu): provision personal accounts"
```

## Task 7: Add account lifecycle and authorization response contract

**Files:**
- Modify: `server/src/services/auth-identity.ts`
- Create: `server/src/services/feishu-identity-reconciler.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/services/auth.ts`
- Modify: `server/src/routes/auth.ts`
- Modify: `src/shared/api/types.ts`
- Modify: `src/shared/contexts/PermissionContext.tsx`
- Test: `server/src/services/__tests__/auth-identity.test.ts`
- Test: `server/src/services/__tests__/feishu-identity-reconciler.test.ts`
- Test: `server/src/routes/__tests__/feishu-auth-intent.test.ts`
- Test: `src/shared/contexts/__tests__/PermissionContext.test.tsx`

- [ ] **Step 1: Write failing lifecycle tests**

Confirm authoritative non-membership disables account and identity, while unavailable leaves both unchanged. Use fake timers to assert one reconciliation cycle processes every enabled Feishu identity, a second `startFeishuIdentityReconciler()` call does not create another timer, and `stopFeishuIdentityReconciler()` clears it. Confirm `/me` for Feishu account returns:

```json
{
  "authMethods": ["feishu"],
  "canChangePassword": false,
  "mustChangePassword": false,
  "hasPassword": false
}
```

- [ ] **Step 2: Run tests and verify RED**

Run identity, reconciler, callback and PermissionContext tests. Expected: lifecycle, scheduling and response assertions FAIL.

- [ ] **Step 3: Implement authoritative disable path**

Add:

```ts
export async function disableFeishuIdentity(providerSubject: string): Promise<void>;
```

It sets identity `enabled=false`, account `active=false`, persists snapshot and refreshes the existing active username cache. `unavailable` never invokes it.

- [ ] **Step 4: Add bounded scheduled reconciliation**

Expose:

```ts
export async function reconcileFeishuIdentitiesOnce(): Promise<{
  checked: number;
  disabled: number;
  unavailable: number;
}>;
export function startFeishuIdentityReconciler(intervalMs?: number): void;
export function stopFeishuIdentityReconciler(): void;
```

The default interval is 15 minutes. Each cycle lists enabled Feishu identities, resolves current department entitlement and disables only `not_member`; `unavailable` increments a metric/log counter without mutation. `app.ts` starts the reconciler only when `FEISHU_DEPARTMENT_PERSONAL_ACCOUNTS_ENABLED === 'true'` after access-control seed succeeds. The timer uses `unref()` so it does not block process shutdown.

- [ ] **Step 5: Update `/me` and frontend context**

Extend `UserPermission` with:

```ts
authMethods?: Array<'password' | 'feishu'>;
canChangePassword?: boolean;
```

PermissionContext defaults legacy responses to password-capable, but honors explicit false for Feishu users. Existing `mustChangePassword` guard stays unchanged.

- [ ] **Step 6: Run lifecycle and frontend tests**

Run:

```bash
cd server && bun run test --run src/services/__tests__/auth-identity.test.ts src/services/__tests__/feishu-identity-reconciler.test.ts src/routes/__tests__/feishu-auth-intent.test.ts
cd .. && bun run test --run src/shared/contexts/__tests__/PermissionContext.test.tsx
bun run typecheck
```

Expected: selected tests and root typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/auth-identity.ts server/src/services/feishu-identity-reconciler.ts server/src/services/__tests__/feishu-identity-reconciler.test.ts server/src/app.ts server/src/services/auth.ts server/src/routes/auth.ts src/shared/api/types.ts src/shared/contexts/PermissionContext.tsx src/shared/contexts/__tests__/PermissionContext.test.tsx
git commit -m "feat(auth): expose Feishu-only account capabilities"
```

## Task 8: Full verification and rollout documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-07-13-feishu-personal-identity-design.md` only if implementation requires a factual clarification
- Modify: `开发文档/DEVELOPER_CONVENTIONS.md` only if a new durable auth convention must be indexed; otherwise leave unchanged

- [ ] **Step 1: Run all auth and Feishu tests**

```bash
bun run test --run tests/api/feishu-mapping-path.test.ts server/src/services/__tests__/auth-password-change.test.ts server/src/services/__tests__/auth-credential-policy.test.ts server/src/services/__tests__/auth-identity.test.ts server/src/services/__tests__/feishu-app-client.test.ts server/src/services/__tests__/feishu-personal-identity.test.ts server/src/routes/__tests__/feishu-auth-intent.test.ts server/src/services/__tests__/activation-token.test.ts server/src/services/__tests__/password-reset-token.test.ts server/src/services/__tests__/personal-access-token.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 2: Run build and governance**

```bash
bun run build
cd server && bun x tsc --noEmit
cd .. && bun run governance
```

Expected: all commands exit 0.

- [ ] **Step 3: Inspect diff and secret boundaries**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
rg -n "app_secret|tenant_access_token|FEISHU_APP_SECRET" server/src/services server/src/routes
```

Expected: no whitespace errors; no log statement contains secret/token values; only intended auth/Feishu/config/test/docs files changed.

- [ ] **Step 4: Record manual production acceptance gate**

Do not mutate Feishu admin or production automatically. Handoff must require owner to grant `contact:user.department:readonly`, add the 运城 department to app visibility, enable the feature flag, reload service, verify `/health`, and test two distinct users.

- [ ] **Step 5: Commit final verification-only adjustments if any**

If and only if verification required a factual documentation correction:

```bash
git add docs/superpowers/specs/2026-07-13-feishu-personal-identity-design.md 开发文档/DEVELOPER_CONVENTIONS.md
git commit -m "docs(auth): document Feishu identity rollout"
```

Otherwise skip this commit and leave the working tree clean.
