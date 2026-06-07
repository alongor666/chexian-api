# 多分公司 Day-1 上线 SOP（RED LINE）

policy: append-only

> 来源：plan v2 Phase 0H。山西分公司账号首次发放前后须按本 SOP 顺序操作，避免「先发账号 → 山西用户看到 SC 数据 / 空 KPI / cache 串读」三类事故。
>
> 适用：每次新增分公司上线（首次为山西，后续为第三省等）；本 SOP 不替代 [multi-branch-rollback-sop.md](./multi-branch-rollback-sop.md)（事故响应专用）。

## 0. 前置条件（必须全部满足）

- [ ] PR #491 (0C 字段注册表 branch_code) 已合并 + 上线
- [ ] PR #492 (0D + 0F 用户状态 + feature flag) 已合并 + 上线
- [ ] PR #501 (0B cache-warmer + cache key branch 隔离) 已合并 + 上线
- [ ] PR #507 (0E SQL 拔"四川"硬编码) 已合并 + 上线
- [ ] PR-5 (0G + 0H 本 PR) 已合并 + 上线
- [ ] 山西分公司业务方完成 [口径对齐_山西.md](../../开发文档/multi-branch/口径对齐_山西.md) 全部 §1.x 签字 + 总验收签字

## 1. T-7：山西首批数据接入

### Step 1.1 — 拿 SX xlsx 样本（≥ 1 周 + 全量备份）

```bash
# 山西方提供的 xlsx → 拷贝到本地 staging
mkdir -p ~/chexian-staging/sx-day1
cp <SX 数据源> ~/chexian-staging/sx-day1/
```

### Step 1.2 — ETL 跑通 + 字段值域验证

```bash
# branch_code 注入（依赖 PR #491 fields.json 派生字段引擎）
BRANCH_CODE=SX node 数据管理/daily.mjs all

# 字段值域对齐检查（脚本见 口径对齐_山西.md §2）
duckdb -c "SELECT COUNT(*) FROM '数据管理/warehouse/fact/policy/current/*.parquet' WHERE branch_code='SX'"
# 期望：行数 > 0
```

**判断**：
- ETL 跑通 ✅
- 字段值域与 SC 偏差 < 1% ✅ → 继续
- 偏差 ≥ 1% 或 ETL 失败 → 排查、不进入 Step 1.3

### Step 1.3 — 数据对账（容忍误差万分之一）

```bash
# 跑山西方业务核对脚本（与原始 Excel 对账）
duckdb -c "SELECT
  SUM(premium) AS total_premium,
  COUNT(*) AS policy_count
FROM '数据管理/warehouse/fact/policy/current/*.parquet'
WHERE branch_code='SX'"
```

**判断**：
- premium / policy_count 与山西原始 Excel 误差 ≤ 万分之一 ✅
- 误差 > 万分之一 → STOP，排查 ETL

## 2. T-3：cache-warmer 按 SX 预热完成

```bash
# 在生产 VPS 上启用 BRANCH_RLS_ENABLED=true
sudo /usr/local/bin/deploy-chexian-api edit-env BRANCH_RLS_ENABLED true
sudo /usr/local/bin/deploy-chexian-api reload

# cache-warmer 启动后会按 PRESET_USERS 全部唯一 branchCode 循环预热
# 当前 PRESET_USERS 仅含 SC；山西超管账号加入后会自动包含 SX

# 验证 cache 隔离（脚本见本目录 ../scripts/multi-branch-stress-test.mjs）
JWT_SECRET=<生产 jwt secret> bun run scripts/multi-branch-stress-test.mjs --simulate-sx --concurrency 10
```

**判断**：
- Phase 1 SC 基线 p95 < 500ms ✅
- Phase 2 SC + SX 交错，**SX token 请求 dataLength=0**（兼容期无 SX 用户但有 SX 数据） ✅
- Phase 3 cache 命中 avg < 50ms ✅
- 任一不满足 → 排查 + 不进入 Step 3

## 3. T-1：sync-vps 把 SX Parquet 推到生产

```bash
# rsync SX 域到 VPS
node scripts/sync-vps.mjs

# VPS 端验证
ssh deployer@162.14.113.44 'ls -la /var/www/chexian/server/data/policy/current/ | grep SX'
```

## 4. T-0：发山西账号

### Step 4.1 — 在 PRESET_USERS 加 SX 超管 + 山西机构用户

```typescript
// server/src/config/preset-users.ts 追加
sxAdmin: {
  username: 'sxAdmin',
  passwordHash: '<bcrypt(初始密码)>',
  displayName: '山西分公司管理员',
  role: 'branch_admin',
  branchCode: 'SX',
  specialFeatures: ['cost', 'moto_cost'],
},
// + 山西各机构 org_user（参照 SC 的 leshan/tianfu 等结构）
```

跑 PR + 部署：
```bash
git checkout -b feat/sx-users-day1
# 改 preset-users.ts → bun run governance → commit-push-pr
```

### Step 4.2 — SX 超管登录验证

