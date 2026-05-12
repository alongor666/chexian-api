# LR 平移预测口径硬化基线差异对账

**生成日期**: 2026-05-11
**预测年**: 2026  
**历史窗口**: [2023, 2024, 2025]  
**估值截止**: 2026-05-11  
**参数哈希**: `d1e80197391650d9…`(完整 64 位见各阶段 `summary.json` 的 `run_params_hash` 字段)

**复现环境**:
- DuckDB CLI: `v1.5.2 (Variegata) 8a5851971f`
- Python: `3.14.3`(项目依赖 `@duckdb/node-api`,本对账用 DuckDB CLI 直查 + Python 脚本聚合)
- Parquet 分片:`数据管理/warehouse/fact/policy/current/` 共 9 个文件
- 脚本:`数据管理/pipelines/diagnose_lr_projection.py` @ `c4873bb`(B287 阶段 0 硬化提交)
- 运行命令:`python3 数据管理/pipelines/diagnose_lr_projection.py --debug-hardening-stage {raw|dedup|cutoff|final} --snapshot-tag {tag}`

## 一、整体满期赔付率四阶差异

| 阶段 | 2026 全年预期 LR | 历史 2023-2025 LR | 与 raw 累计差 |
|------|------------------|--------------------|---------------|
| `raw` | 73.09% | 73.31% | — |
| `dedup` | 68.18% | 68.82% | -4.91 pp |
| `cutoff` | 68.18% | 68.82% | -4.91 pp |
| `final` | 68.18% | 68.82% | -4.91 pp |

## 二、三项影响分解(对账恒等式)

| 影响来源 | 计算 | 数值 |
|---------|------|------|
| 去重影响 | `dedup − raw` | **-4.91 pp** |
| 估值截止影响 | `cutoff − dedup` | **+0.00 pp** |
| 排序 tie-breaker 影响 | `final − cutoff` | **-0.00 pp** |
| **合计(三项)** | — | **-4.91 pp** |
| 总影响 | `final − raw` | **-4.91 pp** |
| 残差(应 ≈ 0) | `总 − 三项` | +0.00 pp |

## 三、影响来源解释

### 3.1 去重影响

**口径**: 引入 `v_policy_base_dedup` 视图,严格对齐 `server/src/sql/shared/policy-dedup.ts` 的 B252 修复:
- `GROUP BY policy_no, CAST(insurance_start_date AS DATE)`
- `HAVING SUM(premium) > 0`(排除全退保 / 负向批改净额 ≤ 0 的保单)
- 字段聚合:`premium = SUM(批改净额)`,其他字段 `ANY_VALUE()`

**为何变化大**: 原口径裸 `read_parquet ... LEFT JOIN claims_agg`,同一保单的批改副本会让赔款被重复 JOIN 计算 N 倍。去重后赔款回到真实水平,赔付率显著下降。

### 3.2 估值截止影响

**口径**: `v_claims_agg` 增加 `WHERE report_time <= hist_as_of`,防止后续报案泄漏到历史回放或月度差异桥场景。

**当前数据切片下为 0**: 此切片下 claims 表最大 `report_time` 早于 `hist_as_of`,无赔案被过滤。**未来何时浮现**:做月度差异桥(month-over-month bridge)、历史回放(historical replay)、或滚动估值(把 `hist_as_of` 回滚到更早时点)时,此项会非零。这是**结构性护栏**而非数值性影响——一旦缺失会出现因果倒置的伪相关。

### 3.3 排序 tie-breaker 影响

**口径**: `DISTINCT ON (claim_no)` 排序键扩为 `ORDER BY claim_no, report_time DESC, settlement_time DESC NULLS LAST, payment_time DESC NULLS LAST`,消除 tie 时输出非确定性。

**当前数据切片下为 0**: 此切片下同一 `claim_no` 多行场景较少,且 DuckDB 当前实现下排序稳定。**未来何时浮现**:claims 表新增批改副本、或 DuckDB 升级后排序实现变更时,此项会非零。这是**确定性护栏**——保证脚本反复跑结果完全一致,差异桥才能可信。

