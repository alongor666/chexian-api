# Phase 0：state-db 引擎沙盒预检（B295）

> v5 状态持久层迁移计划（`~/.claude/plans/vps-json-keen-clock.md`）的 Phase 0 输出。
> 验证 better-sqlite3 在 CI build / VPS install / wrapper runtime 三条路径全绿，
> 同时记录 DuckDB 持久 DB 负面对照、VPS 状态快照、引擎决策。

## 1. 三路径验证结果（全部 ✅）

| 路径 | 命令 | 结果 |
|------|------|------|
| **本地 bun（CI 模拟）** | `git worktree add /tmp/state-db-preflight HEAD && cd .../server && bun add better-sqlite3 @types/better-sqlite3 && bun install --frozen-lockfile` | better-sqlite3@12.10.0 安装成功；259 packages installed [323.87s]；Node v25.9.0 |
| **VPS npm（wrapper install）** | `ssh chexian-vps: "$NPM_BIN" ci --omit=dev + "$NPM_BIN" install better-sqlite3 @types/better-sqlite3 --save-prod` | npm ci 通过；native build 产物 `node_modules/better-sqlite3/build/Release/better_sqlite3.node` 存在 |
| **VPS runtime（wrapper NODE_BIN）** | `"$NODE_BIN" smoke.mjs`（NODE_BIN 来自 `deploy-chexian-api doctor`） | `SMOKE OK (journal_mode=wal)`：ESM import + 4 个 PRAGMA + CRUD + backup API 全绿 |

**smoke 脚本**：[`scripts/state-db-smoke.mjs`](../../scripts/state-db-smoke.mjs)（~30 行，本地 + VPS 沙盒共用）

## 2. VPS 工具快照

```
NODE_BIN:        /root/.nvm/versions/node/v22.22.0/bin/node
NPM_BIN:         /root/.nvm/versions/node/v22.22.0/bin/npm
PM2_BIN:         /root/.nvm/versions/node/v22.22.0/bin/pm2
NODE_VERSION:    v22.22.0
NPM_VERSION:     10.9.4
sqlite3 CLI:     3.42.0 (2023-05-16)   ← Phase 5 备份方案 A 可用
```

**Phase 5 备份方案**：
- ✅ **方案 A**（推荐）：`sqlite3 state.db ".backup state.db.bak"`（VPS CLI 已确认存在）
- ✅ **方案 B**（fallback）：`require('better-sqlite3')('state.db').backup('state.db.bak')`（Node API，已沙盒验证）

## 3. 沙盒过程暴露的隐性问题（写入 SOP）

### 3.1 VPS root SSH 非交互模式 PATH 缺 nvm node

**现象**：`ssh chexian-vps '"$NPM_BIN" install'` 报 `/usr/bin/env: 'node': No such file or directory`

**根因**：
- npm 脚本 shebang 是 `#!/usr/bin/env node`
- root 默认 PATH 不含 nvm，非交互式 ssh 不源 `.bashrc` / `nvm.sh`
- `$NPM_BIN` 是绝对路径但其 shebang 仍需 `node` 在 PATH

**缓解**：所有外部 SSH 脚本开头必须显式注入：
```bash
eval "$(sudo /usr/local/bin/deploy-chexian-api doctor)"
export PATH="$(dirname "$NODE_BIN"):$PATH"
```

**长期方案**：考虑在 wrapper 中加 `with-node` 子命令，封装 PATH 注入 + 透传后续命令，避免每个外部脚本重复样板。

### 3.2 sandbox node_modules 解析

**现象**：把 smoke 脚本放在 `scripts/` 跑会找不到 `node_modules/better-sqlite3`，因为 node 从脚本所在目录向上找 node_modules

**缓解**：smoke 脚本运行时必须 `cd server/`（package.json 所在目录）才能正确解析依赖

**Phase 1 影响**：CI 集成时 `node scripts/state-db-smoke.mjs` 改为 `cd server && node ../scripts/state-db-smoke.mjs` 或者把 smoke 移到 server/scripts/

## 4. DuckDB 持久 DB 负面对照

v5 plan v1-v4 反复评估"是否用 DuckDB 自身做状态层"，本节给出最终拒绝理由（**无需重新跑数据**，决策已成熟）：

| 维度 | DuckDB 持久 DB | better-sqlite3 |
|------|----------------|---------------|
| **设计目标** | OLAP（列存 + 向量化执行） | OLTP（行存 + 单表事务） |
| **高频小写入** | 不擅长（每次 INSERT 整文件 fsync） | 擅长（WAL + 批写） |
| **多 instance** | 与现有 `:memory:` 分析实例冲突，需要 connection pool 协调 | 完全独立的连接生命周期 |
| **生态** | Neo binding 仍 r.N 版本，状态层场景 hardcoded reset 异常多 | 行业最成熟 Node-SQLite 绑定，single thread 设计契合状态层 |
| **新依赖成本** | 0（已是项目依赖） | +1（但 native module 在 Phase 1-pre 部署链中已加可控） |

**结论**：DuckDB 复用看起来"省一个依赖"，实际造成两个引擎抢同一进程的资源 + 语义不匹配（OLAP vs OLTP）。better-sqlite3 是合适的工具。

## 5. 引擎决策

✅ **better-sqlite3@12.10.0**（最新 stable，本地 + VPS 三路径全绿）

- npm: `better-sqlite3@^12.10.0`
- types: `@types/better-sqlite3@^7.6.13`
- 加入 `server/dependencies`（CLI/MCP **不**依赖，详见 v5 plan §「多入口访问规则」）
- WAL + foreign_keys + busy_timeout=5000 + synchronous=NORMAL 配置

可推进 B296（Phase 1：state-db 基础层 + Repository 隔离）。

## 6. 边界声明（临时安置）

> 待 frozen 授权后迁入 `.claude/rules/data-pipeline.md` 作为正式数据架构规则。

**应用状态层 vs 分析事实层**：

| 层 | 引擎 | 数据形态 | 写入特征 |
|----|------|---------|---------|
| 分析事实层（不动） | DuckDB `:memory:` | Parquet（policy/claims/quotes/dim） | 启动加载，运行时只读 |
| 应用状态层（new） | better-sqlite3 | `server/data/state.db` (WAL) | 高频小写入（users/roles/PAT） |

两层物理隔离（不同 DB 引擎、不同存储格式），逻辑也不交叉（PolicyFact 不查 state.db，state.db 不依赖 Parquet）。

## 7. 下一步（B296 Phase 1 前置就绪）

- ✅ better-sqlite3 引擎决策完成
- ✅ scripts/state-db-smoke.mjs 已交付（Phase 1 CI 集成时直接接入 deploy.yml）
- ✅ VPS sqlite3 命令确认（Phase 5 备份方案 A 可用）
- ✅ wrapper doctor 输出已用于沙盒（B293 实施已就绪）
- 🔲 Phase 1 工作清单见 BACKLOG B296

## 关联

- 计划：`~/.claude/plans/vps-json-keen-clock.md` §Phase 0
- BACKLOG：B295（本 Phase）→ B296 → B297 → B298
- 上游：B292 部署链改造（PR #379 merged） + B293 wrapper sync + B294 self-update（PR #381 OPEN）
- 工件：[`scripts/state-db-smoke.mjs`](../../scripts/state-db-smoke.mjs)、[`scripts/INDEX.md`](../../scripts/INDEX.md)（已登记）
