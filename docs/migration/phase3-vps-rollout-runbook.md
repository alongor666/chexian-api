# Phase 3 VPS 启用 SQLite 模式 Runbook（B298 部署）

> **状态**：READY（B298 已 merge `f4a6917`，可执行）
> **执行人**：用户（需 SSH chexian-vps 权限 + 改 ecosystem.config.cjs 权限）
> **执行窗口**：业务低峰（建议工作日 22:00 后 / 周末晨）
> **预计时长**：15-25 分钟（含 5 分钟监控窗口）
> **可中止时机**：Step 4 之前任何节点；Step 4 之后只能 rollback（见 §6）

---

## 0. 前置检查

- [ ] PR #389 已 merge 到 main（`git log --oneline main | head -2` 含 `f4a6917 Merge pull request #389`）
- [ ] PR #390（文档对齐）已 merge 或已开（不影响 deploy）
- [ ] VPS 当前 BACKEND 模式确认：`ssh chexian-vps 'grep STATE_STORE_BACKEND /var/www/chexian/server/ecosystem.config.cjs || echo "unset (= default json)"'`
- [ ] VPS 当前 PAT 数量：`ssh chexian-vps 'cat /var/www/chexian/server/data/api_tokens.json | jq ".tokens | length"'`（记下作为对比基线）
- [ ] PM2 当前健康：`ssh chexian-vps 'sudo /usr/local/bin/deploy-chexian-api describe' | grep status`

---

## 1. 部署 B298 代码到 VPS（自动，已 merge 即触发）

PR #389 merge 时 deploy.yml 已自动触发。验证：

```bash
gh run list --workflow=deploy.yml --limit 3
# 期望：第一条是 PR #389 merge commit f4a6917 触发的 run，conclusion=success
```

如果 deploy run failed → 不要继续。先看 `gh run view <run-id> --log-failed` 排查（按 deploy-chain-sop §2，部署链 PR 失败需立即修）。

健康检查：

```bash
curl -fsS https://chexian.cretvalu.com/health
# 期望：{"status":"ok",...}
curl -fsS https://chexian.cretvalu.com/api/auth/me -H "Authorization: Bearer <已有 PAT>"
# 期望：200 + user info（旧 PAT 仍工作，因为还在 json 模式）
```

---

## 2. 跑一次性 admin-import-pat-from-json（VPS 上）

**目的**：把当前 `api_tokens.json` 全量导入 `state.db.api_tokens` 表，写 `.state-migration-pat.lock` 防重导。

**为什么必须先做这一步**：如果跳过直接改 env 启用 sqlite 模式 → `state.db.api_tokens` 是空表 → `loadApiTokensIntoTable` 走 sqlite 分支返回 0 → `verifyPat` 全 401 → 所有 PAT 用户/CLI/MCP 立即失效。

```bash
ssh chexian-vps << 'EOF'
cd /var/www/chexian/server

# 预检：lock 文件应不存在（首次执行）
ls -la data/.state-migration-pat.lock 2>/dev/null && echo "WARN: lock 已存在，CLI 会拒绝执行" || echo "OK: 首次执行"

# 预检：state.db api_tokens 应不存在或为空
sqlite3 data/state.db 'SELECT COUNT(*) FROM api_tokens' 2>/dev/null || echo "OK: state.db 不存在（首次执行）"

# 跑 CLI（注意：环境变量必须在同一行）
STATE_STORE_BACKEND=sqlite STATE_DB_PATH=./data/state.db \
  node dist/scripts/admin-import-pat-from-json.js

# 验证：lock 已写
cat data/.state-migration-pat.lock | jq .

# 验证：行数与 JSON 对齐
SQLITE_COUNT=$(sqlite3 data/state.db 'SELECT COUNT(*) FROM api_tokens')
JSON_COUNT=$(cat data/api_tokens.json | jq '.tokens | length')
echo "SQLite=$SQLITE_COUNT  JSON=$JSON_COUNT"
[ "$SQLITE_COUNT" = "$JSON_COUNT" ] && echo "✅ 一致" || echo "❌ 不一致，停止"
EOF
```

**期望输出**：
```
OK: 首次执行
OK: state.db 不存在
[admin-import-pat] source=/var/www/chexian/server/data/api_tokens.json tokens=N
[StateDB] initialized at .../data/state.db (applied=3, skipped=0)
[admin-import-pat] 完成。lock 写入: .../data/.state-migration-pat.lock
{"migrated_at": "...", "source_hash": "...", "scope": "pat"}
SQLite=N  JSON=N
✅ 一致
```

