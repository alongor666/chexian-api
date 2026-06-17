# cx query --interactive wizard（evidence-loop scorecard）

policy: append-only
date: 2026-06-16
branch: claude/zealous-fermat-af7482
loop: feature
status: PROMOTE（阶段 C 完成；待 commit & PR）

## 业务目标

让 `cx query` 在用户不记得 route key / 参数名时，进交互式构建器：搜索 → 选 route → 看参数定义（含 enum）→ 填值 → 预览 URL → 执行。降低"先 `cx routes` → 再翻 `cx fields` / `cx filters` → 再敲完整命令"的发现成本。

## 改动（最小有用，无无关重构）

- ✚ `cli/src/commands/interactive.ts`（≈ 175 行）— wizard 主流程 + 3 个可测纯函数（pickRouteFromInput / buildParamSpec / previewUrl）
- ✚ `cli/src/__tests__/interactive.test.ts`（≈ 230 行）— 19 测试，覆盖 route 选择 / 参数收集 / retry 循环 / TTY fallback / 取消路径
- ✎ `cli/src/index.ts`（+13 行）— query 命令 `<key|path>` → `[key|path]`，加 `-i/--interactive`，缺 key 或 -i 时进 wizard
- ✎ `cli/src/commands/query.ts`（+1 字符）— `interface QueryOpts` → `export interface QueryOpts`（消除 wizard 端的类型强转隐患，verifier 抓的 P2）

零侵入：现有非交互 `cx query KEY --p=v` 路径字符不变；现有 51 测试零回归。

## 正确性 oracle

| 校验 | 结果 |
|---|---|
| `bun run test --run` (cli) | ✅ 70/70（51 原 + 19 新） |
| `bun run typecheck` (root) | ✅ tsc --noEmit 全通 |
| `bun run build:bin` (cli) | ✅ dist/cx 重编 |
| `--help` 显示 `-i, --interactive` | ✅ |
| 非 TTY 场景 → exit 4 + 用法提示 | ✅（`echo "" \| cx query` 不挂死） |

## 度量（baseline 来自 cli/perf-baseline.json @ 2026-06-16T00:22:00Z；候选含 wizard 改动 @ 15:36:18Z）

| 档位 | baseline | 候选（含 wizard） | Δ | 阈值 | 评 |
|---|---|---|---|---|---|
| A 冷启动 p95 | 19ms | **19ms** | 0% | < 50ms 且退化 ≤ 10% | ✅ 零退化 |
| E 批量 100 keepalive total | 866ms | **582ms** | **-33%** | < 1500ms 且退化 ≤ 10% | ✅ 远超目标 |
| B 首次远程 p95 | 649ms | 网络敏感（多次跑 252–352ms） | 网络抖动 | 北极星 150ms（不参与闸） | 参考 |
| C 暖复用 p95 | 250ms | 网络敏感 | 网络抖动 | 北极星 50ms（不参与闸） | 参考 |

bench:check 输出：`✅ 全部档位：回归 + 目标双校验通过`。

evidence-verifier 指出的"after 数字无落盘"已修复——本文件存档。完整 JSON 在 `/tmp/cx-bench-after.txt`（本机临时），关键数字已抄录于上。

## verifier 风险与处置

| verifier 发现 | 等级 | 处置 |
|---|---|---|
| 类型强转 `as Parameters<typeof queryCommand>[1]` 绕过编译期 | P2 | export QueryOpts + 直接传 queryCommand，类型 narrow 安全 ✅ |
| required 空回车 retry 循环无专测 | P2 | 补 2 个测试（year 三次空回车 / domain path :var 空回车后 retry）✅ |
| bench"after"数字无文件记录 | P2 | 本 scorecard 落盘 ✅ |

## 范围与边界

- ✅ wizard 仅参数收集器，复用 queryCommand 下游全部链路（route resolve / path-params / cxGet / 渲染 / 退出码）
- ✅ zero-dep（node:readline/promises 内置）
- ❌ 未做：参数空回车后 filters 缓存的 top-N 提示（避免接 2 个域，保持 wizard 简洁）
- ❌ 未做：path 模板有 2+ `:var` 的多变量场景实测（buildParamSpec 已能正确拆分 path-vars 数组，单测覆盖 1 个 :var 案例；多 :var 在 catalog 里目前仅 :domain，扩展时跑覆盖）

## 决策与下一步

- **promote**：合并到主干（PR）
- 下一可选实验（非本轮）：
  1. 接 `cx filters` 缓存给已知维度参数加可选值提示（实际有未知值时）
  2. 给 `route.timeWindow` 在 wizard 路由选择阶段显示（用户已知时间口径就不会选错）
  3. wizard 完成后可选 "y/n/a"，a = 同时把命令以 `cx query KEY --p=v` 形式打印到 stderr 便于 copy

## 关联

- 触发：`/chexian-evidence-loop 优化 CX CLI` 协议 — `.claude/rules/evidence-loop.md`
- 上下文：CLI v0.2.0「巅峰性能 6 阶段」之后的 feature 扩展（commit 50f75e85 之后）
- 不修改 baseline 文件（candidate 数字不进 baseline，符合"baseline 只在显式 `--write` 时刷新"惯例）
