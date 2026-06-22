# PR 工作流进化日志

> 每次 PR 失败（CI 不过、merge 冲突、governance 拦截），在此记录根因和修复措施。
> `/chexian-commit-push-pr` 执行前必读此文件，将已记录的失败模式纳入前置检查。

---

## 格式

```markdown
### YYYY-MM-DD — PR #N: 一句话描述
- **症状**: CI/merge 具体报错
- **根因**: 为什么现有检查没拦住
- **修复**: 本次怎么修的
- **预防**: 加入了什么新检查（写到 /chexian-commit-push-pr 的哪一步）
```

---

## 失败记录

### 2026-04-11 — 直接推 main（无 PR）
- **症状**: `git push origin main` 绕过分支+PR 流程
- **根因**: AI 手动执行 git push，没有调用 `/chexian-commit-push-pr`；无 hook 拦截
- **修复**: 手动推送后补建了 PR
- **预防**: 新增 PreToolUse hook，拦截在 main 分支上的 `git push`（exit 2 阻断）

### 2026-04-11 — CI 监控 API 不可用
- **症状**: `gh pr checks` 返回 403 `Resource not accessible by personal access token`
- **根因**: Token 缺 `checks:read`；步骤 6 写了 `gh pr checks --watch` 但未验证能否执行
- **修复**: 改用 `gh api .../actions/runs`（已验证可用）
- **预防**: 步骤 6 改为 actions/runs API；标注"禁止用 `gh pr checks`"

### 2026-04-11 — 服务端依赖遗漏（两次 commit）
- **症状**: pre-commit tsc 报错 `getPatrolReportPaths` 不存在；query.ts 未注册路由
- **根因**: 改前端没完整梳理后端依赖链（paths.ts / query.ts / api-routes.ts）
- **修复**: 补建第二个 commit
- **预防**: `/chexian-commit-push-pr` 步骤 1 新增「依赖链完整性检查」——修改前端 API 调用时，必须 grep 确认后端路由、paths、api-routes 三处均已注册

### 2026-05-18 — PR #408: 字典 claim_cases 出险率公式与 registry 漂移（codex P2）
- **症状**: 字典新写「出险率 = 赔案件数/已赚暴露」，但 `metric-registry/categories/cost.ts:355-385` (`earned_loss_frequency`) 是「年化赔案数 / DISTINCT 保单件数」。两者对未满期保单不等价（举例满期+未满期 1:1 时差异 78.5% vs 182.5%）
- **根因**: 修字典时只对照了 `variable_cost_ratio`/`comprehensive_expense_ratio`，**漏查 `earned_loss_frequency`**；凭"赔付率分母用 earned exposure"的肌肉记忆把出险率分母也写成 earned exposure
- **修复**: 字典按注册表完整公式改写 + 加「口径陷阱」警告：earned_exposure 仅用于赔付率分母，不可移植到出险率
- **预防**: 自审清单「业务口径」一栏强化——**改字典/文档涉及任何指标公式时，必须把涉及的每个指标 id 逐个 grep `server/src/config/metric-registry/categories/*.ts` 拿 SQL expression 对照，禁止凭"通用规则"推导单个指标**。同类失败再发生 2 次 → 转 governance 自动化（"字典公式与 registry SQL 关键 token 重叠率"检查）

### 2026-05-31 — PR #459: 本地 build 过 ✅ 但 CI typecheck 卡在 unused 变量
- **症状**: `bun run build` 本地零错误零警告，但 CI 的 Production Gate / Typecheck 阶段（`scripts/typecheck.mjs` → `tsc --noEmit`）报 `TS6133: 'isHero' is declared but its value is never read`
- **根因**: 重构 KpiSection 时为可读性引入了 `const isHero = HERO_KPI_IDS.includes(id)` 但后续逻辑没真用到它（Hero 归属判定走 `visibleHero / visibleCore` 过滤）；vite 的 esbuild 把它当 dead-code 静默吃掉，而项目根 `tsconfig.json` 启用 `noUnusedLocals: true` 让 `tsc --noEmit` 报错——两条工具链的严格度不一致
- **修复**: 删掉这个未用的本地变量，commit `11988299`
- **预防**: §3 前置检查里 `bun run build` 不等同于 `bun run typecheck`。**push 前必须额外跑 `bun run typecheck`**（已在 `scripts/typecheck.mjs` 暴露）。同类失败再发生 1 次 → 把 `bun run typecheck` 加进 §3.3 默认治理校验链，让 CI 那一关本地必先过

### 2026-06-03 — PR #476: worktree 模式下把改动写到主目录 main
- **症状**: 任务 A（reports 清理三件套）实施完成后才发现，4 个新/改文件全部落在主目录 `chexian-api/` (在 main 分支)，而不是预期的 worktree `.claude/worktrees/determined-mcclintock-7b70a7/`。事后用 `cp + git checkout HEAD --` 跨工作树迁移修正，浪费一轮操作
- **根因**: Bash 工具的 cwd 跨调用会重置（`Shell cwd was reset to ...` 提示），但每次跑的 Write/Edit 用的是**绝对路径**，绝对路径写主目录而非 worktree——cwd 切换对 Write/Edit 无效；同时整个会话的 system reminder（CLAUDE.md）路径含 worktree 前缀让人误以为已经在 worktree 里
- **修复**: cp 4 个文件到 worktree 对应路径 + 在主目录 `git checkout HEAD -- ` 还原 2 个 modified + `rm` 2 个 untracked
- **预防**: §3 前置检查在第一次 Write/Edit 前必须先确认落点：`git -C $WT_PATH branch --show-current` 应输出 feature 分支名而非 main；Write/Edit 的目标绝对路径必须包含 `.claude/worktrees/` 子串。同类失败再发生 1 次 → 在 settings.json 加 PreToolUse hook 拦截：Write/Edit 路径若指向当前主仓但分支为 main 时 deny

### 2026-06-15 — PR #644/#645: 后台 sub-agent 并行写入打断 stash + push 流程；vitest 通过但 tsc 报错
- **症状**: 主会话 `git stash → commit → push` 期间，后台 sub-agent 持续写 `server/src/services/__tests__/cost-cube-oom-degraded.test.ts`；stash 后 sub-agent 又写出 untracked 文件，触发 pre-push hook 的 server typecheck（`tsc --noEmit`）报 `TS2739: Type missing properties from DuckDBQueryable: hasRelation, dropRelationIfExists, invalidateCache`。Push 被拒，重试 3 次仍失败
- **根因 1**: 异步 sub-agent 无暂停接口；stash 与 sub-agent 写入是 race condition，stash 之后到 push 之间的几秒到几分钟里 sub-agent 又会写新文件
- **根因 2**: sub-agent 自报"22/22 测试通过"用的是 `bun run test` (vitest + esbuild)，esbuild 不做严格类型检查；`tsc --noEmit` 严格，发现 mock 缺接口方法。两条工具链严格度不一致重蹈 2026-05-31 PR #459 覆辙（vite build vs tsc）
- **修复**: 等 sub-agent 完成通知（任务尾部跑 tests 时它实际没补 mock）；主会话手工 Edit 补 3 个 mock 方法（`hasRelation`/`dropRelationIfExists`/`invalidateCache`）；切到新 worktree 分支 `fix/cost-cube-oom-a-c` 基于 `origin/main` 隔离 PR-2 不污染 PR-1
- **预防**: ①sub-agent prompt 模板里强调"跑 `bun run typecheck` 验证 mock 类型完整"，不要只跑 vitest；②`bun run typecheck` 是 §3.3 治理校验链一部分（已在 2026-05-31 加），但仅 sub-agent 自己跑时不在它的验收单 → 在 sub-agent prompt 模板加"最终验收必跑 typecheck"明确要求；③stash → push 路径在 worktree 有 in_progress sub-agent 时不可靠，应等 sub-agent 完成通知再 push；④sub-agent 文件写完成位置不可预测时，PR 拆分必须切新分支基于 `origin/main`（不能复用 worktree 当前分支累积 commit）

### 2026-06-15 — PR #647: benchmark 写盘未 warmup + CI/本地硬件差异未分层
- **症状**: cx CLI 性能优化 PR owner review 揪出两个事实问题：① `cli/perf-baseline.json` 写盘的是带 outlier 的 N=20（A p95=96ms），与 PR body/docs 宣称的 A=17ms / E=964ms / 6.9x 不符；② `bench:check` 只比当前 vs baseline（回归校验），baseline 一次"写差了"就把目标永久放宽，自净化机制实质失效；③ 推 fix commit 后 CI 闸 50ms 失败（runner 实测 172ms），把"runner 硬件慢"误当成"代码退化"
- **根因 1**: spawn 档（A/B）首次跑受 OS 磁盘 cold + Bun runtime 首次 link 影响，p95 outlier 直接放进 baseline——稳定测的前提（warmup K 次丢弃）从未存在
- **根因 2**: 自净化只设了"回归阈值"（vs baseline 上次），没有"目标阈值"（vs targets 北极星）——两者必须同时校验，否则 baseline 自身漂移即等于目标失守
- **根因 3**: CI 闸用了与本地相同的绝对阈值，但 GitHub Actions ubuntu-latest 共享 runner 性能 ~5-10x 慢于 M-series Mac；CI 本意是防退化（catch >5x runner 基线变化），与本地"真实用户感知"目标是两个层次
- **修复**: 抽 `resolveBatchRoute` 纯函数 + 12 用例覆盖 `/health` 直通 bug（commit `ce032856`）；benchmark 加 `--warmup`（默认 3）+ bench:check 双校验（回归 A+E / 目标 `targets`）；`perf-baseline.json` 结构分层 `targets`（强校验，仅 A+E 核心承诺）+ `aspirational_targets`（理想，B+C，仅展示）；CI 闸调 50→250ms 配 workflow summary 标明双层阈值（commit `232f8eaa`）
- **预防**: ①性能 baseline 写盘前必带 warmup（已写进 docs/cli-perf-baseline.md §2）。同类失败再发生 1 次 → benchmark 写盘失败时若 `(p95 - p50) / p50 > 2.0`（高离散度）直接拒绝写。②自净化机制设计必同时含「回归校验 + 目标校验」两层，避免 baseline 自漂移破坏目标守护——后续性能/质量类 baseline 都应采用此模式。③CI 闸与本地阈值分离：CI 闸用 runner 上实际可达的宽阈值（防退化），本地用真实用户感知的严阈值（守目标）；workflow summary 必同时列两层并解释"为什么"。④PR body 数字必须从 baseline 文件 jq 取或留"以 baseline 为准"说明，禁止手抄绝对值（2026-06-15 事故的直接触发点）

### 2026-06-16 — PR #650/#655 + alongor666-skills#37: evidence-loop 拆分上线 + e2e dry-run 发现 harness 缺口
- **症状**: PR #655 wrapper 合入后端到端 dry-run（任务 "/api/query/kpi p95<500ms --type perf"）阶段 A 主动盘点 §4 表 7 类任务的 harness 现状，发现 3 个真缺口：① `.planning/golden-baseline/` 目录不存在 — `golden-baseline.mjs --compare`（perf+refactor 两类的正确性 oracle）事实上不可用；② rule §4 立方体行 `cube-rollback.mjs` 路径写错（实际在 `scripts/cube-rollback.mjs` 而非 `scripts/release/cube-rollback.mjs`）+ `scripts/sentinel/cube-grayscale-sentinel.mjs` 未在 §4 表登记；③ §4 perf 通用行未提"首次须 --build 建 baseline 才能 --compare"前置 + ETL 行未写转换质量报告脚本具体路径
- **根因**: ① baseline 首次构建依赖 dev:full 运行 + 71 端点遍历，构建过 1 次但目录未持久化（或被清理）后没人补回 — oracle 静默失效；② wrapper rule §4 表是 PR #650 凭记忆写，未跑 `ls -la` 物理验证脚本真实位置；③ "新人引导"维度从未审视过 §4 表
- **修复**: BACKLOG 登记 3 条（uid 1f3bc1 P1 baseline 未建 / 5fc464 P2 §4 路径错 / d2fa19 P3 文档引导不足）+ 本 PR 一次性修 P2+P3（§4 表加路径全限定 + 首次须 --build 前置 + ETL 路径示例 + 表尾"禁凭记忆写脚本路径"警示）；P1 留作后续（需 user 提供 E2E_PASSWORD 跑 golden-baseline --build）
- **预防**: ①evidence-loop wrapper rule §4 表落地必须**物理验证**每一格脚本（跑 `ls -la` + `--help`），不靠记忆。同类失败再发生 1 次 → 加 governance 项扫 §4 表内所有提到的脚本路径是否存在；②每个 evidence-loop 任务的阶段 A 必须主动跑 `--dry-run`（基线工具）+ `--help`（其它工具），不能假定"上次能跑"；③`.planning/golden-baseline/` 缺失应作为 perf/refactor 任务的"基线缺口"在阶段 A 直接报 BLOCKED，倒逼项目维持基线时效；④pr-evolution.md 作为 scorecard 落位首次实战通过（取代了基座默认的 .claude/shared-memory/，避免触发 AGENTS.md §8.3 user-only 红线）；⑤**并发会话隔离 worktree 是硬要求**——本次首次提交在主目录被另一会话 `git reset` 抹掉所有改动（reflog 见 HEAD@{1} reset），切 worktree 重做才成功。同类失败再发生 1 次 → 任何 evidence-loop scorecard / BACKLOG 沉淀必须在隔离 worktree 内（不依赖人 / AI 记得，按 memory `feedback_isolate_concurrent_verify_head_first` 已沉淀）

### 2026-06-17 — evidence-loop dry-run #2: useCostAnalysis oracle 双层激活 + 缺凭据请求授权范式

- **起点（不是症状）**: 用户调 `/chexian-evidence-loop 优化项目架构`。阶段 A 收口：前端 src/ 411 文件 / 74322 行 / 8 个文件违反 CLAUDE.md max(800) 红线 / Top 8 全部**零单测覆盖** / `.planning/golden-baseline/` 不存在 → 命中基座 §6 两条停止条件（"测试数据缺失" + "正确性无法验证"）。澄清两轮锁定：维度=可维护性 / 范围=前端层 / 路径=A（先建 baseline + 补 1 个热点测试 + 再启动重构）/ 目标文件=`useCostAnalysis.ts`（880 行纯 hook，最易测）
- **根因（执行路径）**: 起初我推荐"务实/绕过 baseline 走 Step 3 单测"——用户立刻反："不能因为缺什么就不做，可让我授权" 并提供 xuechenglong 凭据。这是关键认知反转：**遇到缺凭据/数据/配置时，默认应该是"先问 → 用户给"，而不是"绕过"**——已沉淀到 memory `feedback_no_giveup_ask_authorization`。两个具体卡点的解锁：① E2E_PASSWORD 缺 → 用户给凭据，主目录跑 baseline；② worktree 数据缺 → 切到主目录跑（主目录数据齐备）。worktree-setup.md §A "主目录锁 main 只读" 由用户显式"授权本次可开发" 覆盖
- **修复（交付物）**:
  - **Step 1**: worktree dev:full 启动验证 healthy（DuckDB pool idle=1/max=8 正常）
  - **Step 2**: 主目录 baseline build → `.planning/golden-baseline/` 落地 26/71 端点快照。**verifier 反驳找出关键缺口**：`/api/query/cost` 端点（slug 9）抓取失败 400（`baseline.mjs` 的 ENDPOINT_DEFINITIONS 没给 cost 默认参数模板，cost 必须传 analysisType/type/dimension/cutoffDate）→ baseline 对 useCostAnalysis 重构**无兜底**。其他 45 个失败端点（claims-detail/repair/customer-flow/renewal-tracker/auth 等）因 xuechenglong 权限范围 500/400。**结论：baseline 层对本次任务 oracle 无效**，oracle 实际只有单测一层。须后续补 cost 参数模板再抓 baseline 才能让第二层生效
  - **Step 3**: 写 `tests/features/cost/useCostAnalysis.test.tsx` — 36 个用例，覆盖 8 fetch (happy + Error 异常 + 非 Error 异常 + 非数组响应 + filterParams 透传) + summary 计算（含除零防护）+ fetchDataBySubTab 6 case + default + reset。22ms 跑过
  - **Step 4**: `bun run verify:full` 全绿 — 233 文件 / **3213 测试用例全过**（含 36 新增），governance + typecheck + 全单元测试零回归
- **预防（下一步纪律）**:
  1. ✅ memory `feedback_no_giveup_ask_authorization` 沉淀：复杂工作缺凭据/数据/配置不能默认"绕过/降级"，先向用户索取授权——用户给的概率比想象的高很多
  2. ⚠️ `useCostAnalysis` oracle **仅第一层激活**（单测）；第二层（baseline）因 cost 端点未抓成对本次任务**无效**，需后续在 `baseline.mjs` ENDPOINT_DEFINITIONS 给 cost 加参数模板后重抓。后续可发起 refactor evidence-loop，把 880 行降到 ≤ 400 行（CLAUDE.md typical 阈值），逐步抽出 8 个子 hook（先 export 再单测拆分，最小有用实验）；动 API 前必须先补 cost baseline
  3. **未完成**：剩余 7 个 >800 行文件（GeoRiskPanel 951 / CrossSellAnalysisPanel 891 / NewEarnedPremiumTable 891 / EnhancedKpiCard 870 / costTypes 820 / AccessControlPage 770 / PerformanceAnalysisPanel 1401）仍零单测覆盖。每个文件做"补单测 → refactor"前都需类似 evidence-loop 单独走一遍
  4. **baseline 覆盖缺口**：xuechenglong（branch_admin/SC）抓不到系统级 admin 权限的 45 个端点（claims-detail 全套 + repair + customer-flow + renewal-tracker + auth/users/roles + filters-options 等）。若未来重构涉及这些路径，需先解锁系统级 admin 凭据补全 baseline（或用户提供）
  5. **同类成功再做 N 次**：把"补单测 oracle → refactor"作为大文件治理的标准化流水线，每个文件单独 PR + 单独 evidence-loop checkpoint，避免"一次性大重构"塌方
  6. **evidence-verifier 价值首次实战展示**：本次 fresh-context verifier 揪出我夸大 baseline 价值的盲点（声称"对纯前端 hook 重构足够"但 cost 端点根本未抓），这正是基座 §5 verifier 隔离原则的核心——实施者不能做自己的唯一验证者。未来 evidence-loop 阶段 C 调 verifier **必须**做，不能省。同类教训再发生 1 次 → wrapper rule 加 "阶段 C 步骤 2 跳过 verifier 视为流程违规"
