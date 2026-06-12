# 通用立方体灰度运维 SOP（RED LINE）

policy: append-only

> 来源：PR #595/#600/#601/#602/#603（五个立方体实现）+ #604（灰度开闸 `CUBE_SHADOW_COMPARE='true'`）+ #605（自动哨兵）。
>
> **本 SOP 是这套灰度系统运维知识的唯一事实源**。代码/配置/BACKLOG 各处的零散指针都收敛到这里。改本 SOP 即改全局认知。
>
> **适用**：① 日常巡检（影子对账状态）② 异常处理（按严重度分级）③ 切流流程（影子→正式）④ 调频里程碑（cron 三阶段）⑤ 回滚（两道开关）⑥ 任何修改 `dbEnv.CUBE_*` / `cube-grayscale-sentinel.yml` / `services/duckdb-cube.ts` / `cube-shadow.ts` 的 PR。

## 0. 机制 vs 记忆（先明确边界）

**机制**（自动执行，**不需要人/AI 记**）：
- `dbEnv.CUBE_SHADOW_COMPARE='true'` → 路由内 `tryXxxCube` 自动后台双跑（`services/cube-shadow.ts`）
- ETL → `setDataVersion(指纹)` → `ensureXxxCubeFresh` 后台单飞重建（`services/duckdb-cube.ts`）
- 跨格保单探针 → cost cube 自动降级 `exact=false` 回退原路径
- 每小时 cron → 哨兵跑 → CRITICAL 自动建/找追踪 issue 追加评论（`scripts/sentinel/cube-grayscale-sentinel.mjs` + workflow）
- governance 校验 BACKLOG 派生视图陈旧 → 提示 AI 重渲

**记忆**（人/AI 必须主动查本 SOP）：
- 在做什么（§1）
- 怎么看健康度（§2）
- 异常分级处理（§3）
- 何时切流 / 切流流程（§4）
- 何时降频 / 降频里程碑（§5）
- 怎么回滚（§6）

## 1. 在做什么（系统当前状态）

通用可加性立方体（CubeTrendDay / CubeCostDay / CubeSalesmanDay）已覆盖五条路由族——`trend` / `growth` / `cost` / `kpi`（仅 cost 三项） / `salesman-ranking`。**当前阶段**：灰度阶段 1（影子对账，`CUBE_SHADOW_COMPARE='true'`，PR #604 合并）。

| 项 | 状态 |
|---|---|
| `CUBE_SHADOW_COMPARE` | `'true'`（生产生效） |
| `CUBE_ROUTING_ENABLED` | `'false'`（用户可见行为零变化） |
| 自动哨兵 cron | 每小时 15 分（UTC）— `cube-grayscale-sentinel.yml` |
| 验收标准 | 连续 7 天 `mismatch=0, error=0` → 进入 §4 切流流程 |

数据流（不需记，列出便于排查）：
```
ETL parquet 到位 → PM2 reload → 进程启动 loadMultipleParquet
  → setDataVersion(指纹) → onDataVersionChange 监听者触发预热
  → 预热请求触发立方体后台单飞构建 → builtVersion 与 dataVersion 一致 = ready
  → 后续可服务请求由 tryXxxCube 双跑（影子对账 / 切流后只跑立方体）
```

## 2. 如何查看（巡检入口）

### 2.1 自动产出（推荐，每小时刷新）

| 入口 | 内容 | 保留 |
|---|---|---|
| GitHub issue「立方体灰度哨兵追踪」（label `cube-grayscale-anomaly`） | 仅 CRITICAL/WARN/INFO 异常追加评论；正常情况静默 | 永久 |
| GitHub Actions Cube Grayscale Sentinel run artifact `cube-grayscale-<run_id>/` | 每次 cron 跑的 `verdict.json` + `summary.md` | 30 天 |
| Workflow run 列表（每小时新增一行） | 绿=健康，红=CRITICAL | 90 天 |

### 2.2 手动当下快照

```bash
curl -s https://chexian.cretvalu.com/health | jq '{cubes, cubeShadow}'
```

返回示例与各字段语义：
```jsonc
"cubes": {
  "trend":    { "builtVersion": "<8位指纹>", "building": false, "lastBuildMs": 234,  "lastError": null },
  "cost":     { ...,                          "building": false, "lastBuildMs": 412,  "lastError": null, "exact": true },
  "salesman": { ...,                          "building": false, "lastBuildMs": 189,  "lastError": null }
},
"cubeShadow": {                              // 进程内累计；PM2 reload 重置（设计行为，不算 bug）
  "trend": { "match": 120, "mismatch": 0, "error": 0 },
  // 路由首次双跑前不会出现在此 map（流量极低 / 立方体未就绪时为空属预期）
}
```

