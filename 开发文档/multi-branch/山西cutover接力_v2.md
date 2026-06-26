# 山西分公司上线「第二层 GATED 生产 cutover」接力提示词（v2 · codex 对抗审计加固版）

> **状态**：📋 待新会话执行｜**用途**：跨会话热启动接力（新会话直接读本文件接手）｜**起草**：Claude（第一层 G6/G7/G8 实现+合并会话）｜**对抗审计**：codex CLI 0.141.0（5 P0 / 7 P1 / 4 P2 全数收进硬闸）｜**日期**：2026-06-23
>
> **维护协议**：append-only —— 新决策/实证追加，不静默改写已定结论。
>
> **为何是 v2**：v1（会话内口头版）抓住了大方向顺序，但 codex 对抗审计指出它在 RLS 验收、SX promotion、sync-vps 分省保护、账号/secret 激活、回滚分支、生产授权上**缺可执行硬闸**，"不能安全交接"。本文把这些补成 GATED 硬闸 + BLOCKED 标记。
>
> **⚠️ origin/main 仍在前进**：本文起草后，其它会话已合并 `#777`（Phase B B2 读侧子目录下钻 + **ETL gated 写侧能力**）——这可能正在补下文 B-a/B-b 两个 BLOCKER（物理布局 + promotion 能力）。**新会话开工第一件事：`git fetch` 后核对最新 Phase B 状态，B-a/B-b 可能已部分就绪，按实际代码为准，勿照本文当成静态事实。**

---

把车险平台山西（SX）数据弄进生产、给山西用户和四川（SC）一样的功能。架构 = 单数据湖 + branch_code 省份列 + 行级安全 RLS。**这是不可逆、面向线上 SC 用户的生产操作；多处步骤是 GATED 硬闸，未补齐前禁止执行，须 owner 逐步显式授权。**

## 0. 开工前 pre-flight（硬前置，缺任一即 BLOCKED）

### 0.1 环境坑规避
- Bash 曾有故障 "command logger"：对带行号输出（`grep -n`/`sed -n`/`cat -n`）失控刷屏几万行污染上下文。→ 读文件用 Read 工具；搜索用**不带 -n** 的 `grep`；jsonl 用 `tail -n N`。（注：此为某次会话环境现象，开工先验证是否仍存在；存在则照此规避。）
- 别在 `.claude/worktrees/` 下建 worktree（命中 `Read(./.claude/worktrees/**)` deny，Read/Edit 都被拦）。一律主仓兄弟目录 `/Users/alongor666/Downloads/底层数据湖DUD/chexian-api-<task>`（路径含中文，命令加引号、用 `git -C "<path>"`，别 `cd` 主仓中文路径会编码报错）。

### 0.2 从最新 origin/main 开工 + 核实第一层已合并（P1-1）
- `git -C "<主仓>" fetch origin --prune`
- 兄弟 worktree 必须基于 origin/main：`git worktree add "<sibling>" origin/main`
- 权威核实（禁信 shell 回显）：`gh pr view 774 775 776 779 780 --json state,mergedAt`（应均 MERGED）。

### 0.3 生产凭据矩阵（P1-5；缺任一项 → 该步 BLOCKED，禁止替代绕过）

| 凭据 / 权限 | 用途 | 缺失处置 |
|---|---|---|
| VPS deployer SSH（162.14.113.44） | sync / 巡检 | BLOCKED |
| `sudo /usr/local/bin/deploy-chexian-api reload` 权限 | PM2 重启（deployer 不能直接 pm2） | BLOCKED |
| 生产 `BRANCH_RLS_ENABLED` 写权限（`deploy-chexian-api edit-env`） | 开 RLS | BLOCKED |
| 生产 `USER_PASSWORDS` 写权限 | 发山西账号（**只走生产 env，禁走 PR**） | BLOCKED |
| `JWT_SECRET`（生产） | 跑 multi-branch-stress-test 隔离压测 | BLOCKED |
| `E2E_PASSWORD` | golden-baseline SC API 基线对比 | 无则 SC 零差异验收 BLOCKED，**不得用 duckdb 替代**（P1-6） |
| 健康检查 URL + GitHub PR 权限 | 验收 / 落 PR | BLOCKED |

## 1. 已完成、无需重做（带可验证事实）

- **架构 D1**：单数据湖 + branch_code + RLS（`BRANCH_RLS_ENABLED` 开关默认关，`server/src/config/env.ts` ~134）。两轮评审定型。
- **Phase A 检测层 + Phase B B1/B2**：branch_code 从 policy_no 前缀派生（610=SC/618=SX）、P5 文档收口、子目录发现/下钻、ETL gated 写侧能力，已合并（PR #762~#777）。**B2 的"ETL gated 写侧能力"可能即 SX→current/ 的 promotion 雏形，开工核对。**
- **G3/G4**：维度/派生域省份化 loader + 查询期 RLS 已落地。G4 子问题：is_telemarketing RLS（`c21667`）已 DONE #728、新能源 org_level_3（`00bac8`）已 DONE #729、续保 tonnage（`e2240c`）仍 PROPOSED。
- **G5 口径**：用户 2026-06-20 确认 6 大口径照搬四川（注意：这是**口径确认，≠ 生产 cutover 授权，≠ 业务接受近似清分**，见 2B 前置）。
- **G6/G7/G8 已合并**：G6 同城白名单省份化（#774，7307dc43）；G7 山西账号（#775，ba747d92，sxAdmin + 11 org_user，全部 `active:false` + tombstone，当前不可登录）；G8 前端空态（#776，094ed364）。收尾 #779、backlog 补登 **#780 已关闭(superseded，e52d9b 工作并入 #782)**。
- **2A 已完成（2026-06-24）**：G7 P2 login→403 运行时测试（#782，auto-merge 中）；B-b promotion 脚本（#783，已合并 `scripts/release/sx-promote.mjs`）；B-a=Option A 扁平前缀（owner 2026-06-24 拍板）。
- **山西数据**：已 ETL 到隔离区 `数据管理/warehouse/validation/SX/`（1,830,603 行 / 15.28 亿，与原始 Excel 零差异），**尚未进生产 `current/`**。
- **机构归属**：`SX.json` 按机构名近似（11 单元），精确清分需业务数据，非阻断但**太原二部含停用历史**（上线通知须含此 caveat，见 2B 前置）。

## 2A. 代码硬化波（Loop v2，分三类 —— P1-7）

- **【cutover 阻断·已完成】** G7 P2 login→403 集成测试（backlog `2026-06-23-claude-e52d9b`，已并入 #782）：账号闸的运行时验证，cutover 发账号前必须有。✅ 已合并。
- **【非阻断 backlog】** `e2240c` 续保 tonnage（PROPOSED）：可 cutover 后迭代。
- **【禁止 auto-merge】** 任何碰部署链（`deploy.yml`/`sync-vps.mjs`/`vps-wrapper/`/`ecosystem.config.cjs`）或账号链（`preset-users.ts` active/密码）的 PR：人工合并，不进 Loop 自动合并。

**Loop v2 纪律（严格）**：① 开工先 `bun scripts/backlog.mjs status <uid> IN_PROGRESS --actor <branch>` 认领锁并 push；② `bun run loop:dispatch` 算前沿；③ 双对抗闸（闸-1 审计划 + 闸-2 审 diff，P0/P1 复杂任务 codex 强制：`/opt/homebrew/bin/codex exec --sandbox read-only - < prompt文件`，skill 名 `codex` 不可用属正常、走 CLI；+ evidence-verifier + CI）；④ 收尾质量账本（round 顺延 R##）+ pr-evolution.md 三问复盘；⑤ 独立 PR ready 非 draft。

**Loop 调度器只处理非 GATED PR，绝不触发 2B。**

## 2B. GATED 生产 cutover（串行运维，非 Loop 扇出；每个不可逆步骤 owner 显式授权）

权威 runbook：`.claude/rules/multi-branch-day1-sop.md`（V1-V10）。回滚：`.claude/rules/multi-branch-rollback-sop.md`。

