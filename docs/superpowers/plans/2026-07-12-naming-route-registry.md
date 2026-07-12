# Naming and Route Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一“车险经营分析平台”产品名称，并用一个最小路由注册表驱动侧栏和权限配置，消除旧路由与多头命名漂移。

**Architecture:** `productMetadata` 只管理产品级用户可见名称；`routeRegistry` 只管理 canonical 页面元数据、导航分组与 alias，不承载 React 页面组件。App 保持显式路由，测试负责对账；旧 URL redirects 保留，业务 API、SQL、ETL 与权限语义不变。

**Tech Stack:** React 19、TypeScript 5.9、React Router 7、Vitest、Bun、现有 backlog event-log 与 governance。

---

## 文件结构

- Create `src/shared/config/productMetadata.ts`：产品名、移动简称、AI 用户名和标题格式函数。
- Create `src/shared/config/routeRegistry.ts`：决策域、canonical 页面、aliases 与派生选择器。
- Create `src/shared/config/__tests__/productMetadata.test.ts`：产品元数据契约。
- Create `src/shared/config/__tests__/routeRegistry.test.ts`：唯一性、导航、权限和 alias 契约。
- Modify `src/components/layout/TopNavigation.tsx`：消费产品元数据。
- Modify `src/features/auth/LoginPage.tsx`：消费产品元数据。
- Modify `src/features/copilot/CopilotDrawer.tsx`：用户可见名统一为“经营副驾”。
- Modify `index.html`：静态启动标题统一为产品主名，`lang` 改为 `zh-CN`。
- Modify `src/components/layout/SidebarNavigation.tsx`：从注册表生成六域导航，保留现有 prefetch 与权限逻辑。
- Modify `src/features/admin/AccessControlPage.tsx`：从注册表生成权限选项，移除 alias/死路由。
- Modify `tests/sidebar-navigation-collapsed.test.tsx`：锁定新分组和可见短标签。
- Modify `tests/route-redirect-guards.test.tsx` 或新增 `tests/route-registry-app-sync.test.ts`：锁定 redirects 与 App canonical 路由覆盖。
- Modify `server/package.json`、`server/src/app.ts`：后端包名与描述统一为 `@chexian/server` / 车险经营分析平台。
- Modify `README.md`、`ARCHITECTURE.md`、`src/features/INDEX.md`：当前态文档纠偏；历史 L2 规则移出主规范。
- Create `reference/legacy-python-subproject-convention.md`：承接旧 Python input/output 约定。
- Modify `scripts/check-governance.mjs`（仅在现有检查无法承载时）：加入静态品牌旧名与 route registry 漂移检查。
- Create/Modify governance tests under `scripts/__tests__/`：证明闸门会对违规 fixture fail-loud。

## Task 1：登记父 backlog 与分项任务

**Files:**
- Create: `backlog-events/2026-07/*.json`（仅通过脚本）
- Verify locally generated ignored views: `BACKLOG.md`, `BACKLOG_ARCHIVE.md`（不得强制加入 Git）

- [ ] **Step 1: 登记父任务**

```bash
bun scripts/backlog.mjs add \
  --actor @codex \
  --priority P1 \
  --section "架构治理/命名体系" \
  --desc "统一车险经营分析平台产品命名，建立 productMetadata + routeRegistry，迁移侧栏/权限/文档并增加防漂移治理闸" \
  --docs "docs/superpowers/specs/2026-07-12-naming-route-registry-design.md,docs/superpowers/plans/2026-07-12-naming-route-registry.md" \
  --code "src/shared/config/productMetadata.ts,src/shared/config/routeRegistry.ts,src/components/layout/SidebarNavigation.tsx,src/features/admin/AccessControlPage.tsx"
```

Expected: 输出 `✅ 新增任务 uid=...`，并自动刷新两个派生视图。

- [ ] **Step 2: 为 Task 2–5 各登记一个 P2 子任务**

分别使用以下描述调用同一 `add` 命令：

```text
建立产品元数据和路由注册表契约
迁移品牌、导航与权限消费者
纠偏 README/ARCHITECTURE/功能索引并增加治理闸
完成全量验证、独立审计、PR 与 CI 收口
```

Expected: 4 个新 uid；不得手写或修改既有事件文件。

- [ ] **Step 3: 校验日志与派生视图**

Run: `bun scripts/governance-backlog-curate.mjs`

