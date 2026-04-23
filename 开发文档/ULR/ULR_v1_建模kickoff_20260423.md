# Snapshot-Constrained ULR v1 建模 Kickoff

**版本**：v1a-kickoff · **日期**：2026-04-23 · **状态**：评审通过，进入建模阶段
**关联文档**：[ULR理赔增强研究_20260422.md](../../数据管理/数据分析报告/ULR理赔增强研究_20260422.md)（方案正文）

---

## 0. 正式术语定义

> **Snapshot-Constrained ULR**: A ultimate loss ratio *nowcast* derived without access to historical *incurred*-loss development triangles. It relies on (a) mature-cohort **paid** development learned on 2021–2024 history, (b) reported-claim **posterior** adjustment, and (c) an **IBNR** layer for unreported development. It **does not** constitute a rigorous incurred-triangle reserving methodology, does not treat the current incurred snapshot as ultimate truth, and does not produce a statutory reserve opinion.

**不声称清单**（必须出现在最终评审结论原文）：

- [ ] 不声称具备严格 historical incurred triangle 回测
- [ ] 不把 2025 当作终极真值
- [ ] 不预测未起保新单
- [ ] 不出具终极准备金充足性意见

---

## 1. 口径锁定（RED LINE）

| 项 | 值 | 备注 |
|---|---|---|
| 预测对象 | 2026 YTD 已起保保单 | `insurance_start_date` ∈ [2026-01-01, 估值日] |
| 目标指标 | 满期/已赚终极赔付率 nowcast | Earned LR ultimate |
| 分子 | 终极赔款 = 已决已付 + 已报案未决发展 + IBNR | Loss only，不含 ALAE/ULAE |
| 分母 | 满期/已赚保费 | `earned_days / policy_term`，闰年感知 |
| 业务范围（v1a） | 燃油能源 + 非营业个人客车 + 商业险 + 主全 | `is_nev=false` 为**过滤条件**非特征 |
| v1b 扩展路径 | 主全+交三分层模型 / NEV 独立 submodel | 见 §10、§11 |
| 排除 | 交强（独立对照）、摩托（独立模型已有） | — |

**核心事实锚点**：历史窗口 2021–2024，样本 171,621 单，保费 30,536.0 万，已发生赔款 17,403.5 万，原始 LR **56.99%**（仅作为 **provisional historical baseline**，不是最终 prior）。

---

## 2. 三层模型结构

```
           Ultimate Loss Ratio nowcast
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
 Underwriting     Reported Claim     IBNR Layer
     Prior           Overlay         (Unreported
  (全量保单)     (仅已报案保单)      + Tail)
```

### 2.1 Underwriting Prior
- **输入**：起保时可知变量，排除理赔字段、机构、渠道、经代/业务员、定价系数、风险等级、customer_source。
- **输出**：保单级 `expected_freq` × `expected_severity` = `expected_loss` → prior LR。
- **模型**：Frequency GLM (Poisson/NegBin) + Severity GLM (Gamma/LogNormal)；若 frequency-severity 相关性检验显著（见 §3），改用 Tweedie。

### 2.2 Reported Claim Overlay
- **输入**：案件类型、是否人伤、死亡重伤、未决状态、报案场景（第一现场/非第一现场）、出险时段（凌晨/高峰/夜间）、工作日/周末，后续补节假日。
- **输出**：已报案保单的 ultimate severity adjustment + tail factor + posterior LR。
- **禁止**：overlay 变量不得混入 prior 训练数据。

### 2.3 IBNR Layer
- **主方法**：Bornhuetter-Ferguson (BF) with industry prior ELR
  - 车损 ELR 先验：约 55%（待 §4 mature cohort 标定）
  - 三者责任 ELR 先验：约 48%（待标定）
  - 人伤 ELR 先验：约 65%（待标定）
- **对照**：Benktander（BF 与 CL 的加权中间值，对小样本 cohort 更稳）
- **排除**：纯 paid CL（v1 cohort 样本不足以稳定估计长尾 LDF）
- **输出**：未报案 IBNR 赔款 + 已报案未充分发展 tail。

---

## 3. 7 处技术参数预定标（建模前锁定）

### P1. IBNR 方法选型
- **主**：BF with industry prior ELR
- **对照**：Benktander（小样本场景）
- **排除**：纯 paid CL

### P2. Maturity 阈值按险别分档

| 险别 | paid LDF 阈值 | 未决占比阈值 | 预期 mature 截止 cohort |
|---|---|---|---|
| 车损（短尾） | < 1.02 | < 3% | 2023（约 24 个月后） |
| 三者责任（中尾） | < 1.05 | < 8% | 2022（约 36 个月后） |
| 人伤 / BI（长尾） | < 1.10 | < 12% | 2021（约 48 个月后） |

