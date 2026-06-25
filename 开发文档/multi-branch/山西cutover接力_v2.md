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