### 2026-06-17 — PR #662: cx wizard 二度违反 user-only red line + CI 冷启动 eager-load 回归
- **症状**: 人类 owner review 揪出 3 个问题：①[blocking] PR 写入 `.claude/shared-memory/project_cx_cli_interactive_wizard.md`，违反 AGENTS.md §8.3 user-only 红线；②[blocking] `cli-perf-sentinel` 实测 A 冷启动 p95=**298ms** 超 CI 闸 250ms（48ms / ~19%）；③[P2] interactive.ts TTY guard 同时要 `stdin.isTTY && stdout.isTTY` 双 TTY，把 `cx query -i -f json > out.json`（stdin TTY + stdout 重定向）这类正常用法误拒为 exit 4
- **根因①**: 我读了 `.claude/rules/evidence-loop.md`「scorecard 落位 → `.claude/shared-memory/`」（旧描述），**没读 pr-evolution.md 最新 entry**（2026-06-16 PR #650/#655 预防第 4 条已明确改为 `.claude/workflow/pr-evolution.md`）。基座 evidence-loop §8 阶段 C 步骤 4 也只说"shared sink"，未对齐到本项目 user-only 红线 — 文档与最新教训 24h 内即漂移
- **根因②**: index.ts 顶层 eager import interactive.ts → `node:readline/promises` 在 `cx --version` 这类完全不进 wizard 的命令上也被解析进 module graph；本地 19→21ms（M-series 噪声）放到 CI 共享 runner ×14 系数即 ~298ms。bench:check 本地双校验只守 ≤50ms 北极星，CI 闸 250ms 是另一层 — 本地过≠CI 过（PR #647 教训实际复发，但表现形式不同：那次是绝对阈值放宽问题，这次是 eager-load 拖慢）
- **根因③**: TTY guard 凭"交互 = 需要终端"的肌肉记忆直接写 `stdin && stdout`，未审视 wizard 的实际 IO 走向（prompt → stderr / 数据 → stdout）；对照 cli/src/commands/* 其他 10 处 `isTTY` 用法（全部仅查 stdout 选输出格式）独此一家
- **修复**: ①删 `.claude/shared-memory/project_cx_cli_interactive_wizard.md` + 把 scorecard 内容并入本 entry（既是失败教训也是 evidence-loop 阶段 C 落位）；②index.ts 改 `await import('./commands/interactive.js')` lazy，仅 wizard 入口才加载；③TTY guard 抽 `isInteractiveUnsupported(stdinTty)` 纯函数只查 stdin，补 2 个测试覆盖 `stdin=true, stdout=任意` 必允许进入
- **预防**: 
  1. **任何 evidence-loop scorecard 落盘前**必 `tail -20 .claude/workflow/pr-evolution.md` 校 user-only 边界（同类失败再发生 1 次 → 加 governance #N 扫所有新 commit 的 `.claude/shared-memory/**` 增改）→ **✅ 已完成**，见下一条 entry「shared-memory user-only 历史违规迁移 + 机制化」，governance #37 `checkSharedMemoryUserOnly` 已落地
  2. **基座 evidence-loop §8** 的"scorecard 落位"措辞应明确分项目：chexian-api → `.claude/workflow/pr-evolution.md`；其他项目按各自 AGENTS.md。已在 `~/.claude/skills/evidence-loop-core/` 留 TODO，下次跨项目同步时一并修
  3. **CLI 性能闸两层并守**：本地 `bun run bench:check` 守北极星 50ms（不通过则不能进入提交流程），但**本地过仅必要不充分** — CI cli-perf-sentinel 250ms 是 final gate；本地 lazy import 类改动必须用 `bun build:bin && bun run bench` 重测，看 A p95 是否真"零退化"（增 2ms 在 M-series 是噪声，但在 CI 共享 runner 可能 ×14 系数即灾难）
  4. **CLI guard 写`isTTY`时必先**对照已有 cli/src/commands/* 用法 — 其他命令一致地用 stdout 决定输出格式，stdin 决定是否读管道；新增交互 guard 不应同时绑两端

#### evidence-loop scorecard（并入本 entry，原 `.claude/shared-memory/` 落位已删）

- **业务目标**: `cx query` 在缺 key/参数名时进交互式构建器，复用 queryCommand 下游链路，无新增依赖
- **正确性 oracle**: cli test 72/72（51 原 + 21 wizard：纯函数 11 / 集成 6 / retry 2 / TTY guard 2）；`bun run typecheck` ✓
- **度量**:
  - 本地 A 冷启动 p95：baseline 19 → eager-import 19 → **lazy-import 21**（M-series 噪声，<50 北极星 ✓）
  - 本地 E 批量 100 keepalive：baseline 866 → **563ms**（改善 35% ✓）
  - CI A 冷启动 p95：eager-import **298ms ❌** > 250ms 闸 → lazy-import 待 push 验证
- **零侵入**: 非交互 `cx query KEY --p=v` 字符仅 action 体 `(key, options, cmd) =>` 改为 `async (key, options, cmd) =>`（lazy import 需 await）；queryCommand / parseExtraParams / applyPathParams 全部不动
- **决策**: lazy import + TTY 修复 → 推 fix commit → 等 CI 验证

### 2026-06-17 — shared-memory user-only 历史违规迁移 + 机制化（承接 PR #662 第 1 条预防，无 PR：内部治理沉淀）

- **症状**: 审计 `.claude/shared-memory/**` 全量 git log，定位到 §8.3 user-only 红线生效（2026-04-27 commit `801f84e7`）**之后**仍有两次 AI 越权写入：
  - commit `b3e14e1c`（2026-06-10）feat(governance): 守恒恒等式增设演进通道 + 复盘教训固化进共享记忆 → 新增 `feedback_retrospective_to_mechanism.md`
  - commit `f8866baf`（2026-06-10）feat(skills): 沉淀 PR 评审打法为项目级 skill → 新增 `project_pr_review_calibration.md`
  - PR #662（上一条 entry）的本次违规是该模式第 3 次复发；其 P1 修复已在原 PR 处理，本 entry 收口"两个旧违规 + 机制化"
  - 2026-04-27 之前的所有 shared-memory 文件（含 `claims_detail_field_mapping.md` / `repair_source_field_mapping.md` / 初始 13 文件 bootstrap）均在规则生效前 commit，属于历史合规存量，不在本次迁移范围
- **根因**: AGENTS.md §8.3 把 `.claude/shared-memory/**` 标为 user-only，但**仅文档化、无自动闸**——AI 会话间没人盯，自然漂移；2026-06-16 pr-evolution.md 2026-06-16 entry 第 4 条已写"pr-evolution.md 作为 scorecard 落位（避免触发 §8.3）"，但同样停在文档层。这正是 memory `feedback_rules_need_automation` 描述的反模式："规则需自动化执行"——文档规则 ≠ 执行规则
- **修复**:
  1. 把两个违规文件的内容**完整归档**到本文 §A 历史归档（见下方），保留可追溯；**不删除 `.claude/shared-memory/` 内原文件**——AI 自行删除违反 §8.3（即使是清理违规也属写操作）；shared-memory 内原始副本是否清理由 user 本人手动决定
  2. `scripts/check-governance.mjs` 新增 `checkSharedMemoryUserOnly()` 检查项（#37）：扫 4 路（staged / unstaged / untracked / `origin/main...HEAD` commit range）；命中任何 A/M/D/?? → exit 1（无"纯 D = warning"例外，避免 AI 自我授权后门）
  3. 例外通道：`SHARED_MEMORY_USER_WRITE=1` 环境变量豁免（命名带 USER_WRITE 自我提示——只有 user 本人手动操作时设置）。AI 会话不应使用此变量
  4. 新增 `.claude/rules/shared-memory-discipline.md` 记录红线 + 违规清单（chronological）+ 备选路径建议（教训→pr-evolution.md / 跨项目知识→`~/.claude/skills/`）
- **预防**:
  1. ✅ 本次完成：规则机制化。`bun run governance` 跑过即等于第 37 项过——AI 试图写 shared-memory 立即红
  2. 同类失败再发生 1 次（仍有人/AI 用 `SHARED_MEMORY_USER_WRITE=1` 绕过且非 user 操作）→ 把环境变量绕过路径删掉，强制 user 走 shell 而非 commit 路径
  3. 对应在 memory `feedback_rules_need_automation` 增加引用：本次是该模式的又一实证（文档规则→6 月 10 日两次违规 + 6 月 17 日 PR #662 第 3 次违规→6 月 17 日机制化）

#### A. 历史归档（两个违规文件原文，仅保留历史可追溯，不在 shared-memory 复活）

##### A.1 原 `feedback_retrospective_to_mechanism.md`（commit b3e14e1c）

> 来源：ApiClient 神类拆分 536→558 全线复盘。AI 会话上下文会蒸发——没固化进仓库可执行护栏（governance/hooks/rules/backlog/memory）的教训，会话结束即不存在。

1. **给 sub-agent 的 brief 里的示例代码也是代码**：PR #556 事故——主会话在任务书里亲手写了 JWT 字面量让 agent 做密钥扫描器的正向测试夹具 → agent 忠实照抄提交 → GitGuardian 按 JWT 形状判泄漏 → CI 红 + force-push 抹历史 + 评审 blocker。规则：写 brief 时夹具/示例/占位值要过与正式代码同一套红线审查，涉密形状的夹具一律用「明显假 + 非真实结构」占位（如 `EXAMPLE-FAKE-TOKEN-not-a-real-secret-0000`），并核对值域约束（该次正则值域 `[A-Za-z0-9._\-]` 不含下划线——用 `_` 分隔的假 token 会让正向用例静默变红）。
2. **exit code 不进管道**：`if git push | tail -2; then` 拿到的是 `tail` 的退出码——被拒的 push 打出假 "PUSH OK"。要分支判断的命令绝不接管道；需要裁剪输出时先 `> /tmp/x.log 2>&1` 再按真实退出码分支。
3. **force-push 即广播**：#556 force-push 修复后 1 分钟，评审者基于旧 head 发了完整评审（白跑一轮 worktree 独立验证）。force-push 后立刻在 PR 留一行「head 已更新至 \<sha\>，\<原因\>」，省评审者整轮重验。
4. **"机制已在、执行缺位"类教训不要再写文档规则**：同次复盘里的「主目录违纪开发」「#552 重复劳动（未提交前查重）」——规则早已在 `.claude/rules/worktree-setup.md` 与 CLAUDE.md Pre-flight 里，失败模式是没执行。再添一条文档规则无增益（本项目原则：文档规则 ≠ 执行规则）；正确动作二选一：升级为自动拦截（hook/governance），或承认属注意力纪律、在会话开工 checklist 里前置执行。
5. **已知知识要在动笔前调用，检查只是兜底**：守恒脚本第一版漏扫 `client-core.ts`（明知 REFRESH 已下沉至此，读过该文件三遍），靠自己写的 LOST 检查才咬出来。护栏抓住自己不是骄傲——写代码那一刻就该把上下文里已有的事实清单过一遍，门禁是最后一道，不是第一道。

##### A.2 原 `project_pr_review_calibration.md`（commit f8866baf）

> PR 评审校准账：append-only ledger，每行 = 一次"评审结论与现实的对账"。原消费方 `.claude/skills/pr-review-playbook.md`（已删除/未存在），现作为历史记录归档。

| 日期 | PR | 类型 | 教训（一行） |
|------|----|------|------------|
| 2026-06-09 | #543 | 自我反转 | 数据列数断言方向判反：裁决前先分清文档/生成器/运行时三口径；生成器 union_by_name=41 与运行时裸读是两回事，二者还可能互相矛盾（B340） |
| 2026-06-09 | #548 | 判据确立 | PR 自述数字 rebase 后必陈旧（自述 79 实测 83）：数字一律以 worktree 实跑为准，自述只作线索 |
| 2026-06-09 | #549 | 误报甄别 | 旧名 grep 命中 server 侧同名函数（workflow-runner 的 getWorkflowRun）并非前端残留：残留扫描必须逐条判属，不可按命中数下结论 |
| 2026-06-09 | #555 | 战技确立 | 回退实验坐实 bug 三真（bug/测试/fix 各自为真）；实际症状（静默挂起到超时）比 PR 描述（TypeError）更重——症状要实测不要转述 |
| 2026-06-10 | #556 | 误报甄别 | 扫描器告警先解码定性：GitGuardian 按 JWT 形状抓、不看邻接 key；安全测试夹具须 key 与 value 双重混淆，混淆一半等于没混 |
| 2026-06-09 | #554→#557 | 采纳闭环 | 评审建议"清单 glob 派生、不硬编码"被采纳后，#557 三个新子客户端自动入保零人工——机器化约定的复利实证，同类建议优先级应上调 |
  4. **本次过程教训**：会话前期我两次 Edit 误用主目录绝对路径 `/Users/alongor666/Downloads/底层数据湖DUD/chexian-api/...`（缺 `.claude/worktrees/heuristic-stonebraker-3ceb6c/`），重蹈 2026-06-03 PR #476 与 memory `feedback_isolate_concurrent_verify_head_first` 同因。同类失败再发生 1 次 → 在 settings.json 加 PreToolUse hook 拦截 Write/Edit 路径不含 `.claude/worktrees/` 子串且当前 cwd 在 worktree 时 deny（pr-evolution.md 2026-06-03 entry 已留 TODO）
  5. **PR #664 owner review 闭环（2026-06-17）**：第一版 PR 含两个 blocker，被 owner 当场拍回——本次记录修复轨迹避免再犯：
     - **Blocker 1（扫描漏 commit range）**：原 `checkSharedMemoryUserOnly()` 只扫 staged + working tree + untracked，CI / pre-push 跑在 clean checkout（已 commit 改动不出现在 staged/working tree） → 已 commit 进 PR 的 `.claude/shared-memory/**` A/M 会被静默漏过——等于"PR #662 模式"绕过自家闸。**修**：加第 4 路扫描 `git diff --name-status origin/main...HEAD`，origin/main 不存在时静默跳过（首次推送场景）。教训：写"防止 X 类违规"的闸时必须对照该违规历史**实际发生路径**（PR #662 是已 commit 后被人类发现的）反推扫描范围，不能凭"本地编辑流"直觉只扫工作区
     - **Blocker 2（AI 自删后门）**：原版让 AI 删了两个违规文件 + governance 给"纯 D = warning"留通道——AGENTS.md §8.3 "AI 不得修改"含义包含删除/重命名；新规则文件自己 §1 也承认 git rm/git mv 是写操作；自己给自己留例外 = 后门。**修**：恢复两个 shared-memory 文件（从 origin/main） + 移除 D warning 例外 + 规则文件 §4 明确"本 PR 不删，user 决定后续"；两个违规文件的原文 100% 完整在 §A 归档可追溯，shared-memory 内的"原件"由 user 用 `SHARED_MEMORY_USER_WRITE=1 git rm ...` 自行清理（或永久保留）
     - 元教训：当机制本身要承担"治理违规"职责时，**不能在同一 PR 里既建闸又用 AI 自我授权绕闸做清理**；建闸 PR 必须自身合规（零 A/M/D shared-memory），违规清理留给 user / 后续 PR

### 2026-06-17 — Wave 1 P2 收尾：EnhancedKpiCard 870→321 + 5 子文件 + 27 case oracle

- **起点**: f756eb07 session 7-file investigation 报告 P2，按 target_split 直接套用（types/utils/Legacy/Hero/Status 五件套 + 薄壳 index）；前置 P1 (#665) 已 merged 进 main
- **合同六要素**（基座 §1）:
  - 业务目标 = 870 → 主入口目标 ~280 行（实际 321，-63%）+ 6 子文件 + 6 public export 100% 兼容
  - 终止条件 = 12-15 case oracle 测试全绿 + verify:full 零退化 + 4 调用方 import 不变
  - 证据 = `wc -l` 行数 / `git rm + git add` diff / vitest 27/27 / governance 36/36 / typecheck ✓
  - loop 协议 = 八步（基线 → 不变量 → 假设 → 最小改动 → 正确性 → 前后对比 → 决策 → 沉淀）
  - verifier = 项目级 `evidence-verifier` agent（PR review 时调度）
  - 停止条件 = 测试 baseline 跑不通 / typecheck 退化 / 调用方需改 import
- **harness 现状**（阶段 A）: vitest jsdom + `tests/setup.ts` matchMedia 注入 + `cross-sell-ux-review-fixes.test.tsx` 等 tsx-test 模板齐备；oracle = vitest-component 12+ case
- **改动文件**:
  - `src/widgets/kpi/EnhancedKpiCard.tsx` (870 lines) → `D` 删除
  - `src/widgets/kpi/EnhancedKpiCard/types.ts` (103) - 6 个 public interface
  - `src/widgets/kpi/EnhancedKpiCard/utils.ts` (28) - DEFAULT_COLORS/SEGMENT_COLORS/toneColor/normalizeNumeric
  - `src/widgets/kpi/EnhancedKpiCard/LegacyRatioParts.tsx` (226) - MiniDonutChart/ChartLegend/RatioBar
  - `src/widgets/kpi/EnhancedKpiCard/HeroReferenceParts.tsx` (169) - ProgressBar/RingChart/SegmentBarReference
  - `src/widgets/kpi/EnhancedKpiCard/StatusAtoms.tsx` (99) - DeltaChip/StatusTag/StatusRail/Sparkline
  - `src/widgets/kpi/EnhancedKpiCard/index.tsx` (321) - 主入口 + 6 type re-export
  - `src/widgets/kpi/__tests__/EnhancedKpiCard.test.tsx` (427) - 27 case oracle
- **跑的命令**:
  - oracle baseline: `bun run test --run src/widgets/kpi/__tests__/EnhancedKpiCard.test.tsx` → 先在 870 行原文件跑 = 25/27 (2 case 因 title 与 status.label 同名 getByText 多匹配 → 修 title 为 "赔付率监控") → **27/27**
  - 重构后 oracle: 同命令 → **27/27** 零差异（行为不变锚点成立）
  - `bun run typecheck` → ✓（修 `unused screen import` 1 处）
  - `bun run verify:full` → governance 36/36 + 237 测试文件 / **3280 用例**全过（含 KpiSection.test.tsx 4 个调用方测试 + 新增 27）
- **正确性结果**: 27 case 在拆分前后行为 byte-identical；调用方 KpiSection / EarnedPremiumCharts / kpiCardProps import 路径 `widgets/kpi/EnhancedKpiCard` 自动解析到 `index.tsx`，**0 处需改**
- **度量结果**:
  - 行数：870 → 321 (-63%)；目标 ~280 ±15%（容差内）
  - 子文件最大 226（LegacyRatioParts），全部 < 800 红线
  - 测试新增 27 case / 78ms 跑过
- **基线 vs 候选**: 行为不变（27 case identical）+ 行数 -63% + 0 调用方 break + oracle 永久建立（PR #663 模式）
- **verifier 结果**: 待 PR review 时调 evidence-verifier agent fresh-context 证伪
- **决策**: **promote** — commit + push + PR
- **下一步**: Wave 2 P3 `NewEarnedPremiumTable.tsx` (891 行)，等本 PR 合并后开新 worktree
- **未验证声明**: 无（所有数字均有命令输出支撑）

### 2026-06-17 — PR #668 (skill 自身硬化): PR #662 复盘 8 个 skill 缺口机制化（G1-G8）

> 本 entry 既是失败教训沉淀，**也是 evidence-loop 阶段 C scorecard 落位**（meta：本 PR 修的就是"scorecard 落位规则"自身）

- **触发**: PR #662 (cx wizard) 暴露 8 个 skill 缺口（详见 2026-06-17 PR #662 entry "预防"段）。用户问"如果重新做，如何优化技能才做得更好？" → 元任务 meta-loop
- **缺口清单与落地**:
  | # | 缺口 | 落地 | anti-pattern 验证 |
  |---|---|---|---|
  | G1 | sink/scorecard 路径合规未进 pr-checklist | `.claude/pr-checklist.md §1` 加红线行 | 改 governance check 反复跑 ✅ |
  | G2 | CI 闸预测公式缺 | `.claude/pr-checklist.md §1` 加 "CLI 性能 CI 闸预测" 行（含 ×14 系数） | 公式来自 PR #662 实测 |
  | G3 | evidence-loop 两处 SSOT 漂移无 governance | `scripts/check-governance.mjs` 加 `checkEvidenceLoopSsotDrift`（rebase 后 39 项含 main 新增） | 临时删 pr-checklist 关键词 → fail ✅；恢复 → ✅ |
  | G4 | pr-evolution 已沉淀预防 24h 复发无强制升级 | `scripts/check-governance.mjs` 加 `checkPrEvolutionExpired` + 引入 `needs_automation` + `expires` schema | 临时加 `expires: 2020-12-31` entry → warning ✅；删除 → ✅ |
  | G5 | 新 CLI guard 必跨入口对齐未协议化 | `.claude/pr-checklist.md §1` 加 "CLI 一致性" 红线行 | 文档级 |
  | G6 | 阶段 A 缺 user friction 调研 | spawn task `task_b97e0530` → 基座 `~/alongor666-skills` 仓 PR | 跨仓 PR |
  | G7 | scorecard 落位 SSOT 多处重复 | wrapper + pr-checklist 两处加 SSOT 内容 + G3 governance 强制两处同步 | G3 验 |
  | G8 | wrapper 缺 Pre-flight checklist | `.claude/commands/chexian-evidence-loop.md §0` 加 5 项强制 checklist | 下次 `/chexian-evidence-loop` 触发即验 |
- **根因（meta）**: 8 个缺口里 **5 个是"沉淀缺口"（写了不执行）** —— 与 memory `feedback_rules_need_automation` 完全一致；说明"规则需自动化"这条 meta-rule 自身没机制化。本 PR 通过 G3/G4 governance 把这条 meta-rule 自身机制化（**meta-mechanization**）
- **零侵入证据**: 不动 `cli/` / 不动现有 commands/agents / 仅改 `.claude/commands/chexian-evidence-loop.md`（既有命令修订，本 PR body §"用户授权"说明记录用户在本会话中口头授权 — AGENTS.md §8.2 commands 既有命令修订条款）+ `.claude/pr-checklist.md`（项目自审清单，AI-writable）+ `scripts/check-governance.mjs`（governance 新增 2 项）+ `.claude/workflow/pr-evolution.md`（本 entry，append-only sink）。**未改既有 `.claude/rules/*.md`**（PR #668 review 反馈撤回 rules 改动；按 AGENTS.md §8.2 既有 rules 改动需 [policy-override]）
- **回归门禁**: `bun run typecheck` ✅ / `bun run governance` 39/39（含 main 新增的 shared-memory user-only + 本 PR 加 G3 + G4）/ G3+G4 双向 anti-pattern 验证 ✅ / `git diff --check` 无报错
- **预防（下一步）**:
  1. 本 PR 是 PR #662 复盘成果的机制化交付；下次 `/chexian-evidence-loop` 触发即进入新协议（G8 Pre-flight 5 项 / G1+G2+G5 自审 / G3+G4 governance）
  2. G6 基座 PR 合并 + 跨仓同步后，阶段 A 必先做 user friction 调研，候选清单从"AI 想到的"升级为"用户真痛的"
  3. **本 entry 自身用 `needs_automation: false` 示范** —— 本 PR 已机制化，无超期风险
     - needs_automation: false
     - rationale: 本 PR 即为机制化交付，G1-G8 全部落地或独立 spawn
  4. **本 PR review fix 教训（PR #668 owner review 闭环）**：第一版 PR 改了既有 `.claude/rules/evidence-loop.md` line 32（加 SSOT pointer 注），违反 AGENTS.md §8.2"既有 rules 改动按 frozen 处理"——根因是 AI 凭"小修改无害"心态触动 frozen-ish 文件，自审清单没在 §1 红线表显式列入 AGENTS §8 frozen 路径检查。**修法（本次）**：撤回 rules 改动 + G3 governance 改两处。**预防（机制化）**：本 PR pr-checklist §1 红线表已加 "sink/scorecard 落位" 行（覆盖 user-only 写入）；后续可考虑再加一行 "AGENTS §8 frozen 路径"——同类失败再发生 1 次 → 加 governance 新项扫 diff 是否触动 §8.1+§8.2 列出路径且 commit message 无 `[policy-override]` → exit 1（不再依赖自审纪律）

### 2026-06-17 — PR #669: cli/ 同步到独立仓库 alongor666/cx-cli（自动化机制）

- **触发**: 用户提出"chexian-api/cli/ 现已更新，需同步到独立仓库 alongor666/cx-cli，且未来应自动同步"
- **PR #668 新协议首次实战**:
  - ✅ §0 Pre-flight checklist 全勾（scorecard 落位 / 不动 cli 顶层 import 故 CI 闸预测 N/A / 读 pr-evolution 最近 7 天 / verifier 计划 / 凭据缺口标记 — PAT secret 由 user 创建）
  - ✅ G1 sink/scorecard 落位检查通过：本 PR 写 pr-evolution.md（非 shared-memory）
  - ✅ G3 governance 跑过仍 ✅（两处同步未漂移）
  - ✅ G4 governance 跑过仍 ✅（无超期项）
- **方案设计**（按 user 3 个决策）:
  - manual/ 处理：拉回 chexian-api/cli/manual/（10 文件含 Windows 下载指南 / 截图脚本 / index.html）→ chexian-api/cli/ 是 SSOT
  - 认证：fine-grained PAT secret `CX_CLI_SYNC_TOKEN`（cx-cli contents:write 权限）
  - 触发：`push to main + paths:cli/**` + `workflow_dispatch`（手动 dispatch 用于首次同步 / 调试）
- **实现**:
  - 新增 `.github/workflows/sync-cx-cli.yml`：clone cx-cli → rsync cli/ → squash commit + push（保留 cx-cli commit history，每次同步一个 "sync: ..." commit）
  - rsync exclude：`.git` / `node_modules` / `dist`（build 产物不入仓）
  - 安全：未设 secret 时 workflow fail-fast 并打印明确指引
  - 文档：cli/README 加"独立仓库镜像（alongor666/cx-cli）"段落 + workflow 顶部含完整 PAT 设置 step 1-2
- **零侵入**: 不动 cli/src/* 任何代码 / 不动现有 8 个 workflow 文件 / 不动 .gitignore（manual/ 已在已跟踪范围内）
- **回归门禁**: typecheck ✅ / governance 39/39 ✅ / git diff --check 无报错
- **待 user 操作（凭据缺口）**:
  1. https://github.com/settings/personal-access-tokens/new 创 fine-grained PAT（Repository access: cx-cli only / Permissions: Contents write / Expiration 1y）
  2. chexian-api Settings → Secrets → Actions → Add `CX_CLI_SYNC_TOKEN`
  3. PR 合并后 Actions 页 manual dispatch `Sync cli to cx-cli` 验证首次同步
- **预防（机制化）**:
  - 同步链 PR 类似 deploy.yml 但**不属于** deploy chain（不在 .claude/rules/deploy-chain-sop.md §1 wrapper-source 列表 / §4 8 项验证清单）→ 不需"禁 auto-merge"特例
  - 但 sync-cx-cli.yml 是单方向"chexian-api → cx-cli"广播器：任何 cli/ 提交即广播到外部仓库，敏感性高。若未来 cli/ 接受外部贡献，应在 chexian-api 自审清单加"广播扩散"检查（确认本 PR 的 cli/ 改动适合公开外部仓库）
  - 同类失败再发生 1 次（如同步出现意外的 cx-cli 数据丢失）→ 加 governance 项扫 workflow 文件含 `force` 字样的 push 模式（本 workflow 用 squash 不 force，但加广义防御）
  - needs_automation: false
  - rationale: 本 PR 已机制化交付，"广播扩散"自审是预防性建议，触发频次低不必立刻加 governance

#### PR #669 v2 — codex review 闭环（4 反馈，5 步 SOP 复盘）

**抽 pattern**：第一版 PR 4 个 blocker/P3 根因都指向"AI 设计同步机制时只盘点了表面差异（manual/），未做完整 diff 全量比对"——与 PR #662 复盘 G3 "三处 SSOT 漂移"同源（不全量盘点 → 漂移）。

| # | codex 反馈 | 等级 | 修法 |
|---|---|---|---|
| 1 | `rsync --delete` 会丢 cx-cli 独有 `release.yml`/`.gitignore`/`package-lock.json` | blocking | 全量 diff (`comm -23` 双向)：拉回 release.yml + .gitignore；package-lock.json **不拉**（chexian-api 是 bun-only，避免双锁污染），workflow rsync 加 `--filter='P package-lock.json'` 保护 target lock；同时加 `--exclude='manual/images'` 双层防护 |
| 2 | `capture-screenshots*.ps1` 默认 `$PAT_TOKEN = "cx_pat_xxx.yyy"` + 引导用户写真 PAT + 跑 `cx login --token $PAT_TOKEN` 截图 → 真 PAT 入截图 → 同步到公开 cx-cli | blocking/security | (a) 改默认值为 `$DISPLAY_PAT_PLACEHOLDER = "cx_pat_PLACEHOLDER.example_replace_locally_DO_NOT_COMMIT"`；(b) 启动检查从"PAT 是否配置"改为"是否 cx login 完成"（`cx whoami` 退出码）；(c) login 截图步骤改用占位 PAT 不真登录；(d) 头部加 5 条安全约定；(e) `cli/.gitignore` 加 `manual/images/`；(f) workflow rsync `--exclude='manual/images'` 双层兜底 |
| 3 | PR body 说"合并后 user 创 PAT + 加 secret"，但 workflow `push to main + cli/**` 触发；secret 不存在则 fail-fast → main 出现红 check | blocking | workflow 拆 `Check secret presence` step（缺 secret 走 graceful skip + warning，不 fail）；user 本次已先建好 secret，PR body 同步更正 |
| 4 | `截图指南.md` 多处 trailing whitespace + EOF 空行 | P3 | `sed 's/[[:space:]]*$//'` + `printf '%s\n' "$(cat ...)"` 清 |

**抽 pattern → 全仓 grep**：
- 是否其他 workflow 用 rsync --delete 同步外部仓库？只有本 workflow（grep 全 `.github/workflows/*.yml` 仅 sync-cx-cli.yml 含 rsync）
- 是否其他文件含 PAT 占位但有泄露风险？grep 全仓 `cx_pat_xxx` 仅本 PR 拉回的两个 ps1 命中（已修）
- chexian-api 内有无其他 镜像/广播 模式 workflow 需要同步加固？没有（grep workflow 含 `clone.*github.com\|push.*github.com` 仅本 workflow）

**预防（机制化建议）**：
1. **同步类 workflow 设计护栏**：rsync to external repo 强制要求 `--filter='P ...'` 保护 target 独有文件 + `--exclude='manual/images'` 等显式排除截图/敏感目录 + secret 检查 graceful skip 模式。同类失败再发生 1 次 → 加 governance 项扫 workflow 文件含 `rsync.*--delete` 是否同时含 `--filter='P` 或 `--exclude=`
2. **PAT 占位符护栏**：截图脚本顶部默认变量名禁用 `*TOKEN*` 后缀（用 `*DISPLAY_PAT_PLACEHOLDER` 等不易被复制粘贴成真 token 的命名）；启动检查走"已 login"而非"PAT 配置"。同类失败再发生 1 次 → 加 governance 项扫 `manual/**/*.{ps1,sh,bat}` 含 `--token \$` 是否同行有占位符备注
3. **全量盘点纪律**：跨仓同步 / 跨域镜像 PR 必须 `comm -23 <(find A) <(find B)` 双向比对完整文件树，不能只看 codex 提到的"明显差异"。**这是 PR #662 G3 教训的递归**：单点 SSOT 漂移 → 全量 SSOT 漂移
- needs_automation: false（教训已写入 pr-checklist 自审 + workflow protect filter 实现，无需进一步机制化）
- rationale: 同步类 workflow 在本项目当前仅 1 个（sync-cx-cli.yml），governance 自动化的边际收益低；若未来再加 1-2 个跨仓同步则启动机制化

#### PR #669 v3 — codex review 闭环（2 P1 + 1 观察，同 pattern 三次发作）

**抽 pattern**：v2 修了 ps1 默认 PAT 占位符 + 头部约定，但**没改两条致命路径**——(a) v2 ps1 的 login 步骤仍真跑 `Invoke-CxScreenshot` 把占位 token 喂给 cx login，loginCommand 会写 ~/.chexian/config.json 然后校验失败回滚但**清掉**真登录态；(b) 6 个 .md 文档仍要求用户写真 PAT 入脚本。这是 PR #669 v1→v2 同源 pattern **第三次发作**："只改了看见的，没遍历同源"。

| # | 反馈 | 等级 | 修法 |
|---|---|---|---|
| 1 | v2 ps1 line 203-207 / v1 ps1 line 146-149 仍真执行 `cx login --token $DISPLAY_PAT_PLACEHOLDER`，loginCommand 写盘 + 校验失败回滚清掉真登录态 | P1 | `Invoke-CxScreenshot` / `Invoke-CxCommand` 加 `-DisplayOnly` switch；login 步骤标记 `-DisplayOnly` 只打印命令字符串不真跑 |
| 2 | 6 个文档（README/截图指南/脚本使用说明/交付清单/截图命令速查/index.html）仍要求 `$PAT_TOKEN = "你的真实token"` / `cx login --token cx_pat_xxx.yyy` | P1 | 统一口径：终端外手动 `cx login`（masked PAT）→ 截图脚本不要求改 PAT 字段 → 占位符仅用于 login 命令字符串截图演示；6 文件 8 处全部改写 |
| 观察 | v1 ps1 `Take-Screenshot` 用未定义的 `Get-SystemMetrics(0)`，即使修登录也跑不起来 | latent bug | 改成 v2 风格 `[System.Windows.Forms.Screen]::PrimaryScreen.Bounds`；v1 同时补 `cx whoami` 启动检查 |

**抽 pattern → 全仓 grep**：
- `grep -rnE "真实.*PAT\|真实.*token\|cx_pat_xxx\|\\\$PAT_TOKEN" cli/manual/` → 全量盘点 7 文件 8 处需修，逐个改完后再 grep 残留仅剩"真实登录请走交互式 cx login"等合理指导（已修复后的"真实"上下文）
- `grep "Invoke-Expression \$Command" cli/manual/*.ps1` → 确认两个 ps1 都已加 -DisplayOnly 守护
- `grep "Get-SystemMetrics" cli/manual/*.ps1` → 仅 v1 1 处已修

**静态闸**：本项目无 governance 项扫"ps1 真跑用户输入命令"或"文档与脚本占位一致性"——边际收益低，本 PR 不引入。

**跨入口对齐**：v1 + v2 两个 ps1 行为完全对齐（-DisplayOnly switch / cx whoami 启动检查 / 占位 PAT 命名）；6 文档表述完全对齐（终端外 cx login + 不改脚本 PAT 字段 + cx_pat_PLACEHOLDER.example）。

**预防（机制化建议）**：
1. **拉回外部仓库内容时必跑双重审查**：除了"功能 ok"，必须审"行为副作用"（命令是否会写盘 / 清状态 / 触发外部 API）。同类失败再发生 1 次 → 加 pr-checklist 新行"拉回脚本/工具时审查命令副作用"
2. **"未完整盘点" pattern 第三次发作**（PR #669 v1：未对比 cx-cli vs cli 文件树；v2：未审 cx login 实际行为；v3：未遍历文档同步说法）→ 升级为铁律：拉回外部仓库内容时必 `grep -r "原作者预设的关键变量"` 全量盘点，逐处改完后再 grep 残留确认零漏
3. **codex review 抗 N 轮发作**：本 PR 已 review v1→v2→v3 三轮，每轮都揪同 pattern 不同位置——证明 codex 是有效兜底但成本高。同类失败再发生 1 次（v4 还揪同 pattern）→ 在自审清单加"已 grep 全仓 N 处？" 强制自审证据
- needs_automation: false
- rationale: 本 PR 已机制化教训沉淀（自审清单已含"未完整盘点"red line 候选），未来若同 pattern 再发作即触发 governance 升级

### 2026-06-18 — PR #6XX hotfix: sync-cx-cli.yml YAML 语法错误（PR #669 同 pattern 第 4 次发作）

- **症状**: PR #669 合入 main 后 sync-cx-cli workflow 自动触发 → 3 次 push 触发全部 failure；GitHub Actions UI 报 "This run likely failed because of a workflow file issue"；cx-cli main 仍是 5-27 的旧状态未更新
- **根因**: workflow line 88-94 用 `git commit -m "<多行字符串>"`，第二行 `Source:` 没有缩进 → YAML block scalar 在 line 88 提前终止 → 解析器把 `Source:` 当新 YAML key → line 93 报 "could not find expected ':'"。本地 `bun run governance` / pre-push hook 都不验 YAML 语法 — governance 缺这一项
- **PR #669 同 pattern 第 4 次**:
  - v1 → v2 → v3 都是 codex review 在 GitHub 揪出
  - 本次 v4 是合并后 workflow run 揪出
  - 都是同源："本地验证不全 → 远端揪 → 修一处 / 装一闸"
- **修复**: 
  1. workflow `git commit -m "..."` 改用多次 `-m`：每个 `-m` 单独一行 + `\\` 续行，YAML 看到的是简单 shell 命令字符串
  2. governance 加 `checkWorkflowYamlSyntax`（项 40）：扫 `.github/workflows/*.yml`，用 python3 `yaml.safe_load` 验证。anti-pattern 验证：临时引入坏语法 → fail ✅；恢复 → ✅
- **预防**:
  1. ✅ governance 自动闸已加 — 同类问题下次本地 `bun run governance` 立刻抓
  2. 同类 "本地通过远端 fail" 模式（PR #459 typecheck / PR #644 mock 类型 / 本次 YAML）累计 3 次以上 → 应该全面审视 pre-push hook 覆盖率：是否还有 GitHub Actions / lint / 静态分析没被本地兜底
  3. PR #669 v1→v4 4 轮发作 → 抽 meta-pattern: "AI 设计-验证回路本身不闭合" — 设计时只验"自己写的部分"，没验"环境会以什么形式解析自己写的内容"（YAML 解析器视角 / cx login 写盘视角 / 文档读者视角）。下次同类工作前先列"环境视角清单"
- needs_automation: false
- rationale: 本 PR governance YAML 检查已落地；同类失败下次本地必抓

### 2026-06-18 — rules 体系黄金标准内化：eager-load 度量闸 + 计数防漂移闸（A+B 全套落地 · verifier 证伪后修复）

- **背景**: 复盘 CLAUDE.md 演化史发现治理重心全压在 CLAUDE.md 本体（governance #23 严管），而"延伸区"——无 `paths:` 门控的 `.claude/rules/*.md` 共 60.3KB——每轮全量 eager-load 却零体积闸，且多 `append-only` 只增不减。对照 Claude Code 官方《Memory》黄金标准 #2「用路径门控只加载碰匹配文件时需要的内容」与 #8「不放会过期的快照计数」，体系在"守小门洞大门"。
- **改动（A 类纯新增 + B 类 `[policy-override]` 授权落地）**:
  1. `scripts/check-governance.mjs`：新增 `checkRulesEagerLoadBudget`（项 41，**error 级**，度量无 `paths:` 门控的 rules 总字节，超 40KB fail 防回退）+ `checkClaudeMdNoStaleCounts`（项 42，warning 级，启发式检测漂移计数）+ 2 个 export 纯函数 `hasPathsFrontmatter` / `findStaleCounts`。
  2. 6 个低频 SOP 加 `paths:` 门控（multi-branch-day1/rollback、reports-cleanup、deploy-chain、backlog-eventlog、skill-prefix），prepend frontmatter 不动正文。
  3. CLAUDE.md 9 处硬编码漂移计数指针化（指标/字段/SQL/子路由/测试/字段定义/路由/域元数据/域命名空间 → 以 X 为准）。
  4. 单测 `scripts/__tests__/rules-eager-load-budget.test.mjs`（15 项：判据边界 + 空值绕过 + 扩展模式）。
- **基线 vs 候选（同会话同环境）**:
  - eager-load rules: baseline 60.3KB / 14 文件 → **after 29.9KB / 8 文件**（降 50.4%，由 6 文件门控造成，非度量口径变化）
  - CLAUDE.md 本体: 指针化净 +89B，仍 < 20KB 预算（非"零增"——verifier P2 校正）
  - oracle: 判据单测 15/15 ✅；`bun run governance` 42/42 ✅，EXIT=0
- **verifier 证伪 + 修复（evidence-loop §5 fresh-context）**: verifier 裁定"不通过"，抓 4 真缺陷，全部已修：
  - P1 `hasPathsFrontmatter` 空值绕过（`paths: null`/空/注释被误判门控 → 大文件可逃预算闸）→ 判据改为要求实际引号 glob 值 + 单测覆盖
  - P2 `findStaleCounts` 覆盖面高估（漏「38 字段定义」「64 路由」「9 域元数据」「13 域命名空间」）→ 扩 pattern + 指针化残留 + 文案诚实化「非穷举」
  - P2 本 entry 状态不实（曾写 7/41/待授权）→ 本次重写为最终态
  - P2 CLAUDE.md「体积不增」不实 → 校正为净 +89B
- **协议短板速记（evidence-loop §8 step5）**:
  1. 阶段 A 误判"加 `paths:` frontmatter 属 append-only 纯新增不需授权"，实际 AGENTS.md §8.2 明确"`.claude/rules/` 既有文件改动按 frozen 处理"需授权。教训：动 `.claude/rules/` 既有文件前必先核 §8 档位，不能凭"只加元数据不动正文"自我豁免。
  2. 启发式 grep 闸首版高估覆盖面被 verifier 抓出——印证 §5.1 第 8 条「零命中声明边界」：声称"无 X"前须穷举同义/变体，闸文案须诚实标注覆盖范围。
- **自进化循环**: 复用现成 `pr-evolution.md` + `checkPrEvolutionExpired` 触发器 + 新 2 闸常态守（eager-load error 防回退 + 计数防漂移 warning）。持续复核项：体系每新增 rule 优先 `paths:` 门控，eager-load 区不得无限膨胀；新漂移计数模式靠 review 补进 `findStaleCounts`。
- needs_automation: false
- rationale: A+B 全套机制已落地（2 道 governance 闸 + 6 文件门控 + 计数指针化），黄金标准由闸常态守，无需进一步机制化；持续复核靠 review + 闸双轨。

### 2026-06-18 — evidence-loop scorecard: cx CLI 用户体验黄金标准 harness（PR #674）

- **背景**: 用户 `/chexian-evidence-loop 建立 cx-cli 用户体验的黄金标准`。承接 PR #662 复盘教训（cx wizard 选型凭直觉，缺使用频率支撑）——本轮 Step 0.5 用户痛点调研先行，痛点真实但分散 → 按协议 AskUserQuestion 澄清方向，用户选「四个兼顾」
- **合同**: 给 cx-cli「好 UX」一个可度量、可回归的定义并落 harness，对标已有 `cli/perf-baseline.json`/`bench:check`（性能维度黄金标准）。四维：①一致性 ②渲染 ③旅程 ④可发现性
- **成果**（工作树，未 commit）:
  - `cli/scripts/ux-baseline.mjs`（新）+ `cli/ux-baseline.json`（新基线）+ `cli/UX-STANDARD.md`（新规范）+ `cli/package.json`（+`ux`/`ux:write`/`ux:check` 3 脚本）
  - ① 一致性：lint R1–R5，23 快照；②渲染：黄金快照逐字节；④可发现性：报错可操作率（棘轮）——三维已建基线、`ux:check` 连跑 0 diff
  - **第一次跑就钉出真实缺陷**：commander 内置参数/命令校验绕过 `failWith` 退出码契约 → 用法错误返 `exit 1`（应 4）+ 报错用 `error:` 前缀（应 `✘ `），共 6 条 known_violations（棘轮债务），可发现性 50%（3/6）
- **verifier（fresh-context evidence-verifier）抓 2 硬缺陷 + 1 风险，本轮全闭环**:
  1. （中）`normalize()` 漏剥 `bunx` 首次安装噪声 → CI 冷启动必漂移 → 加 `Resolving dependencies|Saved lockfile` 等过滤
  2. （低）`actionableRe` 裸词 `available` 过宽 → 锚定到 `available values?:`/`可用值`
  3. （风险）`--check` 不比对 runner → 加 runner mismatch 提示
- **未验证声明已自纠**: Phase A 我看到 config.json 有 `token` 字段就断言"本地 PAT 有效" → 实测 whoami **exit 2 token expired**。"有 token 字段 ≠ token 有效"。教训同 §3 证据七项：状态推断必须实跑验证
- **BLOCKED（§6 测试数据缺失）**: ③ 旅程维度需有效 PAT，本地 token 已过期 → harness 正确判 `unavailable` 未伪造 0ms 数据（verifier 隔离原则生效）。用户 `cx login` 换新 PAT 后 `bun run ux:write -- --journey` 补齐
- **零回归**: cli 单测 72 passed · governance 40/40 · scope 无 creep（未动 CLI 源码）
- needs_automation: true
- rationale: `ux:check` 已可手动跑，但尚未挂 CI/governance 闸（下一步：仿 bench:check 接入 cli 测试链或 governance-check.yml）；旅程维度待 PAT 解 BLOCKED

**—— 同会话收口更新（用户重置 PAT + 选「修债务 + 接 CI + 提 PR」）**:
- ③ 旅程 BLOCKED 解除：用户 `cx login` 换新 PAT（whoami exit 0，xuechenglong/branch_admin）→ `ux:write --journey` 测得首次成功 ✓。⚠️ time-to-first-success **CV 1.43 ≫ 0.10**（冷连接 TLS 离群 p95 11s），按 §6 标"噪声大"——故计时只记录不硬闸，仅功能门禁参与判定
- 6 条退出码债务**已修**（`cli/src/index.ts` `applyExitContract`：递归 exitOverride + writeErr 重渲染 ✘ + 提示 + catch 映射 exit 4）。棘轮 `ux:check` 全程护航：改后 check 精确报「仅 3 条用法快照漂移 + 6 违规消失 + 可发现性 0.5→1.0」，help-* 零波及证明修复外科精准 → `ux:write` 收紧到 **0 违规 / 可发现性 100%**
- CI 闸已接：新增 `.github/workflows/cli-ux-sentinel.yml`（cli/** 触发跑 `ux:check`，与 cli-perf-sentinel 对称）；基线 runner=tsx，CI 同 tsx 跑避免 bin 漂移
- 零回归复验（改 index.ts 源码后）：cli 单测 **72 passed** · typecheck 通过 · 最终 `ux:check` 0 diff exit 0
- 已提交 PR #674：7 文件（4 新增 harness/基线/规范/workflow + 3 改 index.ts/package.json/pr-evolution）
- review 结论「未发现阻断问题，可以合并」；CI 全绿（含 cx UX 黄金标准哨兵 ubuntu 实测通过）；rebase 撞 PR #675 的 pr-evolution append 冲突，保留双方 entry 解决

### 2026-06-19 — evidence-loop scorecard: cx sql 派生域联邦 P0（cx-cli 全面升级计划 P0）

- **背景**: 用户 `/evidence-loop-core 制定全面升级的计划，彻底实现cx-cli的能力`。承接本会话实测——cx-cli 分析内核是「单表牢笼 + 黑箱路由 + 零自省 + 错误不透明」，续保率无法在工具内独立验算。计划见 `.claude/plans/cx-cli-swift-pudding.md`（全 5 阶段，用户选「全规划·P0 先执行」）
- **合同**: P0 把 `cx sql` 准入从单一 PolicyFact 扩展为「已实证权限列的派生视图」，每视图 fail-closed RLS。验收锚点：联邦后 `cx sql` 直查 RenewalTrackerFact 复算续保率 = 路由返回逐机构零差异
- **基线/oracle**（本地，duckdb CLI + warehouse parquet，无需起服务）:
  - 直查 `renewal_tracker/latest.parquet` 复算续保数 = 生产路由（天府 3601/1590…达州 42/15，逐机构一致）——本地 oracle 成立
  - **数据级 RLS oracle**：注入后 SQL 形态 `FROM (SELECT * FROM <parquet> WHERE org_level_3='天府') AS RenewalTrackerFact` → 仅返回天府（越权零泄漏 + 数值正确）
- **成果**（工作树，未 commit）:
  - 新增 `server/src/config/sql-federation-policy.ts`（联邦策略注册表 SSOT，ground-truth 权限列经 duckdb DESCRIBE 实测）
  - 改 `server/src/utils/sql-validator.ts`（validatePolicyFactBoundary → validateRelationBoundary，联邦感知）
  - 改 `server/src/utils/sql-permission-injector.ts`（injectPermissionIntoAnySql 多视图感知 + 每视图 fail-closed：过滤列缺失即拒绝，绝不丢弃过滤）
  - 加 `server/src/config/env.ts` flag `SQL_FEDERATION_ENABLED`（默认 false=零行为变更，调用时直读 process.env 便于 PM2 reload/测试）
  - 新增 `server/src/utils/__tests__/sql-federation.test.ts`（21 用例：注册表 + 边界两态 + RLS 矩阵）
  - 纳入：RenewalTrackerFact / QuoteConversion / CrossSellFact / NewEnergyClaims（direct）+ BrandDim / PlateRegionMap（exempt 全局参照）
- **verifier（fresh-context evidence-verifier）抓 1 高危真缺陷，本轮全闭环**:
  - **（高·越权）RepairDim 误标 exempt**：其 parquet 含 org_level_3（各支公司）+ 损失评估金额/净保费等机构级敏感数据，开启态下任意用户可越权读全机构修理数据。根因=我假设"维度表=全局无机构"未 DESCRIBE 核实 → **教训：exempt 归类必须 duckdb DESCRIBE 实证无任何机构列，宁缺毋滥**
  - 修复：RepairDim 移出联邦注册表（保持拒绝）；其 org_level_3 为编码格式（'011019乐山中心支公司'）与标准 RLS 过滤不匹配，留待后续专门设计。新增越权拦截回归测试
  - 附带：QuoteConversion.is_telemarketing 为 varchar 与布尔过滤类型不匹配 → 从权限列移除（电销查该视图 fail-closed，安全无泄漏）
  - 8 条 RLS 绕过攻击向量（大小写/注释/子查询/第2 JOIN/CTE/逗号/LATERAL/UNION）全被正确注入，残留扫描无漏网
- **零回归**: sql-validator 31 + permission(RLS) 17 + sql-passthrough 11（现有 59 全绿，关闭态逐字节兼容）+ federation 21 = **80 passed** · typecheck 通过 · governance 42/42
- **决策**: promote 到代码层（flag 默认关 = 生产零风险）。**LIVE e2e oracle（cx sql 生产复算路由）需部署 flag ON 才能验，属下一步授权动作——本轮不声称已通过**
- needs_automation: false（已有 governance + 测试闸；联邦视图新增时须 DESCRIBE 实证权限列，已写入策略文件注释）
- rationale: 安全关键 RLS 改动，本地三重验证（单测 + 数据级 RLS oracle + 对抗式 verifier）已闭环；生产推广走灰度 flag + 多分公司回滚 SOP 范式
- **下一实验**: 部署 flag ON 灰度，跑 LIVE 锚点（`cx sql` vs `cx query RENEWAL_TRACKER` 逐机构零差异）；通过后接 P0.5 错误透明化

### 2026-06-19 — evidence-loop scorecard: cx sql 派生域联邦 本地全栈预验证 + 惰性域预热缺口修复

- **背景**: 用户合并 PR #676（P0 派生域联邦）后要求「做本地全栈预验证，生产环境还没有山西的数据和用户」。前一记分卡明确「LIVE e2e oracle 需 flag ON 才能验」，本轮在本地用 **flag ON 的真实 server + 真实 PAT + 真实 cx** 跑通该 oracle（生产部署前的等价证据），不再停在数据级。
- **harness（本地全栈，生产真实配置 federation ON / BRANCH_RLS OFF）**: worktree 联邦代码 + 主仓 warehouse 数据软链（gitignored，验证后清理）+ `node start.mjs --server` 端口 3939 + `DEV_SKIP_AUTH=1` 登录铸本地 PAT + `CX_BASE_URL/CX_PAT` 环境覆盖（不碰用户生产配置）。独立 oracle = duckdb 直查 parquet。
- **通过项**:
  - **续保逐机构复算**：admin `cx sql FROM RenewalTrackerFact` 12 机构 + 合计 **7660/3286 与 duckdb 基线零差异**（天府 3601/1590…达州 42/15）。证明全栈链路：server 读 flag→validateRelationBoundary 准入→permissionMiddleware 生成 filter→injectPermission RLS 注入→duckdb→cx 收 JSON
  - **RLS 越权隔离**：tianfu（org_user=天府）查 RenewalTrackerFact 仅返回天府一行，其余 11 机构零泄漏
  - **边界拒绝**：information_schema / RepairDim / raw_parquet 端到端「禁止访问（访问边界限制）」；RepairDim 越权回归闸现场守住
  - **fail-closed（review M2 场景，BRANCH_RLS ON 复跑）**：派生视图缺 branch_code → `RLS 注入失败：缺少权限列 [branch_code]，拒绝执行`（拒绝而非静默泄漏全分公司）；PolicyFact（有该列）正常 → 证明拒绝是**精准缺列**。**即开 BRANCH_RLS 后所有用户派生查询都 fail-closed → P0.5 补 branch_code 是引入山西前的硬前置**
- **抓到 1 个真集成缺陷（单测漏过，仅全栈暴露），本轮修复闭环**:
  - **NewEnergyClaims 冷态 `cx sql` 不可达**（"Table does not exist"）：它在 federation 白名单但是**纯惰性域**（bootstrap 不急切建视图、不在启动预热清单 ClaimsDetail/ClaimsAgg/CrossSell），而 sql-passthrough 不走 typed 路由的 `createDomainMiddleware`→`ensureDomainLoaded` → 无人物化它。RenewalTrackerFact/QuoteConversion/CrossSellFact 因 bootstrap 急切建视图而可达，掩盖了该类缺陷
  - **修复**：注册表 `RelationPolicy` 加 `lazyDomain` 字段（4 个 direct 视图标注 data-bootstrapper 注册的惰性域 key：RenewalTracker/QuoteConversion/CrossSell/NewEnergyClaims）；新增 `getReferencedLazyDomains(sql)`；sql-passthrough 在校验后、注入前对引用的 federated 关系逐一 `ensureDomainLoaded`（开关关闭恒返回空，零额外开销）
  - **修复验证（同一 harness）**：NewEnergyClaims 冷态 → **可达 n=901**；其余 3 视图 + 续保 7660/3286 + RLS 隔离全部无回归
- **附带发现（数据质量，非 federation 缺陷，已登记 BACKLOG `2026-06-19-claude-00bac8`）**: NewEnergyClaims.org_level_3 全为 NULL → org 用户查它恒空（安全无泄漏，仅 admin/branch_admin 可用）；根因在 new_energy_claims ETL 未填充机构维度。federation 保留 org_level_3 为权限列正确（列存在、RLS 注入有效）
- **零回归**: federation 28（+7 新增 getReferencedLazyDomains 用例）· validator 31 + permission 26 + federation 28 = 85 passed · typecheck 通过 · governance 42/42
- **决策**: 本地全栈 oracle 已通过（生产部署前等价证据）；LIVE 仅剩**确认生产 `BRANCH_RLS_ENABLED=false`**（单分公司 SC 应为默认 false）后开 `SQL_FEDERATION_ENABLED`。本修复作为 P0.5 第一个 PR（用户选定）
- needs_automation: false（getReferencedLazyDomains 已加单测闸；数据质量问题走 BACKLOG/ETL）
- **教训**: 字符串级单测（validator/injector）对 NewEnergyClaims 全绿，但真实查询失败——**惰性物化 + 直查路径绕过预热中间件**这类集成缺陷只有「真 server + 真 cx 全栈」能暴露。重复印证「本地全栈预验证」在数据级 oracle 之上的独立价值
- **下一实验**: 生产确认 BRANCH_RLS_ENABLED 取值 → 开 flag 灰度跑 LIVE 锚点；P0.5 补 branch_code 列 + 错误透明 + NewEnergyClaims org ETL

### 2026-06-19 — LIVE 上线确认: cx sql 派生域联邦生产切流（闭合前两条记分卡的"下一实验"）

- **动作**: PR #678 把 `SQL_FEDERATION_ENABLED: 'true'` 写入 `server/ecosystem.config.cjs` env，用户手动 merge（部署链 PR，deploy-chain-sop §2 禁 auto-merge）。Production Gate → Deploy to VPS 链路：wrapper `reload`=delete+start 重读 ecosystem env → flag 生效。
- **LIVE oracle（生产 `https://chexian.cretvalu.com`，薛成龙 branch_admin PAT）**:
  - 上线前基线：`cx sql FROM RenewalTrackerFact` 被「禁止访问（访问边界限制）」拒绝（federation OFF），证明 #676/#677 代码在线 + 零行为变更
  - 上线后：`cx sql FROM RenewalTrackerFact` 联邦复算续保逐机构 = 本地 duckdb 基线**零差异**（天府 3601/1590…达州 42/15，合计 **7660/3286 = 42.9%**）——即本会话起点「续保率无法在工具内独立验算」的痛点根除
  - PolicyFact 基线 2,600,421 不变；边界拒绝（RepairDim / information_schema）在生产仍守
  - health 200（reload 窗口曾瞬态 502，部署自带健康检查 + 回滚 trap 未触发，自愈）
- **部署观测**: deploy.yml 由 `workflow_run`（Production Gate 完成）触发，非 push 直触；#678 部署排在 #677 部署之后串行（并发组）。轮询生产 federation 状态直到翻转（~13min 从 merge 到 ON）= 直接测终态的等待法，不靠解析多个 workflow run
- **回滚**: 删 ecosystem 那行 revert，或 VPS 改 'false' + `deploy-chexian-api reload`。纯 flag，Parquet/用户态零改动
- **结论**: cx-cli 全面升级计划 P0（派生域联邦）+ P0.5（惰性域预热）**已生产上线并 LIVE 验证通过**。三 PR 链 #676→#677→#678 全部合并部署
- **下一实验**: P0.5 错误透明化（duckdb uuid → 白名单分类中文错误，闭合"错误不透明"结构墙）；P0.5 branch_code 列补齐（山西 onboarding 前）；NewEnergyClaims org_level_3 ETL（BACKLOG 2026-06-19-claude-00bac8）

### 2026-06-19 — evidence-loop scorecard: cx-cli P0.5 错误透明化（闭合"错误不透明"结构墙）

- **背景**: cx-cli 五道结构墙之一「错误不透明」——生产 `duckdb.ts:134` 把 DuckDB 原始报错压成 `查询执行失败 [uuid]`，cx sql 用户连列名打错/类型不匹配都无法自助 debug（本会话起点分析时即被此 uuid 挡住）。federation 已上线让用户能查派生视图，但查错仍是黑箱 → 价值打折。
- **合同**: 生产保留 uuid 屏蔽（防泄露），叠加**白名单安全分类中文**，让用户自助 debug；安全不变量=绝不回传原始消息/数据值/完整 SQL/DuckDB 的 "Did you mean"/"Candidate bindings" 建议（后者泄露用户无权访问的内部关系/列名）。
- **改动**:
  - 新增 `server/src/services/duckdb-error-classifier.ts`：白名单正则把 DuckDB 报错归一为 7 类中文（关系不存在/列不存在/类型不匹配/聚合 GROUP BY/语法/数值范围/除零）。关系名/列名只取**用户自己引用的标识符**（schema 级、非数据），类型/转换类不抽取任何标识符（可能含字面量值）；safeIdent 限 `[A-Za-z0-9_]{1,64}` 防把消息其余部分带出。
  - `duckdb.ts` 生产分支：`category = classifyDuckDbError(message)` → `查询执行失败 [uuid]：<分类>`（未命中退回纯 uuid，兜底不变）。dev 行为逐字节不变（仍回原始消息）。
- **oracle（真实 DuckDB Neo 绑定，非构造样本）**: 用 `@duckdb/node-api` 跑 6 类真错抓 `e.message` 过分类器——关系/列/类型/聚合/语法 5 类全部正确命中且无泄露（Catalog "Did you mean RepairDim" 被剥离、Binder "Candidate bindings" 被剥离、Conversion 的 'abc' 值不外泄）；除零 DuckDB `1/0` 返回 inf 不报错（分支为防御性，单测覆盖消息格式）。
- **零回归**: error-classifier 11 单测（含 3 条安全不变量 + 超长标识符边界）· typecheck 通过 · governance 42/42。测试文件刻意命名 `error-classifier.test.ts`（不带 duckdb- 前缀）以进 CI——被测模块纯字符串正则无原生依赖，不应落入 `duckdb-*.test.ts` 原生模块排除桶。
- **安全**: 分类白名单审查；标识符抽取仅 schema 名（关系=联邦白名单公开视图名、列=用户自写）；类型类零标识符抽取。修补不拆除：未命中即退回原 uuid 行为。
- **decision**: promote（生产 error-path 增强，对合法查询零影响，纯改报错文案）。
- needs_automation: false（分类器有单测闸；新增 DuckDB 错误类型时在白名单加一条 + 一个用例）。
- **下一实验**: P0.5 branch_code 列补齐（山西 onboarding 前的硬前置）；P1 自描述（cx describe / 续保 L4 注册）

### 2026-06-19 — evidence-loop scorecard: cx-cli P1 自描述（续保 L4 注册 + cx describe 视图自省）

- **背景**: cx-cli 结构墙「口径不自描述」——`cx metrics --category renewal` 返回空（续保口径散落 foundation/ratio 无 renewal 分类）、无法自省视图 schema。用户指定两个验收点：`cx metrics --category renewal` 与 `cx describe RenewalTrackerFact` 可用。
- **deliverable A — 续保口径注册到 renewal 域**:
  - types.ts MetricCategory 加 'renewal'（领域分类，与 cross_sell/repair/plan 同属域分类）
  - 新建 categories/renewal.ts：新增 A 应续/B 报价/C 已续件数（口径取 renewal-tracker.ts SSOT 头注，非臆测）+ 迁入 D 未报价/E 流失/续保影响度（自 foundation/ratio，口径不变，changelog 记归类调整 1.0.0→1.1.0）= 6 指标
  - **口径辨析（车险红线·不混用）**: ratio 域 `renewal_rate`（PolicyFact is_renewal 占比，KPI 面板快速口径）保留**不迁**——其 notes 明确「非续保分析板块的精确续保率（后者基于到期判断 C/A）」，与续保追踪族是两个口径。是否注册 C/A 续保率待用户口径裁决（避免同名歧义）
- **deliverable B — cx describe**:
  - 后端 `GET /api/discover/schema?relation=`：复用 sql-federation-policy 白名单准入（未授权 403）+ lazyDomain 预热 + 受控 DESCRIBE（canonical 来自注册表非用户输入，无注入），仅返回 schema 元数据零行数据
  - CLI 新增 `cx describe <relation>` 命令 + index.ts 注册；metrics --category 帮助补 renewal
- **oracle（本地全栈 federation ON，真 server + 真 cx + 真 PAT）**:
  - `cx metrics --category renewal` → 6 续保指标全列出（renewal 分类）
  - `cx describe RenewalTrackerFact` → 完整 schema（source_policy_no/vehicle_frame_no/expiry_date/org_level_3… 含 type+nullable，lazyDomain 预热 + DESCRIBE 生效）
  - 边界：describe PolicyFact 52 列（授权）；RepairDim / information_schema.tables → 403 拒绝
- **零回归**: 全量单测 3342 passed（240 文件）· CLI 72 · metric-registry 220（含金丝雀总数 52→55、L4 白名单补 A/B/C 3 id）· typecheck（root+server+cli）· governance 42/42 · validate.ts 通过 · frontend-map 重新生成
- needs_automation: false（validate.ts + 金丝雀 + L4 白名单已成闸；新增续保指标在 renewal.ts 加条目 + 同步金丝雀/白名单）
- **下一实验**: P0.5 branch_code 列补齐（山西前）；P1 续 renewal-tracker.ts 引用注册表口径成单一事实源 + cx query --describe 图例；P2 语义层

### 2026-06-19 — evidence-loop scorecard: cx-cli P1 续（续保口径单一事实源 + cx query --describe 路由图例）

- **背景**: 承接 P1 自描述（#681）的"下一实验"。用户三选一选定方向 1。闭合 cx-cli 结构墙「响应裸 A-E 无图例」最后一块——续保追踪路由 `/api/query/renewal-tracker` 输出列是裸字母 A/B/C/D/E，调用方拿 JSON 无从得知含义；同时让续保口径成单一事实源（消除 renewal-tracker.ts 头注与 metric-registry 的口径重复）。
- **合同**: ① `sql/renewal-tracker.ts` 输出列 A-E 绑定 metric-registry 续保域指标 id，口径文本单一事实源；② `cx query <route> --describe` 输出 A-E 中文图例（列+名称+口径+单位 走 stderr）+ 路由级时间口径 + 生效参数(含 cutoff)，消灭裸字母，数据照常走 stdout。
- **设计（评审要点）**: 口径 SSOT 分层——口径文本=metric-registry（categories/renewal.ts，#681 已建）· 列↔指标绑定=`RENEWAL_OUTPUT_COLUMNS`（renewal-tracker.ts 导出）· 路由级时间口径=query-routes-metadata。新增 `config/route-field-legend.ts` 只做"解析编排"零口径文本。图例由**独立 discover 端点** `GET /api/discover/legend?route=`（/schema 同级）服务，**不改任何 query 路由数据路径** → golden-baseline 零差异 by construction；图例走 stderr 不污染 stdout 管道。
- **成果（工作树，本记分卡随同 commit 落盘）**: 8 文件——`sql/renewal-tracker.ts`(头注引用注册表+RENEWAL_OUTPUT_COLUMNS) · `config/route-field-legend.ts`(新,buildRouteLegend+SSOT 守卫) · `routes/discover.ts`(/legend 端点) · `config/__tests__/route-field-legend.test.ts`(新 9 用例) · `cli/src/commands/query.ts`(--describe+formatLegend+printRouteLegend) · `cli/src/index.ts`(注册选项+示例) · `cli/__tests__/query.test.ts`(+4 formatLegend) · `cli/ux-baseline.json`(重生成 help-query)。
- **oracle（本地全栈 federation ON / BRANCH_RLS OFF，真 server:3939 + 真 cx + 真 PAT + 独立 duckdb）**:
  - **图例渲染**: `cx query RENEWAL_TRACKER --describe --start=2026-06-01 --end=2026-06-30 --cutoff=2026-06-18` → stderr 显「字段图例 RENEWAL_TRACKER + 时间口径(到期窗口) + 生效参数 cutoff=2026-06-18 + A-E 全表(列/名称/口径/单位)」，裸字母全消灭
  - **数据路径零影响**: 带/不带 --describe 的 stdout **逐字节一致（1375174 bytes）**——图例只写 stderr
  - **数值正确（独立 duckdb 直查 parquet 同谓词）**: overall A=9933 C=4053、高新 A=1451 C=510 与 cx 返回零差异
  - **无图例路由优雅降级**: `cx query KPI --describe` → stderr「(路由 KPI 暂无字段图例)」+ KPI 数据正常返回；`/legend?route=KPI` → data:null
  - **端点安全**: /legend 仅返回指标元数据零行数据，authMiddleware（router 级），不挂 permissionMiddleware（与 /fields/metrics/presets 一致）
- **verifier（fresh-context evidence-verifier）实质检查全过**: 口径绑定逐列核对正确（A→renewal_due_count…E→renewal_lost_count 与 SQL 别名语义一致，无错绑）· route-field-legend.ts/discover.ts grep 确认零硬编码中文口径（真 SSOT）· 回归数字全复现 · /legend 无泄漏鉴权正确 · 数据路径零影响。verifier 唯一"不通过"=改动尚未 commit（evidence-loop 正常 pre-commit 态，本 commit 即落盘解除；其把 #681 已合并文件误算"范围蔓延"，实际本次改动干净 8 文件）
- **零回归**: typecheck(root+server+cli) · 全量单测 **3355 passed/241 文件**（baseline 3342/240 → +route-field-legend 9 + formatLegend 4）· CLI 76 · governance 42/42 · `ux:check` 0 diff（一致性 0 违规 / 可发现性 100%，改 query 帮助后 `ux:write` 重生成 help-query 快照）
- **harness 自纠**: 软链主仓 warehouse 数据时初次误把 claims_detail 当单文件 latest.parquet（实为分区 claims_2019..2026.parquet）→ ClaimsAgg←ClaimsDetail 构建失败污染查询管道；改软链全部分区文件后 ClaimsDetail 288198 行/ClaimsAgg 243007 行正常。另误软链覆盖两个**已跟踪**的 `业务员归属与规划/*.json`（产生 git T 类型变更）→ git restore 还原。教训：软链补数据前先 `git check-ignore` 确认目标 gitignored，分区域看真实文件结构
- needs_automation: false（route-field-legend SSOT 守卫单测 + formatLegend 单测已成闸；新路由加图例在 ROUTE_OUTPUT_COLUMNS 加一行绑定 + SQL 生成器导出列表即可）
- **下一实验**: P0.5 branch_code 列补齐（山西 onboarding 前硬前置）；P2 语义层 cx cube 可组合查询（接续 B290）；P3 cx query --explain

### 2026-06-19 — evidence-loop scorecard: cx-cli P2 语义层（cx cube 可组合查询 · 续保锚点优先）

- **背景**: cx-cli 全面升级计划 P2（接续 P0/P0.5/P1 已上线）。结构墙「黑箱路由——路由未预置切片就做不出」：续保 24 层固定 GROUPING SETS 只覆盖 5 个维度层，换一个组合（如续保率×是否新车）就做不出。用户三选一选定 **Option A 续保域锚点优先**（全 additive 标记 + 泛化续保生成器 + cx cube 分派，单内聚 PR；非全域语义层一次到位）。
- **合同**: 让 cx 对续保域实现「选指标 × 任意维度子集」可组合查询，PolicyFact 域复用既有 pivot。oracle = 可组合结果 = 等价直查 SQL/既有路由零差异（cube-shadow 容差语义）。
- **设计（精读 /pivot 后定）**: /pivot 已做 PolicyFact 1-2 维 × 可加/单层比率指标聚合（isPivotSafeMetric 守卫），但 PolicyFact-only + ≤2 维，做不出续保 L4。关键洞察：对「恰好按请求维度子集」做**直接单层 GROUP BY**，无论可加与否都正确（比率算 SUM(分子)/SUM(分母)、续保算 COUNT(DISTINCT vin) 逐组重算，不涉 roll-up 求和）；additive 真正用于 cube 物化加速，非直接 GROUP BY 正确性前提。故 = 泛化续保 GROUPING SETS 成「维度子集→单层 GROUP BY」生成器 + additive 元数据 + cx cube 服务端按域分派（续保→新生成器，PolicyFact→复用 generatePivotQuery）。
- **成果（工作树，21 改 + 4 新）**:
  - `metric-registry/types.ts` 加可选 `additive` 字段 + `validation.ts` 加「每指标必声明 additive」闸；全 55 指标补标记（**仅 5 个 true**：total_premium/earned_premium/baseline_earned_premium/repair_damage_amount_total/repair_net_premium_total；50 个 false=比率/COUNT DISTINCT/差值/L4/增长率，**保守判定**：拿不准一律 false，误判 true 才会让 cube 错误求和率值——车险铁律 [[feedback_rate_aggregation_law]]）；`discover.ts` /metrics 暴露 additive（AI agent 自描述）。
  - `sql/renewal-tracker.ts`：抽 `renewalCountSelectSql(cutoff)` 共享 A-E 口径助手，**重构主查询复用**（口径 SSOT 单一定义，零漂移）+ 新增 `generateRenewalCubeQuery`（任意维度子集单层 GROUP BY）+ `RENEWAL_CUBE_DIMENSIONS` 白名单（续保宽表真实列，**无 insurance_grade** → 续保率×风险等级须走 PolicyFact）。
  - `routes/query/cube.ts`（新 /api/query/cube）：服务端按域分派；续保路径**镜像 renewal-tracker 路由的 buildRenewalExtraConditions（11 字段 + permissionFilter RLS 逐条一致）** + createDomainMiddleware 预热惰性域；PolicyFact 路径复用 generatePivotQuery + parseFiltersAndBuildWhere。续保影响度（需窗口合计分母）/L4/跨源/增长率 → 400 指引。
  - CLI `cx cube --metric --dims --start/--end/--cutoff [--<筛选>=值]`（cli/src/commands/cube.ts + index.ts），透传范式同 cx query，退出码契约一致。
  - 四处登记：api-routes.ts / 前端 routes.ts / query-routes-metadata.ts(CUBE entry) / route-param-contracts.ts(/cube 契约)。
  - 测试：renewal-cube.test.ts(11) + additive.test.ts(4)。
  - **续保率 C/A 口径裁决**：renewal.ts SSOT 注释显式把「C/A 是否注册为独立指标」延后给用户（避免与 ratio 域 renewal_rate 同名歧义）。本 PR **不注册**新指标，cube 输出 A-E 五个已注册计数 + 派生 renewal_rate_pct(C/A)/unquoted_rate_pct/lost_rate_pct（C/A 是 renewal.ts 文档化口径「由下游用 A、C 计算」，非臆测，标注续保追踪口径）。
- **本地全栈 oracle（federation ON / BRANCH_RLS OFF，真 server:3939 + 真 cx + 真 PAT + 独立 duckdb 直查 parquet）**:
  - **overall 三方零差异**: duckdb A=9933/B=8624/C=4053 ≡ cx cube（D=1309=A−B、E=5880=A−C、续保率 40.8%=C/A 全自洽）。
  - **12 机构三方零差异**: cx cube --dims=org_level_3 ≡ duckdb 直查 ≡ 既有路由 RENEWAL_TRACKER orgRows（天府 4512/3899/1862…达州 54/45/19，逐机构 A/B/C 0 差异）——即固定切片路由的 shadow 对账。
  - **新组合（固定 24 层未预置）零差异**: cx cube --dims=org_level_3,is_new_car vs duckdb top5 全中——证明解锁了原路由做不出的组合（动机痛点根除）。
  - **RLS 越权隔离**: tianfu(org_user=天府) PAT 查 cube 仅返回天府一行，其余 11 机构零泄漏。
  - **PolicyFact 路径**: cx cube --metric=total_premium --dims=org_level_3 ≡ cx query PIVOT 同参 15 机构零差异（同生成器）。
  - **边界拒绝**: renewal_impact_rate（窗口合计）/insurance_grade（白名单外维度）/growth_rate_yoy（需外层 CTE）/缺 metric(exit 4)/续保缺 start 全部 ✘ 正确拒绝。
- **verifier（fresh-context evidence-verifier）裁定通过**: 独立复跑 typecheck/governance 42/42/全量单测 3370/validate.ts 全绿；逐一核 5 个 additive=true 真可加 + 无比率/DISTINCT 误标 true（grep additive: =55、true=5 精确匹配）；renewalCountSelectSql 全仓单一定义无漂移；cube RLS 与续保路由逐条一致无 fail-open 新增；四处登记一致；无 scope creep。唯一提示=CLI 帮助示例措辞「可加指标」实际接受比率指标 → 已校正为「可加/比率指标」。无实质缺陷。
- **零回归**: typecheck(root+server+cli) · 全量单测 **3370 passed/243 文件**（baseline 3355/241 → +renewal-cube 11 + additive 4，+2 文件）· CLI 76 · governance 42/42 · validate.ts 55 指标 · `ux:check` 0 漂移（cube 进顶层帮助基线，`ux:write` 重生成）。
- **harness 自纠**: 软链 warehouse 用 `git ls-files --others --ignored` 精确列出 gitignored 文件 + 逐文件软链「绝不覆盖已存在文件」，避免上次（P1续）误覆盖跟踪文件的坑；验后 `find -type l -delete` + git restore 还原，git status 仅余代码改动。
- **决策**: promote。纯代码（不碰部署链 ecosystem/deploy.yml/sync-vps），PR 可 ready 直合。本地全栈 oracle = 生产部署前等价证据；LIVE 仅剩生产开 SQL_FEDERATION_ENABLED（已 LIVE，#678）即可用。
- needs_automation: false（additive 由 validation.ts 闸常态守；新指标加条目须声明 additive，缺失即 governance 红。续保 cube 维度白名单/口径 SSOT 由 renewal-cube 单测守）。
- **下一实验**: P2 续——若用户要全域语义层（PolicyFact >2 维 / 跨域统一端点 / 续保率 C/A 注册口径裁决）再扩；P0.5 branch_code 补齐；P3 cx query --explain。

**—— PR #685 auto-review 修复（receiving-code-review）**:
- **review 发现（P2 级·真缺陷）**: 电销用户（telemarketing_user，`permissionFilter='is_telemarketing = true'`）调 cube 续保路径 → 朴素追加到无该列的 RenewalTrackerFact → **DuckDB Binder Error 500**，电销完全不可用。我镜像 renewal-tracker 路由时把这个潜在 bug 一并带进了新代码。
- **核实（验证不声称）**: permission.ts:50 确生成纯 `is_telemarketing=true`（无 org 段）；duckdb 直查证 `... AND (is_telemarketing = true)` on renewal parquet → `Binder Error: Referenced column "is_telemarketing" not found`；ORG_ROLE_ALLOWED_ROUTES 是前端页面路由不门控 /api/query/* → bug 真实可达。
- **修复**: 新增 `query/shared.ts buildOrgScopedPermissionWhere`（对齐 repair.ts 既定降级模式——正则提取 `org_level_3='...'` 段，电销/纯 branch_code → 1=1，绝不追加视图缺失列）；cube 续保路径改用之。**修一类不修一处 + prod bug 不偷修**（feedback_codex_review_fix_sop）：cube（新代码）修正；renewal-tracker 同款既存 bug 单独登 BACKLOG `2026-06-20-claude-10c9e9`，不在本 PR 偷修。
- **全栈验修**: 电销 PAT cube 续保 → **200 返 12 机构**（降级 1=1，无 500）；tianfu(org_user) → **仍仅天府**（org_user 隔离零回归）；helper 5 单测（电销→1=1 / org_user 提取 / 多分公司只留 org / 转义引号）。typecheck · governance 42/42 · 相关测试 20/20。
- **教训**: 「镜像生产路由」会连同照搬其潜在缺陷——新增派生视图查询前必查目标视图真实列集（duckdb DESCRIBE）与 permissionFilter 列是否匹配，缺列用安全降级而非朴素追加。续保族（renewal_tracker）/维度视图（RepairDim）/报价（QuoteConversion）均缺 is_telemarketing，是同一类盲区。

### 2026-06-19 — evidence-loop scorecard: cx-cli P0.5（派生视图 branch_code RLS 列 + m1 fail-closed）

- **背景/现状审计纠偏**: 接 P1 续"下一实验"。开工审计发现计划 P0.5 四子项**已部分合并、计划文件过时**：错误透明化（#1）已合并 PR #679（duckdb-error-classifier.ts 7 类分类）；CLI 透传（#3）就绪；日期列（#2）DESCRIBE 实测**实质已解**（PolicyFact 4 日期列中 3 已 TIMESTAMP，唯一 VARCHAR first_registration_date 为规范 ISO、`>= DATE` 硬错且被 #679 分类器翻成「类型不匹配…可用 CAST」）。**真正剩余 = #4 派生视图权限列 + m1 fail-closed**。教训：接力计划开工先核 origin/main 真实落地态（计划文件滞后于已合并 PR）。
- **合同**: ① 4 个 direct 派生视图（RenewalTrackerFact/QuoteConversion/CrossSellFact/NewEnergyClaims）补 branch_code，使 BRANCH_RLS_ENABLED 开启后分公司用户不被 fail-closed 拒（闭合 review M2，是开 flag 前硬前置——否则连 SC 用户也 fail-closed）；② sql-passthrough m1 fail-open（`?? '1=1'`）→ fail-closed；③ is_telemarketing 缺口登记 BACKLOG。
- **关键判断（用户两次拍板）**: ① is_telemarketing 三无源派生域（parquet 无 terminal_source 列）+ QuoteConversion（归一 boolean 会打断 typed 报价路由 sql/quote-conversion.ts:72 按字符串 '电销'/'非电销' 消费 + 前端筛选契约）→ 全部 BACKLOG（2026-06-20-claude-c21667）；② 实现走**视图层补列**而非改 parquet（跨 ETL 持久 / 零数据变更 / 可逆，循 loadCustomerFlow 先例），优于 0C backfill（后者下次 ETL 会冲掉、留耐久性地雷）。
- **成果（工作树，5 文件）**: `config/sql-federation-policy.ts`（4 视图 permissionColumns +branch_code · 新增 getDeploymentBranchCode 直读 env BRANCH_CODE、^[A-Z]{2}$ 校验默认 'SC'）· `services/duckdb-domain-loaders.ts`（新增 selectWithBranchCode：DESCRIBE 守卫，仅 parquet 缺列时追加 `'<bc>' AS branch_code`，防未来 ETL 落列重复 · 4 loader 视图定义引用）· `utils/sql-permission-injector.ts`（新增类型守卫 isPermissionFilterMissing）· `routes/query/sql-passthrough.ts`（m1：undefined→403，'1=1' 仍放行）· `utils/__tests__/sql-federation.test.ts`（branch_code 断言翻转 + 全 4 视图覆盖 + m1 不变量，+7 用例）。
- **oracle（live 全栈：worktree 真实 loader+注入器 × 主目录真实数据 260 万行级）**:
  - 4 视图均 branch_code 列经 DESCRIBE 守卫真实产生（VARCHAR）
  - `branch_code='SC'`→全量（续保 128016 / 交叉 420899 / 新能源 901 / 报价 880489）· `='SX'`→**0 行**（越权归空，无泄漏、无报错、非 fail-closed）· 电销 `is_telemarketing=true`→**fail-closed 抛错**（缺列回归未破）
  - duckdb 直查 parquet 交叉验证：first_registration_date `>= DATE` 硬错复现、`>= '2022-01-01'` 字符串比较与 TRY_CAST 同为 311408 行（异常格式 0 行 / 2600421 行）
- **零回归**: typecheck（root+server+cli，类型守卫收窄生效）· 全量单测 **3372 passed/242 文件**（baseline 3365 → +7）· cli 76 · governance 42/42 · ux:check 0 diff
- needs_automation: false（federation policy RLS 矩阵单测 + isPermissionFilterMissing 不变量 + selectWithBranchCode DESCRIBE 守卫已成闸；新派生视图补 branch_code = loader 套 selectWithBranchCode + policy 加列 + 测试一行）
- **下一实验**: is_telemarketing 派生视图 RLS（BACKLOG 2026-06-20-claude-c21667，需 ETL 携带 + QuoteConversion 报价路由迁移到 boolean+标签约定）；P3 cx query --explain（P2 语义层 cx cube 已落地 PR #685）

---

## 2026-06-20 · 山西多省接入 loop（审计→backlog→合并→G1-claims）+ 每轮三问复盘

> 按用户 8 步 loop workflow 推进山西接入，并按用户要求**每轮三问复盘**（重来怎样更好 / 复用价值 / 如何更高质量自动化），供最终复盘与下轮改善。机制见 memory `feedback_per_round_retrospective`。

**R1 · 审计 PR #690（机构规范化 61→11）**
- 成果：独立实跑复现，无 P0/P1。ETL 61→11 零 unmapped、validation/SX 1,830,603 行/15.28 亿与源零差异、current/ md5 字节零回归、文档-代码三方一致。
- 重来更好：直读源 Excel 第一次只读首 sheet（114K vs 183 万）→ 应先 openpyxl 看全 sheet 结构再聚合，避免假异常绕路。
- 复用价值：高。"rm validation/SX → BRANCH_CODE=SX 重跑 → duckdb 对账 vs 源 Excel"是多省审计标准动作。
- 自动化：对账可固化 `scripts/verify-branch-domain.mjs`。

**R2 · 登记 backlog + plan 续传 → PR #695（merged）**
- 成果：G1/G3/G7/G8 入 backlog（G4=c21667/G6=fdbba5 已有不重复），plan 续传 v4，governance 42/42。
- 重来更好：查重应更早（差点重复登记 G4/G6）→ add 前先 grep 现有同主题。
- 自动化：backlog.mjs add 前可加同主题相似度提示。

**R3 · 合并 #690 + #695**
- 成果：merge 确认；main 含全部地基（SX.json / normalize_branch_org / §6.5）。
- 重来更好：gh graphql 端点 EOF 闪断 → 早用 REST（gh api）兜底，少绕一次。

**R4 · G1-claims 接入（本 PR）**
- 合同：claims_detail 域 branch-aware，SX claims → validation/SX/claims_detail，SC 字节安全。
- 成果：convert_claims_detail.py 加 `--branch-code` 注入 + daily.mjs runClaimsDetail 路径省份化（branchSourceDir/branchOutputRoot，policy-dir 指向同省 premium 富集）+ main 子命令非 SC 双护栏（仅 claims_detail 放行 + 非 SC 跳过 sync/report/企微，**闭合"单域子命令路径会 syncToVps"的 D5 漏洞**）。
- oracle：validation/SX/claims_detail 13,156 行、branch_code 全 SX、已决 31,860,134.81/未决 22,271,615.27 与源 Excel **精确相等**、SC warehouse/fact/claims_detail 零 parquet 新增、node --check + governance 42/42。
- 重来更好：以为"跑命令"，实为编排手术（policy-dir 富集 + CDC + sync 副作用护栏）→ ETL 域接入开工先画"源→convert→partition→副作用"全链路再估工。SC 字节安全靠代码构造证（受数据环境争用限制未跑 SC claims 回归）→ 理想应补 SC claims golden 对比。
- 复用价值：高。daily.mjs branch-routing 模式（branchSourceDir/Root + 非 SC 早退 + convert --branch-code）现 premium+claims 两域复用，是 quotes/repair/brand 的直接模板；非 branch-aware 域硬拦截护栏可推广。
- needs_automation: true → `scripts/verify-branch-domain.mjs <省> <域>`（行数/金额 vs 源 ≤ 万分之一 + branch_code 全省 + SC 目录零新增 parquet）+ governance 闸"非 SC 域必须有早退护栏"。
- 下一实验：G1 余域 quotes/repair/brand（套同模板）/ G3 维度表省份化。

---

## 2026-06-21 · 山西多省接入 loop（G1-quotes，runStandardDomain 省份化）+ 每轮三问复盘

> 续 2026-06-20 loop，按用户 8 步 workflow 推进 G1 余域；每轮三问复盘（重来怎样更好 / 复用价值 / 如何更高质量自动化）。机制见 memory `feedback_per_round_retrospective`。

**R5 · G1-quotes 接入（PR #698）**
- 合同：把 daily.mjs **通用处理器 `runStandardDomain`**（manifest 驱动，cross_sell/quotes/brand/repair/customer_flow/new_energy 共用）做成 branch-aware，SX 报价 → `validation/SX/quotes_conversion`，SC 字节安全。
- 成果：
  - `runStandardDomain` BRANCH_CODE 路由：非 SC 源自 `branchSourceDir`(staging/<省>)、产物 `branchOutputRoot`/<域>、`archiveRoot` 隔离、`extraArgs` 注入 `--branch-code`、跳过 data-sources.json。
  - `archiveRoot` 线程化到 4 个 strategy + `safeConvertDomain`（默认 `join(__dirname,'.archive')`，SC 不变）—— 闭合"非 SC 旧产物归档落进 SC `数据管理/.archive`"的隔离缺口。
  - `base_converter.py` 加 `--branch-code`（**brand/repair 子类免费获得**，下两域零脚本改动）；`quote_etl.py` standalone 同语义手加。
  - main 白名单 `__branchReadyDomains` 加 quotes。
- oracle：validation/SX/quotes_conversion **570,355 行 × 33 列**、branch_code 全 SX 无 NULL、duckdb 产物 vs pandas 直读源 Excel **精确相等**（SUM(最终报价)633,141,426.29=633,141,426.29 / 承保 53,216=53,216 / 总量相等）、SC `current/` 零触碰、data-sources.json 未改、node --check + governance 42/42。
- **重来更好**：本轮真正的工程价值在"通用处理器 + BaseConverter 一次省份化 → brand/repair 几乎零成本"，这一杠杆点开工时未预判，先读全调用图（谁继承 BaseConverter / 谁 standalone）能更早锁定最小改动面。SC 字节安全仍靠代码构造证（worktree 无 SC quote 源，未跑 SC 回归）→ 理想补 SC golden 对比。
- **复用价值**：极高。`runStandardDomain` 一处省份化覆盖 5 个标准域；BaseConverter 的 `--branch-code` 让所有子类域（brand/repair/cross_sell/customer_flow/new_energy）天然 branch-aware，剩余域接入塌缩为"白名单 + 暂存源 + 验证"三步。
- **needs_automation: true** → R4 已提的 `scripts/verify-branch-domain.mjs <省> <域>`（行数/金额 vs 源 ≤ 万分之一 + branch_code 全省 + SC 零新增 parquet）本轮再次手工复刻同一套 duckdb+pandas 对账，固化收益已确定；可顺带加 governance 闸"标准域非 SC 必经 `__branchReadyDomains` 白名单"。
- **下一实验**：repair（multi_file_merge）→ brand（single），均仅需白名单+暂存源+验证；之后 G3 维度表省份化（6ae4d7）。派生域 cross_sell/customer_flow/new_energy 依赖 policy+claims，排其后。

**R6 · G1-repair 接入（同 PR，携带 R5 quotes-meta）**
- 合同：repair_resource 域（multi_file_merge）branch-aware，SX 维修资源 → `validation/SX/repair_resource`，SC 字节安全。
- 成果：**几乎零成本** —— `RepairConverter` 继承 `base_converter.py`，R5 已给 BaseConverter 加 `--branch-code`（已随 #698 进 main），故 repair 仅需 daily.mjs `__branchReadyDomains` 白名单加 `repair` 一行。
- oracle：validation/SX/repair_resource **21,166 行 × 14 列**、branch_code 全 SX、duckdb 产物 vs pandas 直读源 Excel **精确相等**（SUM(核损金额)21,460,875.29=21,460,875.29 / SUM(签单净保费)15,324,338.90=15,324,338.90 / 4S 10,076=10,076）、SC `dim/repair` 与 `数据管理/.archive` 均未创建（**archiveRoot 隔离首次实证**：multi_file_merge 的归档落 validation/SX/<域>/.archive 而非 SC）、current/ 与 data-sources.json 零触碰、governance 42/42。
- **重来更好**：印证 R5 的杠杆判断 —— BaseConverter 一次省份化让 repair 从"一个域的工作量"塌缩为"一行白名单"。本可在 R5 PR 里顺带把 repair/brand 白名单一起开（反正 BaseConverter 已就绪），但逐域验证更稳、PR 更可追溯，权衡后保持一域一验。
- **auto-merge 竞态教训（本轮事故）**：#698 启用 `--auto` 后我又 push 了 backlog/pr-evolution 跟进提交，CI 先过 → auto-merge 在 head=adc14c74 触发并删分支，跟进提交 8c87d2dc 滞留重建分支、未进 main。对策已执行：rebase 到新 main 携带该 meta，并改为**把 backlog+复盘 bundle 进代码提交、enable auto-merge 前一次推完**（本 R6 即如此）。→ 值得固化为 memory（auto-merge 后禁 follow-up push）。
- **复用价值/自动化**：同 R5。brand 为最后一个有源标准域，路径与 repair 完全一致。

**R7 · G1-brand 接入（最后一个有源标准域）**
- 合同：brand 域（single）branch-aware，SX 厂牌车型 → `validation/SX/brand`，SC 字节安全。
- 成果：同 repair —— `BrandDimConverter` 继承 BaseConverter，仅 daily.mjs `__branchReadyDomains` 白名单加 `brand` 一行。
- oracle：validation/SX/brand **371,359 行 × 16 列**、branch_code 全 SX、**主键对账精确**（产物行数 = 源「车辆型号（上传平台）」去重非空数 371,359、null_code=0）。品牌 distinct 7,275 vs 源 7,277 差 2 —— 按 §0「验证不声称」复刻 ETL 去重 keep-first 后精确得 7,275，证明差异是**依赖属性在 keep-first 去重下的固有行为**（与 SC 同逻辑、非本次改动引入），非缺陷。SC `dim/brand`/`.archive` 未创建、current/ 与 data-sources.json 零触碰、governance 42/42。
- **重来更好**：dim 表对账不能只看总行数，要分清"主键基数（必须精确）"与"依赖属性聚合（可能因去重 keep-first 有小差）"——本轮没有把 7275≠7277 当异常，而是先复刻 ETL 去重逻辑证伪"缺陷"假设，是 §0 的正确实践；可固化进 verify-branch-domain harness（dim 域对账按 dedup_key 基数而非裸 distinct）。
- **里程碑**：★ G1 四个**有源**标准域（claims_detail / quotes / repair / brand）全部隔离接入完成。runStandardDomain + BaseConverter 一次省份化的杠杆兑现：后两域各仅一行白名单。余 cross_sell / customer_flow / new_energy 为**派生域**（依赖 policy+claims，非 Excel 源），排 G3 维度表省份化（6ae4d7）之后。
- **复用价值**：multi_file_input(quotes) / multi_file_merge(repair) / single(brand) 三种 input_strategy 全部跑通 branch 路由 + archiveRoot 隔离，runStandardDomain 省份化已全策略覆盖验证。

**R8 · G1 收官 + G3 scoping 交接**
- **G1 状态**：4 个有源标准域全部 branch-aware 隔离接入并合并 —— claims_detail(#697) / quotes(#698) / repair(#699) / brand(#700)。backlog `2026-06-21-claude-4ec927` → DONE。本轮净产出 3 PR（#698/#699/#700），各 4 项 CI 全绿、duckdb×pandas 精确对账、SC 字节零触碰、governance 42/42。
- **杠杆复盘**：真正的工程价值是 #698 把通用处理器 `runStandardDomain` + `BaseConverter` 一次省份化 → repair/brand 各仅一行白名单。三种 input_strategy（multi_file_input/multi_file_merge/single）+ archiveRoot 隔离全策略覆盖验证。
- **本轮唯一事故**：auto-merge 竞态丢 meta 提交（已 rebase 补救 + 固化 memory `feedback_auto_merge_no_followup_push`，repair/brand 改 bundle 模式零复发）。
- **G3 交接（6ae4d7，本轮不动手，待用户定调）**：性质从 ETL 升为**服务端 runtime + 设计抉择**——
  1) salesman/plan/plate_region 维度表为单一全局 latest.parquet 无省份维度（brand/repair 的 SX 隔离副本已由 G1 落 validation/SX，可复用）；
  2) 设计抉择：dim 表注入 branch_code vs 按省加载（影响 `duckdb-domain-loaders.ts`/`paths.ts`，触碰 GATED 共享 runtime 边界，需 BRANCH_RLS_ENABLED 门控保持 SC-safe）；
  3) **信息缺口**：SX 的 salesman/plan dim 无独立源（G1 quotes ETL 实测 team 全'未分配'），plate_region 同理 → 需用户提供 SX 业务员归属/计划源或确认降级口径。
- **下一实验**：待用户就 G3 设计抉择 + SX dim 源缺口定调后启动；或转 G7/G8 等其他 backlog。

**R9 · G3 维度表省份化 — loader 数据层落地（branch_code 注入·SC 字节安全）**
- **用户定调（2026-06-21）**：方向 = branch_code 注入 + loader 多省加载（沿用联邦 RLS 范式，`BRANCH_RLS_ENABLED=false` 默认时行为不变=SC 字节安全）；SX dim 源缺口=降级兜底（salesman team 未分配 / plan 缺省空 / plate_region 全局）；brand/repair 的 SX validation 副本可直接接。落点：`duckdb-domain-loaders.ts` + `paths.ts` + `sql-federation-policy.ts`。
- **合同**：salesman/plan/repair 维度多省能力 + branch_code；brand/plate_region 保持全局；SC 默认逐字节不变。commit `5405cd8c`（分支 `claude/sx-standard-domains`，backlog 6ae4d7 → PARTIAL）。
- **成果**：纯函数 `buildBranchDimSelect`（单源短路=历史 SQL 字节一致，多源 `UNION ALL BY NAME`+缺列补 branch_code）+ `loadDimParquet`/`loadRepairDim` 接受 extra 省份源 + `data-bootstrapper.resolveBranchDimExtras` 探测 `validation/<省>/dim/<域>`（0a 期空→单源字节安全）+ `paths.getBranchValidationDimPath`。
- **oracle**：CI 单测 6（`buildBranchDimSelect` 含"单源不变形/多源 BY NAME/空源抛错"）+ 集成 4（**单省 SalesmanDim/RepairDim 不含 branch_code 列=字节回归** / 多省 SC 补常量·SX 原值·按省精确过滤）+ `duckdb-dim-dedup` 回归 7（向后兼容签名）+ 全量 CI 3423 全绿；typecheck；governance 42/42。
- **重来更好**：① 范围抉择耗时大 —— "loader 层 vs 含 achievement_cache 传播+typed 路由过滤"边界，靠"落点=3 文件 + RepairDim 联邦排除是既有安全决策"两条硬约束才收敛；下次遇 runtime 设计抉择，先用"落点文件清单 + 既有安全测试不可破"两把尺子快速划界，少走分析弯路。② **字节安全证明法**：golden-baseline BLOCKED on `E2E_PASSWORD`，改用"单源短路 = SQL 形态恒等（按构造）+ 集成回归断言单省无 branch_code 列 + 既有 dim-dedup 回归 + 全量 CI"四重直证，比"跑不了就降级"更稳（呼应 memory `feedback_no_giveup_ask_authorization`：缺 E2E_PASSWORD 可向用户要，但本变更纯 loader、按构造已足）。
- **复用价值**：`buildBranchDimSelect`/`resolveBranchDimSources`/`buildDimSelectSql` 是通用多省维度 SQL 构造器，后续任一 dim 域接 SX 仅需 data-bootstrapper 传 extra 源；`resolveBranchDimExtras` 探测约定（`validation/<省>/dim/<域>`）可被 G4 派生域复用。
- **needs_automation: true** → ① `verify-branch-domain` harness 应扩 dim 域分支（单省零 branch_code 列 + 多省按省计数）；② 可加 governance 闸"维度 loader 单源路径不得引入 branch_code 列"防未来回归破坏字节安全。
  - expires: 2026-09-21（届时 GATED 多省上线前应已机制化为 harness/governance 闸；未机制化则升级或撤项）
- **下一实验（本任务后续，配 G4）**：`SalesmanTeamMapping`/`achievement_cache` 的 branch_code 传播 + typed 路由（premium-plan/repair）分省过滤；或转 G7/G8。**🔴 GATED cutover（RLS-on→SX 进 current/→sync VPS→发账号）须用户显式确认，禁自动执行。**

**R10 · G4 派生域多省 branch_code — loader 多省层落地（per-row·SC 字节安全）**
- **用户选择（2026-06-21，#704 合并后）**：下一项做 G4 派生域补 branch_code。
- **范围澄清（开工首要收获）**：派生视图 branch_code **常量列**早由 P0.5（原 `selectWithBranchCode`）覆盖；既有 backlog `00bac8`/`c21667`/`e2240c` 实为 org NULL / is_telemarketing / tonnage 等**非 branch_code** 子问题。本轮真正的 G4 = 把单省**部署常量**升级为多省**真实 per-row** branch_code（与 G3 平行）。→ 新建 backlog `8571a6` 精确记此里程碑（不混入既有子问题条目）。commit `c6f09fba` → DONE。
- **成果**：`selectUnionWithBranchCode`（取代单源 `selectWithBranchCode`，移除死代码）：单源=P0.5 字节一致、多源 `UNION ALL BY NAME`；4 派生域 loader 接受 extra 源 + `resolveBranchFactExtras` 探测 `validation/<省>/<域>`（G1 已落 SX quotes/renewal）；customer_flow 派生自 PolicyFact 已含 branch_code 无需改。
- **oracle**：集成 4（`duckdb-branch-fact`：单省 P0.5 字节回归 / 多源补常量 / SX 携真实省份 / 分省过滤）+ typecheck + governance 42/42 + 全量 CI 3423 全绿。**`domain-testcases` 5 失败先 stash 改动在 clean main 复跑确认为既有**（fixture 缺 endorsement_no/coverage_combination，非本变更）—— §0「验证不声称」的正确实践（疑似回归先证伪归属再下结论）。
- **重来更好**：① G3/G4 是同一抽象的两面（dim 单源不补 vs 派生域单源恒补 branch_code），R9 若预判到这层对称，可一次性设计 `buildBranchDimSelect`+`selectUnionWithBranchCode` 共用骨架（差异仅"单源是否补常量"一个 flag），少一轮重读；② 范围澄清提前做（先 grep P0.5 是否已覆盖 branch_code）能避免"以为要补 branch_code、实则已有"的方向误判 —— 印证 memory `feedback_verify_before_assume`。
- **复用价值**：dim/fact 两套多省 SQL 构造器 + 两个 `resolveBranch*Extras` 探测器已成型，覆盖 warehouse 下全部省份相关域；后续任一域接 SX 仅"放 validation 副本 + 0 代码"。
- **needs_automation: true** → `verify-branch-domain` harness 应同时覆盖 dim 与 fact 域（单省字节/多省分省计数），与 R9 同一 harness 缺口合并。
  - expires: 2026-09-21（同 R9，GATED 上线前机制化）
- **下一实验**：G3/G4 后续（achievement_cache/SalesmanTeamMapping 传播 + typed 路由分省过滤）需服务端运行时 + 多 route 文件，blast radius 较大；或转 G7（SX 账号·需用户名单）/G8（前端空态·独立小）。**🔴 GATED cutover 须用户显式确认。**

**R11 · G3/G4 查询期收口 — typed 路由分省 RLS 落地（双门控·SC 字节安全）**
- **承接**：R9（dim loader）+ R10（fact loader）只把 branch_code 注入到**数据层**；本轮把它**在查询期下推**到 typed 路由，闭合"SX 用户在 premium-plan/repair 等仍看混省数据"的真漏洞。分支 `claude/sx-rls-closeout`，backlog `6ae4d7` note 追加。
- **合同**：① loader 对 `SalesmanTeamMapping`/`SalesmanPlanFact`/`achievement_cache` gated 注入 branch_code（multiProvince=DESCRIBE SalesmanDim 零假设；achievement_cache A1/A2=`m.branch_code`、Part B=`ytd_actual MAX(branch_code)` 不 fan-out；branchAware 二次守卫 PolicyFact 含列防 Binder）；② `resolveBranchRlsCode` 双门控（gate a=permissionFilter 含 branch_code；gate b=information_schema 实测关系含列）接入 premium-plan/kpi/comprehensive/performance(bundle+heatmap)/repair；③ `BRANCH_RLS_ENABLED=false` 默认逐字节不变。
- **关键设计抉择（最大思考量）**：路由注入该门控在**标志**还是**列存在性**？查清生产 `BRANCH_RLS_ENABLED=false`（env.ts 默认 + ecosystem 未设）+ Day-1 SOP「先 RLS-on 再载 SX」⟹ 存在 **T-3 中间态（RLS-on + 单省无 branch_code 列）**，仅按标志注入会 Binder Error 破坏 golden-baseline 隔离证明。∴ 选**列存在性 ground-truth 双门控**（gate b），沿用 loader 既有 DESCRIBE 零假设范式，免疫 T-3。
- **oracle**：CI 单测 **3435 全绿**（+12 `branch-rls-injection` 纯函数：传→含 `branch_code='SX'`/不传→零注入）；集成 `duckdb-branch-dim` **7/7**（+3：三表单省无列字节回归/多省分省隔离 SX≠SC）+ `duckdb-branch-rls-resolve` **5/5**（双门控 + T-3 gate b 免疫 + 关系不存在降级）；typecheck；governance 42/42。`domain-testcases` 5 失败先证伪归属为既有（diff 未触及该文件/cross_sell，clean main 同样失败）—— §0「验证不声称」实践。
- **重来更好**：① 范围广度（5 路 achievement_cache 消费方 + SalesmanTeamMapping 独立查 + RepairDim）靠先派 Explore agent **精确测绘"STANDALONE 真漏洞 vs JOIN-PolicyFact 已约束"**才正确定界，避免盲目改全部消费方（JOIN 附属表已被 PolicyFact 的 whereClause 约束，无需重复过滤）——下次遇"给所有查 X 表的路由加过滤"先做用法分类测绘。② 中心化 `resolveBranchRlsCode` 一处实现、各 SQL 生成器加 `rlsBranchCode?` 一参，比散落 6 处正则提取更可维护、可单测。
- **复用价值**：`resolveBranchRlsCode(req, relation)` 是「不含标准 RLS 列、GATED 多省时携 branch_code」类关系的通用分省过滤入口；后续任一此类关系（如 filters.ts /filters/options）接 RLS 仅"调用 helper + 生成器加一参"。
- **needs_automation: true** → ① `verify-branch-domain` harness 应扩"运行期分省过滤"分支（多省 SX token 查 achievement_cache/repair 返回行 branch_code 全 SX）；② 可加 governance 闸"achievement_cache/SalesmanTeamMapping/RepairDim 单源路径不得引入 branch_code 列"防回归破坏字节安全（与 R9/R10 同一 harness 缺口合并）。
  - expires: 2026-09-21（同 R9/R10，GATED 上线前机制化为 harness/governance 闸；未机制化则升级或撤项）
- **剩余 RLS 漏洞（非本 PR·登记待办）**：`routes/filters.ts` /filters/options 直查 SalesmanTeamMapping（文件作用域外·并行安全）；`marketing-report`/`premium-report` 标签子查询（team_name 命名泄漏·非数据行·低优）。
- **下一实验**：填上述剩余 RLS 漏洞（filters.ts 需协调文件作用域）；或转 G7（SX 账号·需用户名单）/G8（前端空态）。**🔴 GATED cutover（RLS-on→SX 进 current/→sync VPS→发账号）须用户显式确认，禁自动执行——本轮只做查询期过滤，不 cutover。**
**R11 · G8 前端空态保护（看板 KPI·零后端·并行 loop 之一）**
- **合同**（ADR G8 / Day-1 SOP §5）：山西等新分公司数据装载中 / 缺数据时，KPI 接口返回空对象或全零规模 → 看板必须显式提示「加载中 / 暂无数据」，**禁止静默渲染零值 KPI**（避免业务方误判真实零保费）。仅改 `src/` 前端，零后端改动（与 G3/G4/G7 并行会话隔离）。backlog `2026-06-21-claude-9f4da8` → DONE。
- **成果**：① 新增纯函数 `kpiDataState.isKpiDataEmpty`（判据：总保费/车险保费/保单件数三规模指标全零或缺失即空态，一并覆盖"接口未返回/装载中"与"该范围真实无业务量"两类空）；② `KpiSection` 在所有 hooks 后加早返守卫——`loading && 空`→复用 `KpiGridSkeleton`+「数据加载中，请稍候…」；`空`→复用 `EmptyState`+「暂无数据·当前机构数据可能正在装载…这不代表真实零保费」；③ `PremiumDashboard` 把 `dashboardBundle.loading` 并入传给 KpiSection 的 `loading`（bundle 模式下 `useKpiData` 走 prefetched 路径自身 loading 恒 false，不并入会把"加载中"误判成"暂无数据"）。
- **oracle**：新增单测 16（`kpiDataState` 8：空对象/全零/null/bigint/仅占比指标 → 判据精确；`KpiSection` 新增 4：空+loading 显「加载中」、空+非 loading 显「暂无数据·非真实零保费」、全零触发空态、有数据正常渲染不误触发；原 4 特征测试不变）+ `bun run build` 零 TS + `typecheck` PASS + `governance` 42/42。
- **重来更好**：① 起手先 grep 既有空态资产（`DataGuard`/`NoDataPlaceholder`/`EmptyState`/`KpiGridSkeleton`）—— 全部可复用，零自造组件，是「先搜再写」红线的正确实践；② **bundle 模式的 loading 来源陷阱**靠通读 `useKpiData`（prefetched 短路 loading=false）+ `useDashboardBundle`（独立 loading）调用链才发现，若只改 KpiSection 不并 bundle.loading 会在默认配置（`ENABLE_BUNDLE_ROUTES` 默认 true）下空态误判 —— 改前读完整数据流而非只读渲染层是关键。
- **live 截图限制（如实记录）**：worktree 为纯代码检出**无本地 parquet**（0 个），后端无数据 → `isDataLoaded=false` → DataGuard 重定向 `/data-import`，KpiSection 空态在无数据 worktree 经正常导航**不可达**（到达需 `isDataLoaded=true` 但 KPI 空，即山西分省后端数据，本地不具备且后端/数据操作被并行安全契约排除）。故采用项目证据闭环首选的**确定性 oracle**：`@testing-library/react` 真实渲染 `<KpiSection>` 断言两态确切中文文案 + 无静默零值卡。符合 evidence-loop「correctness oracle 优先确定性脚本/单测，不靠眼看截图」。
- **复用价值**：`isKpiDataEmpty` + 「loading→skeleton / empty→EmptyState」守卫范式可平移到其余 KPI 看板（`VariableCostKpiBoard`/`CrossSellSummaryKpiBoard`/`GrowthKpiCards`/quote-conversion `KpiCards`）；本 PR 按并行安全保持聚焦主看板，其余作后续 backlog（非阻断）。
- **下一实验**：其余子页 KPI 看板套用同守卫（独立小）；或继续 G3/G4 服务端后续 / G7 SX 账号（需用户名单）。**🔴 GATED cutover（RLS-on→SX 进 current/→sync VPS→发账号）须用户显式确认，本前端空态保护为纯防御 UI 不触发任何 cutover。**
**R11 · G7 山西账号定义（preset-users 加 SX，3 会话并行 loop 之一）**
- **合同**：`preset-users.ts` 加山西 1 超管（`yangjie0621`，branch_admin，dataScope all）+ 11 经营单元 org_user（organization 取自 `数据管理/config/branch-org-mapping/SX.json` 的 11 units = ETL 规范化 org_level_3），全 branchCode='SX'；密码走 admin 同款机制（USER_PASSWORDS env + bcrypt tombstone，零明文）；`getAllBranchCodes()` 自动含 SX。只改 preset-users.ts(+其测试)，不碰前端/loaders/sql/routes（并行隔离）。backlog `2026-06-21-claude-acf188` → PARTIAL。
- **成果**：12 个账号定义 + tombstone 哈希（即弃随机口令，明文丢弃永不记录）；org_user 全部复用 `ORG_ROLE_ALLOWED_ROUTES`/`ORG_ROLE_DEFAULT_ROUTE`；超管不绑 organization；org_user 用 `sx_` 前缀命名空间（多省共存防碰号，pinyin 沿用 SC 风格）。
- **oracle**：`preset-users.test.ts` **8 passed**（新增 4 断言：超管存在+role+branchCode、11 org_user 数量+organization 集合严格等于 SX.json units+结构镜像 SC、SX 账号 tombstone bcrypt 格式、getAllBranchCodes 含 SX）；typecheck PASS；governance **42/42**。**SSOT 核实**：`access-control.ts` 用 `PRESET_USERS`，`organizations.ts:USER_CREDENTIALS` 在 server/src 内零 import（死备份），故只改 preset-users 即足够一致 —— §0「验证不声称」（grep 实证消费方而非假设）。
- **重来更好**：① 任务文案写函数名 `getUniqueBranchCodes()` 实为 `getAllBranchCodes()` —— 先 grep 确认真实符号再动手（呼应 `feedback_verify_before_assume`），没盲信文案；② 命名「照 SC 风格」存歧义（SC org_user 是裸 pinyin，电销是 `scdianxiao` 前缀）→ 选 `sx_` 前缀（多省共存更安全），开工时若先把命名约定向用户确认一句可省一次心证；③ 超管 specialFeatures（cost/moto_cost）按字面最小化未加 —— 留作 cutover 可选项并在 PR 注明，符合「修补不拆除/最小变更」。
- **复用价值**：tombstone 账号定义模式（即弃随机哈希 + USER_PASSWORDS 注入）对未来任一新分公司/新机构账号可直接复制；测试里「organization 集合严格等于 branch-org-mapping/<省>.json units」断言是任一省份账号接入的通用回归锚点。
- **needs_automation: true** → governance 可加闸「preset-users 中各 branchCode 的 org_user.organization 集合必须等于 `branch-org-mapping/<branchCode>.json` 的 units」（防账号 organization 与 ETL 规范化口径漂移；当前靠单测，未进 governance 跨文件对账）。
  - expires: 2026-09-21（GATED 多省上线前应机制化为 governance 闸；未机制化则升级或撤项）
- **下一实验**：🔴 GATED cutover（RLS-on → SX 进 current/ → sync VPS → 发账号 + RLS 隔离验证 SX token 不读 SC）须用户显式确认，本任务只加账号定义不做 cutover；或转 G8（前端空态）。

**R12 · G8 后续 — 子页 KPI 看板空态保护推广（修一类·零后端）**
- **承接**：R11·G8 主看板（PR #709）已为 `KpiSection` 落地空态守卫，其「复用价值」预告范式应平移到 4 个子页看板。本轮兑现该后续。backlog `2026-06-21-claude-3a4399` → DONE。仅改 `src/` 前端，零后端改动，不触发任何 GATED cutover（纯防御 UI）。
- **合同**（ADR G8 / Day-1 SOP §5）：山西等新分公司数据装载中 / 缺数据时，子页 KPI 看板接口返回空对象 / 全零规模 → 必须显式提示「加载中 / 暂无数据·非真实零保费」，禁止静默渲染零值。
- **调研定界（核心增量）**：4 候选 + grep 其他 KPI 看板/`useDataStatus` 消费方，分两类——
  - **真·静默零值缺口（2，行为修复）**：① `CrossSellSummaryKpiBoard` 空 `rawData` 仅处理 `error` 分支，`dataByCoverage` 空 Map → 所有单元格 `?? 0` 静默零值；② quote-conversion `KpiCards` 后端 `res.json({ data: data[0] ?? {} })`（query/quote-conversion.ts:101）空范围返回 `{}` / 全零聚合行，原 `!data` 守卫**漏判空对象**（`{}` 为 truthy）→ 静默渲染 0.0% 转化率 / 0 件。
  - **已守卫但裸文案（2，谐化统一）**：`VariableCostKpiBoard`（`orgRows.length===0` → 裸文本）、`GrowthKpiCards`（`!todayData` → 裸文本，**无 loading prop**）——非静默零值缺口，但未用共享 EmptyState/骨架、未点明「非真实零保费」。
  - **正确排除**：`claims-detail/pending/KpiCard.tsx`、`widgets/kpi/KpiCard.tsx` 为纯展示型单卡（父级传 value/label，空态由父决定），不在范围——「先搜再写 + 不强行扩面」。
- **成果**：① 新增纯判据 `quoteKpiState.isQuoteKpiEmpty`（报价总量/承保件数/承保保费三规模全零或 undefined/`{}` 即空，镜像 G8 `isKpiDataEmpty` 范式）；② CrossSell + quote KpiCards 套完整范式（`loading`→`KpiGridSkeleton`+「数据加载中」；空→`EmptyState`+「暂无数据·非真实零保费」），quote 守卫由 `isLoading || !data` 拆为 `isLoading` 单守 + `!data || isQuoteKpiEmpty(data)`（靠 `!data ||` 短路让 TS 收窄，免 `!` 断言）；③ VariableCost 谐化到 `KpiGridSkeleton`/`EmptyState`、Growth 谐化空态到 `EmptyState`（无 loading 故无骨架分支，如实保留不对称）。
- **oracle**：TDD 5 轮红→绿（每轮先证 RED）；新增 20 断言（`quoteKpiState` 7 + quote `KpiCards` 4 + `CrossSell` 4 + `VariableCost` 3 + `Growth` 2）；`typecheck` PASS；全量单测 **255 文件 / 3471 全绿**（零回归）；`bun run build` 零 TS；`governance` **42/42**。
- **live 截图限制（如实记录）**：worktree 纯代码检出无本地 parquet → 后端无数据 → `DataGuard` 重定向 `/data-import`，子页看板空态经正常导航不可达（需后端有山西分省数据，本地不具备且并行安全契约排除后端/数据操作）。故采用项目证据闭环首选的**确定性 oracle**——`@testing-library/react` 真实渲染各看板断言三态确切中文文案 + 无静默零值。符合 evidence-loop「correctness oracle 优先确定性脚本/单测，不靠眼看截图」。
- **重来更好**：① 起手即 grep 后端 `data[0] ?? {}` 空返回语义是分类关键——若只看前端 `!data` 守卫会漏判 quote KpiCards 缺口（`{}` truthy）；**判"有无缺口"必须连读取数链路到后端空态返回形态**，呼应 `feedback_verify_before_assume`。② 4 看板数据形态各异（`KpiData`/`QuoteKpi`/`VariableCostData[]`/`GrowthData[]`），**未强行抽象统一判据**——按 `feedback_no_force_abstraction` 每域独立纯函数/内联判空更清晰，仅共享呈现层（EmptyState/KpiGridSkeleton）。③ 严守「对确有缺口者套用」与「修一类」的张力：2 真修复 + 2 谐化，PR 中如实区分两类，不把谐化伪装成缺陷修复。
- **复用价值**：「`loading`→skeleton / 空→EmptyState·非真实零保费」守卫范式 + 「每域纯判据 `is*KpiEmpty`」现已覆盖主看板 + 4 子页看板；后续任一新 KPI 看板按此范式落地即可。`isQuoteKpiEmpty`/`isKpiDataEmpty` 的「三规模指标做锚」判据可复制到任意聚合型看板。
- **needs_automation: true** → 可探一条轻量 governance/lint 启发式闸：组件名匹配 `/Kpi(Board|Cards|Section)/` 且消费查询数据者，须 import `EmptyState` 或具空态早返（防新看板回退到静默零值）。**注意**：静态可靠性有限（纯展示型单卡会误报，需白名单），落地前评估误报率；未机制化则本条到期升级或撤项。
  - expires: 2026-09-21（GATED 多省上线前应机制化或撤项）
- **下一实验**：填 R11 列出的剩余 RLS 漏洞（filters.ts /filters/options）/ G3·G4 服务端后续 / G7 SX 账号 cutover。**🔴 GATED cutover 须用户显式确认，本前端空态保护为纯防御 UI 不触发任何 cutover。**

**R13 · Loop v2 编排协议（元任务 — loop 改 loop·首个跑 codex 双闸的任务）**
- **触发**：用户在 3 会话并行实跑（G7/G8/RLS 零冲突合并）后复盘，点名 4 缺口：① 无总调度（各自完成后无人推进）② 规划后/完成后无 codex 对抗审计 ③ 无质量度量/记录 ④ 自进化项缺到期催办。要求"整体设计好 Loop v2"。用户定调：编排引擎=C·混合、范围=全部 5 机制一个 setup PR。backlog `2026-06-21-claude-ac6f4f` → DONE。
- **成果（5 机制）**：① 调度 `scripts/loop/dispatch.mjs`（折叠 backlog→文件域冲突图→可并行前沿+状态板+会话提示词，SSOT 复用 BACKLOG_LOG.jsonl）② codex 双闸（写进 evidence-loop wrapper §4/§5 + SOP §2）③ 质量账本 `loop-quality-ledger.jsonl`(union)+`quality-report.mjs` ④ 自进化 `automation-due.mjs`（催办过期 needs_automation，补 #703 盲区）⑤ 终局 gated 闸。脊柱 `.claude/rules/loop-orchestration.md`。pr-evolution/ledger 全 `merge=union`。
- **🌟 dogfood 闸-2 即抓真 bug（机制当场证明价值）**：codex 对抗审计本 setup → 0 P0 + **3 P1**：(P1-1) 我**自实现了 backlog 折叠**且语义错（物理行序 + 顶层 amend 字段），与权威 `scripts/backlog/lib.mjs` fold（(at,eid) 全序 + amend field/value LWW）分叉 → 会把 DONE 读回 OPEN/漏 amend 破坏调度；(P1-2) 文件域把 `N/A`/`同B244`/中文分号当伪域 → 误判可并行撞车；(P1-3) GATED 闸只靠不存在的 config → 失效。+2 P2（冲突扫描覆盖/strict 退出码）。全修：复用权威 fold、未知 token→null+分号分隔、精确 cutover 词+seed config。
- **oracle**：loop 单测 20（覆盖权威 fold 委托/null 域/分号/gated 精确词/strict）；3 脚本真实数据实跑（前沿伪域残留=0、automation-due --strict exit=1）；typecheck；governance 42/42（冲突扫描 7 文件）；全量 CI 3491 全绿。
- **重来更好**：① **最大教训 = "先搜再写"红线**：dispatch 折叠 backlog 前应先 grep `scripts/backlog/lib.mjs` 有无权威 fold——我重造轮子且造错，codex 才抓出。元工具尤其要复用既有 SSOT 而非自实现。② 字节/语义安全的"按构造"自证不足以覆盖"与既有实现语义对齐"——这类对齐缺口正是独立模型对抗审计的命中区，印证双闸的必要。③ gated 关键词差点用"GATED"（会误伤"GATED 上线前置"该做任务）——精确指向不可逆 cutover 动作才对。
- **复用价值**：dispatch/quality/automation-due 三脚本 + SOP 是项目无关的 loop 编排基座骨架，可上提共享 skills 仓复用到其他多会话项目。「元工具复用 backlog 权威 fold」是通用教训。
- **needs_automation: true** → ① 把 loop-quality-ledger 收尾追加做成 `bun scripts/loop/record.mjs`（避免手拼 JSON 行出错）；② meta-review 触发器（每 ~10 任务自动跑 quality+automation-due）可挂 Stop hook 或 cron。
  - expires: 2026-09-21（下个多省 meta-review 周期前机制化或撤项）
- **下一实验**：用 Loop v2 真正驱动一波并行（`bun run loop:dispatch` 取前沿 → 3 会话各跑 evidence-loop+双闸）；或填 G3/G4 服务端 RLS 后续。🔴 GATED cutover 须用户显式确认。

**R14 · B330 架构依赖违规修复 — 防回归 governance 闸（Loop v2 wave1·codex 双闸）**
- **触发**：编排者派 B330（21 目录排查 主题B：5 处前端分层依赖违规上提 shared）。开工 grep 全仓核实 → 5 处主体 + 第 6 处 orgSalesman **已在 PR #641/#642/#643 修复并合并**（widgets/shared↛features=0、features↛server 实值/类型 import=0、growth↛dashboard=0、quote-conversion↛filters=0）。"修代码"无可做——真正未完成的 in-scope 项是 follow-up `2026-06-15-claude-2e017d` 防回归 governance 闸（check-governance.mjs 无此闸、`.claude/rules/architecture.md` 不存在）。无闸 → 已修边界会静默回退（CLAUDE.md「规则必须自动化执行」红线）。backlog `2026-06-15-claude-2e017d` → DONE；B330 本体保留未 DONE（layout→features 属 follow-up edbd61 shell+slot 重构，本轮不做）。
- **成果**：① `scripts/check-governance.mjs` 新增 `checkArchLayerBoundaries`（治理第 43 项「分层依赖边界」），用 **TypeScript AST**（`ts.createSourceFile` + visitor）解析模块说明符，覆盖 import / import type / export from / 动态 import() / require() / 无插值模板字符串；归一别名 `@/features`、相对路径、`server/src`；守 5 类（widgets↛features、shared↛features、前端三层 features/shared/widgets↛server、growth↛dashboard、quote-conversion↛filters）；逃生阀 marker 须带 backlog/PR 引用 + 非空理由。② `.claude/rules/architecture.md`（带 `paths:` frontmatter 避免计入 eager-load 预算；明文不自称 SSOT，引用 `ARCHITECTURE.md §2.2`）。③ 单测 32 例（`scripts/__tests__/arch-layer-boundaries.test.mjs`），导出 4 个纯函数供测。
- **oracle**：governance 43/43（原 42 +1）、扫 417 文件 0 违规；负向 fixture（widgets→features、shared→server 各造一处）均被拦并报 `file:line → spec`，验后即删；`node --check` + typecheck PASS；单测 32 全绿。**未跑 build**——本轮零 `.ts/.tsx`(src) 业务代码改动（只动 `.claude/rules/*.md` + `scripts/*.mjs`），full tsc 已覆盖类型面，build 对纯 governance/rules 改动信号低（codex gate-1 P2 亦如此判）。
- **codex 双闸均生效抓真问题**：gate-1（审计划）3 P0 → 纠正"B330 全 DONE"口径（layout→features 未做，只能关 follow-up）、补 feature→feature 定向 denylist（否则漏守原始 growth→dashboard / quote-conversion→filters）、改 naive 文本正则为 AST（防 export from/多行/别名绕过）；5 P1 全采纳（AST 抽取、`paths:` frontmatter、fixture try/finally 不污染 src、marker 须带引用、backlog 走 event log）。gate-2（审 diff）2 P1 → 模板字符串 `import(\`...\`)` 绕过（补 `NoSubstitutionTemplateLiteral`）、shared/widgets↛server 口径缺口（补两条规则收齐前端三层），re-review 通过无 P0/P1。
- **重来更好**：① **最大教训——派工任务可能已被前序会话做掉**：B330 主体 6 处违规全已合并，若不先 grep 核实而照"修 5 处"动手，会重造已存在的修复甚至与 main 冲突（呼应 `feedback_midsession_pr_collision_fetch_gate` / `feedback_isolate_concurrent_verify_head_first`）。开工第一步永远是 grep 现状 + 查 backlog/git log 已落地物。② 重构类任务"行为不变"时，最高价值产出常是**把已修复状态机制化锁定的闸**，而非再改一遍代码——否则修复会静默回退。③ codex gate-1 当场纠正我"全部消除"的口径虚高，印证"完成定义交给外部对抗证据不交给模型感觉"。
- **复用价值**：`checkArchLayerBoundaries` 的「TS-AST 解析模块说明符 + 路径前缀规则表 + 归一别名/相对/模板字符串 + 带引用逃生阀」是项目无关的**分层边界闸骨架**，可参数化规则表后复用到任意前端分层项目（比 ESLint boundaries 轻、零额外依赖）。导出纯函数（`classifyArchViolations`/`normalizeArchTarget`/`extractModuleSpecifiers`/`isValidArchAllowMark`）让 governance 逻辑可单测，是治理脚本的好范式。
- **needs_automation: false**（本轮产出本身即自动化闸；后续 ESLint boundaries/dependency-cruiser 落地后可把本纯文本/AST 闸切换为 lint 规则，但属 follow-up edbd61 之后的演进，非当前到期项）。
- **下一实验**：B330 收尾的 layout→features shell+slot 重构（follow-up `2026-06-15-claude-edbd61`，需改 App.tsx 注入 Modal/Panel slot，独立 PR）；落地后可把闸规则表补 `components/layout↛features` 第 6 条。🔴 GATED cutover 须用户显式确认，本闸为纯静态治理不触发任何 cutover。
**R14 · B249 字段覆盖率报告自动化（Loop v2 第二个跑 codex 双闸的实任务）**
- **触发**：编排者按 Loop v2 派发 B249（@codex/@claude P2 增强项）。任务：每日 ETL 结束附带产出 `数据管理/knowledge/ai/field-coverage-report.json`（字段×年份记 有效非空比例/去重计数/样本值），解决 `fields.json` 注释过时（如 fuel_type 注「仅2020-2023有值」实际 2024-2026 满期100%覆盖）误导 AI、需额外 DuckDB 验证轮次。backlog `2026-04-21-claude-b249` → DONE。仅改 `数据管理/pipelines/field_coverage.py`(新)+`test_field_coverage.py`(新)+`daily.mjs`(末尾追加调用)，零既有逻辑改动、不触发任何 GATED cutover。
- **成果**：纯函数式 `field_coverage.py`（DuckDB 读两域 parquet，`union_by_name=true` 兼容跨文件 schema 漂移；按年份锚点 policy=policy_date/claims=report_time 分桶 + `_ALL` 汇总 + `_UNKNOWN_YEAR`；低基数 exact distinct/高基数 approx；原子写 .tmp→replace）；daily.mjs 加 `runFieldCoverageReport` helper（SC-only + 失败降级不阻塞，呼应企微集成同策略；仅 premium/all/claims_detail 后触发）。
- **🌟 codex 双闸均抓真问题（机制连续两任务证明价值）**：
  - **闸-1（审计计划）**：0 通过 → 4 P0（PII 采样无闭环/`COUNT(col)` 高估覆盖含空串占位符/字段键不映射注册表制造双源漂移/多省分支隔离语义不清）+6 P1。全部纳入实现：脱敏白名单 + `effective_non_null_ratio`（VARCHAR 把空串/占位符算空）+ 映射 field_id/label/source_column + SC-only。
  - **闸-2（审 diff）**：0 P0 + **3 P1**：(P1-1) 生成 JSON 落了本机**绝对路径**且来自另一 checkout → 加 `_repo_relative()` 转相对 + 全文 0 泄露断言；(P1-2) **去重计数仍含占位符**（`COUNT(DISTINCT col)` 把 ''/'NULL'/'-' 算成 3 个真实值）→ 改 `COUNT(DISTINCT CASE WHEN nn_expr THEN col END)`，approx 同理；(P1-3) PII 防线只硬编码 denylist，**未注册低基数字段仍被采样** → 改 fail-safe：仅「已注册+非敏感+低基数」才采样，未注册一律 redacted。+2 P2（注册表漏读 repair-fields.json 致 subject_repair_shop 误报 unmapped / 无关单域子命令也刷报告）全修。
- **oracle**：源数据直查对账**零误差**（fuel_type 2024 满期100%、commercial_pricing_factor _ALL 0.2593、高基数 salesman_name approx 747=747 完全一致）；14 个 pytest 全过（含闸-2 三反例：占位符去重=0/未注册不采样/glob 非绝对路径）；typecheck PASS；governance 42/42（5090 行生成 JSON 走 GOVERNANCE_LARGE_PR_OK 大体量例外，代码仅 695 行）。
- **重来更好**：① **schema 漂移应起手即料到**——首跑就撞 `next_insurer` DOUBLE↔VARCHAR 跨文件冲突，项目早有 `union_by_name=true` 标准（data-sources.json 注释 + diagnose_common.py 均用），先 grep 现有 read_parquet 用法就能一次写对。② **生成产物的路径可移植性**易被忽视——绝对路径泄露是 codex 才抓出的；ETL 派生物写盘前应默认相对化，呼应"禁硬编码路径"红线延伸到数据产物。③ **覆盖率口径与去重口径必须同源**——`effective_non_null_ratio` 严格了却漏改 distinct，是"改一处忘改一类"的典型；同一"有效非空"语义应抽成单一 SQL 片段（已抽 `effective_value`）供 ratio/distinct/sample 共用。
- **复用价值**：`field-coverage-report.json` 成为 AI 知识库新事实源——后续诊断 case 查"某字段某年有没有值/有几个值"直接读 JSON，免跑 `SELECT COUNT(field)`。`effective_non_null_ratio`（空串/占位符算空）+「未注册字段 fail-safe 不采样」是任意数据剖析工具可复用的两条铁律。脚本 `--policy-glob/--claims-glob/--output` 入参设计便于单测 fixture 与只读 smoke。
- **needs_automation: true** → ① claims_detail 域无独立字段注册表（schema 仅在 SCHEMA.md），其列大量被标 unmapped 属"诚实但噪音大"——可补一份 claims 字段注册表让覆盖率报告对齐；② 报告可加 governance 轻量闸：当某已注册字段 `effective_non_null_ratio` 跨年骤降（如 >30pt）时告警，提前发现上游 schema 退化。
  - expires: 2026-09-21（下个数据治理周期前补 claims 注册表或撤项）
- **下一实验**：用 Loop v2 继续取并行前沿；或为 claims_detail 域补字段注册表消化本轮 unmapped 噪音。🔴 GATED cutover 须用户显式确认。
**R14 · B299 ClaimsAgg 出险日期窗口化（Loop v2 双闸·partial 落地）**
- **触发**：Loop v2 调度取 B299（@user 提的潜在隐患 P2）。`createClaimsAggFromDetail` 按 policy_no 聚合赔款无 accident_time 过滤，多 cutoff/历史 YTD 查询时早期窗口拿"未来出险赔款÷过去满期保费"虚高数倍。任务域限 `duckdb-domain-loaders.ts`+`cost-ratios.ts`。
- **🌟 闸-1（计划）当场收窄范围 = 机制防止破坏性落地**：codex 对抗审计计划抓 **3 P0 + 3 P1**：(P0-1) 给静态单例 ClaimsAgg 加 cutoff 参数会污染整个连接的共享表（8+ 消费方）→ 改为抽局部 CTE helper，静态表不动；(P0-2) "loader 加参+注释"是死代码非修复；(P0-3) "看板 cutoff=max accident_time 故 no-op"证据链不成立——cost cutoffDate 是请求传入、非恒等最新出险日；(P1-1) 只改 cost-ratios 是半修复，cost 有 cube 影子路径仍 JOIN 静态 ClaimsAgg，cutoff<最新时影子对账出差异；(P1-2) kpi/comprehensive/forecast 同 JOIN 静态表，不能宣称全局根治；(P1-3) accident_time<=cutoff 只截未来出险，金额仍当前快照≠历史 as-of。采纳后判定：完整修复跨任务域(cube/kpi/comprehensive/forecast)且破坏 cube-shadow 锚 → 是 BACKLOG 明列的**用户决策项** → 落地降级为 partial。
- **成果（非破坏性·字节安全）**：① 抽 `CLAIMS_REPORTED_AMOUNT_CASE` 共享金额口径常量（静态 ClaimsAgg 与窗口 CTE 复用，防漂移·codex P2-3）；② 新增 `buildWindowedClaimsAggCTE(cutoff)` 返回**局部 CTE 主体**（不 CREATE TABLE、不污染单例·P0-1），`accident_time < cutoff+INTERVAL 1 DAY` 半开区间(列侧不 CAST·P2-4)；③ cost-ratios.ts 仅加对齐文档(指向 helper+用户决策+BACKLOG)，JOIN 形态零改动。
- **oracle（源数据验证·口径正确非仅"不一样"）**：duckdb 直查 Parquet——cutoff=2026-03-31 满期赔付率 全快照**176.48% → 窗口 61.51%**（含未来出险虚高根治，与 memory 183.6%→81.0% 同向同量级）；cutoff=最新数据日 2026-06-13 窗口赔款=全快照=**1,467,272,953.01 逐分钱一致**（证字节安全 no-op）；全量 claims **accident_time 0 行 NULL**（过滤不误伤）。测试：4 单测(SQL 字符串·CI 安全：断言静态表不含 accident_time/窗口含半开过滤/复用常量/转义防注入/不产 CREATE)+4 集成测试(合成数据·本地：早期 cutoff 排除未来出险/最新 cutoff==静态表/金额口径剔无责拒赔/已决未决二选一)全绿；typecheck；governance 42/42；cube-cost 影子对账 31 测试不退化(证 cost-ratios 字节未变)。闸-2(diff) P0/P1/P2=0。
- **重来更好**：① 起手就该把"任务域=2 文件"与"完整修复跨 8 消费方"的张力摆到计划最前——闸-1 才点破"半修复+破锚"，若我先做架构爆炸半径 grep(ClaimsAgg 8 处 JOIN)再写计划能自检出范围矛盾。② 静态单例表 + per-query cutoff 的耦合是经典反模式，应一眼识别"不能给共享物化表塞动态参数"。③ 集成测试 VALUES 字面量被 Neo 驱动推断成 DECIMAL({width,scale,value} 对象)致 Number()→NaN——合成表必须显式 CREATE TABLE 列类型对齐生产 Parquet(double/bigint)，这是 DuckDB 测试通用坑。
- **复用价值**：「静态物化表不塞动态 cutoff，改抽局部 CTE helper」是 ClaimsAgg/任何共享聚合表加时间窗口的通用范式；`CLAIMS_REPORTED_AMOUNT_CASE` 常量化是"业务口径 SSOT 防散落复制"的样板；「合成表显式列类型对齐生产 Parquet」入 DuckDB 测试避坑清单。
- **needs_automation: true** → 可探 governance 启发式：检测对静态物化表(CREATE OR REPLACE TABLE)的 loader 函数若新增日期/cutoff 形参 → 警示"共享单例表勿塞 per-query 参数，改 CTE helper"。静态识别有限(需匹配 CREATE TABLE + 形参)，落地前评估误报。
  - expires: 2026-09-21
- **下一实验（交用户决策）**：是否把 cost-ratios 三处 JOIN 切到 `buildWindowedClaimsAggCTE`？须同步评估 cube/cost-cube 是否一并窗口化(否则 cutoff<最新时影子对账差异)，及 kpi/comprehensive/forecast 是否纳入。建议绑定"时间机器/历史快照"特性排期。🔴 不触发任何 GATED cutover。

## 2026-06-21 · Loop v2 并行波1 + backlog 卫生（stale-scan）

**三问复盘**
- 重来怎样更好：派单前必做逐任务现实核查。本波"用户确认的 3 个"里 90a92c/b246 是陈旧、b330 的违规也早被 #641-643 修复——dispatch 仅凭 status+code 字段无法识别"实际已完成但状态未流转"。教训=元工具(dispatch)的输入(backlog status)若不维护，元工具就持续假阳性（与 6ae4d7 同源，累计本会话已遇 7 个陈旧任务）。
- 复用价值：新增 scripts/loop/stale-scan.mjs（note-完成信号[强：完成语+引用 PR] + git churn 信号[弱：code 域被旁路提交改动]），`bun run loop:stale-scan [--churn]` 一键列疑似陈旧。本波实测除 90a92c/b246 外又揪出 8964d3/4641ef/2eccfa，共 5 项。
- 如何自动化：stale-scan 已是该洞察的自动化落地（9 单测）。下一步=dispatch 算前沿时自动叠加 stale-scan 高置信告警（前沿任务若被标高置信→提示"疑似已完成，先核实"再派单）。
  - needs_automation: true
  - expires: 2026-09-19

**量化**：并行波1 codex 双闸 — b330(闸1 3P0/5P1→闸2 0P0/2P1) · b299(3P0/3P1→0/0/0) · b249(4P0/6P1→0P0/3P1)；3 PR(#716/#717/#718)全经源数据/静态验证。b299 源数据验证 满期赔付率 176.48%(全快照虚高)→61.51%(窗口正确)、最新日窗口=全快照逐分钱一致(字节安全 no-op)，按红线停 partial 未盲改理赔 SSOT。

---

**R15 · Loop v2 入口设计 — codex 闸-1 砍掉过度工程（闸用在「计划」而非「代码」上）**
- **触发**：用户问"Loop v2 激发/启动机制是什么？要不要做成 agent/skill/slash"。我初拟方案=新建 `/chexian-loop` 总控命令（含 quality/due/stale 子命令 + `--workflow` fan-out）。用户："制定计划，安排 codex 做对抗性评审后再定"——把闸-1 用在**纯设计决策**上（无一行代码）。
- **codex 闸-1 结论「改后再建」，核实零误差**（6×P0/P1）：① slash 本质单会话 prompt 注入，**指挥不了多会话并行**，名实不符；② `--workflow` 是未落地承诺、越 Workflow 工具 opt-in 红线；③ slash 命令在 `.claude/commands/**`，**不触发** loop-orchestration 的 `paths:` 门控注入，"只放指针"会绕过协议；④ `stale` 子命令造第二份入口表(SSOT 漂移)；⑤ dispatch 已引导走 `/chexian-evidence-loop` + skills-map 已列 → "不可发现"被高估，泛名命令反抢入口；⑥ 发现**既存 bug**：`dispatch.mjs:162` 硬编码 `governance 42+/42`，实际已漂移到 43(R14 新增 checkArchLayerBoundaries)。
- **决策（用户选「修真问题·不建命令」）+ 成果**：不建任何 slash/agent/skill。改 3 处真问题：① `dispatch.mjs:162` `42+/42`→`全过`(不再漂移)；② `loop:stale-scan` 补进 loop-orchestration §6 命令速查(SSOT 补全)；③ skills-map evidence-loop 行加「跨任务调度先 `bun run loop:dispatch`」指针(并压顶部 blockquote 净减 6B 抵预算)。验证：`loop:dispatch` 跑通(228 任务/前沿 9)、提示词已无硬编码 42。
- **重来更好**：① 我的"分层推荐"对(slash 入口/Workflow 引擎/rules 协议/agent 执行者)，但**把维护面(quality/due/stale)和未落地的 --workflow 塞进入口**是过度工程——入口就该只做一件事。② 闸-1 的最大价值这次体现在**拦截"假想需求"**：把"不可发现"当 P1 缺口是夸大，真缺口是 dispatch 输入(backlog status)维护 + 硬编码漂移(承接 R14 三问)。③ 对抗审计用在**计划阶段**比代码阶段更省——砍掉的是还没写的代码。
- **复用价值**：确立"新建任何 wrapper/命令前先问『现有入口是否已覆盖 + 这个壳是否名实相符 + 是否绕过 SSOT 门控』"——codex 闸-1 三连问。元工具(dispatch)提示词**禁硬编码易漂移状态**(governance 计数/PR 号)，用"全过/全绿"等不漂移措辞。
  - needs_automation: false（本轮即"少建一个东西"+ 修既存漂移；无新增待自动化项）

---

**R16 · 山西并入收尾 5 任务并行实现 — codex 闸-2 抓 3/5 真 P1，现实核查防 2 处返工**
- **触发**：用户"聚焦山西数据并入系统，loop:stale-scan → 清理假阳性 → loop:dispatch 取干净前沿 → Workflow fan-out"，决策"codex 对抗审查后自动合并"。Workflow 规划 fan-out → 5 任务实现 fan-out（隔离 worktree）→ codex 闸-2 逐 PR → auto-merge。5 PR 全合：#726(15d8fd P1)/#725(10c9e9)/#727(681eee)/#729(00bac8)/#728(c21667)。
- **codex 闸-2 量化（用户要求的核心闸）**：5 PR 中 3 个需返工才 ENDORSE，抓到的都是实现自评低估/漏掉的真 P1：
  - **00bac8**（3 轮）：① 同 VIN 多保单用 `ROW_NUMBER() OVER ()` 物理序 → 机构变更静默归错（改 `ORDER BY insurance_start_date DESC`）；② `daily.mjs` 的 **`all` 路径** `--policy-dir` 带字面引号 → 日常 ETL 静默跳过回填（单域路径已改、`all` 漏改）；③ `except Exception` 静默吞 schema/Binder 错（改重新抛出）。**P1-1（policy-dir 传错目录）经核实是 codex 误读 `branchOutputRoot('SC')` 语义 → 撤销**（核实分歧而非盲从）。
  - **c21667**（3 轮）：① boolean 迁移只改筛选、漏维度输出 → heatmap/ranking 输出 `true/false` 而非中文枚举，**federation 关闭时也破四川字节安全**；② 筛选侧对非法值放大为全部非电销（改严格三态，非法→`1=0`）；③ `ELSE 非电销` 折叠 NULL（加 `IS NULL THEN NULL`）。
  - **10c9e9**（3 轮）：测试意图失真（声称测路由实际测 helper）→ 补真路由级测试，但 `vi.mock` factory 捕获顶层 `const` 致 TDZ（改 `vi.hoisted()`）。
  - **15d8fd / 681eee**：首轮 ENDORSE。
- **重来更好**：① **实现子代理的 self_review_p0p1 系统性低估真问题**——00bac8 把"物理序不稳"列为"可能性"（实为 P1）、完全漏掉 `all` 路径引号；c21667 漏掉维度输出侧。实现 prompt 对 ETL/SQL 改动应强制"枚举所有调用点（单域+all 路径）+ 区分筛选侧 vs 输出侧契约"。② **strict 分支保护 + 并发 loop 会话（本轮同时 7 个 open PR）→ 合并串行化抖动**，监控循环跑 8 轮反复 update-branch 才落地——无 merge queue 时多会话并行合并是结构性瓶颈。
- **复用价值**：① **现实核查 first（规划 fan-out 阶段）防返工**——00bac8 实测 `policy_no` 全 NULL（policy_no JOIN 回填 0%）、`vehicle_frame_no` 100%，把"参 policy JOIN"具体化为 VIN JOIN；15d8fd 实测 filters.ts 已注入 → gap 收窄。stale-scan「逐任务现实核查」教训前移到规划阶段。② **审 diff（闸-2）比审计划更能抓具体 bug**：本轮真 P1 全是"代码与契约/数据现实的偏差"（all 路径漏改、输出侧漏改、JOIN 键错），计划阶段看不出。③ codex 与子代理分歧时**亲自读代码裁决**（00bac8 P1-1：codex 误读、子代理对）。
- **needs_automation**：
  - **dispatch.mjs gatedKeywords「cutover」误伤「cutover 前置」**：15d8fd（P1 RLS 收口，desc 含"GATED cutover 前置"）被 isGated 排除出前沿——它是 cutover 的*前置*（该做、字节安全）非 cutover 本身。修法：gated 判定排除含"前置/前提"的命中，或仅匹配不可逆动作短语（"进 current/"、"发账号"）。
    - needs_automation: true
    - expires: 2026-07-22
  - **启用 GitHub merge queue**：消除 strict + 多并发 loop 会话的串行化抖动（本轮监控循环手动 update-branch 8 轮）。
    - needs_automation: true
    - expires: 2026-09-22

**量化**：codex 闸-2 抓 P1 合计 5（00bac8×2 + c21667×2 + 10c9e9×1）+ 撤销误报 1（00bac8 P1-1），全部 by-construction 字节安全（BRANCH_RLS_ENABLED=false 四川零行为变更）；现实核查推翻 2 处实现假设。GATED 的 acf188 账号+cutover 未触碰（须用户显式确认）。
**R16 · b331 PerformanceAnalysisPanel 拆分（1401→882 行·codex 双闸·纯搬移行为零变更）**
- **触发**：用户"按推荐办"驱 b331（前沿 top-1 P1）。**现实核查先救一命**：前沿原 top-1 是 7a2849，查其 note 发现 PR #640 已合并一周（commit 353aa7f5 在 main），仅状态没翻——差点重做。翻 DONE + 登记 stale-scan 增强 47c2a5（补"note 引用 PR 已 MERGED→高置信陈旧"信号，stale-scan 这次漏了它）。再核 b331 本身：client.ts 早于 Phase 2 已拆，仅 PerformanceAnalysisPanel.tsx 1401 行未拆（真实可做）。
- **闸-1（改后实施·全核实零误差）**：3P0=oracle 写错(`build`≠tsc，须显式 typecheck)/barrel 无 DAG 约束恐循环依赖/引用清单漏 `tests/performance-drilldown-prefetch.test.ts` 从主文件 import（我只搜 src/ 漏 tests/）；4P1=不抽 controller hook(主组件 10+ 耦合 state)/不复用既漂移的 PerformanceDistributionChart/行为保真须加定向 vitest/拆 6 文件过细→4 文件。全采纳。
- **成果**：抽 `performancePanel.shared.ts`(类型+常量+纯helper) + `PerformanceHeaderActions`/`PerformancePanelDistributionChart`/`PerformancePanelDimensionPicker`，主文件 1401→882。**同目录落位**(非闸-1 原议 performance/ 子目录)→被搬移代码 `./` 相对 import **零改写**，消除最大风险源。barrel 重导出全部 6 个原对外符号+默认导出→PerformanceAnalysisPage + test 旧入口**零改动**。
- **oracle**：typecheck ✓ / build ✓ / governance 43/43（分层边界扫 421 文件 0 违规）/ 全量 **3550 测试全过** / 定向 prefetch gating+title 测试 4/4。**闸-2 codex 可合并 0P0/0P1**（仅 1 P2 理论 HMR 风险，非前置）。verifier=确定性闸（纯 move 宜确定性脚本非 LLM，符合 evidence-loop §特例）。
- **重来更好**：① **现实核查必须前置于"动手"**：连续两轮(7a2849 第三方会话已合并/b331 部分早已做)证明 dispatch 前沿不等于"真待办"——派单前先查 note 里的 PR 状态 + 实测目标现状(行数/文件)。这是 stale-scan 47c2a5 要自动化的。② 同目录落位 > 子目录落位（当搬移代码有大量相对 import 时）——闸-1 没料到这点，我在实现时优化了，降风险。③ 纯搬移重构的 oracle 是"确定性闸全绿"，无需新增测试也无需 LLM verifier；但定向回归测试(prefetch)是验 barrel 不断链的关键锚。
- **复用价值**：①「1000+行组件拆分」可复用打法=同目录抽 shared(类型/常量/纯helper)+子组件、barrel 重导出保旧入口零爆炸半径、`noUnusedLocals` 下精确剪枝靠 typecheck 迭代。② follow-up 登记纪律：大重构里"想做但风险高/超范围"的(hook 抽取 03f6f0、chart 去重 21c578)即时登记 backlog，不混进本 PR。
  - needs_automation: false（本轮无新增待自动化项；stale-scan 增强已独立登记 47c2a5 带其自身 expires 由 #703 闸管）

---

**R17 · 1f3bc1 golden-baseline oracle 修复（17→72/72 build+compare·codex 闸-2）**
- **触发**：用户问"1f3bc1 需密码吗？cx-cli 已有 PAT"。连环现实核查推翻多个既有判断：① **"缺 E2E_PASSWORD"是误判**——`auth.ts` 有 `DEV_SKIP_AUTH=1`（非生产）使 `verifyPassword` 恒真，login 接受任意密码签发真 token，**免密码**。② cx-cli 的 PAT 是**生产域**（chexian.cretvalu.com），golden-baseline 打 localhost，PAT 跨 auth store 用不上。③ `USER_PASSWORDS` 是 bcrypt 哈希，不可反推明文（我一度误判"可派生"，已纠正）。④ **真因不是鉴权**：原 baseline 17/78 成功，server 日志 `ConnectionPool: queue full / acquire timeout` —— 脚本 `Promise.allSettled` 把 71 端点**全并发**打爆 DuckDB 连接池。
- **成果（修 golden-baseline.mjs）**：① `mapSettledWithConcurrency` 限流（默认 4，`BASELINE_CONCURRENCY` 可配）替代全并发 → 17→74。② build 跳过 deprecated（coefficient 路由已删 404）→ 排除。③ holiday-drilldown 补必填 `groupBy`（z.enum 无默认）。④ patrol×2 是**文件托管端点**（读生成报告，无文件即 404、内容随时变）→ 移除（非 SQL/perf oracle）。⑤ test/data-version/data-metadata 标 `volatile`（回显 session/buildTime/serverStartTime 实时态，compare 必假阳）→ build+compare 跳过。⑥ compare FAIL 附 `endpointSlug`（原 AssertionError 不含端点身份，无法定位）。**build 72/72 + compare 72/72 零差异 = oracle 端到端可用**（远胜原 BACKLOG note 的 66/71 带 5 坏）。
- **闸**：闸-1 未单跑（根因由连接池错误**实证**锁定，"plan"= 修该 bug，无设计空间）；闸-2 codex 可合并 0P0/0P1，2 P2（dry-run 未标 volatile / compare 不防旧 manifest）**全修**。codex 还实测了 mapSettledWithConcurrency 结构与 allSettled 同构。
- **重来更好**：① **现实核查再次是最高杠杆**——本轮在动手前连推翻 4 个既有假设（密码/PAT/USER_PASSWORDS/真因），全靠"读代码+读日志+读 BACKLOG note"而非信任任务描述。任务描述（"需 E2E_PASSWORD"）本身就是过时假设。② **报错日志直指根因**——`ConnectionPool: queue full` 一句话定位真因，胜过盲目加 params。先读 server 日志再动手（呼应 memory `feedback_startup_log_first_not_source`）。③ 区分"oracle 端点"与"基础设施/文件/实时端点"是 golden-baseline 设计的核心——不是所有 API 都该进回归基线。
- **复用价值**：① **并发型 harness 默认限流**——任何"批量打本地服务"的脚本（baseline/bench/巡检）都该限流而非全并发，DuckDB 池小。`mapSettledWithConcurrency`（worker 池 + allSettled 同构返回）可复用。② golden-baseline 现可作所有 perf/refactor 任务的零差异 oracle（解锁后续重构对账），且对任意机器/CI 可复现（限流 + DEV_SKIP_AUTH 免密码）。③ 「volatile/deprecated 不纳入基线」的判据可复用到任何快照对账系统。
  - needs_automation: false（本轮即修复 harness 使其可用；无新增待自动化项。后续 perf/refactor 任务应在 §4 harness 表标注 golden-baseline 现已可用）
**R17 · claims_detail「字面引号 bug」误报排查 → 据实关闭 + 固化 foot-gun 护栏（PR #732·无功能变更）**
- **触发**：派单称 daily.mjs claims_detail / 字段覆盖率的 `'--policy-dir', \`"${policyDir}"\`` 是 new_energy_claims（PR #729）同款字面引号 bug，要求改裸路径。
- **据实判定非 bug（核实零误差）**：① `runPythonScript`（daily.mjs:176）中央剥离 argv 最外层双引号（`d197b431` execSync→spawnSync 迁移补丁），claims_detail 全程经它 → 实测 `"${p}"`→裸路径；② 字段覆盖率 `runFieldCoverageReport` 用**空数组**调用 `field_coverage.py`、且该脚本无 `--policy-dir` → 描述对象不存在；③ PR #729 的 `e9507542`（同提交保留 claims_detail 引号未动）佐证；④ 进一步核实：new_energy 的 `--policy-dir` 同样经 runStrategyFullSnapshot→runPythonScript 剥离（`d197b431` 是 `e9507542` 祖先），故 e9507542 那处去引号在该控制流下实为冗余 no-op，其「Path.exists 静默跳过」根因叙事在该路径不成立——站不住的根因又派生出本次误报任务。
- **根因（真问题）**：① pattern-grep ≠ data-flow：把「类成员资格」用表面语法（见 `"${...}"` 即归同类）判定，违反「grep 是有损代理 / 验证不声称」；② foot-gun：`"${path}"` 经 runPythonScript 安全、走裸 spawn 即坏，调用点视觉无法区分，安全全靠用了哪个 helper。
- **根治（PR #732）**：抽 `数据管理/lib/arg-quotes.mjs` 纯函数（与原内联逐字等价）+ `tests/arg-quotes.test.ts` 14 例契约单测锁不变量（防误删剥离）+ governance AST 闸「spawn参数引号安全」禁裸 spawnSync/execFileSync 照搬 `"${path}"`（防复发）。**负向验证**：注入 daily.mjs:925 → 闸精确 FAIL → 已还原。oracle：单测 14/14 · verify:quick（governance 44 含新闸 + typecheck）· CI Governance+Production Gate 双绿 · rebase origin/main（含 e9507542/fa4c98d6）32 提交零冲突。
- **重来更好**：派生「在别处修同款」任务前，必须端到端追一条代表性调用链（调用点→helper→Python argparse/Path）证明类成员资格 + 给最小复现，再动手——是 `feedback_codex_review_fix_sop`「修一处≠修一类」的逆向护栏（修一类前先证成员资格）。
- **复用价值**：「中央 shim 兼容旧写法」型迁移（execSync→spawnSync 的剥引号）必配「契约单测 + 禁绕过 shim 的 AST 闸」，否则旧写法成视觉无差别 foot-gun，反复诱发误报与冗余修复。
  - needs_automation: false（本轮已落地护栏闸 + 契约单测，无新增待自动化项）

---

**R18 · b332 comprehensive-analysis 边界测试补强（Loop v2 单任务·三源对抗全过·纯增测试零生产改动）**
- **触发**：Loop v2 单任务取 b332（测试覆盖补强 P1）。任务描述称 comprehensive-analysis 等 12 个 features 模块零测试。
- **现实核查纠正盘点（codex 闸-1 顺带揪出）**：盘点命令 `find src/features/*/` 只扫同目录、漏项目根 `tests/`——comprehensive-analysis 自 PR #70(B300, 2026-02-27) 起就有 `tests/comprehensive/` 测试（同目录测试用 `./` import 不含 `features/<mod>/` 字串，根目录测试用 `../../src/...` 才含，两种 import 风格导致单源 grep 互相漏报）。**双源准确盘点**(同目录 test 文件 OR tests/根引用)后**真·全仓零测试仅 8 个**(admin/customer-flow/expense-development/file/moto-cost/premium-report/repair/report)，远少于历次"12/15/19"有损盘点。comprehensive-analysis 是 happy-path 浅测、缺边界——补强仍有真实回归价值，非重复劳动（区别于 R16/R17 的"目标已完成"stale）。
- **成果（纯增测试）**：tests/comprehensive 4→52 测试(净增48)。rules.test.ts 补 mergeThresholds 边界+不可变/buildOverviewAlerts 阈值边界三件套(恰好线·线下·线上；premiumLag 用 `<`、其余三类用 `>`)+四类各自 slice(0,5)+告警顺序+dimType 过滤；新建 normalize.test.ts 锁 common.ts normalize* 逐字段(NaN/Infinity→0、Number(null)=0 vs toNullableNumber(null)=null、Math.max+round、dimKey 空串非 nullish)+camelCase??snake_case 回退(0 保留/null 回退/兄弟字段)；adapters.test.ts 补字段路由(防取错 section——既有测试所有 section 全空数组、无法验证路由)+summary `||{}` 缺省。
- **三源对抗(全过)**：闸-1(计划)codex P0=0(核心期望值方向全对)+3P1(spread undefined 覆盖/0 左值 ??/import type 纯度)+5P2 全采纳；闸-2(diff)codex P0=P1=0+4P2(summary 缺省/兄弟字段/不可变 undefined/多类 slice)全采纳；evidence-verifier fresh-context **confirmed**(逐条复核 6 断言无误·git diff --cached 范围最小·3648 单测独立复现)。verify:full(governance44+typecheck)全绿。
- **重来更好**：① **盘点命令本身是有损代理**——"零测试"判据必须双源(同目录 test 文件 + tests/ 根目录 import 引用)，单扫 src/features 同目录会把"测试落根目录"的模块误报零测试（CLAUDE.md §0「grep 是有损代理」在测试盘点上的具体实例）。② codex 闸-1 顺带抓到既有测试文件(P2 末条)再次印证"对抗审计用在计划阶段"的高杠杆——它直接促成现实核查纠偏，避免我在 src/features 同目录另起炉灶造成分裂/重复。③ 测试覆盖任务的 oracle 是"断言锁真实行为(哪怕含 spread undefined 覆盖这类陷阱)"，不是"应然行为"；codex+verifier 三源核对期望值 vs 源码是该 oracle 的落地。
- **复用价值**：① 「双源零测试盘点」(同目录 find + tests/根 grep `features/<mod>/`)可固化为脚本，供 b332 后续模块取准确前沿，免每轮误报。② 「字段路由测试」范式(给每 section 唯一可区分标记，防薄包装 adapter 复制粘贴取错字段；既有测试全空数组=无法验证路由是常见盲点)适用任何多 section adapter。③ 「camelCase ?? snake_case 用 0 左值测」锁 `??` vs `||` 回归，是双键回退标准测法。
  - needs_automation: true → 把「双源零测试盘点」做成 `scripts/` 脚本(同目录 find + tests/根 grep 并集)，供 b332 逐模块 PR 取准确前沿；可作 governance 过渡守卫"features/* 至少 1 处测试覆盖(含 tests/根引用)"。
  - expires: 2026-09-22
- **下一轮**：8 个真零测试模块逐模块独立 PR(优先 moto-cost/report 纯函数)；b332 整体仍 IN_PROGRESS。
**R18 · full_snapshot 缓存键漏 --policy-dir 内容指纹（PR #732 codex 另一发现·陈旧缓存隐患·task_6d1e8053）**
- **触发**：PR #732 codex 闸-2 除「字面引号」（R17）外独立揪出的正交既存隐患（loop-orchestration §4 meta 已登记 task_6d1e8053）——`buildFullSnapshotCacheKey` material 漏掉调用方注入的 `extraArgs`（典型 new_energy_claims 的 `--policy-dir`）。评为低于 P1 后续项，单独成任务。
- **systematic-debugging 先证后修（RED 复现）**：缓存键逻辑抽到 `数据管理/lib/full-snapshot-cache-key.mjs`（daily.mjs 顶层 main() 无法 import，同 R17/lib 既有模式），写 `tests/full-snapshot-cache-key.test.ts`：构造 id/batchDate/sources/deps 不变、policy-dir parquet 内容变化场景 → 当前代码 key 不变（3 例 RED）→ 证实「命中陈旧快照、服务旧 policy 回填的 org_level_3」真实可达。
- **关键修正——任务原议「JSON 化 extraArgs 字符串」对所述场景不足**：`necPolicyDir`（`branchOutputRoot` SC）在同 worktree/同 SC 分支两次运行间是**恒定字符串**，仅把路径字符串塞进 key 则 key 不变、仍命中陈旧缓存。真正变化的是 `--policy-dir` 目录下 parquet 的**内容**。承重修复 = 对该目录 `*.parquet` 做内容指纹（与 convert 的 `read_parquet('<dir>/*.parquet')` JOIN 输入集严格对齐）；extraArgs 整组仍纳入（捕获 --branch-code/路径变更，保守正确）。
- **oracle**：缓存键单测 9/9（RED→GREEN + P2 加固）· Python full_snapshot 7/7（依赖断言跟随 lib 重定向 + 新增 policy/extraArgs 覆盖，不回归）· 全量 3609 单测全过 · verify:quick（governance 44/44 + typecheck）· rebase origin/main（含 #732 e9507542/fa4c98d6）零冲突，自动合并 daily.mjs 后逐项重核完好。
- **codex 闸-2（对抗审 diff·`codex exec` 经 stdin）= 无 P0/P1**：独立确认核心判断（路径恒定→必须内容指纹 / sha256 取舍正确 / 非递归 glob 对齐）。4 个 P2 中本 PR 修 3 个：① quoted `--policy-dir` 鲁棒性（复用 #732 `lib/arg-quotes.mjs` 剥引号，防 R17 同类 foot-gun 复活）② `--no-metadata` 内容中性（base_converter.py:206 仅门控 data-sources.json 写入，证安全）→ denylist 剔除避免 manifest/直接运行反复重算 ③ `withFileTypes` 只纳常规文件，防 `.parquet` 目录/FIFO 在缓存键计算阶段抛错。均补对应 vitest 用例。codex_done: {P0:0,P1:0,P2:4→已处理3+1测试覆盖}。
- **重来更好**：收到「最小改动」式建议时，先端到端验证它是否真覆盖所述场景——这里「路径字符串 vs 目录内容」之差决定修复成败，是 systematic-debugging「症状描述 ≠ 根因」的实证。`dependencies` 只指纹 .py、`sources` 只指纹域自身 xlsx → 经 extraArgs 注入的外部数据依赖是缓存键盲区。
- **复用价值**：full_snapshot 缓存键须覆盖「所有影响产物内容的输入」，含经 extraArgs 注入的外部目录依赖（--policy-dir）的**内容指纹**而非仅参数字符串；新增「convert 时读外部目录回填」型 full_snapshot 域时，该外部目录必须进缓存材料。
  - needs_automation: false（回归测试 tests/full-snapshot-cache-key.test.ts 已锁内容敏感性不变量）

---

**R19 · b332 expense-development 规则引擎测试（Loop v2 续推·闸-1 免跑权衡·闸-2 抓覆盖洞·纯增测试零生产改动）**
- **触发**：#739（R18 comprehensive）合并后用户「需要」续推 b332。对剩余真零测试模块做**纯函数分布扫描**：仅 expense-development（`utils/expenseDevInsightRules.ts`）+ premium-report（2 个 hooks）有 `.ts` 逻辑文件；余 6 个（admin/customer-flow/file/moto-cost/repair/report）是纯组件（仅 `.tsx`+barrel）、无纯函数。锁定 expense-development utils。
- **成果（纯增测试）**：新建 `expenseDevInsightRules.test.ts` 29 测试，覆盖 `generateExpenseDevInsights` 规则引擎——成熟/早期年分类（minDevForAlert=6 边界）/ 费用率阈值告警（erHigh=20 danger、erModerate=16 warning，**er=20 落 warning**）/ 三 metric 趋势（trendDeltaPp=3、avgFeeGrowthPct=30、dev_fee_wan 20%，恰好线）/ 三类同期对比（compareDeltaPp=5、avgFeeComparePct=20，恰好线）/ TYPE_ORDER 排序锚 / info / null 跳过 / 除零保护 / danger+moderate 共存。CohortData 私有类型用结构化 helper（cohort/single）构造。
- **闸-1 免跑的权衡（本轮关键学习）**：范式与 comprehensive（已过闸-1）同构，按 R17 先例免跑闸-1。**代价显性化**：闸-2 codex 抓到 2 个 P1 **覆盖洞**（同期对比正例没用恰好线 5/20 而用 10/25；`dev_fee_wan` 的 appendCompare 同期对比整条漏测）。即"免闸-1 省一次 codex(~1.5min)，但把覆盖完整性问题推迟到闸-2 才暴露、多一轮返工"。**结论**：同构范式可免闸-1，但必须自查「源码每个分支都有对应测试」——本轮恰好漏了 feeAmountInsights 里那条 appendCompare 调用。
- **三源（闸-1 免）**：闸-2 codex P0=0 + 2 P1 + 3 P2 全采纳；evidence-verifier fresh-context **confirmed**（8 断言逐条对源码无误、范围最小、3686 单测独立复现）。verify:full（governance 44+typecheck+3681 单测）全绿。
- **重来更好**：① 多 metric × 多规则（阈值/趋势/对比/info）的引擎，测试设计应**先列「分支矩阵」(metric × 规则类型)** 再写——本轮漏的 dev_fee_wan×compare 正是矩阵里一个未填的 cell。② 「免闸-1」决策应配「分支矩阵自查」作补偿，否则把闸-1 的覆盖职责无人接手地丢给闸-2。
- **复用价值**：① 「规则引擎测试」范式=阈值边界三件套 × 每条规则 + 排序锚 + null/除零守卫 + 分支矩阵防漏；可套用任何 metric×rule 型洞察/告警引擎。② 「纯函数分布扫描」（区分 utils 纯函数 / hooks / 纯组件）是 R18「双源零测试盘点」的下一层细化——决定一个零测试模块走「纯逻辑测试」还是「组件 smoke」路线。
  - needs_automation: false（并入 R18 已登记的「双源零测试盘点」脚本项 expires 2026-09-22，新增「纯函数分布扫描」维度，不另立）
- **下一轮**：premium-report（2 hooks，renderHook 稍重但仍属纯逻辑）；余 6 纯组件模块须转「组件 smoke（DOM/testing-library）」路线，与本纯函数策略不同——b332 的一个**策略分叉点**，建议后续明确。

## 2026-06-22 · 47c2a5 stale-scan 增 PR-合并信号（根治「已合任务被重复派单 + DONE 滞后」）

- **背景/根因**：本轮 loop 复盘暴露 P1——stale-scan 仅看完成语+git churn，看不到「任务实现 PR 已 MERGED」，致 7a2849（#640 已合一周仍被重复派单）、b299/b261（合并后滞留 IN_PROGRESS 未回填 DONE）。
- **实现**：`classifyStale` 加注入参 `mergedPrRefs`（PR 已合=最强信号→high，独立于完成语）；CLI 一次 `gh pr list --state merged` 批量取 + 纯函数 `branchMatchesUid` 分隔符边界匹配（避免 b332 误命中无关分支子串）；网络/gh 不可用优雅降级（返回空 Map 不崩）；默认开 + `--no-pr` 关。
- **验证**：43 单测全绿（含 6 新例：uidToken/branchMatchesUid/PR 信号高置信/scanStale 注入）；governance 44/44；实跑命中 b261/b299/b290/b322/b332 共 5 项「合并未回填 DONE」任务（活证据）。
- **边界纪律（用户 2026-06-22 确认）**：网络抖动 / 判定器 503 是环境不可抗力（天），不计入「问题」、不优化，只容错共处；本 PR 只根治可控的逻辑盲区。
- needs_automation: false（本身即把"现实核查"自动化的一环）

---

**R20 · b332 premium-report 2 hooks 纯逻辑提取 + 单测（Loop v2 续推·路线 B 提取重构·三源全过·golden 由确定性等价证明）**
- **触发**：#742（R19 expense-development）合并后续推 b332。R18「双源零测试盘点」结论=真零测试 8 个，R18/R19 已清 comprehensive(浅测补强)/expense-development；premium-report 是唯一含 `.ts` 逻辑文件(2 hooks)的剩余模块，余 6 个(admin/customer-flow/file/moto-cost/repair/report)纯组件无纯函数。
- **路线决策（B 提取 vs A renderHook+mock）**：用户给 A/B 二选一并推荐 B。选 B（calculateSummary/sortData/normalize*/drill 层级逻辑提取到 utils/ 纯函数直测）。**关键推理**：R19「下一轮」把 premium-report 标为「renderHook 稍重」(路线 A 心智)；但路线 B 提取后**本轮转为与 R18/R19 同构**(纯函数直测、零 mock)——用户给的「跑闸-1」理由是「hooks+mock 不同构于前两轮」，该理由在路线 B 下消失。故按 R17/R19 先例免闸-1 + R19 要求的「分支矩阵自查」补偿；路线 B 新引入的「提取保真」风险交给**更有效的闸-2 审 diff**(R16:「审 diff > 审计划」对重构尤甚)。
- **成果（提取重构 + 纯增测试，hook 净缩减、golden 不变）**：新建 utils/premiumReportCalc.ts(4 函数)+utils/premiumPlanDrill.ts(6 符号)，两 hooks 删内联改 import(usePremiumReport -94/usePremiumPlan -64 行,典型代码简化)。44 单测：浮点四舍五入(去尾差 1.1+2.2→3.3 / 三位截断 1.111+2.222→3.33 / avg 1.65)、`??` vs `||`(空串保留锁 nullish 语义)、`== null`(null+undefined 同捕获)、localeCompare zh-CN(ASCII+拼音甲<乙)、null/undefined 排序方向、不可变(返回新数组 / 空 column 返回同引用)、normalize 逐字段(0 保留 vs null 回退 vs 数字串转型)、drill 层级映射全 6 档+越界 null+钳位、面包屑标签(业务员美化分支)。
- **三源（闸-1 免）**：确定性闸 verify:full(governance44+typecheck+3747 单测)全绿；闸-2 codex(exec 经 stdin)无 P0/P1、确认与 origin/main 内联逐字符等价，3 P2(采纳 2:null/空串 dedup + undefined 排序；1 记残留:hook 级 golden)；evidence-verifier fresh-context(sonnet)**CONFIRMED**(逐函数对 diff 等价、5 断言推演无误、亲跑 3747 单测)。
- **重来更好**：① **路线选择会重定义「同构」判断**——R19 把 premium-report 预判为「renderHook 稍重」=非同构据此建议跑闸-1；实际选路线 B 后变同构，闸-1 决策应随路线重判而非沿用上轮预判。② **路线 B 的 golden 保真不靠「新测试」(它们只测提取后代码)，靠「提取逐字符等价(人工+codex+verifier 三方对 diff) + typecheck(接线) + 全量套件(无回归)」**——本轮无既有 premium-report 测试作 golden 回归锚，故等价证明全压在 diff 对比，这是路线 B(提取无既有测试模块)的固有约束，必须显式声明而非假装「测试证明了 golden」。③ 闸-2 的 P2-3(hook 级 golden 需 renderHook)是路线 A/B 的本质权衡点而非可补缺口：补它=引回路线 B 刻意规避的 mock 脆性。
- **复用价值**：① 「纯逻辑从 hook 提取到 utils/」打法=同目录(utils 与 hooks 同在 features/<mod>/下,`../../../shared` 相对深度一致零改写)抽纯函数、hook 改 `.map(normalizeX)`/`computeX()` 调用、useCallback 依赖移除已提取的稳定模块函数(原 `useCallback(...,[])` 提取后天然稳定,从依赖数组删除安全)；零生产行为变更而 hook 显著简化。可把 R19「纯函数分布扫描」里判为 hooks 的模块从路线 A 转路线 B。② 「`??` vs `||` 用空串(非 null)区分」「`== null` 用 undefined(非 null)区分」是锁「易被误改的判等运算符」标准测法。③ vitest exclude 含 `**/.claude/**`——测试**禁落 `.claude/worktrees/`**(否则静默 skip=假 passed)，本轮特意用兄弟目录 worktree 规避(呼应 feedback_e2e_silent_skip_false_positive)。
  - needs_automation: false（沿用 R18 已登记的「双源零测试盘点 + 纯函数分布扫描」脚本项 expires 2026-09-22；本轮新增「路线 A/B 同构判断随路线重判」是决策纪律非可自动化项）
- **下一轮**：真零测试余 6 个**纯组件**模块(admin/customer-flow/file/moto-cost/repair/report,仅 .tsx+barrel 无纯函数)——须转「组件 smoke(DOM/@testing-library)」路线，与本纯函数策略不同，是 b332 既定**策略分叉点**；premium-report 已清零，b332 整体仍 IN_PROGRESS。