- **Development age 基准**：**policy-year triangle**，`dev_age = 估值日 − insurance_start_date`
- **2024 cohort** 默认 developing；仅车损层若 LDF 通过检验可部分纳入

### P3. 频率-严重度相关性检验
- **分箱法**：按 (车系×价格带) 分 K 桶，高/低频桶平均严重度 t-test
- **Copula**：拟合 Gaussian + Clayton copula，输出 tail dependence λ
- **分水岭**：如 Spearman > 0.15 或 λ_lower > 0.1 → 改 Tweedie/联合分布

### P4. Rolling backtest 窗口
- **Training**：t-4 ~ t-1 年（4 年滚动）
- **Validation**：t 年的 3/6/9/12 月观察点
- **Walk-forward**：t ∈ {2022, 2023, 2024}，共 3 组验证

### P5. Credibility shrinkage 层次（加密一层）
```
车系×价格带 → 车系 → 品牌×价格带 → 品牌 → 车型分类 → baseline
```
（原方案缺 "车系" 和 "品牌" 单独层）

### P6. 严重度按险种子模型
- `severity_车损`（sum_insured = 车损保额或 new_vehicle_price 代理）
- `severity_三者`（sum_insured = 三者责任限额）
- `severity_座位`（sum_insured = 座位险限额）
- 保单级合成：按各险种 earned_exposure 加权
- `log(sum_insured)` 作为 GLM offset；车损保额未补齐前 new_vehicle_price 仅做代理并标注限制

### P7. 预测区间推断
- **Bootstrap**（参数层）：1000 轮 resample，输出 P05/P50/P95
- **Parametric**（方法层）：BF 方法的 Mack 标准误作对照

---

## 4. 必备交付表（10 张）

| # | 表名 | 脚本 | 状态 |
|---|------|------|------|
| T1 | 变量泄漏审计表 | `ulr_v1_leakage_audit.py`（待开发） | 🟡 本 kickoff §5 已有草表 |
| T2 | Development maturity 表 | `ulr_v1_maturity.py` | 🟢 本 PR 交付 |
| T3 | NCD 时点验证表 | `ulr_v1_ncd_timing_validation.py` | 🟢 本 PR 交付 |
| T4 | IBNR 对账表 | `ulr_v1_ibnr_reconciliation.py`（待开发） | 🔴 建模 PR |
| T5 | 3/6/9/12 观察窗回测表 | `ulr_v1_rolling_backtest.py`（待开发） | 🔴 建模 PR |
| T6 | Prior/Overlay/IBNR 分层误差表 | 同 T5 | 🔴 建模 PR |
| T7 | 频率-严重度相关性矩阵 | `ulr_v1_freq_sev_corr.py`（待开发） | 🔴 建模 PR |
| T8 | 机构 Shadow Challenger 表 | `ulr_v1_shadow_challenger.py`（待开发） | 🔴 建模 PR |
| T9 | 新能源单独建模可行性表 | `ulr_v1_nev_feasibility.py`（待开发） | 🔴 v1b 规划 |
| T10 | 险种边界表 | 本 kickoff §11 静态说明 | 🟢 本 PR 交付 |
| T11（补）| Tail factor 三分层表 | 建模 PR 内联 | 🔴 建模 PR |

---

## 5. T1 · 变量泄漏审计表（草稿，建模 PR 定稿）