**A. SX 超管视角**
```bash
TOKEN=$(curl -s -X POST https://chexian.cretvalu.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"sxAdmin","password":"<初始密码>"}' | jq -r .data.token)

# KPI 应返回非空（山西数据）
curl -s -H "Authorization: Bearer $TOKEN" \
  'https://chexian.cretvalu.com/api/query/kpi' | jq '.data | length'

# 验证返回的 org_level_3 列表全部是山西机构（不含成都/天府等四川机构）
curl -s -H "Authorization: Bearer $TOKEN" \
  'https://chexian.cretvalu.com/api/filters/options' | jq '.data.org_level_3'
```

**B. SC 超管对照**
```bash
SC_TOKEN=$(curl -s -X POST https://chexian.cretvalu.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"CxAdmin@2026!"}' | jq -r .data.token)

# KPI 与上线前比对零差异
curl -s -H "Authorization: Bearer $SC_TOKEN" \
  'https://chexian.cretvalu.com/api/query/kpi' | jq '.data[0]' > /tmp/sc-kpi-after.json
diff /tmp/sc-kpi-before.json /tmp/sc-kpi-after.json  # 应该完全一致
```

## 5. Day-1 空态保护（前端）

> 此项需前端配合（PR-5 不含前端改动；登录页/首页空态文案改动留 BACKLOG B 项跟踪）。

**核心要求**：
- 登录页：山西用户登录后若 KPI 接口返回空 → 显示「山西数据装载中，预计 X 分钟」明确状态
- 首页：禁止静默展示空 KPI（避免业务方误以为山西真实零保费）
- 错误码 401（fail-closed 旧 token 重登）：提示「会话已过期，请重新登录刷新权限」

**降级方案**：若前端无法在 T-0 前完成空态保护 → 推迟发账号 ≥ 1 天，先等前端就绪

## 6. T+1 至 T+7：监控期

### 关注指标
- `chexian.cretvalu.com/health` 返回 200（每 5 分钟监控）
- VPS RSS / DuckDB peak / route-cache hit-rate / 并发连接池（grafana 或日志）
- 误报率：SX 用户报错率 < 1% / SC 用户报错率与上线前对齐
- cache 串读：grep route-cache 日志确认 SC/SX 各自独立 entry（PR #501 + #507）

### 触发回滚
任一情况立即按 [multi-branch-rollback-sop.md](./multi-branch-rollback-sop.md) Step 1-4 操作：
- SX 用户报错率 > 1%
- SC 用户报错率显著上升（vs 上线前）
- SC 用户看到 SX 数据 / SX 用户看到 SC 数据（跨分公司串读，CRITICAL）
- VPS RSS / DuckDB peak 比上线前升 > 30% 且无法在 10 分钟内定位

## 7. 验证清单

| 序号 | 验证项 | 通过标准 |
|------|--------|----------|
| V1 | ETL 跑通 + branch_code 列存在 | `duckdb -c "SELECT DISTINCT branch_code FROM ...parquet"` 含 'SX' |
| V2 | 字段值域与 SC 偏差 < 1% | 口径对齐_山西.md §2 全部 ✅ |
| V3 | 数据对账与原始 Excel 误差 ≤ 万分之一 | premium / policy_count 比对 |
| V4 | cache 隔离压测全过 | `multi-branch-stress-test.mjs --simulate-sx` 全 ✅ |
| V5 | sync-vps 推 SX Parquet 成功 | VPS `ls policy/current/` 含 SX |
| V6 | SX 超管登录可拿 token | `/api/auth/login` 返回 token |
| V7 | SX 超管 KPI 返回山西数据 | KPI 非空 + org_level_3 全部是山西机构 |
| V8 | SC 超管 KPI 与上线前零差异 | diff 比对 |
| V9 | 登录页空态文案就绪 | 前端 PR 合并 |
| V10 | T+1 监控指标全绿 | `/health` + 错误率 + cache hit-rate |

## 8. 禁止

- ❌ 跳过任一 §1-§4 步骤直接发账号（必出"看到空 KPI / 跨分公司串读"事故）
- ❌ 在山西方业务方未签字 [口径对齐_山西.md](../../开发文档/multi-branch/口径对齐_山西.md) 时启用 BRANCH_RLS_ENABLED=true（指标口径分歧会让业务方甩锅给开发）
- ❌ V1-V8 任一未通过仍发账号（不可逆操作 — 山西用户已拿凭据后再回滚非常痛）
- ❌ 在缺前端空态保护时静默上线（业务方看到空 KPI 当真实零保费）

## 关联

- **设计契约**：plan v2 Phase 0H — `/Users/alongor666/.claude/plans/indexed-tinkering-ritchie.md`
- **回滚 SOP**：[multi-branch-rollback-sop.md](./multi-branch-rollback-sop.md)
- **口径对齐**：[../../开发文档/multi-branch/口径对齐_山西.md](../../开发文档/multi-branch/口径对齐_山西.md)
- **压测脚本**：[../../scripts/multi-branch-stress-test.mjs](../../scripts/multi-branch-stress-test.mjs)
- **AGENTS.md §8.2 append-only**：本文件作为新增独立护栏文件，无需 `[policy-override]` 授权
