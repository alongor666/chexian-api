# 飞书一人一账号与多认证身份模型设计

## 1. 背景与结论

当前飞书授权计划拟将运城部门成员统一映射到共享账号 `sx_yuncheng`。该方式会造成自然人审计丢失、共享密码互相影响、任意成员可触发共享账号找回密码，以及单人离职无法独立吊销。

本设计采用以下终态：

- 运城部门成员一人一账号，首次飞书登录时自动开户。
- 飞书 `user_id` 是稳定外部身份键；姓名拼音仅用于生成可读且唯一的系统用户名。
- 飞书自动开户账号仅允许飞书认证，不拥有密码凭据，不进入 `pns` 强制设密流程。
- 账号、外部身份、密码凭据分层建模，避免通过用户名白名单或特殊分支堆叠例外。
- 运城先试点；机制验证后才能扩展到其他市州。

## 2. 目标与非目标

### 2.1 目标

1. 每个飞书自然人拥有独立系统账号、审计主体和吊销边界。
2. 部门归属决定账号的机构权限，但不决定账号用户名或密码重置权。
3. 飞书专属账号无法通过密码、激活令牌、找回密码或自助改密获得本地密码凭据。
4. 保留现有密码账号的登录、`pns`、改密、激活和找回行为。
5. 飞书接口故障时 fail-closed，但不得把“查询失败”误判为“员工已离开部门”。
6. 首次登录并发时只创建一个账号和一条身份绑定。

### 2.2 非目标

- 本阶段不批量扩展到山西其他市州。
- 本阶段不删除所有既有个人角色映射；显式 `deny` 和管理员 bootstrap 仍保留。
- 本阶段不允许飞书专属账号创建 PAT。未来如确有 CLI/API 需求，须单独设计 `api_token` 能力。
- 本阶段不把飞书接口放进每个业务 API 请求的同步链路。

## 3. 核心不变量

1. 权限属于 `UserAccount`，认证方式属于 `AuthIdentity`，密码属于 `PasswordCredential`。
2. 没有密码凭据是飞书专属账号的合法终态，不等于“尚未设密”。
3. `(provider, provider_subject)` 在系统内唯一绑定一个账号。
4. 部门查询只有“确认属于”“确认不属于”“不可判定”三种结果；三者不得合并。
5. 只有显式启用密码凭据的账号可以走密码登录、改密、激活或找回链路。
6. 部门授权不能隐式授予密码重置权。

## 4. 数据模型

### 4.1 UserAccount

保留账号的授权与生命周期字段：

```ts
interface AccessUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  organization?: string;
  branchCode?: string;
  active: boolean;
  // 现有 allowedRoutes/defaultRoute/allowedIps/specialFeatures 保留
}
```

`username` 是稳定系统标识。飞书账号的生成规则为：

```text
<姓名规范化拼音>_<sha256(feishu_user_id) 前 6 位>
```

例如 `张伟` 可生成 `zhangwei_a83f2c`。姓名变化只更新 `displayName`，不修改既有 `username`。

### 4.2 AuthIdentity

新增外部身份绑定：