| 字段 | 健康值 | 含义 |
|---|---|---|
| `cubes.*.builtVersion` | 与 `/api/data/version` 一致 | 立方体已追上当前数据 |
| `cubes.*.building` | `false`（构建瞬间为 `true` 不算异常） | 没有进行中的构建 |
| `cubes.*.lastError` | `null` | 上次构建无错 |
| `cubes.cost.exact` | `true` | 探针通过，无跨格保单 |
| `cubeShadow.*.match` | 持续累加 | 影子双跑正在发生 |
| `cubeShadow.*.mismatch` | **0** | 立方体与原路径逐字段相等 |
| `cubeShadow.*.error` | **0** | 立方体执行无异常 |

### 2.3 异常发生时看明细

```bash
ssh deployer@162.14.113.44 'sudo /usr/local/bin/deploy-chexian-api logs 200 | grep -E "CubeShadow|TrendCube|CostCube|SalesmanCube"'
```

差异明细（含具体行号/字段值）只进 PM2 日志 `[CubeShadow] MISMATCH`，不上 `/health` 公开端点（避免泄业务数值）。

## 3. 异常分级处理

哨兵输出 / `/health` 中出现以下情况按表处理。

| 严重度 | 触发 | 即时动作 | 根因排查方向 |
|---|---|---|---|
| **CRITICAL** | `cubeShadow.*.mismatch > 0` | 1. **立刻暂停切流计划**（不要合 `CUBE_ROUTING_ENABLED='true'` PR） 2. 进追踪 issue 看哪个路由 3. ssh PM2 日志看差异明细 | A. 立方体改写器口径漂移（最常见 — 原 SQL 模板演进了，立方体没跟上） B. ETL 引入新字段值未在 token 白名单（如 `tonnage_segment` 新增枚举） C. 立方体逻辑 bug |
| **WARN** | `cubeShadow.*.error > 0` | 不阻断流程，记到追踪 issue；当天解决 | 立方体构建失败 / 连接池耗尽 / 内存不足。查 `cubes.*.lastError` |
| **WARN** | `cubes.*.builtVersion` 落后 `/api/data/version` 持续 > 30 分钟 | 不阻断，记追踪 issue | A. cache-warmer 路由未覆盖该立方体路由族（最常见） B. 流量极低无人触发预热 C. 构建失败循环 |
| **INFO** | `cubes.cost.exact === false` | 不阻断；**这是 ETL 数据质量信号** | 真实数据出现跨格保单 — 同 policy_no 的批改行改了机构/起保日/客户类别。复盘 `pipelines/transform.py` 批改字段处理 + 业务核实是否合规 |

### CRITICAL 根因排查 SOP（最常用）

1. **看哪个路由出 mismatch** — 追踪 issue 评论里第一行就是路由名
2. **看差异**：`ssh deployer@162.14.113.44 'sudo /usr/local/bin/deploy-chexian-api logs 200 | grep "CubeShadow.*MISMATCH"' | head -5`
3. **判定 A/B/C**：
   - **A 口径漂移**：在原 SQL 生成器（`sql/<route>.ts`）找近期 commit，看 SELECT 列 / WHERE 条件 / GROUP BY 是否变了。立方体改写器（`sql/cube/<route>-cube.ts`）需要同步更新 + 补等值测试。改写器有 fail-fast 断言能直接报"模板演进对不上"
   - **B ETL 新值**：`duckdb -c "SELECT DISTINCT <可疑字段> FROM '数据管理/warehouse/...'"` 直查源数据，对比立方体 token 白名单（`sql/cube/servability.ts`）。若新值确实落到白名单外，要么扩白名单（结构性安全），要么走结构性回退（默认行为）
   - **C 立方体 bug**：补集成测试复现 → 修生成器/状态机 → 等值测试钉死
4. **临时止血**：VPS 改 `CUBE_SHADOW_COMPARE` 为 `'false'` + `sudo /usr/local/bin/deploy-chexian-api reload`，先停影子双跑（用户行为不受影响，因为原本就走原路径）
5. **根治后**：恢复 `'true'` 观察 24 小时无 mismatch 才算修好

## 4. 切流流程（影子 → 正式）

**触发条件**（必须全部满足）：
- ✅ 连续 **7 天** 自动哨兵无 CRITICAL（追踪 issue 无新评论 / artifact 全绿）
- ✅ `cubeShadow.*.mismatch=0`, `error=0` 持续累计
- ✅ `cubes.cost.exact` 不长期为 `false`（偶发 INFO 可接受，但需要 ETL 那边有应对计划）

