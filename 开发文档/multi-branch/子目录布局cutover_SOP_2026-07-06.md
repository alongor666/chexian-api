# 生产扁平 → 分省子目录布局 cutover SOP（Phase B B5 · 801409）

> **状态**：📋 文档与就绪清单就绪，**实跑 GATED**——前置依赖全部打勾 + owner 低峰窗口显式授权后才执行；本文档所属任务卡（B5）不含实跑。
>
> **维护协议**：append-only。
>
> **一句话**：把生产 `data/current/` 从「扁平混放（SC 裸名 + `SX_` 前缀）」一次性搬迁为「分省子目录 `current/SC/` + `current/SX/`」，退役 #753/Option A 前缀过渡态，兑现 owner 2026-07-04 拍板的子目录终局。

---

## 0. 现状事实（写 SOP 时点，2026-07-06）

- **生产布局 = 扁平混放**：`data/current/` 顶层同时有 SC 裸名文件（数字开头 / `每日数据_*` / `sichuan_*`）与 `SX_` 前缀文件（Option A，`scripts/release/sx-promote.mjs` 产物）。
- **山西已上线**：2026-06-25/26 完成 SX cutover（`BRANCH_RLS_ENABLED=true` + 13 个 sx 账号 + `SX_` 前缀文件进生产 current/）。因此本次 cutover **不是新增省上线**，是同一批数据的**布局搬迁**。
- **子目录能力已具备**：装载层 B1（PR #773，`discoverInDir` 下钻 + GATED 闸）、ETL 写侧 B2（PR #777，`POLICY_CURRENT_SUBDIR_LAYOUT` 开关）、sync 侧 B3（PR #941，分省子目录同步 + GATED 预检）均已合并。
- **⚠️ 已知缺陷（B5 发现并修复，必须先部署）**：修复前的装载层去重对扁平前缀盲视——`SX_每日数据_20250601_*.parquet` 与 SC `每日数据_20250601_*.parquet` 同起期，会被「保留 endDate 最新」剔除，**山西 2025-06-01 起增量保单整段不装载**（B5 worktree 用生产等价文件集实测复现：修复前装载 4 文件 4,195,699 行，修复后 5 文件 4,464,114 行）。B5 PR 含此修复；**cutover 前必须确认该修复已部署生产**，否则 T-0 对账基线本身就是缺数的。

## 1. 前置依赖（就绪清单——全部 ✅ 才能约窗口）

| # | 项 | 状态（2026-07-06） | 说明 |
|---|----|------|------|
| 1 | B1/B2/B3 合并 | ✅ PR #773 / #777 / #941 | 装载 / ETL 写侧 / sync 子目录能力 |
| 2 | B4 合并（web 上传子目录化，`server/src/routes/data.ts` + `data-layout.ts`） | ✅ PR #947（2026-07-06） | 上传链路与启动 bootstrap 共用同一份 GATED 闸静态实现，不再有「上传写顶层扁平 → 并存拒启」缺口 |
| 3 | B5 PR 合并 **且已部署生产**（含扁平前缀去重修复） | ⬜ 本 PR | 见 §0 缺陷通告 |
| 4 | Python 读侧扁平 glob 适配或逐站确认 fail-closed | ⬜ **未就绪 · 硬阻断（T-0 门槛）** | B2 明确延后的站点仍直读 `current/*.parquet`（`diagnose_*` 系列 / `field_coverage.py` / `backfill_derived_fields.py` / `materialize_branch_code_special.py` / `ulr_v1_maturity.py` 等，grep `policy/current` 命中 30+ Python 文件）。子目录化后这些 glob 读 0 行——`convert_renewal` 已有 subdir-only fail-closed 会大声拦截，其余多数**静默失明**（诊断/日报/物化产出空结果且不报错，API 层验证发现不了）。须专项 PR 统一走 `policyCurrentGlobPatterns` 等价 Python 实现（`数据管理/lib/branch_paths` 域）后才可 cutover；T-7 oracle 含 Python smoke 兜底（architect 闸 P1-1） |
| 5 | cutover 变更包 PR 就绪（见 §2，随授权当日合并） | ⬜ | sync 白名单 + sx-promote 子目录化 + 环境开关 |
| 6 | owner 低峰窗口授权 + 业务方（四川/山西）知会 | ⬜ | 回滚 SOP（§4）同时知会 |

