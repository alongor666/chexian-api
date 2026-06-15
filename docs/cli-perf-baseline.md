# cx CLI 性能基线与自净化

> 单一事实源：[cli/perf-baseline.json](../cli/perf-baseline.json) — 由 `bun run bench:write` 自动维护。
> 不在此文件手抄数字（会漂）；本文只解释 **怎么量、谁来防退化、降级了去哪里查**。

## 1. 北极星目标（巅峰性能）

| 档位 | 含义 | 目标 p95 | 当前 (2026-06-15) | 状态 |
|---|---|---|---|---|
| **A** | 冷启动 `cx --version` | ≤ 50ms | 17ms | ✅ |
| **B** | 单次远程 `cx health`（含 TLS 握手） | ≤ 150ms | 501ms | ❌ 物理瓶颈 |
| **C** | 同进程热复用 fetch | ≤ 50ms | 211ms | ⚠️ 网络抖动 |
| **D** | 批量 100 次串行（无 dispatcher） | — 仅对照基线 | 6687ms | — |
| **E** | 批量 100 次（undici keep-alive + HTTP/2 + 并发 8） | ≤ 1500ms | **964ms** | ✅ |

**核心成果**：阶段 2（undici Agent）让 E vs D = **6.9x 加速**（6687ms → 964ms），平均请求 67ms → 10ms。

**B 维度的物理瓶颈**：cx 启动 ~30ms + Bun 模块加载 ~50ms + TLS 握手 ~110ms + RTT 70ms + 服务端处理 ~80ms ≈ 340ms。
跨进程 TLS session 持久化（[cli/src/tls-session.ts](../cli/src/tls-session.ts)）在 **Node 调用路径**下生效，但
`bun --compile` 出的二进制 runtime 不用 undici 全局 dispatcher（Bun 平台限制），所以单次 cx 调用受益有限。
要进一步压 B，得让服务端 route-cache LRU 命中率接近 100%（见 §4）。

## 2. 跑 benchmark

```bash
cd cli
bun install                          # 装依赖（含 undici）
bun run build:bin                    # 出 dist/cx 二进制
bun run bench                        # 跑全档 N=20，输出到 stdout
bun run bench:write                  # 覆盖 perf-baseline.json
bun run bench:check                  # 对照 baseline，任一档 p95 退化 > 10% exit 1
node scripts/benchmark.mjs --only=A  # 只跑某档（CI 用）
node scripts/benchmark.mjs --n=50    # 增加样本数（降抖动）
```

每档语义参 [cli/scripts/benchmark.mjs](../cli/scripts/benchmark.mjs) 文件顶 docstring。

## 3. 自净化机制（防退化）

| 触发 | 工具 | 闸值 | 失败动作 |
|---|---|---|---|
| 每个 PR（改 `cli/**` 时） | [.github/workflows/cli-perf-sentinel.yml](../.github/workflows/cli-perf-sentinel.yml) | A 档 p95 ≤ 50ms（机器无关硬阈值） | ❌ 阻断 merge，summary 提示排查新依赖 / circular import / 异步副作用 |
| 本地预 push | `bun run bench:check` | 任一档 p95 退化 > 10% | exit 1，提示退回 baseline |
| 周期手测（建议每 2 周） | `bun run bench:write` 落新 baseline | — | 提交新 baseline，PR body 解释退化原因 |

**网络段（B/C/D/E）为什么不进 CI 闸**：
- B/C/D/E 都需要请求生产 `https://chexian.cretvalu.com`，GitHub Actions runner 跨地域 RTT 远高于用户本地
- 绝对值与本地不可比，相对值需要 CI baseline（成本高）
- 100 次批量会触发服务端 IP 限流
- → 这些档由 **本地 + 手动周期跑** 守护

## 4. 服务端协同（已闭环）

```
ETL 完成 → sync-and-reload.mjs → PM2 reload → app.ts 重启
                                                ├→ cacheWarmer.warmStartupCritical()  同步关键路径
                                                └→ cacheWarmer.warmCommonRoutes()     异步常用路由
```

- 文件：[server/src/services/cache-warmer.ts](../server/src/services/cache-warmer.ts)
- 触发：[scripts/sync-and-reload.mjs](../scripts/sync-and-reload.mjs) §reload 阶段
- 命中：route-cache LRU 命中时服务端响应 < 1ms（log 里 `cache hit` 标记）
- **覆盖度盲点**：`COMMON_WARM_ROUTES` 是手写列表，未必覆盖所有热路由。命中率埋点 + 自动扩面属于后续 BACKLOG。

## 5. 降级历史

> PR 引入 p95 退化（即使过 CI 闸）时，在此追加一行：**日期 · PR 链接 · 退化档位与幅度 · 原因 · 跟进 issue**。

| 日期 | PR | 档位 | 退化 | 原因 | 跟进 |
|---|---|---|---|---|---|
| — | — | — | — | （首批 baseline） | — |

## 6. 不会再做的优化（投入产出比过低）

- **B 档进 CI 闸**：RTT 抖动 + 限流 → 误报率 > 信号率
- **冷启动 < 10ms**：物理已在 17ms（V8 启动开销 ≥ 10ms，再压收益微薄）
- **跨进程 TLS ticket 在 Bun 二进制下生效**：需要等 Bun 提供 undici dispatcher 兼容层
- **D 档优化**：D 是「无 dispatcher」对照组，不优化（用 E 即可）

## 7. 关联

- 设计与原始决策：会话「巅峰性能行动方案」（2026-06-15）
- 业界对标：`gh`（Go AOT，cold ~30ms）/ `stripe`（Go AOT，~30ms）/ `kubectl`（Go AOT，本地 < 5ms）
- 标准源：Nielsen 三阈值（100ms = 即时感知）· Google RAIL 模型 · HTTP/2 RFC 9113 · TLS 1.3 RFC 8446
