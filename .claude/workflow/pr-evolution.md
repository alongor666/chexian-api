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