## 2. cutover 变更包（一个小 PR，授权当日随窗口合并）

1. **sync-vps 基准省白名单**：`scripts/sync-vps.mjs` 的 `SYNC_BASELINE_BRANCH='SC'` → 显式多省白名单（如 `SYNC_ALLOWED_BRANCHES=['SC','SX']` 常量）；`buildPolicyCurrentTasks` 的 `branch===deploymentBranch` 过滤与 `findPolicyCurrentSyncGateViolations` 的非基准省判定同步改白名单。**保留**「禁读 ETL `BRANCH_CODE` env」约束（codex 闸-2 P1 原判）。这是把 `current/SX/` 推生产的唯一解锁点，必须与 owner 授权绑定在同一 PR。
2. **sx-promote 子目录化**：`scripts/release/sx-promote.mjs` 目标从「current/ 顶层 `SX_` 前缀」改为「`current/SX/` 裸名」（`assertNoSubdirIntent` 语义反转 + staging/backup 路径随迁）。cutover 后若未改造，下一次 SX 数据晋升会重新制造顶层扁平文件 → 并存互斥闸拒启。**部署顺序互锁（architect 闸 P1-2）：sx-promote 改造必须先于（或同批于）§2-1 sync 白名单解锁部署**——白名单先开而 promote 未改造，等于给「倒灌顶层扁平」开了推送通道。
3. **本地 ETL 写侧开关**：主仓 `.env.local` / auto-release watcher 环境加 `POLICY_CURRENT_SUBDIR_LAYOUT=true`（SC ETL 落 `current/SC/`）。
4. **本地开发环境 RLS 开关**：主仓 `.env.local` 加 `BRANCH_RLS_ENABLED=true`。⚠️ 本地 current/ 子目录化后，RLS off + `current/SX/` 有数据 → 装载闸 fail-closed **拒绝启动**（`enforceProvinceSubdirGate` 设计行为），本地 `bun run dev:full` 会起不来。
5. **前缀防线退役清单**（**不与 cutover 同日**）：governance 前缀类检查（`checkPolicyGlobPrefixIsolation` / `checkProvincePrefixMapConsistency` 等约 6 个）、`SX_` 命名约定文档、`flatPrefixBranch` 去重兜底——cutover 稳定运行 ≥1 周后单独 PR 评估退役（801409 收尾项）。

## 3. 操作序列（低峰窗口，预计 ≤40 分钟含验证）

> 全程纪律：**T-4 开始到 T-6 完成之间，禁止任何 deploy / reload / PM2 重启**（运行中进程不受文件搬迁影响——数据在启动时装入内存；风险只在中间态重启）。

- **T-0 前置核查（owner）**
  - a. 生产文件清单基线：`ssh` 只读 `ls -la /var/www/chexian/server/data/current/`，记录文件名与字节数（本 SOP 撰写时无生产读权限，实跑时以此为准）。
  - b. RLS 开关亲验：`ecosystem.config.cjs` 中 `BRANCH_RLS_ENABLED: 'true'`。
  - c. 对账基线：SC 超管与 sx 账号各取 `/api/query/kpi` 快照存盘；`/health`、`/api/data/version`、PM2 日志 `Data ready` 行数记录。**确认日志无 `Parquet overlap … skipping SX_` 字样**（若有 = §0 修复未部署，STOP）。
  - d. **§1 就绪清单逐项亲验为 ✅**（尤其 #4 Python 读侧适配已合并——这是 T-0 硬门槛，未合并即中止约窗）。
  - e. Python 读侧基线：本地跑 1 个代表性管道（如 `field_coverage.py`）记录行数，供 T-7 smoke 对照。