Expected: 事件日志无错误，`BACKLOG.md` 与 `BACKLOG_ARCHIVE.md` 已是最新。

- [ ] **Step 4: 提交 backlog 登记**

```bash
git add -- backlog-events/2026-07
git commit -m "chore(backlog): register naming registry rollout"
```

## Task 2：以 TDD 建立产品元数据与路由注册表

**Files:**
- Create: `src/shared/config/productMetadata.ts`
- Create: `src/shared/config/routeRegistry.ts`
- Create: `src/shared/config/__tests__/productMetadata.test.ts`
- Create: `src/shared/config/__tests__/routeRegistry.test.ts`

- [ ] **Step 1: claim 对应 backlog 子任务后写失败测试**

测试至少包含：

```ts
expect(PRODUCT_METADATA.productName).toBe('车险经营分析平台');
expect(PRODUCT_METADATA.mobileName).toBe('车险经营');
expect(PRODUCT_METADATA.aiAssistantName).toBe('经营副驾');
expect(formatDocumentTitle('成本分析')).toBe('成本分析｜车险经营分析平台');

expect(new Set(ROUTES.map(r => r.id)).size).toBe(ROUTES.length);
expect(new Set(ROUTES.map(r => r.path)).size).toBe(ROUTES.length);
expect(getPermissionRoutes().every(r => r.kind === 'canonical')).toBe(true);
expect(getPermissionRoutes().map(r => r.path)).not.toEqual(
  expect.arrayContaining(['/renewal', '/truck', '/cross-sell', '/comparison']),
);
expect(getNavigationGroups().map(g => g.label)).toEqual([
  '经营总览', '增长达成', '成本质量', '客户经营', '专项资源', '平台管理',
]);
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `bun run test --run src/shared/config/__tests__/productMetadata.test.ts src/shared/config/__tests__/routeRegistry.test.ts`

Expected: FAIL，原因是两个模块尚不存在。

- [ ] **Step 3: 实现最小产品元数据**

```ts
export const PRODUCT_METADATA = {
  productName: '车险经营分析平台',
  mobileName: '车险经营',
  aiAssistantName: '经营副驾',
} as const;

export function formatDocumentTitle(pageName?: string): string {
  return pageName ? `${pageName}｜${PRODUCT_METADATA.productName}` : PRODUCT_METADATA.productName;
}
```

- [ ] **Step 4: 实现最小路由注册表**

定义 `DecisionDomainId`、`RouteId`、`RouteDefinition`，登记当前 canonical 页面；redirect aliases 与 canonical 定义放在同一条记录的 `aliases` 字段。派生函数只返回新数组，不暴露可变引用：

```ts
export const getPermissionRoutes = () =>
  ROUTES.filter(route => route.permissionConfigurable);

export const getNavigationGroups = () =>
  DECISION_DOMAINS.map(domain => ({
    ...domain,
    routes: ROUTES.filter(route => route.navigationDomain === domain.id),
  })).filter(group => group.routes.length > 0);
```

`/home` 是 canonical 首页；`/` 仅为容器/入口跳转，不作为第二个首页权限项。保留 `/premium-report`、`/marketing-report`、`/truck`、`/cross-sell`、`/comparison`、`/comprehensive-analysis`、`/old-dashboard` aliases。

- [ ] **Step 5: 运行测试并确认 GREEN**

Run: `bun run test --run src/shared/config/__tests__/productMetadata.test.ts src/shared/config/__tests__/routeRegistry.test.ts`

Expected: 两个测试文件全部通过。

- [ ] **Step 6: 提交事实源**

```bash
git add -- src/shared/config/productMetadata.ts src/shared/config/routeRegistry.ts src/shared/config/__tests__
git commit -m "feat(config): add product and route registries"
```

## Task 3：迁移品牌、侧栏与权限消费者

**Files:**
- Modify: `src/components/layout/TopNavigation.tsx`
- Modify: `src/features/auth/LoginPage.tsx`
- Modify: `src/features/copilot/CopilotDrawer.tsx`
- Modify: `src/components/layout/SidebarNavigation.tsx`
- Modify: `src/features/admin/AccessControlPage.tsx`
- Modify: `index.html`
- Modify: `server/package.json`
- Modify: `server/src/app.ts`
- Modify: `tests/sidebar-navigation-collapsed.test.tsx`
- Create: `tests/route-registry-app-sync.test.ts`

- [ ] **Step 1: claim 子任务并先扩充失败测试**

侧栏测试锁定六个一级域和关键入口；权限注册表测试锁定 canonical 路径；App 同步测试读取 `src/app/App.tsx`，断言每个 `navigation`/`permissionConfigurable` canonical path 都有显式 Route 或有注释声明的入口映射。

```ts
expect(screen.getByText('经营总览')).toBeTruthy();
expect(screen.getByText('成本质量')).toBeTruthy();
expect(screen.getByRole('link', { name: '经营看板' })).toBeTruthy();
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `bun run test --run tests/sidebar-navigation-collapsed.test.tsx tests/route-registry-app-sync.test.ts`