如果 `❌ 不一致` → 不要继续，回退到 Step 0 排查（可能是 ETL 期间有 token 增减）。

**用户/角色表同步检查**（Phase 2 已部署，但首次执行 sqlite 模式可能也要跑 users CLI）：

```bash
ssh chexian-vps << 'EOF'
cd /var/www/chexian/server
ls -la data/.state-migration*.lock 2>/dev/null
# 期望：仅 .state-migration-pat.lock（B298 写的）
# 如果有 .state-migration.lock（Phase 2 legacy）或 .state-migration-users.lock → users 已迁过
# 否则需先跑 admin-import-users-from-json.js（同样格式）
EOF
```

如果 users 也没迁，先跑：

```bash
ssh chexian-vps << 'EOF'
cd /var/www/chexian/server
STATE_STORE_BACKEND=sqlite STATE_DB_PATH=./data/state.db \
  node dist/scripts/admin-import-users-from-json.js
EOF
```

---

## 3. 修改 server/ecosystem.config.cjs 加 SQLite 双写 env

在本地仓库改 + PR + merge 触发 deploy（不要直接 SSH 改 VPS 文件，违反"VPS 与仓库单一来源"原则）：

```bash
git checkout main && git pull
git checkout -b chore/enable-state-db-sqlite-vps
```

编辑 `server/ecosystem.config.cjs`（**注意：文件在 server/ 子目录**），在 `env:` 块加 2 行：

```diff
       env: {
         NODE_ENV: 'production',
         PORT: 3000,
         VPS_MODE: 'true',
         CORS_ORIGIN: 'https://chexian.cretvalu.com',
         DUCKDB_MAX_MEMORY: '1536MB',
         DUCKDB_THREADS: '2',
+        // v5 状态持久层 Phase 3 启用：state.db api_tokens / access_users / access_roles 为主权威
+        // 启用前必须先 SSH VPS 跑 admin-import-pat-from-json + admin-import-users-from-json
+        STATE_STORE_BACKEND: 'sqlite',
+        STATE_DB_PATH: '/var/www/chexian/server/data/state.db',
       },
```

提交 + PR：

```bash
git add server/ecosystem.config.cjs
git -c commit.gpgsign=false commit -m "chore(deploy): VPS 启用 STATE_STORE_BACKEND=sqlite（B298 Phase 3）

依赖 admin-import-pat-from-json + admin-import-users-from-json
已在 VPS 上手工跑过（lock 文件已写）。

Refs: docs/migration/phase3-vps-rollout-runbook.md §3"
git push -u origin chore/enable-state-db-sqlite-vps
gh pr create --title "chore(deploy): VPS 启用 STATE_STORE_BACKEND=sqlite（B298 Phase 3 启用）" \
  --body "依赖 #389（已 merge）+ VPS admin-import-pat/users CLI 已跑（lock 写入确认）。
按 deploy-chain-sop §2：本 PR **禁止 auto-merge**，必须人工选监控窗口 merge + 盯前 5 分钟。"
```

---

## 4. 人工 merge + 监控（按 deploy-chain-sop §2）

**触发**：人工 merge 上面 PR → deploy.yml 自动跑。

**前 5 分钟不离开**：

```bash
# Terminal 1: 看 deploy run
gh run watch --exit-status

# Terminal 2: 持续 ping health
while true; do
  echo "$(date +%H:%M:%S) $(curl -fsS -o /dev/null -w '%{http_code}' https://chexian.cretvalu.com/health)"
  sleep 5
done

# Terminal 3: 准备 rollback 命令（不执行）
echo 'ssh chexian-vps "cd /var/www/chexian/server && cp ecosystem.config.cjs.bak ecosystem.config.cjs && sudo /usr/local/bin/deploy-chexian-api reload"'
```

**deploy 成功后立即验证 PAT 仍工作**：

```bash
# 拿 .chexian/config.json 里已配的 PAT 测一次
curl -fsS https://chexian.cretvalu.com/api/auth/me -H "Authorization: Bearer cx_pat_xxx.xxx" | jq .

# 期望：200 + user info（与 Step 0 baseline 一致）
```

**SSH 上确认 state.db 是事实源**：