| 字段 | 来源 | 起保时可知 | 理赔后可知 | 归属层 | 处理结论 |
|---|---|:-:|:-:|---|---|
| `insurance_start_date` | PolicyFact | ✅ | — | 时点基准 | 作为 development age 锚点 |
| `plate_prefix` / `plate_city` | PolicyFact | ✅ | — | Prior 特征 | 号牌地进入频率+严重度模型 |
| `vehicle_category` / `brand` / `series` | PolicyFact | ✅ | — | Prior 特征 | 严重度主变量 |
| `price_band` / `new_vehicle_price` | PolicyFact | ✅ | — | Prior 特征 | 严重度 + `log(price)` offset 代理 |
| `driver_age` / `vehicle_age` | PolicyFact | ✅ | — | Prior 特征 | 频率主变量 |
| `business_nature` | PolicyFact | ✅ | — | Prior 特征 | 频率主变量 |
| `pre_booking_days` | PolicyFact | ✅ | — | Prior 特征 | 频率特征 |
| `seat_count` | PolicyFact | ✅ | — | Prior 特征 | 严重度特征（座位险相关） |
| `no_claim_bonus` (商业NCD文本) | PolicyFact | ⚠️ 81% 一致 | — | **Overlay** | T3 CONDITIONAL，prior_1_claim 一致率仅 45% → 不进 Prior |
| `compulsory_ncd_factor` | PolicyFact 派生 | ✅ | — | Prior 监控 | 仅作监管一致性检验，不进入训练 |
| `is_nev` | PolicyFact | ✅ | — | **过滤条件** | v1a 固定为 false |
| `insurance_grade` | PolicyFact | ✅ | — | **排除** | 结构性风险等级，易内生 |
| `customer_source` / `terminal_source` | PolicyFact | ✅ | — | **排除** | 渠道反馈回路风险 |
| `agent_name` / `salesman_name` / `branch` | PolicyFact | ✅ | — | **排除** | Shadow challenger 对照用 |
| `commercial_pricing_factor` | PolicyFact | ✅ | — | **排除** | 避免定价反馈 |
| `case_type` / `is_bi` / `is_fatal` | ClaimsDetail | — | ✅ | Overlay | 已报案 posterior 特征 |
| `reserve_status` (未决) | ClaimsDetail | — | ✅ | **方法层** | BF/tail adjustment 输入，非线性特征 |
| `first_scene` / `remote_scene` | ClaimsDetail | — | ✅ | Overlay | 严重度调整 |
| `accident_hour` (凌晨/高峰) | ClaimsDetail | — | ✅ | Overlay | 时段调整 |
| `weekday_flag` / `holiday_flag` | ClaimsDetail | — | ⚠️ | Overlay | 节假日日历维表补齐后启用 |

---

## 6. T2 · Development Maturity 实测结果（2026-04-23）

脚本：[`数据管理/pipelines/ulr_v1_maturity.py`](../../数据管理/pipelines/ulr_v1_maturity.py)
完整报告：[`ulr_v1_maturity_20260423.md`](../../数据管理/数据分析报告/ulr_v1_maturity_20260423.md) / [`.json`](../../数据管理/数据分析报告/ulr_v1_maturity_20260423.json)

**成熟 Cohort 清单（9/12 通过）**：

| 险别 | 成熟 cohort | 说明 |
|---|---|---|
| 车损（短尾） | 2021, 2022, 2023 | 最大 LDF=1.0115（2023），未决占比<0.20% |
| 三者责任（中尾） | 2021, 2022, 2023 | 最大 LDF=1.0232（2023），未决占比<0.30% |
| 人伤/BI（长尾） | 2021, 2022, 2023 | 最大 LDF=1.0982（2023），逼近 1.10 阈值 |

**2024 全险别 developing**（dev_age=27 月）：
- 车损 LDF=1.4556（阈值 1.02）❌
- 三者 LDF=1.3981（阈值 1.05）❌
- 人伤 LDF=2.4689（阈值 1.10）❌

**关键洞察**：
- **训练窗口锁定 2021-2023**（所有险别成熟），样本量 1,291,988 保单（425K+413K+452K）
- 2023 人伤 LDF=1.0982 临界通过，需在 backtest 中重点关注其 stability
- 2024 cohort 在 v1a 中只作为 developing holdout，不进入训练

---

## 7. T3 · NCD 时点验证实测结果（2026-04-23）

脚本：[`数据管理/pipelines/ulr_v1_ncd_timing_validation.py`](../../数据管理/pipelines/ulr_v1_ncd_timing_validation.py)
完整报告：[`ulr_v1_ncd_timing_20260423.md`](../../数据管理/数据分析报告/ulr_v1_ncd_timing_20260423.md) / [`.json`](../../数据管理/数据分析报告/ulr_v1_ncd_timing_20260423.json)

**验证逻辑**：续保单的 `no_claim_bonus` 必须基于 **上一保单期** 的出险历史生成。对续保单 P_t（起期 `t_start`），其 `no_claim_bonus` 应反映 P_{t-1} 期内（`t_start - 1y` ~ `t_start`）的 `accident_time` 落入的赔案数，而非 P_t 期内未来赔案。

**实测结果**（样本 513 条，目标 1000 但受 VIN+起期差 180-540 天配对约束）：

| 判定 | 一致率 | 未识别率 | 结论 |
|---|---|---|---|
| **CONDITIONAL** | **81.09%** | 0.00% | 降级为 Overlay 特征，不进入 Prior |

**按上期出险次数分档**：

| 上期出险次数 | 样本量 | 一致率 | 评价 |
|---|---:|---:|---|
| 0 次（应升档 UP） | 437 | **86.04%** | 合理，少量档位错配（DOWN_1 占 9.6%） |
| 1 次（应 DOWN_1） | 66 | **45.45%** ⚠️ | **异常**，51.5% 仍显示 UP |
| 2 次（应 DOWN_2） | 8 | 100% | 合理 |
| 3+ 次（应 DOWN_3+） | 2 | 100% | 合理 |