Expected: 新分组/标签断言失败。

- [ ] **Step 3: 迁移品牌消费者**

顶部、登录页和 Copilot 用户可见标题从 `PRODUCT_METADATA` 读取；`index.html` 因 Vite HTML 无法直接 import，静态写入同一主名并由治理闸对账。将 `<html lang="en">` 改为 `<html lang="zh-CN">`。后端包改名为 `@chexian/server`，注释与描述使用产品主名。

- [ ] **Step 4: 迁移侧栏但保留行为**

将现有 `dataNavItems/toolNavItems/adminNavItems` 替换为注册表派生的六域结构。图标映射留在布局层，或由 registry 保存 Lucide icon 引用；不得把 React 组件引入纯配置测试难以加载的模块。保留：

- `canAccessRoute`；
- `canAccessMotoCost` / `canAccessExpenseDevelopment` 特殊守卫；
- hover prefetch switch；
- compact rail 两字短标签；
- 移动端关闭抽屉行为。

- [ ] **Step 5: 迁移权限配置**

删除 `AccessControlPage.tsx` 内手写 `ALL_ROUTES`，改用 `getPermissionRoutes()` 映射 `{ path, label }`。现有用户或角色中遗留 alias 可以继续显示为已存值或在提交前由后端现有对齐逻辑处理，但 UI 不再提供新勾选入口；不得自动扩大 allowedRoutes。

- [ ] **Step 6: 运行定向测试**

Run: `bun run test --run tests/sidebar-navigation-collapsed.test.tsx tests/route-registry-app-sync.test.ts tests/config/organizations.test.ts tests/route-redirect-guards.test.tsx`

Expected: 全部通过，redirect 行为保持原样。

- [ ] **Step 7: 类型与构建验证**

Run: `bun run typecheck && bun run build`

Expected: exit 0。

- [ ] **Step 8: 提交消费者迁移**

```bash
git add -- index.html server/package.json server/src/app.ts src/components/layout/TopNavigation.tsx src/components/layout/SidebarNavigation.tsx src/features/auth/LoginPage.tsx src/features/copilot/CopilotDrawer.tsx src/features/admin/AccessControlPage.tsx tests/sidebar-navigation-collapsed.test.tsx tests/route-registry-app-sync.test.ts
git commit -m "refactor(ui): derive naming and navigation from registries"
```

## Task 4：纠偏文档并建立防漂移治理闸

**Files:**
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `src/features/INDEX.md`
- Create: `reference/legacy-python-subproject-convention.md`
- Modify: `scripts/check-governance.mjs`
- Create or Modify: `scripts/__tests__/naming-route-governance.test.mjs`

- [ ] **Step 1: claim 子任务并写失败治理测试**

fixture 分别放入旧产品主名、权限 alias 和重复 canonical path，调用导出的检查函数并断言返回错误：

```js
expect(checkProductNaming(fixtureRoot)).toEqual(expect.arrayContaining([
  expect.stringMatching(/车险业绩分析系统/),
]));
expect(checkRouteRegistry(fixtureRoot)).toEqual(expect.arrayContaining([
  expect.stringMatching(/重复 canonical path/),
]));
```

治理扫描只覆盖当前态用户入口和配置文件，排除 `docs/reviews`、历史迁移文档、测试 fixture 与 legacy reference，避免把历史证据误判为违规。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `bun run test --run scripts/__tests__/naming-route-governance.test.mjs`

Expected: FAIL，检查函数尚不存在。

- [ ] **Step 3: 实现最小治理检查**

优先复用 `scripts/check-governance.mjs` 现有检查注册方式。检查：