### 🔴 进入 2B 前必须先解决的 BLOCKER（缺一不可执行）

- **B-a 物理布局决策（P1-2）**：Day-1 生产 SX 落盘是「扁平 `SX_*.parquet`」还是「`current/SX/*.parquet`」？Phase B B1/B2 已合并子目录发现/下钻、但 #753 是扁平前缀。**先与 owner + 读 `data-bootstrapper.ts`/`paths.ts`/`sync-vps.mjs`/`check-governance.mjs` 钉死一种**，列出 loader/sync/governance 对该布局的验证命令；另一种标「不得使用」。未定 → BLOCKED。
- **B-b promotion runbook（P0-2）**：`validation/SX` → 生产 `current/` 的安全脚本（`daily.mjs` 历史设计是把非 SC 隔离到 `validation/`；#777 的 ETL gated 写侧能力可能已补，**核对**）。**确认唯一 promotion 脚本**：输入、输出布局（同 B-a）、命名、manifest、行数/保费校验、失败回滚。未有 → BLOCKED，禁止临场手拷/改脚本。
- **B-c 业务/上线授权（P1-4）**：owner 批准执行窗口 + 业务方书面接受「先按 11 单元近似清分上线」+ 上线通知模板含太原二部历史机构 caveat。

### cutover 序列（D5 顺序铁律：RLS 必须先于 SX 进 current/，违反 = 四川线上看到混省数据）

