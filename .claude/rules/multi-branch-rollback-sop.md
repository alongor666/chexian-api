# 多分公司 RLS 回滚 SOP（RED LINE）

policy: append-only

> 来源：plan v2 Phase 0F。山西上线后若多分公司 RLS（行级安全）出现事故（跨分公司数据串读 / 性能严重退化 / 业务规则不一致导致山西数据展示异常），用此 SOP 在 5 分钟内回到 0C 之前的单租户行为。
> 适用：处理 `BRANCH_RLS_ENABLED` feature flag 关闭决策、`scripts/rollback-multi-branch.mjs` 执行、事后复盘登记。

## 1. 触发条件（必须满足任一）

- 山西用户在生产环境登录后 KPI / 趋势 / 排名等接口报错率 >1%
- SC 用户登录后看到山西数据（跨分公司串读，CRITICAL）
- 山西用户登录后看到 SC 数据（同上，CRITICAL）
- VPS RSS / DuckDB peak 比 0C 时段上升 >30%，且无法在 10 分钟内定位

非上述情况优先走 hot-fix，不动 RLS 总闸。

## 2. 回滚步骤（5 分钟）

### Step 1 — dry-run 确认变更

```bash
ssh deployer@162.14.113.44
cd /var/www/chexian/server
node scripts/rollback-multi-branch.mjs --dry-run
```

期望输出：
```
ℹ️  当前 BRANCH_RLS_ENABLED = 'true'
=== DRY-RUN ===
将把 ecosystem.config.cjs 中 BRANCH_RLS_ENABLED 改为 'false'：
...
💡 加 --apply 实际执行
```

### Step 2 — 执行回滚

```bash
node scripts/rollback-multi-branch.mjs --apply
```

脚本会：
1. 修改 `ecosystem.config.cjs` 把 `BRANCH_RLS_ENABLED: 'true'` 改为 `'false'`
2. 调用 `sudo /usr/local/bin/deploy-chexian-api reload` 让 PM2 重载 env

### Step 3 — 验证

```bash
# 健康检查
curl -s https://chexian.cretvalu.com/health

# 用 SC 超管验证 KPI 返回数据（行数应与回滚前一致）
TOKEN=$(curl -s -X POST https://chexian.cretvalu.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"CxAdmin@2026!"}' | jq -r .data.token)

curl -s -H "Authorization: Bearer $TOKEN" \
  'https://chexian.cretvalu.com/api/query/kpi' | jq '.data | length'
```

### Step 4 — 通知

立即在企微 chexian-api 群发布：
```
🔴 多分公司 RLS 已紧急回滚（plan v2 0F）
   触发原因：<具体现象>
   当前状态：BRANCH_RLS_ENABLED=false，回到 0C 单租户行为
   山西用户：账号保留可登录，但只能看到 SC 数据
   下一步：根因分析中，预计 X 小时内复盘
```

## 3. 回滚后的状态

- ✅ Parquet `branch_code` 列保留（**不需** backfill 回滚）
- ✅ 用户表 `branch_code` 字段保留（access_users / UserAccount / PRESET_USERS）
- ✅ JWT payload `branchCode` 保留（旧 session 不失效）
- ⚠️ 山西用户技术上可登录（账号未删），但 permission filter 不带 branch_code → 山西用户登录后看到 SC 数据。**必须**在企微群第一时间通知山西方暂停使用，避免业务误读

## 4. 恢复 RLS 的步骤

根因修复并验证通过后，手动改 `ecosystem.config.cjs`：

```javascript
env: {
  // ...
  BRANCH_RLS_ENABLED: 'true',
},
```

然后：
```bash
sudo /usr/local/bin/deploy-chexian-api reload
```

再跑 Step 3 验证脚本，确认 SC + 山西用户各自只看到本分公司数据。

## 5. 禁止

- ❌ 删除 Parquet 的 branch_code 列（破坏 0C 字段注册表，恢复 RLS 时会 Binder Error）
- ❌ 删除用户的 branchCode 字段（破坏 JWT 解码，旧 session 失效）
- ❌ 在不通知山西方的情况下回滚（业务方看到错误数据当作真实结果会决策错）
- ❌ 把 ecosystem.config.cjs 改回 `true` 但跳过 Step 3 验证

## 6. 复盘登记

每次执行本 SOP 后，在 `.claude/workflow/pr-evolution.md` 追加一条：

```markdown
### YYYY-MM-DD — 多分公司 RLS 紧急回滚
- **症状**: <具体接口/页面表现>
- **根因**: <permission.ts / Parquet schema / 用户态 / 其他>
- **修复**: <代码改动 commit hash>
- **预防**: <governance / 单元测试 / SQL 静态分析 新增的检查>
```

## 关联

- 设计契约：plan v2 Phase 0F — `/Users/alongor666/.claude/plans/indexed-tinkering-ritchie.md`
- feature flag 实现：[server/src/config/env.ts](../../server/src/config/env.ts) `dbEnv.BRANCH_RLS_ENABLED`
- WHERE 注入：[server/src/middleware/permission.ts](../../server/src/middleware/permission.ts)
- 回滚脚本：[scripts/rollback-multi-branch.mjs](../../scripts/rollback-multi-branch.mjs)
- AGENTS.md §8.2 append-only：本文件作为新增独立护栏文件，无需 `[policy-override]` 授权