- **T-0.5 暂停自动发布 watcher（architect 闸 P1-2）**：cutover 窗口起点 `launchctl unload` auto-release watcher（`bun run auto-release:status` 亲验已停）——防窗口内/观察期 watcher 触发 ETL/晋升向新布局倒灌顶层扁平文件。T-8 观察期确认 sx-promote 子目录化生效后再恢复安装。
- **T-1 本地（Mac 主仓）布局迁移**：
  ```bash
  cd 数据管理/warehouse/fact/policy/current
  mkdir -p SC SX
  # 用 find 而非 shell glob（code-reviewer 闸 HIGH：zsh 默认 nomatch，多 glob 打包 mv 在
  # 任一模式零匹配时整条静默失败；find 对零匹配安全且与 shell 无关）。顺序：先挑 SX_ 前缀，余者归 SC。
  find . -maxdepth 1 -name 'SX_*.parquet' -exec mv {} SX/ \;
  find . -maxdepth 1 -name '*.parquet' -exec mv {} SC/ \;
  ```
  逐文件核对：顶层不残留任何 `.parquet`；`SC/` 内无 `SX_` 前缀文件、`SX/` 内全部为 `SX_` 前缀文件。
- **T-2 本地验证（不动生产）**：
  - `node scripts/sync-vps.mjs --dry-run` → 应列出 `policy/current/SC` 与 `policy/current/SX` 两个独立任务、GATED 预检通过（依赖 §2-1 已合并）。
  - 本地起服务（RLS on）：日志 `Data ready` 行数 == T-0c 基线行数；无 GATED 抛错、无 overlap skipping。
  - duckdb 直查两省子目录行数/保费与迁移前逐省一致。
  - （B5 实测背书：同一文件集扁平 vs 子目录装载均为 5 文件 4,464,114 行，逐行一致；关键路由 p95 无差异，见 §6。）
- **T-3 VPS 备份**：`ssh` 执行 `cp -al /var/www/chexian/server/data/current /var/www/chexian/server/data/current.bak-$(date +%Y%m%d)`（Linux 硬链接秒级、零额外空间）。
- **T-4 推送子目录**：`node scripts/sync-vps.mjs`（含两个 `policy/current/<省>` critical 任务）。
- **T-5 清理 VPS 顶层扁平残留**：`ssh` 执行 `find /var/www/chexian/server/data/current -maxdepth 1 -name '*.parquet' -delete`。
  - 顺序铁律：**先推子目录（T-4）再删顶层（T-5）**。先删后推的中间态若进程意外重启 = 无数据；先推后删的中间态若重启 = 并存互斥闸拒启。两种中间态都有 T-3 备份兜底 + 窗口禁 reload 纪律压缩暴露时间。
- **T-6 reload**：`sudo /usr/local/bin/deploy-chexian-api reload`。⚠️ 已知地雷：reload 后 502 先查 bcrypt MODULE_NOT_FOUND（memory `project_vps_bcrypt_reload_landmine`，`install`→`reload`）；冷启动 CrossSell 预热 ~3 分钟内 502 属已知窗口（backlog 294022）。
- **T-7 验证 oracle（逐项打勾）**
  - [ ] `/health` 200；启动日志 `Data ready` 行数 == T-0c 基线、无 GATED / overlap 告警
  - [ ] SC 超管 KPI 与 T-0c 快照**零差异**（SC 逐字节安全）
  - [ ] sx 账号 KPI 与 T-0c 快照**零差异**（山西数据不缺不涨）
  - [ ] 全国超管 `?targetBranch=SX` / `?targetBranch=ALL` 抽查数值合理（SX 非空、ALL≈SC+SX）
  - [ ] `ls data/current/` 仅 `SC/`、`SX/` 两个子目录（+ 非 parquet 杂项）
  - [ ] **Python 读侧 smoke（architect 闸 P1-1）**：本地（已迁移布局）跑 ≥1 个 Python 读侧管道（如 `field_coverage.py`），行数 == T-0e 基线——防「Node 侧全绿、Python 管道静默读 0 行」