- `index.html` 主标题与 `productMetadata.ts` 一致；
- TopNavigation/LoginPage 不得硬编码旧产品主名；
- `AccessControlPage.tsx` 不得重新出现本地 `ALL_ROUTES`；
- registry 不得出现重复 id/path 或 alias/canonical 冲突。

- [ ] **Step 4: 更新当前态文档**

README 页面表从 registry 当前 canonical 页面人工对齐；删除不存在的 `/coefficient` 和“营销战报”当前能力声明。ARCHITECTURE 主体改为当前数据仓库/API-only 分层；把旧 L2 Python 规范原文移到 legacy reference，并在主文档只保留历史链接。`src/features/INDEX.md` 标签与 registry 对齐。

- [ ] **Step 5: 运行定向测试与 governance**

Run: `bun run test --run scripts/__tests__/naming-route-governance.test.mjs && bun run governance`

Expected: 测试通过；governance 全部检查通过。

- [ ] **Step 6: 提交文档与治理闸**

```bash
git add -- README.md ARCHITECTURE.md src/features/INDEX.md reference/legacy-python-subproject-convention.md scripts/check-governance.mjs scripts/__tests__/naming-route-governance.test.mjs
git commit -m "docs(governance): align naming and architecture truth"
```

## Task 5：全量审计、backlog 收口与 PR

**Files:**
- Create: remaining `backlog-events/2026-07/*.json` through script only
- Verify locally generated ignored views: `BACKLOG.md`, `BACKLOG_ARCHIVE.md`（不得强制加入 Git）

- [ ] **Step 1: claim 最终验证子任务**

从 Task 1 的四个子任务输出中取描述为“完成全量验证、独立审计、PR 与 CI 收口”的真实 uid，记为 shell 变量 `FINAL_UID`，再运行：

Run: `bun scripts/backlog.mjs claim "$FINAL_UID" --agent final-verification --actor @codex`

Expected: 状态变为 DOING；只有当前 owner 可继续收口。

- [ ] **Step 2: 逐项完成独立审查闭环**

每个实施任务依次执行：规格审查 → 修复 → 复审通过 → 代码质量审查 → 修复 → 复审通过。审查 Agent 不得修改代码；实施 Agent 负责修复。主代理读取真实 diff 和测试输出后才更新 backlog。

- [ ] **Step 3: 新鲜全量验证**

```bash
bun run typecheck
bun run build
bun run test --run
bun run governance
git diff --check origin/main...HEAD
```

Expected: 所有命令 exit 0；全量测试无失败；diff 无 whitespace error。

- [ ] **Step 4: 逐个标记子任务 DONE**

```bash
TASK_UID="Task 1 输出的真实子任务 uid" \
COMMIT_SHA="该分项真实提交的 git rev-parse 短 SHA" \
bun scripts/backlog.mjs status "$TASK_UID" DONE \
  --actor @codex \
  --evidence "commit=$COMMIT_SHA; spec review=approved; quality review=approved; targeted tests=passed"
```

父任务暂不 DONE，只追加 note 记录本地验证和待 PR/CI 状态。

- [ ] **Step 5: 提交 backlog 本地收口事件**

```bash
git add -- backlog-events/2026-07
git commit -m "chore(backlog): record naming rollout verification"
```

- [ ] **Step 6: 按 commit-push-pr 流程推送并创建 PR**

PR 标题建议：`refactor(ui): unify product naming and route registry`。

PR 正文必须列出：范围、非目标、旧 URL 兼容、权限半径不变、定向/全量验证、Agent 双审结果和回滚方式。

- [ ] **Step 7: 审核 GitHub CI 与 review comments**

检查 mergeability、required Actions 和未解决 review threads。失败则回到对应实施 Agent 修复并重复定向/全量验证。

- [ ] **Step 8: CI 全绿后标记父任务 DONE 并推送同一 PR**

```bash
PARENT_UID="Task 1 输出的真实父任务 uid" \
PR_NUMBER="gh pr view --json number --jq .number 的真实输出" \
bun scripts/backlog.mjs status "$PARENT_UID" DONE \
  --actor @codex \
  --evidence "PR #$PR_NUMBER; required CI success; no unresolved review comments; full local verification passed"
git add -- backlog-events/2026-07
git commit -m "chore(backlog): close naming registry rollout"
git push
```

Expected: 父任务进入归档视图，PR 仍保持可合并且 required CI 重新通过。