```ts
interface AuthIdentity {
  id: string;
  userId: string;
  provider: 'feishu';
  providerSubject: string; // 飞书 user_id
  enabled: boolean;
  lastVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

持久层必须保证：

- `UNIQUE(provider, provider_subject)`；
- `user_id` 引用真实 `UserAccount.id`；
- 身份绑定与首次账号创建处于同一事务或同一串行临界区；
- 冲突后重新读取已有绑定，不创建第二个账号。

### 4.3 PasswordCredential

新增密码凭据模型：

```ts
interface PasswordCredential {
  userId: string;
  passwordHash: string;
  state: 'bootstrap_required' | 'active';
  changedAt?: string;
}
```

现有 `password_hash`、`password_changed_at` 先做兼容迁移，最终由 `PasswordCredential` 承担密码事实源。迁移期间必须双读兼容，不能一次性破坏现有密码账号。

飞书自动开户账号不创建 `PasswordCredential`。

## 5. 认证策略

### 5.1 pns 语义

现有 `pns` 从“没有 `password_changed_at`”改为“密码凭据处于 `bootstrap_required`”。内部推荐重命名为 `credentialSetupRequired`，JWT 在兼容期仍可保留 `pns` 字段。

- 密码 bootstrap 账号：携带 `pns=true`。
- 已设置密码账号：不携带 `pns`。
- 飞书专属账号：没有密码凭据，因此不携带 `pns`。

### 5.2 密码链路

密码登录、`/change-password`、激活、管理员密码重置和找回密码在执行前统一调用凭据策略：

```ts
assertCredentialAllowed(userId, 'password')
```

账号没有 `PasswordCredential` 时统一返回 `AUTH_METHOD_NOT_ALLOWED`。不得通过 `USER_PASSWORDS`、用户名白名单或 tombstone 回退为飞书账号补出密码能力。

### 5.3 飞书找回密码

找回密码按飞书 `user_id` 精确查询 `AuthIdentity`，随后检查目标账号是否存在 `PasswordCredential`。

- 飞书专属账号：统一失败，不签发重置令牌。
- 混合账号：未来如显式允许，可重置其个人密码。
- 部门映射只用于授权，不参与重置目标账号选择。

### 5.4 PAT

本试点的飞书专属账号不能创建 PAT。PAT 是独立长期凭据，不能因为账号可登录就自动获得。未来若开放，必须增加显式 capability 并单独评审。

## 6. 部门授权配置

部门配置只表达授权模板，不包含共享用户名：

```ts
interface FeishuDepartmentEntitlement {
  feishuDeptId: string;
  feishuDeptName: string;
  role: 'org_user';
  organization: string;
  branchCode: string;
}
```

运城试点配置：

```ts
{
  feishuDeptId: 'od-395bce9db9d4acccae3e6da8d25cb672',
  feishuDeptName: '运城',
  role: 'org_user',
  organization: '运城',
  branchCode: 'SX'
}
```

启动时验证部门 ID 不重复、`branchCode` 格式合法、角色与机构完整。个人显式 `deny` 优先于部门授权。

“运城部门下成员”在试点阶段定义为飞书返回的直接归属部门 ID 包含运城 ID。若运城存在子部门且要求递归继承，必须在开放前把子部门闭包加入配置或实现经验证的部门路径解析，不能默认推断。

## 7. 登录数据流

```text
飞书 OAuth 回调
  -> 校验 state 与租户
  -> 解析个人显式 deny/管理员映射
  -> 获取 tenant_access_token
  -> 查询用户部门（三态结果）
  -> 匹配部门授权模板
  -> 按 (feishu, user_id) 查询 AuthIdentity
       -> 已存在：读取 UserAccount
       -> 不存在：原子创建 UserAccount + AuthIdentity
  -> 校验 account.active 与 identity.enabled
  -> 签发 amr=['feishu'] 的个人会话，不携带 pns
```

JWT/会话应记录：

```ts
{
  sub: userAccount.id,
  username: userAccount.username,
  amr: ['feishu'],
  identityId: authIdentity.id,
  role: userAccount.role,
  organization: userAccount.organization,
  branchCode: userAccount.branchCode
}
```

审计记录自然人账号、飞书身份绑定 ID 和认证方式，不记录 access token、app secret 或完整敏感响应。

## 8. 飞书客户端与故障语义

仓库已有 tenant token 缓存、提前刷新和超时实现。应抽取共享 Feishu application client，供通知与部门查询复用，禁止在 `feishu.ts` 再造第二套 token 生命周期。

部门查询返回：

```ts
type DepartmentResolution =
  | { status: 'member'; departmentIds: string[] }
  | { status: 'not_member'; departmentIds: string[] }
  | { status: 'unavailable'; reason: string };