**动作**：
1. 提部署链 PR：把 `server/ecosystem.config.cjs` 的 `CUBE_SHADOW_COMPARE: 'true'` 改成（追加）`CUBE_ROUTING_ENABLED: 'true'`
2. **按 deploy-chain SOP §2 操作**：禁止 auto-merge，人工选业务低峰窗口合并，merge 后盯前 5 分钟 Actions deploy run + `/health`
3. 切流后第 1 天高频巡检（每小时 `/health` 看一眼）；7 天无 CRITICAL → 进入"切流后观察期"
4. 把 BACKLOG `2026-06-12-claude-055a12` 从 BLOCKED → DOING（进入观察期）

## 5. 调频里程碑（BACKLOG uid=2026-06-12-claude-055a12）

| 阶段 | 触发条件 | cron | 月跑次 |
|---|---|---|---|
| **当前 — 灰度阶段 1（影子对账）** | `CUBE_SHADOW_COMPARE='true'` 已生效 | `15 * * * *` | 720 |
| 切流后观察期 | §4 切流 PR 合并 + 30 天稳定 | `15 */3 * * *` | 240 |
| 长期生产稳态 | 观察期后再 30 天无 CRITICAL | `15 */6 * * *` 或并入 ETL 哨兵 cron | 120 |

每个阶段切换时改 `cube-grayscale-sentinel.yml` 的 `cron:` 一行 + 推进 BACKLOG 任务（DOING → DONE 附 commit 证据）。

**当前阶段 cron 不要随便降频**：mismatch 出现越早干预越好；public repo 无 GHA minute 成本。

## 6. 回滚（两道开关，按需选用）

```bash
# 工具一：关影子对账（保留立方体在内存里，停止后台双跑）
# 适用场景：哨兵 mismatch 误报 / 想做静态分析期间静音
ssh deployer@162.14.113.44
sudo sed -i "s/CUBE_SHADOW_COMPARE: 'true'/CUBE_SHADOW_COMPARE: 'false'/" /var/www/chexian/server/ecosystem.config.cjs
sudo /usr/local/bin/deploy-chexian-api reload

# 工具二：关正式路由（切流后回退到原路径）
# 适用场景：切流后发现性能/正确性问题
sudo sed -i "s/CUBE_ROUTING_ENABLED: 'true'/CUBE_ROUTING_ENABLED: 'false'/" /var/www/chexian/server/ecosystem.config.cjs
sudo /usr/local/bin/deploy-chexian-api reload
```

**真彻底回滚**：revert 引入立方体的 PR 链（#595 → #600 → #601 → #602 → #603 → #604）。但**几乎不需要**——双开关默认 `'false'` 即原路径，立方体只是内存里的额外表，关掉开关就等同从未存在。

## 7. 禁止

- ❌ 在 CRITICAL 未消除前提切流 PR（违背"7 天 mismatch=0"硬条件）
- ❌ 在哨兵报 WARN/INFO 时擅自降低 cron 频率（灰度还没到稳定期）
- ❌ 把差异明细日志（含业务数值）放到 `/health` 公开端点
- ❌ 修改 `services/duckdb-cube.ts` 状态机的 `builtVersion` 记账顺序（结构性规避 B311 竞态，详见文件头注释）
- ❌ 在 `cube-shadow.ts` 的 `diffRows` 里放宽容差（`1e-9` 已是 DuckDB 浮点求和顺序差异的物理下限）
- ❌ 把 PR `Cube Grayscale Sentinel` 工作流的 `cron` 改为 `*/N * * * *`（每 N 分钟），会让 cubeShadow 的 7 天判定噪音过大

## 关联

- 设计文档：[开发文档/架构设计/通用立方体查询加速方案.md](../../开发文档/架构设计/通用立方体查询加速方案.md)
- 实现：`server/src/sql/cube/*.ts`（5 个立方体 SQL）+ `server/src/services/duckdb-cube.ts`（状态机）+ `server/src/services/cube-shadow.ts`（影子对账）
- 哨兵：`scripts/sentinel/cube-grayscale-sentinel.mjs` + `.github/workflows/cube-grayscale-sentinel.yml`
- 母 PR：#595（趋势） / #600（增长） / #601（成本） / #602（KPI） / #603（业务员） / #604（灰度开闸+/health 观测面） / #605（自动哨兵）
- BACKLOG 主任务：uid=2026-06-11-claude-90a92c（立方体实施）
- BACKLOG 调频里程碑：uid=2026-06-12-claude-055a12（BLOCKED 等切流稳定）
- 部署链规则：[deploy-chain-sop.md](./deploy-chain-sop.md)（部署链 PR 禁止 auto-merge）
- AGENTS.md §8.2 append-only：本文件作为新增独立护栏文件，无需 `[policy-override]` 授权
