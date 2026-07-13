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

- [ ] **Step 1: 登记父任务和 Task 2–5 子任务**

通过 `bun scripts/backlog.mjs add` 登记一个 P1 父任务及四个 P2 子任务，分别覆盖注册表、消费者、文档治理和最终收口；关联本设计/计划与核心代码路径，不手写事件文件。

- [ ] **Step 2: 校验并提交事件日志**

运行 `bun scripts/governance-backlog-curate.mjs`，确认事件日志和 ignored 派生视图一致；仅提交 `backlog-events/2026-07`。

## Task 2：以 TDD 建立产品元数据与路由注册表

**Files:**
- Create: `src/shared/config/productMetadata.ts`
- Create: `src/shared/config/routeRegistry.ts`
- Create: `src/shared/config/__tests__/productMetadata.test.ts`
- Create: `src/shared/config/__tests__/routeRegistry.test.ts`

- [ ] **Step 1: claim 对应 backlog 子任务后写失败测试**

测试锁定产品主名、移动简称、AI 名称和标题格式；路由侧锁定 id/path 唯一、权限仅含 canonical path、alias 不进入权限选项，以及六个决策域的顺序。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `bun run test --run src/shared/config/__tests__/productMetadata.test.ts src/shared/config/__tests__/routeRegistry.test.ts`

Expected: FAIL，原因是两个模块尚不存在。

- [ ] **Step 3: 实现最小产品元数据**

导出只读 `PRODUCT_METADATA`（产品主名、移动简称、AI 名称）与 `formatDocumentTitle`，不混入页面或路由信息。

- [ ] **Step 4: 实现最小路由注册表**

定义域、路由 id 和 route definition，登记 canonical 页面及 alias；权限与导航选择器均返回新数组，不暴露可变引用。

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

已完成的消费者迁移保留以下验收契约：

- 顶栏、登录页和副驾标题消费 `PRODUCT_METADATA`；HTML 静态标题由治理闸对账，server 包名为 `@chexian/server`。
- 侧栏由 registry 生成六域，Lucide 映射留在布局层；`canAccessRoute`、特殊功能守卫、hover prefetch、compact rail 与移动端行为不变。
- 权限 UI 只展示 `getPermissionRoutes()` 的 canonical 项；legacy alias 兼容已存权限但不成为新选项，且不得扩大 `allowedRoutes`。
- App 保持显式 Route，registry redirects 保持目标及 query 字节行为；同步测试用 TSX AST 对账。

验证命令：

```bash
bun run test --run tests/sidebar-navigation-collapsed.test.tsx tests/route-registry-app-sync.test.ts tests/config/organizations.test.ts tests/route-redirect-guards.test.tsx
bun run typecheck && bun run build
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

收口时仅通过 backlog 脚本追加事件，不手改事件或强制提交 ignored 派生视图。每个实施项必须完成规格审查、质量审查及修复复审，主代理核验真实 diff 和输出后才能标记 DONE。

新鲜验证：

```bash
bun run typecheck
bun run build
bun run test --run
bun run governance
git diff --check origin/main...HEAD
```

所有命令须 exit 0。子任务证据必须包含真实 commit、双审通过和定向测试；父任务只在 required CI 全绿、无未解决 review thread 后标记 DONE。PR 正文保留范围/非目标、旧 URL 兼容、权限半径、验证、审查与回滚说明。