1. **抓 SC API 基线（P1-6）**：RLS-on 前，用 `E2E_PASSWORD` 跑 `golden-baseline --build` 存 SC 基线快照（无 E2E_PASSWORD → BLOCKED，**duckdb 不可替代 API 零差异**）。
2. **开 RLS + 硬验收（P0-1）**：生产 `deploy-chexian-api edit-env BRANCH_RLS_ENABLED true` → reload。**reload 后、SX 进 current/ 之前**，用 `JWT_SECRET` 跑 `STRESS_BASE_URL=https://chexian.cretvalu.com JWT_SECRET=... bun run scripts/multi-branch-stress-test.mjs --simulate-sx`，**预期：SC 非空、SX 空（`--simulate-sx` 是兼容期空断言，P1-3）、无串读、cache branch key 分离**；并比 SC API 基线零差异。任一不符 → 立即停、回滚。
3. **SX 进 current/**：按 B-b 的 promotion 脚本（布局同 B-a），落盘后 duckdb 直查行数/保费与 `validation/SX` 一致。
4. **sync-vps（P0-3 硬闸）**：**禁裸跑**。先 `SYNC_VPS_BRANCH_CODE=SX node scripts/sync-vps.mjs --dry-run`，**确认输出含 SX 分省 protect/include/exclude、远端 SC 受保护**；备份远端 manifest 后才实跑。绝不裸 `node scripts/sync-vps.mjs`（默认全量 + `--delete` 可能删远端 SC）。
5. **reload + post-cutover 验收（P1-3）**：`sudo deploy-chexian-api reload`。专门 post-cutover 验证（curl 或专用脚本）：SX 非空且 org/branch 全 SX；**SC API 与基线零差异**；无串读。
6. **发账号 —— 拆闸（P0-5，最后且最慎）**：
   - 代码 PR 只改 `preset-users.ts` 的 `active:true`，**禁含任何密码/hash**；走人工合并（账号链禁 auto-merge）。
   - `USER_PASSWORDS` **只走生产 env**（`deploy-chexian-api edit-env` / secret 管理），**禁走 git/PR**。
   - 发账号前 owner 确认精确账号清单 + 接收人 + 初始密码交付方式；激活后逐账号登录隔离验证（SX token 只读 SX、SC 不受影响）。

## 3. 回滚（P0-4，分两套）

- **账号激活前**：直接 `BRANCH_RLS_ENABLED=false` + reload 即可（SX 无人能登）。
- **账号激活后**：必须先 ① 禁用 SX 登录（`active:false` 或撤 `USER_PASSWORDS`）② 撤销 SX session ③ 通知山西暂停，**再**决定是否关 RLS。否则关 RLS 会让已登录 SX 用户看到 SC 数据。
- 触发条件：SC 用户看到 SX 数据 / SX 看到 SC 数据 / 错误率上升 / RSS 或 DuckDB peak 升 > 30%。

## 4. 通用红线

- 合并/部署/CI 状态一律幂等轮询 + `gh api`/health 原始输出留证（P2-2），禁信 shell 回显。
- 禁直推 main；走 PR + governance（**以 `check-governance.mjs` 全绿为准，不因计数漂移单独判失败**，P2-1）。
- 子代理只做只读审计或前置 PR（P2-3）；生产 env/rsync/reload/发账号必须主会话逐步请 owner 授权并亲自执行 + 留痕。
- 别在污染上下文硬撑搜索；早切 Read 工具 + 干净子代理。
- 开工先读 `.claude/workflow/pr-evolution.md` 2026-06-23 偏离复盘（别重蹈跳认领锁/跳闸的错）。

## 5. 必读

`.claude/rules/{multi-branch-day1-sop.md, multi-branch-rollback-sop.md, loop-orchestration.md}` · `.claude/workflow/pr-evolution.md` · `开发文档/multi-branch/{全国多省架构决策_2026-06-19.md, 口径对齐_山西.md, 山西机构清分对账_状态与数据需求.md}` · 代码：`scripts/sync-vps.mjs` · `数据管理/daily.mjs` · `server/src/data/data-bootstrapper.ts` · `CLAUDE.md §0/§8/§9`

---

**第一步**：跑 0.1-0.3 pre-flight → 解决 2B 的 B-a/B-b/B-c 三个 BLOCKER（多半要先做 promotion runbook + 布局决策的前置 PR，**先核对 #777 是否已部分覆盖**）→ 与 owner 确认执行窗口 → 才进 cutover 序列。**任一硬闸缺失就停在 GATED/BLOCKED，向 owner 要授权，不自行绕过。**

---

## 2B 执行接力（2026-06-24 · 2A 已完成，新会话据此执行 cutover）

> 2A 代码前置全部就绪：B-a=Option A 扁平前缀（owner 拍板）· B-b promotion 脚本 `scripts/release/sx-promote.mjs` 已合并（#783）· G7 P2 账号闸测试已合并（#782）。**以下 cutover 步骤是 production 操作，每步须 owner 显式授权，凭据缺失即 BLOCKED。**

### 第 0 步：凭据矩阵（缺任一即该步 BLOCKED，禁替代绕过）
| 凭据 | 用途 | 谁提供 |
|------|------|--------|
| `E2E_PASSWORD` | RLS-on 前后抓 SC API golden-baseline 零差异 | owner |
| `JWT_SECRET`（生产） | `multi-branch-stress-test.mjs --simulate-sx` 隔离压测 | owner |
| VPS deployer SSH（162.14.113.44） | promotion dry-run / sync / 巡检 | owner |
| 生产 `BRANCH_RLS_ENABLED` 写权限（`deploy-chexian-api edit-env`） | 开 RLS | owner |
| 生产 `USER_PASSWORDS` 写权限 | 发山西账号（只走生产 env，禁 PR） | owner |
| `sudo /usr/local/bin/deploy-chexian-api reload` | PM2 重启 | owner |

### 第 1 步（🔴 真用 promotion 脚本前必做）：VPS 真实 SX parquet dry-run
本地 `validation/SX` 为空，promotion 脚本的 `branch_code` 实际值/列名、duckdb 版本兼容性**必须在 VPS 用真实 SX parquet 先 dry-run 验证**：
```
# VPS 上，默认 dry-run（不写任何文件）
node scripts/release/sx-promote.mjs
# 预期：列出 validation/SX premium → SX_*.parquet 计划 + 每文件 branch_code='SX' 校验通过 + 行数/保费预读
```
dry-run 报错或 branch_code 校验不过 → 停，排查（字段名/列大小写/数据），不得 --apply。

### 第 2 步起：cutover 序列（D5 顺序铁律，沿用本文 §2B；关键增量）
1. 抓 SC API 基线（`E2E_PASSWORD` + golden-baseline `--build`）。
2. 开 `BRANCH_RLS_ENABLED=true` + reload → **SX 进 current/ 之前**跑 `multi-branch-stress-test --simulate-sx`（预期 SC 非空/SX 空/无串读）+ 比 SC 基线零差异。
3. **用 promotion 脚本落 SX 进 current/**：`node scripts/release/sx-promote.mjs --apply --rls-confirmed`（`--rls-confirmed` = operator 声明已核实生产 RLS-on）。⚠️ **脚本非崩溃原子**：必须等它 **exit 0 + `.sx-promote-ready` 标记存在**，**才**跑 sync-vps，**禁与 sync 并发**；若被 kill，按脚本 leftover preflight 提示清理后重跑（幂等）。
4. sync-vps 硬闸：`SYNC_VPS_BRANCH_CODE=SX node scripts/sync-vps.mjs --dry-run` 确认远端 SC 受保护 + 备份远端 manifest，再实跑。
5. reload + post-cutover 验收（SX 非空且 org/branch 全 SX、SC 与基线零差异）。
6. 发账号（最后）：PR 只改 `active:true`（禁含密码）；`USER_PASSWORDS` 走生产 env；逐账号登录隔离验证。

### 回滚（沿用本文 §3 两套：账号激活前=直接关 RLS；激活后=先禁 SX 登录再关 RLS）。

---

## 实证追加（2026-06-24 · 第 1 步 dry-run 已绿 + 验证闸修复 · append-only）

> 新会话执行 cutover 前半段时的实测。**上文「第 1 步」「第 2 步.2」不改，以本条为准。**

### A. promotion dry-run 已绿（口径校正：在本地，不在 VPS）
本地默认 `node scripts/release/sx-promote.mjs`（零写盘、零生产凭据）全绿：源发现 1 文件
`20210101-20260617_01_签单清单_定稿.parquet` → `SX_…parquet`(81.3 MB)；**P0-1 branch_code fail-fast 通过**
（全部 **1,830,603 行** 均 `branch_code='SX'`）；行数 1,830,603 + 保费 1,528,004,152(15.28 亿)与 §1 隔离区基线一致；
duckdb CLI v1.5.2 兼容；Option A 扁平不触发子目录互斥闸。

**校正上文「第 1 步」**：本地 `validation/SX/` **有真实数据**（非空）；脚本 `DEFAULT_SOURCE_DIR=validation/SX`、
`DEFAULT_TARGET_DIR=current/`，`warehouse/` 是本地源（CLAUDE.md §11），VPS 只跑 `current/` 靠 sync-vps 推 →
**promotion 是本地操作，不在 VPS 跑**（VPS 无 `validation/SX` 源）。真正的 VPS 侧 dry-run 是第 4 步 `sync-vps --dry-run`。

### B. RLS 隔离实测正确 + 验证闸假阳性已修（第 2 步.2 关键）
本地起 server（RLS on，仅 SC 数据 2,600,421 行），实测对比同一 `/api/query/kpi`：
- **SC token**：`total_premium=170,345,990`、`policy_count=225,188`、`org_count=14`（真实 SC 数据）
- **SX token**：`total_premium=null`、`policy_count=0`、`org_count=0`（全零/全空）→ **RLS 隔离正确，SX 看不到 SC 数据**

但旧版 `multi-branch-stress-test --simulate-sx` 的串读断言用「`data` 数组长度 > 0」判有数据，
**对聚合路由（KPI 等）假阳性**：RLS 过滤到零行后 `SUM/COUNT` 仍返回 1 行全零（数组长度=1）被误判成 CRITICAL 串读。
**已修**（本 PR）：断言改用 `realDataCount`（含正数业务度量的行数，计划/比率字段不计），重跑 →
`✅ 串读断言通过（SX 真实数据行=0 + SC 真实数据行>0）`；12 单测锁住假阳性回归 + 真泄漏仍触发。
**生产第 2 步据此放行**：跑 `--simulate-sx` 看到「SX 真实数据行=0」即正常，不要被任何「dataLength=1」吓到。

### C. 已登记 follow-up（非阻断，cutover 后迭代）
1. **计划维度未省份化**：`vehicle_plan_wan` 等计划字段对 SX token 也非零（dim 仍 SC-only）。兼容期无真实 SX 账号无影响；真实 SX 计划数据落地时需省份化。
2. **stress-test cross-sell 覆盖缺口**：`/api/query/cross-sell` 在压测里 HTTP 400（路由参数过时），被当失败排除→该路由未进串读断言。补参数可扩覆盖。
3. **sx-promote 测试卫生**：E2E 测试会把临时路径写进仓库跟踪的 `scripts/release/.sx-promote-manifest.json`（#783 自带），宜改写临时 manifest 或 gitignore。

---

## 实证追加（2026-06-24 · validation/SX 隔离区数据刷新到 0623 · append-only）

> owner 给新 SX 源（签单/报价 0618-0623 增量 + 理赔 2021-2026 全量），ETL 到 validation/SX 隔离层（**非 GATED 数据准备，不碰 current/、不 sync VPS**，owner 明确选「仅 ETL 进 validation/SX 隔离层」）。**§1「已完成」的「山西数据 1,830,603 行」据此更新为以下基线。**

- **签单**：历史 0617 分片 1,830,603（缓存命中未重转 485MB）+ 新增量 `20260618-20260623_01_签单清单_定稿.parquet` 2,577 行；合计 **1,833,180**，窗口 2021-01-01~2026-06-23 连续无重叠，全 `branch_code=SX`。
- **理赔（首次接入）**：`validation/SX/claims_detail/` 8 年度分区共 **236,653 赔案**（2019-2026），立案 10.56 亿，报案截止 2026-06-23（新鲜），`branch_code` 派生(policy_no[:3]=618)全 SX。首次 ETL 漏做理赔，本次补齐；旧 `山西_理赔明细_2026`(仅2026,3.7MB)残缺文件作废，改用 2021-2026 全量(80MB)。
- **报价**：历史 570,355 + 增量 9,818 = **580,173**，窗口 2025-12-01~2026-06-23，`branch_code` 全 SX（policy_no 缺失 90.7% 兜底 SX，B255 已知质量问题）。
- **续保**：owner 未给新数据，`renewal_tracker/latest.parquet` 保留不动。
- **🔒 隔离铁律守住**：`current/` 仍纯 SC 2,600,421（duckdb 核验）。源软链在 `staging/SX`（标准命名：`YYYYMMDD-YYYYMMDD_01_签单清单*` / `04_报价清单*` / `YYYYMMDD-YYYYMMDD_02_理赔明细*`）。
- **ETL 入口**：`BRANCH_CODE=SX node 数据管理/daily.mjs {premium,claims_detail,quotes}`（多省 0a 路由，产物落 validation/SX 并自动跳过所有 SC 副作用）。
- **cutover 仍 GATED**：本次只刷新隔离区数据。promote→开 RLS→sync→发账号 **未动**，须 owner 凭据矩阵（E2E_PASSWORD/JWT_SECRET/生产 env 写权限/USER_PASSWORDS）+ 逐步授权（见上文「2B 执行接力」）。

---

## 实证追加（2026-06-25 · cutover 能力体检：上文「2A 全部就绪」需修正 + 补齐路线图 · append-only）

> validation/SX 刷新到 0623 后做 cutover 能力体检，发现上文「2A 代码前置全部就绪，新会话据此执行 cutover」**不准确**。**新会话 cutover 前必先补齐下列能力，不能直接进 §2B cutover 序列。**

### 新增事实
- **SC multiProvince 数据列已上线生产**（Task B #790，2026-06-24）：生产 `current/` 全 SC **2,600,421** 行已带 `branch_code='SC'` 列，reload 后启动日志 `TrendCube/SalesmanCube ready (branch_code=true)`。RLS 所需的生产数据列前置已就位（但 `BRANCH_RLS_ENABLED` 仍未开）。

### 能力缺口（体检结论）
1. **promote 工具链只覆盖签单**：`sx-promote.mjs` 只把 `validation/SX/*.parquet`（签单）promote 到 `current/`。**理赔 `validation/SX/claims_detail/` + 报价 `validation/SX/quotes_conversion/` 无 promote 路径** → 即使签单进生产，这两个派生域仍进不去。
2. **VPS 读不到 validation/SX 派生域**：`paths.ts` + `sync-vps` 只覆盖 `current/` + 标准 fact/dim，不含 `validation/SX`。
3. **开 RLS 机制偏差**：day1-sop 假设 `deploy-chexian-api edit-env`，wrapper 未实现该子命令。

### 补齐路线图（5 任务 backlog，2026-06-25 登记）
| PR | uid | 角色 | 部署链 |
|----|-----|------|--------|
| PR-1 | `5f1545` | **核心起点**：ClaimsDetail loader 多省扩展（`loadClaimsDetail` 加 extraSources，对齐 `loadQuoteConversion`；让 validation/SX/claims_detail 进 VIEW）。**风险 R1**：ClaimsAgg 聚合丢 branch_code → 赔付路由须经 PolicyFact JOIN 传 branch_code，否则开 RLS 报 Binder Error | 否 |
| PR-2 | `a94c21` | `paths.ts getValidationRootDir` 加 VPS 回退 + sync-vps 追加 validation/SX claims_detail+quotes_conversion 同步 → 让 VPS 读到 SX 派生域 | **是·禁 auto-merge** |
| PR-3 | `fe871b` | **GATED 终点**：ecosystem `BRANCH_RLS_ENABLED=true`。不可逆，人工窗口 merge+盯 CI；开前必跑 `stress-test --simulate-sx` + SC golden-baseline 零差异（需 owner E2E_PASSWORD/JWT_SECRET） | **是·禁 auto-merge** |
| PR-4 | `8e6e8a` | wrapper 补 `edit-env` 子命令（可选，修 day1-sop 偏差） | **是·禁 auto-merge** |
| PR-5 | `34dae2` | 前端空态保护（claims-detail/renewal-tracker KPI 空时显「数据装载中」，参 G8 范式） | 否 |

### 路径架构选择（关键决策点，新会话开工先核对）
两条 SX 派生域进生产路线，**二选一须先与 owner + 读 D6 ADR 钉死**：
- **A. promote 到 `current/SX_*`**（sx-promote 模式）：需为理赔/报价扩 promote 工具链。
- **B. loader 直读 `validation/SX` + sync validation 到 VPS**（当前 PR-1/2 backlog 按此设计）。
⚠️ **D6 ADR（#788）已定「0a 隔离层终局 = 子目录 `current/<省>/`」**，与 B 的 validation/SX 直读可能冲突——**新会话开工先核对 D6 与 PR-1/2 路线是否一致**，不一致则先收敛架构再实现。

### cutover 仍 GATED 未动
promote/开 RLS/sync/发账号全部未执行，须 owner 凭据矩阵 + 逐步授权（见 §2B「执行接力」）。

---

## 实证追加（2026-06-25 · PR-1 ClaimsDetail 多省扩展完成 + repair 泄漏发现 · append-only）

> 阶段 1 能力补齐 PR-1（`5f1545`）已实现+验证（owner 授权"行动吧"，主会话执行）。**修正上文「能力体检」PR-1 表述 + 新增 repair 硬前置（PR-6）。cutover 仍全 GATED 未动。**

### 路径架构（阶段 0）已与 D6 核对：不冲突
D6 子目录终局（`current/<省>/`）仅约束 **PolicyFact（签单）**；派生域（claims_detail/quotes/renewal）走 G4 `validation/<省>/` 直读（loader `extraSources` + `resolveBranchFactExtras` 既有模式），D6 未涉及 → **PR-1/2 路线 B 与 D6 兼容**，无需先收敛架构。

### PR-1 已完成（loader 层，不碰部署链）
- **实现**：`loadClaimsDetail(db, parquetPath, extraSources=[])` 多省扩展。新增专属 `composeClaimsDetailSelect`（纯函数）/ `buildClaimsDetailSelectSql`（async）（`duckdb-domain-loaders.ts`）+ `resolveBranchClaimsDetailExtras` 探测 `validation/<省>/claims_detail/claims_*.parquet` glob（`data-bootstrapper.ts`）+ `getBranchValidationClaimsDetailDir`（`paths.ts`）。
- **关键设计澄清（与体检 backlog 描述偏离，均已实证）**：
  1. **SC claims_detail 已含 `branch_code` 列**（duckdb DESCRIBE 实测 YES，全 'SC' 288,198 行）——ADR §11 2026-06-23「claims_detail latest.parquet 缺列」结论**已过时**（#789 物化时补上）。
  2. **不能套 `loadQuoteConversion` 补列模式**：ClaimsDetail 是 CDC 年度分区 glob，每源必须保留 `union_by_name=true`（分区间 branch_code 列有无的 schema 漂移），而派生域 `selectUnionWithBranchCode` 不带它 → 故 PR-1 写专属构造（单源短路逐字节等价历史，多源每源各自 union_by_name 后 UNION ALL BY NAME）。
  3. **R1 正解 = ClaimsAgg 不加 branch_code**（与体检"加 branch_code"假设相反）：所有 ClaimsAgg 消费方都 `FROM PolicyFact ... LEFT JOIN ClaimsAgg ON policy_no`，RLS `branch_code='SX'` 解析到 PolicyFact（唯一含列）；给 ClaimsAgg 也加列反致**裸列名歧义 Binder Error**。全仓裸 `FROM ClaimsAgg`=0 已复核。
- **验证**：CI 单测 21（含 8 新）+ 集成 4（真 DuckDB R1 隔离 SX=3000/SC=5000、无串读、无 Binder）+ 全量 4096 passed + typecheck 0 + governance 44/44；duckdb 真实数据 oracle：多源 SC 288,198+SX 236,653 / SC 看板赔款多源 == 纯 SC `1,421,721,840.37`（字节安全）/ policy_no 跨省碰撞 0。
- **字节安全**：`extraSources=[]`（生产 SC-only）单源短路逐字节等价历史、不 DESCRIBE。本地 `validation/SX` 存在 → 多源，但 PolicyFact 纯 SC → SX 赔案孤儿经 `JOIN ON policy_no` 丢弃（前缀 610/618 不碰撞）→ SC 结果不变（oracle 已证）。

### 🔴 新增 repair 硬前置（PR-6 · `2bb22d` · PR-3 RLS-on 前必修）
code-reviewer 子代理 fresh-context 对抗审查发现：`repair.ts` 4 端点（coop-tier / scatter×2 / diversion / orphan-shops）的 shadow 网点 CTE `FROM ClaimsDetail c` **不经 PolicyFact JOIN、无 branch_code 过滤**（orphan-shops 还 `void whereClause` 丢弃全部过滤）。PR-1 让 ClaimsDetail 多源后，**RLS-on + SX 账号激活会让 repair 影子网点跨省串读**（SX 看 SC 赔案 / 反之）。
- **当前不触发**：RLS 仍关、无 SX 账号 → PR-1 合并后安全。
- **PR-3（`fe871b`）已加依赖**：开 RLS 前 PR-6 必须先合并。orphan-shops「全省维度」语义多省后需业务确认（本省/全国）。
- **对比**：claims-detail / claims-heatmap **安全**（RLS 注入内层 PolicyFact 子查询，`eligible_policies` CTE 不 SELECT branch_code → 外层 `ClaimsDetail c JOIN eligible_policies p` 无歧义）。

---

## 实证追加（2026-06-25 · PR-6 repair shadow CTE 分省 RLS 完成 + codex 发现 RepairDim 第二半缺口 · append-only）

> 阶段 1 PR-6（`2bb22d`）已实现 + 双对抗审查（code-reviewer + codex CLI 0.141.0）+ 验证。**关键修正：repair RLS 闭合是「两半」——PR-6 闭赔案侧（ClaimsDetail/PolicyFact）第一半，新登记 PR-7 闭登记表侧（RepairDim）第二半。cutover 仍全 GATED 未动。**

### PR-6 已完成（loader/SQL 层，不碰部署链，可正常合并）
- 实现：repair.ts 5 端点（coop-tier/scatter/local-resource/diversion-list/orphan-shops）6 处 ClaimsDetail 影子扫描经 `resolveBranchRlsCode(req,'ClaimsDetail')` 下推 `c.branch_code='XX'`；diversion 的 `policy_dedup`(PolicyFact) 加显式 `branch_code='XX'`（review HIGH-1 纵深防御，不再仅靠 policy_no 610/618 前缀约定）；时间窗 `MAX(accident_time)` 基准子查询同步本省过滤。branchCode undefined（RLS-off）→ 零字符变更（字节安全）。
- 范围：backlog 枚举 4 端点，按其判据「不经 PolicyFact JOIN + 无 branch_code 过滤」补齐同类 local-resource（端点 5·防同码跨省赔案灌入），修一类不修一处。
- 验证：单元 11 + 集成 8（真 DuckDB：SX 不串读 SC、同码碰撞隔离、policy_no 碰撞下 PolicyFact 过滤 8000 vs 泄漏 107999、RLS-off 历史行为、无 Binder）+ governance 44/44 + typecheck + 全量 4113 passed。

### 🔴 codex 对抗审计发现 repair RLS 第二半缺口（PR-7 `e6fac1`，RLS-on 新增硬前置）
PR-6 只过滤 ClaimsDetail（赔案侧）。**RepairDim（登记表侧）无 branch_code 列，仍跨省**：
1. **RepairDim-only 端点（overview/detail/status/metadata/city/channel/to-premium）对 branch_admin 未省份隔离**：branch_admin 的 permissionFilter 无 org_level_3 → `buildRepairWhere` 降为 '1=1' → RepairDim 全读 → **SX branch_admin 看 SC 维修网点 = 直接泄漏**。（org_user 经 org_level_3 隔离，不触发。）
2. **影子/孤儿 CTE 的 bare RepairDim 子查询跨省**（coop-tier `NOT IN`/diversion active_shops+past+none/orphan `NOT IN`）：SX 赔案网点码若登记在 SC RepairDim → SX 视角误判为已登记 → 漏报本省影子 + 弱推断信道。codex 真 DuckDB 复现：1 条 SX 赔案 + 同码 SC 登记店 → SX orphan/coop none_shadow/diversion 全空。
3. **diversion policyWhereExtra Binder 隐患**：RepairDim 有 branch_code 而 PolicyFact 无列的 schema skew 态会 Binder Error。

→ 已登记 **PR-7 `e6fac1`** 为 PR-3（`fe871b` RLS-on）新增硬前置。修法选项：RepairDim 物化 branch_code（如 #789 对 claims_detail/salesman）或 org_level_3→branch 派生映射；「孤儿=全省/本省未登记」语义需业务确认。**ADR §11「repair RLS 面外」的 cutover 阻断升级第二半。**

### cutover 前置清单更新（截至 2026-06-25）
- 非 GATED 能力补齐：PR-1 ✅(#792) · PR-6 ✅(#793) · **PR-7 ✅(本 PR·RepairDim 省份化)** · PR-2(`a94c21` 部署链·禁 auto-merge) · PR-5(`34dae2` 前端空态)。
- GATED：PR-3(`fe871b` RLS-on，依赖 PR-1/2/6/**7** + 账号 + owner 凭据) · PR-4(`8e6e8a` 可选 edit-env)。

---

## 实证追加（2026-06-25 · PR-7 RepairDim 省份化完成 + codex 闸-2 两轮（抓 diversion PolicyFact 污染 HIGH→已修） · append-only）

> 阶段 1 PR-7（`e6fac1`）已实现 + codex CLI 闸-2 两轮对抗 + 验证。repair RLS「两半」**全部闭合**（PR-6 赔案侧 + PR-7 登记表侧）。**RepairDim 真实物化 + sync 是后续数据发布步（类比 #790），cutover 仍全 GATED 未动。**

### PR-7 已完成（代码·堆叠于 PR-6 #793·byte-safe·gated）
- **ETL（镜像 #789 salesman 常量 'SC'，repair SC-only）**：`convert_repair.py` durable 落 `branch_code='SC'`；`materialize_branch_code_special.py` 加 repair 域（存量零刷新回填）；`oracle_mpdata_byte_safety.py` DOMAINS 加 repair。
- **SQL（repair.ts）**：新增 `repairDimBranchAnd` + coop-tier/diversion/orphan 加 `repairBranchCode` 参数，5 处 bare RepairDim 子查询（coop-tier NOT IN / diversion active+past+none / orphan NOT IN）下推 `branch_code`。`repairBranchCode` 经 `resolveBranchRlsCode(req,'RepairDim')` **独立 gate**（gate b 在 RepairDim 列存在性，仅物化后为真）→ 与 ClaimsDetail 的 branchCode 分开 → RepairDim 未物化时不注入、不 Binder、字节安全。RepairDim-only 端点（overview/detail 等）经既有 buildRepairWhere 自动隔离。
- **数据发布步（后续·类比 #790）**：本地 `python3 数据管理/pipelines/materialize_branch_code_special.py --domains repair --data-root 数据管理/warehouse` 给存量 RepairDim parquet 加 branch_code='SC' → `oracle_mpdata_byte_safety.py` 字节安全验证 → sync-vps 推 dim/repair。**RLS-on 前必做（否则 repair RLS 不激活）。**

### 🔴 codex 闸-2 两轮（再证 codex 多模型对抗价值）
- **第 1 轮**抓 HIGH：RepairDim 物化 branch_code 后 `buildRepairWhere` 的 whereClause 含 branch_code，diversion 经 `policyWhereExtra` 注入 PolicyFact → 绕过 policyBranchCode 独立 gate → PolicyFact 未物化 branch_code 的 schema skew 态 Binder Error（真 DuckDB 复现）。这是 PR-6 MEDIUM-1（当时 dormant）被 PR-7 **激活**。
- **修法**：diversion 的 whereClause 仅用于 PolicyFact，改传 `buildRepairPermissionWhere`（org-only）；PolicyFact 分省由 policyBranchCode 独立 gate 处理。各表分省 gate 各管自己的列 → fail-safe。
- **第 2 轮复审**：0 CRITICAL / 0 新 HIGH，原 HIGH 已闭合，可合并。另指出一个 MEDIUM（非本 PR 引入·非分省隔离）：diversion org 粒度泄漏（org_user 见同分公司他机构 claim 行，policy null）→ 已登记 P3 follow-up `6b021a`。

### cutover 前置清单（PR-7 完成后）
- 非 GATED：PR-1 ✅ · PR-6 ✅(#793) · PR-7 ✅(#794) · **PR-2(`a94c21` 部署链)** · **PR-5(`34dae2` 前端)** 待做。
- 数据发布步：**RepairDim materialize+sync**（PR-7 激活）+ validation/SX 派生域 sync（PR-2）。
- GATED：PR-3 RLS-on（依赖 PR-1/2/6/7 + RepairDim 物化 + 账号 + owner 凭据）· PR-4 可选。

---

## 实证追加（2026-06-25 · PR-2 部署链「VPS 读 SX 派生域」完成 + codex 闸-2 抓「日常 sync 把 SX 推进生产」CRITICAL · append-only）

> 阶段 1 PR-2（`a94c21`）已实现 + 双对抗（codex 闸-2 两轮 + code-reviewer fresh-context）+ 验证。**关键修正：原 backlog 漏 renewal_tracker 域；codex 抓出「日常 sync 会让 SX 进生产」CRITICAL，已收口为 GATED 显式开关。cutover 仍全 GATED 未动。** 本 PR-2 分支从 PR-6 期 origin/main 分叉，收尾时已 merge origin/main 纳入 PR-7（#794 已合并）。

### PR-2 已完成（分支 claude/sx-cutover-pr2-deploychain，未合并；部署链·禁 auto-merge）
- **paths.ts**：getValidationRootDir 加 VPS 回退（首个存在者：本地 warehouse 优先 → server/data/validation 回退）+ 纯函数 getValidationRootDirs（两候选）+ 可注入 candidates 参数（确定性测试）。VPS 无 warehouse → 原单路径恒不存在 → loader 探测 [] → SX 派生域永进不去；回退后能读到 sync 推送目标。
- **sync-vps.mjs**：buildValidationBranchSyncTasks 枚举 warehouse/validation/<非SC省>/<派生域> → 推 VPS data/validation/<省>/<域>，append 到 buildStandardSyncTasks。
- **对称性三层**（与 data-bootstrapper resolveBranch*Extras 一致）：① 省份 `^[A-Z]{2}$`+排除 SC+升序 ② 域集合 = loader 真读的 5 域 {claims_detail,quotes_conversion,renewal_tracker,cross_sell,new_energy_claims}（修正 backlog 漏 renewal_tracker；customer_flow 从 PolicyFact 派生、loadCustomerFlow 无 extras 参数 → 正确排除——codex 第 2 轮误判为「漏」，已逐行核验否决，不盲从）③ 文件级 claims_*.parquet / latest.parquet。
- **验证**：单元 15（paths 5 + sync 10）+ 全量 4132 + typecheck + governance 44/44 + 字节安全 node 实测（flag 默认 false → 标准任务 15、validation 项 0）。

### 🔴 codex 闸-2 第 1 轮抓 CRITICAL（日常 sync 把 SX 推进生产 = 破坏字节安全）
- buildStandardSyncTasks 无条件 append validation 任务 + bootstrapper resolveBranch*Extras 不检查 BRANCH_RLS_ENABLED + loader 无条件 UNION ALL BY NAME → **RLS-off 生产机跑过这版 sync+reload 即让 SX validation 进生产派生关系**。
- **修法**：validationBranchSyncEnabled() 总开关（SYNC_VALIDATION_BRANCHES，默认 off）→ SX validation 进生产收口为 **GATED cutover 显式数据发布步**（类比 #790 / RepairDim），日常 sync 默认不推 → 逐字节等价历史。HIGH（文件门禁）：validationDomainHasData 防空目录 rsync --delete 清空 VPS。
- **第 2 轮复审**：CRITICAL/HIGH/MEDIUM 全闭合、0 新阻断；1 LOW（customer_flow）核验为误读否决。

### cutover 数据发布步增量（PR-2 激活）
- validation/SX 派生域 sync 是 **GATED 显式步**：`SYNC_VALIDATION_BRANCHES=1` + `node scripts/sync-vps.mjs`（RLS-on 前置序列内，类比 RepairDim materialize+sync）。日常 `release:daily` 不带此 env → 不推 SX。**RLS-on 前必做（否则 VPS 读不到 SX 派生域）。**

---

## 实证追加（2026-06-25 · PR-5 前端空态保护完成 · append-only）

> 阶段 1 PR-5（`34dae2`）已实现 + 双对抗（code-reviewer + codex CLI；后者按 #796 用户指令为单源闸）。**非部署链，非 GATED。PR-2（#795）已被 owner 合并入 main。**

### PR-5 已完成（分支 claude/sx-cutover-pr5-frontend-empty，未合并）
- **renewal-tracker（真静默零 → 修）**：RenewalTrackerPage 原 `{data && (...)}` 直接渲染全零仪表盘。新增纯函数 `isRenewalEmpty`（规模锚=应续件数 A，useMemo 收口）+ 页面级 EmptyState 守卫。
- **claims-detail ClaimsHeatmapPanel（隐性静默零 → 修）**：原 `periods.length===0` 挡不住「有时间桶但规模锚全 0」零矩阵。新增 `isClaimsHeatmapEmpty` + EmptyState。
- **逐 panel 读实际代码定范围（非照测绘清单）**：PendingClaimsPanel 刻意「0 件正常态」（codex P2 #2）/ GeoRiskPanel 已有「暂无赔案数据」叙事（但 KPI 卡仍 0 件 → **部分缓解**，登记 P3 `6a5aad`）/ LossRatioDev 已有空态框架 → 均排除（避免回归既有刻意行为 + 误伤真实零）。
- **SC 无影响**：populated 数据 isXxxEmpty=false → 渲染路径逐字节等价历史。
- **验证**：TDD 单元 15（renewal 8 + heatmap 7）+ 两 feature 套件 137 + typecheck + build + governance 44/44。

### cutover 前置清单（PR-5 完成后）
- 非 GATED：PR-1 ✅(#792) · PR-6 ✅(#793) · PR-7 ✅(#794) · **PR-2 ✅(#795 已合并)** · **PR-5 ✅(本 PR·未合并)**。**非 GATED 代码前置全部就绪。**
- 数据发布步（GATED 显式）：RepairDim materialize+sync（PR-7 激活）· validation/SX 派生域 sync（PR-2 激活，`SYNC_VALIDATION_BRANCHES=1`）。
- 🔴 GATED：PR-3 RLS-on（依赖上面全部 + 数据发布 + 山西账号激活 + owner 凭据矩阵）· PR-4 可选 edit-env。

---

## 实证追加（2026-06-25 · 步骤1 RepairDim 数据发布步「物化+字节安全」已本地执行 · ⑤⑥同步待下次发布顺带 · append-only）

> 承接上节 PR-7（`e6fac1`）「数据发布步（后续·类比 #790）」。本次按接力执行步骤1 的本地数据步 ①②③④——硬活（字节安全物化）已完成且 durable；⑤真同步/⑥reload 因本机当前 IP 被 VPS fail2ban 重置 SSH 而 BLOCKED，**顺延到下次正常发布自动携带**（dim/repair 已在标准同步清单）。RLS 仍 OFF，repair 分省 RLS 待 PR-3 RLS-on 才激活 → 同步延后对线上零影响。

### ①②③④ 已执行（本地·byte-safe·SC-only）
- **① 物化前快照**：`oracle_mpdata_byte_safety.py --snapshot /tmp/repair_base.json --data-root <主仓 warehouse>` → 8 域值级基线。物化前现状核实：repair 是**唯一**无 branch_code 域（13 列、6,682 行），其余 7 域（salesman/cross_sell/claims_detail/customer_flow/quotes_conversion/renewal_tracker/new_energy_claims）早已物化 branch_code='SC'。
- **② 真物化**：`materialize_branch_code_special.py --domains repair --data-root <主仓 warehouse>` → 给存量 `dim/repair/latest.parquet` 仅追加 `branch_code='SC'`（零刷新·append_column）。结果：6,682 行、13→14 列、248,014→270,291 字节。
- **③ 字节安全 verify**：`oracle_mpdata_byte_safety.py --verify /tmp/repair_base.json ...` → **exit 0**，8 域「非 branch 列值级逐行全等 + branch_code 全 SC、0 NULL」。
- **④ sync dry-run**（不连 VPS·纯计划）：`node scripts/sync-vps.mjs --dry-run` → dim/repair 在 `buildStandardSyncTasks` 标准清单内；未设 `SYNC_VPS_BRANCH_CODE` → 单省 SC、省份保护 filter 不触发、无跨省 --delete 风险。

### ⑤⑥ BLOCKED（基础设施层·非授权问题）
- 本机当前 IP `151.244.134.80` 到 VPS:22 在 SSH 握手阶段被**持续重置**（`kex_exchange_identification: Connection reset by peer`；跨 30+ 分钟、沙箱内外、6+ 次一致）。VPS 本身在线（生产 HTTPS `/health` HTTP 200）。
- 定位：到 VPS 路由 en0 直连（非代理隧道）；对照 github.com:22 不重置 → 重置是 **VPS 专属对该 IP**；典型 fail2ban（部署窗口失败连接 + 重试触发）。IP 动态会轮换，封禁过期/换网即恢复。
- **结论：无需特殊补做**。`dim/repair` 已在标准同步清单 + 生产者 `convert_repair.py:87` durable 产 branch_code → 下次任一成功 `release:daily`/`sync-vps.mjs` 增量自动把新 repair parquet 推上 VPS。RLS-on（PR-3 `fe871b`）前完成同步即可。

### 本步剩余（待 SSH 恢复后一次正常发布即可）
- 换网/IP 轮换/fail2ban 解封后，正常 `bun run release:daily`（或 `node scripts/sync-vps.mjs`）一次 → dim/repair 上 VPS → `sudo /usr/local/bin/deploy-chexian-api reload` → curl `/api/query/repair/*` 200 验证（RLS-off 故 SC 行为不变）。
- backlog `e6fac1` 已 note 本步进度。

---

## 实证追加（2026-06-25 · 步骤 B validation/SX sync「顺序校正」+ SSH 仍 BLOCKED + repair 污染 oracle · append-only）

> 承接上节「步骤1 RepairDim」。owner 指令「做数据发布步（A RepairDim + B validation/SX 一起），再到 PR-3 RLS-on」。本次会话核实两件事：(1) SSH 仍 fail2ban BLOCKED，真同步无法执行；(2) 用真实数据 oracle 发现**步骤 B 在 RLS-off 时执行会污染线上 SC 的 repair 视图**。owner 据证据拍板：**步骤 B 推迟到 PR-3 RLS-on 同窗口**。**本节 D 校正上文 §「PR-2」/§「PR-5 后清单」中「validation/SX sync RLS-on 前必做」的表述——以 §128 cutover 序列（先 RLS-on 再 sync）为准。**

### A. 现状核实（PR 全合并 + 步骤 A 仍就绪）
- PR #792-799 全部 MERGED（`gh pr view` 逐个权威核实）。非 GATED 代码前置全就绪。
- 步骤 A RepairDim 本地物化保持就绪：`dim/repair/latest.parquet` 6,682 行全 `branch_code='SC'`、14 列、270,291 字节（本次 duckdb 复核）。
- VPS 在线（`/health` HTTP 200）。

### B. SSH 仍 BLOCKED（基础设施层·与 #799 同·本次单测未重试）
- 本机当前公网 IP 仍 `151.244.134.80`（与 #799 被封 IP 相同）→ fail2ban 封禁未解除。
- 单次 `ssh chexian-vps-deploy` → `kex_exchange_identification: read: Connection reset by peer` / `Connection reset by 162.14.113.44 port 22`；对照 github.com:22 不重置 → VPS 专属封禁。遵「SSH 部署窗口勿连试」单测即停。
- 结论：步骤 A 真同步（⑤rsync/⑥reload）+ 步骤 B sync 本次均无法执行。步骤 A 顺延日常发布自动携带（`dim/repair` 在标准同步清单，dry-run 已复核）。

### C. 🔴 步骤 B RLS-off 污染 oracle（真实数据·关键发现）
- **机制**：步骤 B 把 `validation/SX/claims_detail`（236,653 山西赔案）推上 VPS → loader **无条件** UNION 进 `ClaimsDetail` 视图（PR-2 期 codex 标 CRITICAL：不看 `BRANCH_RLS_ENABLED`）→ repair 影子端点（coop-tier/scatter/orphan-shops）在 RLS-off 时**零过滤**（PR-6 字节安全 = 不注入 branch 条件）→ 山西维修网点灌入四川用户视图。
- **duckdb oracle**（`dim/repair` 纯 SC 登记 + `fact/claims_detail`(SC) + `validation/SX/claims_detail`，影子 = `subject_shop_code NOT IN RepairDim`）：repair 影子/孤儿网点 **7,225**（推 SX 前·正确）→ **13,130**（推 SX 后 RLS-off）= **+5,905 个山西网点污染四川视图**。污染窗口直到 PR-3 RLS-on 才闭合（PR-6/PR-7 分省过滤激活）。
- dry-run 复核：`SYNC_VALIDATION_BRANCHES=1` 推 `claims_detail`/`quotes_conversion`/`renewal_tracker` 3 派生域到 `data/validation/SX/<域>`（SX 专属目录，不与 SC 重叠，无 `--delete` 误删 SC 风险）。
- **步骤 A（RepairDim）无此问题**：repair 域无山西数据，物化纯 SC + `branch_code` 列，RLS-off 字节安全（`resolveBranchRlsCode` RLS-off 返回 undefined → 不注入）。

### D. owner 决策 + 顺序校正（2026-06-25·RED）
- **owner 拍板**：步骤 B（validation/SX 派生域 sync）**推迟到 PR-3 RLS-on 同窗口**——先 `BRANCH_RLS_ENABLED=true` + reload，**再** `SYNC_VALIDATION_BRANCHES=1 node scripts/sync-vps.mjs` 推派生域。与本文 §128 cutover 序列（sync-vps 在 RLS-on 之后第 4 步）一致，零污染。
- **校正（作废上文相反表述）**：§「PR-2 cutover 数据发布步增量」/§「PR-5 后清单」写的「validation/SX 派生域 sync RLS-on 前必做」会打开 C 的污染窗口，**作废**。正确顺序固定为：**RLS-on（含 reload）→ 再 sync validation/SX 派生域**。理由：派生域含真实山西数据，进 VPS + reload 即被 loader 无条件 UNION，repair 影子端点 RLS-off 零过滤 → 必须 RLS 已 on 才安全。
- 步骤 A（RepairDim，纯 SC）不受此约束，可 RLS-on 前安全同步（待 SSH 恢复，由日常发布自动携带）。
- backlog `fe871b`（PR-3）已 note 本决策；`e6fac1`（步骤 A）状态不变。

---

## 实证追加（2026-06-25 · 生产 RLS-on dry-run：可逆开关→挖出"全员 branchCode 缺失"致命隐雷→修复→回滚 · append-only）

> owner 授权在生产做一次**可逆**的 RLS-on 扫雷（零山西用户、零 SX 数据、可一键回滚）。结论：**RLS-on 机制对四川安全，但挖出一个未写进 cutover 清单的致命隐性前置并已修复（数据层）。完整 cutover 仍因 SSH(fail2ban) 卡 SX 同步未完成，已回滚 RLS 到关闭，所有修复持久保留。**

### A. 致命隐雷（已修数据层 · PR-3 RLS-on 硬前置）：存量用户 user_store.json 缺 branchCode
- **现象**：`BRANCH_RLS_ENABLED=true` + reload 后，**所有用户**（admin 在内）每次查询 `401 Token missing branchCode`，重登也没用 → 全员锁死。
- **根因链**：登录读**内存 DuckDB `UserAccount`**（`access-control.ts:342 getUserByUsername`），该表启动时从 **`user_store.json`** 加载（`seedAccessControlData`/`loadFromStore`）。生产 `user_store.json`（6/10 生成，早于多分公司改造）**20 个用户全部无 `branchCode` 字段** → 内存 branch_code 全 NULL → JWT 无 branchCode → `permission.ts:89` fail-closed 401。`preset-users.ts` 虽带 branchCode='SC'，但 `ensurePresetUser` **只对"库里不存在的用户"生效**，存量用户走不到补全。
- **修复（数据层，已落生产）**：备份后 `python3` 给 `/var/www/chexian/server/data/user_store.json` 全部 20 用户写 `branchCode='SC'`（全是四川、零 SX，已 `sqlite3` 核实）→ reload。验证：JWT 含 `"branchCode":"SC"`、RLS-on 下 admin kpi 200 + 2.06 亿。
- **⚠️ 这是运行时数据修复，非代码修复**：若 `user_store.json` 被重新 seed/import 覆盖（无 branchCode），隐雷复发。**永久修复见 backlog（admin-import-users-from-json 带 branch_code + ensurePresetUser 对存量用户 reconcile branchCode）。**
- **红鲱鱼**：起初误改 `state.db`（以为 `STATE_STORE_BACKEND=sqlite` 登录从它读）→ 无效。**state.db 只是写镜像，读/启动加载走 user_store.json**。已顺手把 state.db 也回填 'SC'，但非必需。

### B. 管理员密码已重置（2026-06-25）
- 旧泄漏密码 `CxAdmin@2026!` 早失效（实测 401）；本次 owner 重置为全新强密码（bcrypt 哈希更新进 `user_store.json` 的 admin + reload）。**明文在 owner 密码管理器，不落盘、不入任何文档/对话。** memory `reference_auth_credentials` 已更新。

### C. 验证结论：RLS-on 对四川安全
- 抓了 SC 生产黄金基线 `golden-baseline --build` **72/72**（并发=1 避开 2核4G VPS 并发瞬态——并发 4 会让重活查询返回"查询执行失败"假阴）。
- RLS-on 后 `--compare`：**头部 KPI（保费/件数）、total_cases、所有结构/分类/字符串零差异**；唯二差异 =（1）浮点末位求和噪声；（2）`claims-detail/geo-comparison` 的 `cross_region_cases` 抖 15 例（0.014%）。
- **(2) 已证与 RLS 无关**：PolicyFact 生产 100% 'SC'（duckdb 核 2,600,421 行）→ `branch_code='SC'` 过滤等于 `1=1` → 去重子查询输入输出相同 → total_cases 一致。15 例来自 `claims-detail.ts:48 ANY_VALUE(plate_no)`（DuckDB 非确定性聚合，对同保单号多车牌个例任意挑行，跨进程重启翻转），与 RLS 正交。**单独 cleanup backlog。**

### D. 仍 GATED / 剩余
- 完整 cutover 未完成：**第 4 步 SX 数据同步卡 Mac→VPS SSH(fail2ban，IP 151.244.134.80)**；第 6 步发账号待。
- 下次（SSH 恢复后）一气呵成顺序：① 确认 user_store.json branchCode 仍在（或已上永久修复）→ ② `golden-baseline --build`（并发=1）抓基线 → ③ `BRANCH_RLS_ENABLED=true`+reload → admin kpi 非 401 冒烟 → ④ promote SX + `SYNC_VPS_BRANCH_CODE=SX` sync + `SYNC_VALIDATION_BRANCHES=1` sync 派生域 → ⑤ reload + post-cutover 验收 → ⑥ 发账号。
- RLS 当前 = **关闭**（已回滚，生产 = 已知良好态，admin kpi 200 核实）。

---

## 实证追加（2026-06-25 · cutover 步①-⑤ 执行完成，停在「数据上线+隔离验证」安全点，步⑥发账号待 owner · append-only）

> owner 授权「启动完整 cutover」，主会话执行。**SSH fail2ban 已自然解除**（IP 151.244.134.80 现可连，与 #801 同 IP；root 通道 `ssh chexian-vps` 免密 key 可用）。步①-⑤全部完成，**RLS 当前 = 开启，山西数据已上线生产**。停在步⑥发账号前（owner 选「先停安全点准备前置」）。

### 已执行（按 #801 §D 顺序）
- **凭据/通道**：owner 填 E2E_PASSWORD + JWT_SECRET 进 `~/.chexian-cutover.env`（chmod 600；值不入对话/文档）。**关键发现：deployer 仅 `NOPASSWD: /usr/local/bin/deploy-chexian-api` 一条、无通用 sudo**（owner 输密码总错的根因）→ 改 root 文件/读 secret 一律走 **root 通道 `ssh chexian-vps`**（config 有 `Host chexian-vps User root`，免密 key）。`edit-env` 子命令**仓库无实现**（PR-4 未合并），day1-sop §67 那条会报错。
- **步②基线**：`SNAPSHOT_SERVER_URL=生产 BASELINE_CONCURRENCY=1 golden-baseline --build` → **71/72**（cost-claim-ratio 批量抓取间歇 400、手动 curl 200 健康 → 单独存 RLS-off oracle `/tmp/cutover-cost-claimratio-rlsoff.json`）。
- **步③开 RLS**：root 通道在 `ecosystem.config.cjs` env 块 NODE_ENV 后 sed 插入 `BRANCH_RLS_ENABLED: 'true',`（备份 `ecosystem.config.cjs.bak-rls-pre`）→ deployer wrapper reload → 验证三连：admin kpi 2.06 亿（四川没崩）/ **删 branchCode token→401**（RLS 真生效）/ 含 branchCode→200（JWT_SECRET 正确）。`Environment production not defined` WARN **无害**（PM2 回退 env 块，token 测试为证；`/proc environ` 查不到因 root 直连与 wrapper-sudo 是不同 PM2 daemon）。
- **golden-baseline --compare 30 FAIL 已铁证为非确定性噪声**：**RLS-on 自我对比（同状态零 reload）反而 36 FAIL > 跨 RLS 30 FAIL** → 浮点末位求和 + `ANY_VALUE(plate_no)` + 无序数组排序，整数部分全一致、与 RLS 正交。严格 deep-equal 是 SQL 重构 oracle、不适合生产快照对比。
- **隔离验证**（单请求确定性，替代被 503 打崩的并发压测）：SC token→2.06 亿 / SX token→0（步③时 current 尚无 SX），无串读。
- **步④ promote+sync**：`sx-promote.mjs --apply --rls-confirmed` → 1,833,180 行全 branch_code=SX（staging→rename + ready-marker）→ `SYNC_VPS_BRANCH_CODE=SX sync`：policy/current 的 `--filter 'P *.parquet'` 保护远端**四川 4 文件逐字节一致**、SX_ 2 文件新增（85MB+196KB）；**dim/repair 顺带同步 → #799 BLOCKED 的步骤 A 一并完成**；`SYNC_VALIDATION_BRANCHES=1` 推三派生域（**首次失败=远端缺 `data/validation/SX/` 父目录，手动 `mkdir -p` 后成功**：claims_detail 8 文件 / quotes 1 / renewal 1）。
- **步⑤ reload+验收**：reload 后进程加载 4.43M 行需时（前 8 次 login 撞我自己压测累积的限流，第 9 次 ready）；**SC 四川 2.06 亿零回归 / SX 山西 9,795 万 + 最新签单 2026-06-23 首次可查 / 无串读**。SX `vehicle_plan_wan`=0（plan 维度无山西计划，非阻断迭代项）。

### 当前生产状态（安全可交付中间态）
- RLS = **开启**；current/ = 四川 4 文件(原样) + 山西 SX_ 2 文件；validation/SX 三派生域落盘；**山西账号仍 active:false（无人能登山西）**。
- **回滚（账号未发，仍可一键）**：root 通道恢复 `ecosystem.config.cjs.bak-rls-pre`（或删 BRANCH_RLS_ENABLED 行）+ deployer reload。

### 步⑥发账号待 owner 准备（最终不可逆）
USER_PASSWORDS（只走生产 env、禁 PR）+ 账号清单确认（sxAdmin + 11 org_user，G7 #775）+ 密码交付方式 + 上线通知（含太原二部历史机构 caveat）。PR 只改 `preset-users.ts` active:true（禁含密码、人工合并）。发账号后回滚须先禁 SX 登录再关 RLS。

### follow-up（非阻断，cutover 后处理）
1. **sync-vps 推 `validation/<省>` 派生域前未 `mkdir -p` 远端父目录** → 首次必失败（PR-2 缺口，本次手动绕过）。
2. **golden-baseline --compare 严格 deep-equal 不适合生产快照**（浮点/ANY_VALUE/排序非确定性）→ 需容差或区分两用途。
3. **stress-test 并发 10 打崩 2核4G**（全 503、串读断言空洞通过）→ 降默认并发或加 `--concurrency`。
4. **user_store branchCode 永久修复**（#801 P1 `a80133` 仍 PROPOSED）：当前生产是运行时回填，重 seed 即复发全员 401。