**关键洞察**：
- prior_1_claim 异常低：52% 的"上期出 1 次案"保单本期 NCD 仍显示"没有发生赔付"（UP）
- 可能原因：
  1. 小额快处赔案豁免 NCD 浮动（某些公司 <2000 元不计入）
  2. 赔案跨期（`accident_time` 接近 P_{t-1} 期末，NCD 结算时尚未录入）
  3. 商业险 NCD 与交强 NCD 混淆（本验证针对 `no_claim_bonus` 商业险 NCD 文本）
  4. 部分保单为首年投保（实际显示 "首年投保或未发生浮动"=LEVEL）
- **决策**：`no_claim_bonus` **不进入 Prior**，作为 Overlay 辅助特征 + 监控信号保留

**替代方案**：
- 频率模型可用 `business_nature`、`driver_age`、`pre_booking_days`、`plate_city` 作为风险代理
- 如未来需要引入 NCD 信息，使用 `compulsory_ncd_factor`（监管强制，时点严格前置）

---

## 8. 验收 Checklist（建模阶段启动前）

- [x] 口径声明完整（§1）
- [x] 三层结构 Prior + Overlay + IBNR（§2）
- [x] 7 处技术参数预定标（§3）
- [x] 10 张必备表清单（§4）
- [x] 变量泄漏审计草表（§5）
- [x] Development maturity 阈值按险别分档（§3 P2、§6）
- [x] Credibility shrinkage 层次补全（§3 P5）
- [x] 严重度按险种子模型（§3 P6）
- [x] 预测区间推断方法明确（§3 P7）
- [x] T2 maturity 表实际运行结果回填（§6，训练窗口锁定 2021-2023）
- [x] T3 NCD 时点验证实际运行结果回填（§7，NCD 降级为 Overlay）

---

## 9. 建模阶段放行条件（逐项签字）

| 项 | 负责人 | 状态 |
|---|---|---|
| T2 运行通过 → mature cohort 清单 | @claude | ✅ 2021-2023 全险别成熟 |
| T3 运行通过 → NCD 时点结论 | @claude | ✅ CONDITIONAL (81%), NCD 降级 Overlay |
| 频率-severity 相关性检验 → Tweedie vs GLM 决策 | @claude | 🔴 建模 PR |
| IBNR 先验 ELR 标定 → mature cohort 导出 | @claude | 🔴 建模 PR |
| Rolling backtest → 输出误差矩阵 | @claude | 🔴 建模 PR |
| 机构 Shadow Challenger → 误差损失量化（阈值：RMSE 增加 <20% 可接受） | @claude | 🔴 建模 PR |
| 最终评审结论模板 → 使用 §0 术语定义 | @user | 🔴 建模 PR |

---

## 10. v1a → v1b 扩展路径

| 阶段 | 业务范围 | 触发条件 |
|---|---|---|
| **v1a**（本 kickoff） | 燃油 + 非营业个人客车 + 商业主全 | 当前 |
| v1b.1 | + 商业交三 | v1a 回测通过后 |
| v1b.2 | + 新能源独立 submodel | T9 可行性表通过后 |
| v1b.3 | + 交强险对照层 | v1a/v1b.1 稳定后 |
| **不纳入** | 摩托（独立模型已有）、营业性车辆 | — |

---

## 11. T10 · 险种边界表

| 险种 | v1a | v1b | 排除 | 理由 |
|---|:-:|:-:|:-:|---|
| 商业险 · 主全（车损+三者+驾乘） | ✅ | ✅ | | 核心分析对象 |
| 商业险 · 交三（三者+交强） | | ✅ | | 结构差异大，分层建模 |
| 商业险 · 单车损 | | | ✅ | 样本不足 |
| 交强险（独立） | | ⚠️ 对照 | | NCD 监管强制，无自主空间 |
| 摩托车险 | | | ✅ | `moto_loss_ratio_development.py` 已有专门模型 |
| 营业性车辆 | | | ✅ | 风险结构与非营业差异过大 |

---

## 12. 下一步（本 PR 后）

1. **合并本 PR** → kickoff 文档 + T2 + T3 脚本与结果
2. **开新分支 `feat/ulr-v1-modeling`**：实现 T4–T9 + T11 建模
3. **回测结果评审** → 生成最终评审说明书
4. **v1b 规划**（条件：v1a 回测通过）

---

**Co-Authored-By**: Claude <noreply@anthropic.com>
