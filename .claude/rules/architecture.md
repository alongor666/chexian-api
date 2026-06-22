---
paths: ["src/widgets/**/*.ts", "src/widgets/**/*.tsx", "src/shared/**/*.ts", "src/shared/**/*.tsx", "src/features/**/*.ts", "src/features/**/*.tsx", "scripts/check-governance.mjs"]
---

# 前端分层依赖边界（B330 防回归 · RED LINE）

> **本文件不是新事实源**：分层语义的权威定义在根目录 `ARCHITECTURE.md §2.2`。本文件是
> 「path-scoped 执行规则」——把 ARCHITECTURE 的分层约束落成 `bun run governance` 可拦的禁令，
> 守住 B330（架构依赖违规修复，PR #641/#642/#643 已修复合并）不被静默回退。

## 1. 分层（自底向上）

| 层 | 目录 | 说明 |
|----|------|------|
| L1 共享层 | `src/shared/`、`src/widgets/` | 通用 hook / 组件 / 类型 / 工具，**不得依赖任何业务特性** |
| L2 特性层 | `src/features/*` | 各业务域（dashboard / growth / quote-conversion / filters / ...），架构原则是各域自治、不横向互引（本闸目前只硬拦 B330 已修复的 2 条横向边界，见 §2 (d)(e)，非全量 L2 隔离） |
| 后端 | `server/src/` | 前端（features / shared / widgets）**禁实值/类型 import server/src**；需要共享的契约在 `src/shared/` 维护镜像类型 |

## 2. 边界禁令（governance 闸 `分层依赖边界` 自动拦截）

闸实现：`scripts/check-governance.mjs` 的 `checkArchLayerBoundaries()`，用 TypeScript AST
解析每个 `.ts/.tsx` 的所有模块说明符（覆盖 `import` / `import type` / `export ... from` /
动态 `import()` / `require()`），命中以下任一即 `governance` 失败：

| 规则 | 禁止 | 方向 | B330 原违规 |
|------|------|------|-------------|
| (a) | `src/widgets/**` 引用 `src/features/**` | 依赖倒置 | `EnhancedKpiCard` → `features/dashboard/utils/kpiStatus` |
| (b) | `src/shared/**` 引用 `src/features/**` | 依赖倒置 | `FilterContext` → `features/dashboard/orgSalesman` |
| (c) | `src/features/**`、`src/shared/**`、`src/widgets/**` 引用 `server/src/**` | 前后端越界 | `useCrossSellTopSalesman` → `server/src/sql/*` |
| (d) | `src/features/growth/**` 引用 `src/features/dashboard/**` | L2→L2 横向 | `GrowthAnalysisPanel` → `dashboard` 的 `usePerspective` |
| (e) | `src/features/quote-conversion/**` 引用 `src/features/filters/**` | L2→L2 横向 | `GlobalFilters` → `filters` 的 `CollapsibleFilterSection` |

> 别名 `@/features`、`@/...`、相对路径 `../../features`、`server/src` 与无插值模板字符串
> （`import(\`...\`)` / `require(\`...\`)`）均归一识别，无法靠改写 import 形式绕过。
> (d)(e) 只是 B330 已修复的两条横向边界的定向 denylist，**不是**全量 L2 域隔离；其余 L2→L2
> 互引（如 growth→quote-conversion）本闸当前放行。`components/layout → features` 的依赖倒置属
> 更深的 shell+slot 重构（follow-up `2026-06-15-claude-edbd61`），不在本闸守护范围内。

## 3. 修复方向（命中后怎么改）

- 被横向/倒置引用的 hook/组件/类型，**上提到 `src/shared/`**（B330 主体做法：`usePerspective` →
  `shared/hooks/`、`kpiStatus`/`orgSalesman` → `shared/utils/`、`CollapsibleFilterSection` →
  `shared/components/filters/`）。
- 前端需要后端类型，在 `src/shared/types/` 维护**镜像类型**（如 `shared/types/cross-sell.ts`），
  禁直接 `import type ... from 'server/src/...'`。

## 4. 逃生阀（极少用，需带依据）

确有正当理由保留某条边界依赖时，在命中行**或其上一行**写：

```
// governance-allow: arch-boundary <backlog-uid 或 PR 号> <一句理由>
```

闸要求 marker 同时带 `arch-boundary` 关键字与一个 backlog/PR 引用（形如 `B###`、
`####-##-##-...` uid 或 `#数字`），否则视为无效不予豁免——防止裸 marker 给回归留后门。

## 关联

- 分层语义权威：根目录 `ARCHITECTURE.md §2.2`
- B330 主体修复：PR #641 / #642 / #643
- follow-up：`2026-06-15-claude-edbd61`（layout→features shell+slot 重构，独立 PR）
- 闸实现：`scripts/check-governance.mjs` `checkArchLayerBoundaries`