```bash
ssh chexian-vps << 'EOF'
cd /var/www/chexian/server
pm2 logs chexian-api --lines 50 --nostream | grep -E "StateDB|PAT|state.db|api_tokens"
# 期望看到：
# [StateDB] initialized at /var/www/chexian/server/data/state.db (applied=3, skipped=0)
# [PAT] 从 state.db 加载了 N 条 ApiToken
EOF
```

如果 PAT 验证 401 → 立即 rollback（见 §6）。

---

## 5. 24 小时观察期

**Day 1 监控**（VPS）：

```bash
ssh chexian-vps << 'EOF'
cd /var/www/chexian/server

# 1. SQLite 与 JSON 行数应继续对齐（一致性）
echo "=== api_tokens count ==="
sqlite3 data/state.db 'SELECT COUNT(*) FROM api_tokens'
cat data/api_tokens.json | jq '.tokens | length'

echo "=== access_users count ==="
sqlite3 data/state.db 'SELECT COUNT(*) FROM access_users'
cat data/user_store.json | jq '.users | length'

# 2. 错误日志看 PAT / SQLite / INCONSISTENCY
grep -E "PAT|state.db|INCONSISTENCY" /var/log/chexian/api-error.log | tail -30

# 3. last_used_at 在更新（说明 flush 工作）
sqlite3 data/state.db "SELECT username, last_used_at FROM api_tokens WHERE last_used_at IS NOT NULL ORDER BY last_used_at DESC LIMIT 5"

# 4. SQLite 体积
ls -lah data/state.db data/state.db-wal data/state.db-shm 2>/dev/null
EOF
```

**期望**：
- 行数一致（SQLite = JSON）
- 无 `[INCONSISTENCY]` 日志（表示 SQLite/JSON 双写都成功）
- last_used_at 时间戳新于 deploy 时间（PAT 在用 + flush 在写）
- state.db 体积 < 1 MB（少量 token / 用户体量）

---

## 6. Rollback（任何阶段失败回退到 BACKEND=json）

**判定信号**（任一即触发 rollback）：
- Step 4 后 PAT 验证连续 3 次 401（且预期应通过）
- pm2 logs 大量 `[INCONSISTENCY]` 或 `state.db 写入失败`
- 502/504 突增（SQLite 死锁等极端情况）

**Rollback 步骤**（5 分钟内执行）：

```bash
# 方案 A：revert PR + 重新 deploy（推荐，留痕迹）
git revert <merge-commit-of-enable-sqlite-PR>
git push origin main  # 触发自动 deploy 回到 json 模式

# 方案 B：紧急 SSH 手工改（仅 deploy 链路同时坏的极端场景）
ssh chexian-vps << 'EOF'
cd /var/www/chexian/server
# 临时移除 SQLite env（在 PM2 内联 env，不改文件）
pm2 restart chexian-api --update-env --env "STATE_STORE_BACKEND=json"
# 然后立即 revert PR（恢复仓库与 VPS 一致）
EOF
```

**Rollback 后**：
- state.db 文件**不要删**（包含此次 deploy 期间的真实 PAT 状态，可能 JSON 已落后）
- lock 文件**不要删**（保持已迁移语义）
- 排查 root cause（pm2 logs + deploy run logs）
- 修复 + 重新执行 §4 之前的步骤

---

## 7. 完成判定（DoD）

- [ ] §4 deploy run conclusion=success + PAT 验证 200
- [ ] §5 Day 1 监控通过（一致性 + 无 INCONSISTENCY + last_used_at 更新）
- [ ] 24 h 后无回退；用户在 PROGRESS.md 记录里程碑（"VPS 启用 BACKEND=sqlite 稳定 24h"）
- [ ] 2 周稳定后解锁 Phase 4 索引化 + B298 后续清理 PR（删 JSON 双写路径）

---

## 8. 关联

- 模板 PR：[#389 feat(state-db): Phase 3 PAT 迁移到 SQLite 双写（B298）](https://github.com/alongor666/chexian-api/pull/389)
- 部署链 SOP：[.claude/rules/deploy-chain-sop.md](../../.claude/rules/deploy-chain-sop.md)
- VPS wrapper：`/usr/local/bin/deploy-chexian-api`（doctor / describe / reload / install）
- Phase 4 接力：[docs/migration/phase4-indexing-plan.md](./phase4-indexing-plan.md)
- 母 plan：`~/.claude/plans/vps-json-keen-clock.md` §Phase 5 部署与回滚