- **T-8 观察期 24h**：`/health` 监控、SC/SX 用户报错率、route-cache 命中、RSS/DuckDB peak 对齐 multi-branch-day1-sop §6 指标、**双省用户并发下 KPI p95**（architect 闸 P2-1：微基准为单查询串行，并发争用无实测背书，观察期补）；确认 sx-promote 子目录化生效后恢复 auto-release watcher；触发异常按 §4 回滚。

## 4. 回滚路径（≤5 分钟）

1. `ssh`：`mv data/current data/current.subdir-fail && mv data/current.bak-<日期> data/current`
2. `sudo /usr/local/bin/deploy-chexian-api reload` → T-0c 快照复验。
3. **代码零回滚**——装载层对扁平/子目录自适应（B1），扁平恢复即回到现状；sync 白名单 PR 可留待复盘后处置（本地保持扁平则 sync 走单任务扁平路径，行为不变）。
4. 本地主仓同样 `mv` 回扁平并撤 `POLICY_CURRENT_SUBDIR_LAYOUT`；若窗口内本地已跑过子目录 ETL，先恢复布局再跑一次 ETL 对账。
5. 复盘登记 `.claude/workflow/pr-evolution.md`（对齐 multi-branch-rollback-sop §6 格式）。

## 5. 与 801409 红线的关系

- **「GATED 严禁推 SX 进生产（current/SX 空）」**：该红线立于 2026-06-23（当时 SX 未上线）。现状 SX 已以扁平前缀在生产在线，本 cutover 是**同数据布局搬迁**，不新增数据面；**本 cutover 不改变 SX 数据的可见性（RLS 已 on、账号已发），仅改变其物理落盘路径**——不存在「current/SX 从空到有 = 新增省上线」的解读；但 `current/SX/` 子目录从空到有仍是红线动作，解锁点 = §2-1 sync 白名单 PR，**必须与 owner 授权同批**。授权前任何会话不得合并 §2 变更包。
- **SC 逐字节安全**：T-2 本地对账 + T-7 SC KPI 零差异双 oracle。
- **readdir 枚举禁省常量**：装载/sync 均按实际子目录枚举（B1/B3 已固化）；§2-1 的白名单是**推送授权面**（安全闸），不是数据发现面，不违背此红线。

## 6. B5 性能与行为实测依据（2026-07-06，worktree 隔离实验）

- 数据：生产等价 5 文件（SC 3 + SX 2，符号链接主仓 parquet），SC 2,628,872 行 + SX 1,835,242 行 = 4,464,114 行。
- **布局对照（HTTP 层，`scripts/benchmark-key-routes.mjs`，RLS on，admin=SC）**：扁平混放 vs 分省子目录，10 条关键路由暖态 p95 均 5-13ms、冷态差异在单样本抖动内，**零退化**——子目录布局对查询路径完全透明（数据装入内存表后与文件布局无关）。
- **branch_code 索引决策（DuckDB 层微基准）**：复刻 `PolicyFactRealtime` 建表（ORDER BY policy_date）后，三种 RLS 查询形态加/不加 `branch_code` ART 索引全部持平（窄窗 KPI ~1ms、机构分组 ~2-3ms、宽窗全表聚合 ~11ms），索引构建另付 0.133s/次物化。**决策 = 不加索引**：两值低基数等值过滤由列存扫描 + zonemap 承担，ART 索引无收益、纯增启动开销。详细数字见 B5 PR body。

## 7. 关联

- 方案总纲：[省份派生化与子目录方案_2026-06-23.md](./省份派生化与子目录方案_2026-06-23.md)（§4 Phase B）
- 发账号 SOP（另一维度，不替代）：[.claude/rules/multi-branch-day1-sop.md](../../.claude/rules/multi-branch-day1-sop.md)
- 回滚基座：[.claude/rules/multi-branch-rollback-sop.md](../../.claude/rules/multi-branch-rollback-sop.md)
- 装载闸：`server/src/services/data-bootstrapper.ts`（`enforceProvinceSubdirGate` / `deduplicateOverlapping`）
- sync 闸：`scripts/lib/policy-current-shards.mjs`（`findPolicyCurrentSyncGateViolations`）+ `scripts/sync-vps.mjs`
- backlog：`2026-06-23-claude-801409`