### 3.4 历史 LR 与全年预期 LR 影响差异说明

读者可能注意到:**全年预期 LR 跌 -4.91 pp,而历史 LR 只跌 -4.49 pp**,差值 0.42 pp。两者来自同一去重 CTE,为什么影响不同?

| 口径 | raw | dedup | 差 |
|------|-----|-------|-----|
| 历史 2023-2025 LR | 73.31% | 68.82% | -4.49 pp |
| 2026 全年预期 LR | 73.09% | 68.18% | -4.91 pp |
| **差值** | -0.22 pp | -0.64 pp | **-0.42 pp** |

**原因**:历史 LR 是 `SUM(claims) / SUM(earned_premium)` 全口径加总;2026 全年预期 LR 是 **cell-level 历史 LR × 2026 全年预估 earned_premium 加权**。去重对各 cell 的影响**不均匀**——批改副本集中的 cell(典型如摩托车单交、营业货车主全)赔款虚高更严重,这些 cell 在 2026 业务结构中的权重又与历史不同,所以两个口径的去重影响不会精确相等。

差值 0.42 pp 在数学上是 cell-level 去重影响向量 与 2026 vs 2023-2025 权重差向量 的协方差,**非异常**,符合"业务结构平移"的方法论假设。

### 3.5 方法论局限性

- **`ANY_VALUE()` 维度选取的轻微不确定性**:`v_policy_base_dedup` 对 `customer_category` 等非 GROUP BY 字段使用 `ANY_VALUE()`,同一 `policy_no` 多副本时取哪一行是 DuckDB 内部实现决定。当前数据下反复跑差异 < 1e-5(回归测试 `test_distinct_on_determinism` 容忍上限),业务无感,但在做长尾 cell 分析时若同一保单批改前后客户类别变更,可能产生 cell 归属切换。未来可加 `ORDER BY insurance_start_date DESC` 收敛到"最新批改副本"语义。

## 四、单元覆盖分布对比

| 阶段 | 4d_original | 3d_fallback | 2d_fallback | 1d_fallback | overall | override |
|------|-------------|-------------|-------------|-------------|---------|----------|
| `raw` | 38 | 12 | 46 | 20 | 23 | 0 |
| `dedup` | 39 | 11 | 46 | 20 | 23 | 0 |
| `cutoff` | 39 | 11 | 46 | 20 | 23 | 0 |
| `final` | 39 | 11 | 46 | 20 | 23 | 0 |

## 五、新基线接受建议

- **总体赔付率变化**: -4.91 pp
- **方向**: 下降(去重剔除了批改副本带来的赔款虚高)
- **数学一致性**: 三项分解和与总差残差 = +0.00 pp,恒等式成立

**建议**: 接受新基线作为后续阶段(阶段 1-5)的回归基准。本变化来自口径与项目主分支(`policy-dedup.ts` / `metric-registry`)对齐,不引入新算法,属于工程债清理。

---

## 六、自检清单(merge 前)

- [x] 三项分解残差 < 0.01 pp(实测 +0.00 pp)
- [x] 去重影响方向负向(实测 -4.91 pp,剔除批改副本后赔款回归真实水平)
- [x] 估值截止与 tie-breaker 在当前数据下为 0(结构性护栏,见 §3.2 / §3.3 "未来何时浮现")
- [ ] **待 follow-up**:`4d_original` 覆盖单元数 38 → 39 反直觉变化(去重后样本应非增),需 DuckDB 直查具体 cell 验证是边界跨阈值还是去重逻辑反向

## 七、变更追溯

- **提交**: `c4873bb` feat(lr-projection): 阶段 0 口径硬化 — 保单去重 + 估值截止 + tie-breaker (B287)
- **PR**: [#355](https://github.com/alongor666/chexian-api/pull/355)
- **合入 main**: 提交 `29f5c00`(Merge pull request #355)
- **遗留任务**: PR-0.5(移除 `--debug-hardening-stage` 临时开关)、PR-1(薄模块化拆分)、§六待补的 4d_original 反直觉验证