```

处理规则：

- `member`：继续开户或登录；
- `not_member`：拒绝登录，并可停用既有绑定账号；
- `unavailable`：拒绝本次登录，但不改变账号、身份绑定或 active 状态。

所有外部请求必须有超时，检查 HTTP 状态、飞书业务 `code` 和响应结构；日志不得包含 token、app secret、手机号或完整个人响应。

## 9. 权限回收

终态采用三层回收：

1. 飞书通讯录变更事件作为主通道；
2. 定时部门对账作为漏事件兜底；
3. 登录与 refresh 时重新校验作为在线兜底。

确认用户离开授权部门后：

- `UserAccount.active=false`；
- `AuthIdentity.enabled=false`；
- 刷新 active username cache；
- 撤销 refresh session；
- 如未来持有 PAT，同时撤销 PAT。

业务请求继续复用现有 active username cache，使已停用账号的未过期 JWT 立即失效。接口不可用不得触发停用。

## 10. 前端契约

`/api/auth/me` 增加：

```json
{
  "authMethods": ["feishu"],
  "canChangePassword": false,
  "mustChangePassword": false,
  "hasPassword": false
}
```

飞书专属账号不展示首次设密、修改密码、找回密码或 PAT 创建入口。后端仍必须独立拒绝这些操作，不能只依赖前端隐藏。

## 11. 安全迁移顺序

1. 新增 `AuthIdentity`、`PasswordCredential` 及持久化迁移，不改变现有登录行为。
2. 回填现有密码账号的 `PasswordCredential`，验证密码登录、`pns`、激活、改密和找回完全回归。
3. 将所有密码相关入口接入统一凭据策略。
4. 抽取共享飞书 application client，补齐超时、缓存和错误三态。
5. 实现运城飞书个人账号原子开户与个人会话。
6. 完成飞书后台 scope、可用范围和生产 feature flag 配置，reload 后执行真实登录验收。
7. 试点稳定后停用共享账号 `sx_yuncheng`，保留有限回滚窗口但不再作为飞书映射目标。
8. 运城验收通过后，另行评审其他市州扩展。

## 12. 测试与验收

### 12.1 单元与集成测试

- 同一飞书用户重复登录复用同一账号。
- 两名同名员工生成不同用户名和账号。
- 姓名变化只更新显示名，不创建新账号。
- 并发首次登录只产生一个账号和一个身份绑定。
- 飞书专属账号无法密码登录、改密、激活、找回密码或创建 PAT。
- 飞书专属账号登录不携带 `pns`。
- 现有密码账号的三级哈希、`pns`、改密和找回行为不回归。
- 个人 deny 优先于部门授权。
- 部门查询 `member/not_member/unavailable` 三态分别覆盖。
- 接口超时或 scope 缺失不误停账号。
- 确认移出运城后，账号停用且旧 JWT 被 active cache 拒绝。
- token 缓存命中、提前刷新、并发首取和日志脱敏。

### 12.2 可执行验证

```bash
bun run test --run tests/api/feishu-mapping-path.test.ts
bun run test --run server/src/routes/__tests__/feishu-auth-intent.test.ts
bun run test --run server/src/services/__tests__/feishu-personal-identity.test.ts
bun run test --run server/src/services/__tests__/auth-credential-policy.test.ts
bun run build
bun run governance
```

### 12.3 端到端验收

飞书后台授权完成后，至少使用两名运城员工验证：

1. 两人分别产生不同系统账号；
2. 均只能看到 `organization=运城、branchCode=SX` 的只读数据；
3. `/me` 不显示设密要求；
4. 密码与找回入口均被后端拒绝；
5. 审计日志能区分两名自然人；
6. 停用其中一人不影响另一人。

## 13. 上线与回滚

- 功能默认关闭；scope、可用范围和代码均就绪后才开启。
- 修改 `.env` 后必须 reload/restart 服务并检查 `/health`，不能把文件修改视为运行时热更新。
- 回滚时关闭部门个人开户开关并 reload；已创建个人账号保留但禁止新飞书会话，不删除审计数据。
- 共享 `sx_yuncheng` 仅在明确回滚窗口内保留，不能与个人开户长期双轨运行。

## 14. 完成标准

只有同时满足以下条件才算完成：

- 身份、账号、密码凭据边界落地且持久化唯一约束有效；
- 运城成员一人一账号，飞书身份稳定绑定；
- 飞书专属账号不存在密码旁路和 `pns` 误拦；
- 部门查询故障不会误停账号；
- 离职/调岗具备有界的权限回收路径；
- 现有密码账号回归测试、构建和治理全部通过；
- 真实飞书双用户端到端验收通过。
