---
name: diagnose-renewal
description: 续保诊断 v2.2 — 三级机构经营盯盘 / 机构下钻追业务员 / 涨价异常专题 / 报价响应速度 / 待跟进清单 / 分公司视角7表（--branch-report）/ 三级机构视角业务员维度模板（--org-report，应续 top15 固定贯穿·以有续保业务员数为上限）
category: data-analysis
version: 2.2.0
author: "@claude"
tags: [diagnosis, renewal, salesforce, action-list]
scope: project
requires:
  - Python 3.x
  - duckdb (pip)
  - pandas (pip)
dependencies:
  - 数据管理/pipelines/diagnose_renewal.py  # CLI 编排入口
  - 数据管理/pipelines/renewal_common.py  # 共享口径常量+Report+rate/light（依赖叶子）
  - 数据管理/pipelines/renewal_resp_mode.py  # 责任模式清单加载
  - 数据管理/pipelines/renewal_sections.py  # 主报告6大板块
  - 数据管理/pipelines/diagnose_renewal_branch.py  # 分公司视角6表（--branch-report）
  - 数据管理/pipelines/diagnose_common.py
  - 数据管理/warehouse/fact/renewal_tracker/latest.parquet
  - 数据管理/warehouse/fact/policy/current/*.parquet
  - 数据管理/warehouse/fact/quotes_conversion/latest.parquet
  - "~/Library/Mobile Documents/.../四川5-7月 - 智能表.xlsx（责任模式板块，可选）"
last_updated: "2026-06-06"
---

# 续保诊断 v2.2（/diagnose-renewal）

> **三级机构经营盯盘版**。复用应续盘（renewal_tracker）+ 上年原单 / 续保单渠道（policy/current）+ 报价（quotes_conversion）多方 JOIN，输出 6 大板块 Markdown 报告 + 3 份 CSV。面向分公司管理者：看各机构续保率/报价率/未报价/未续回、已到期续保率 vs 全月进度，并下钻到团队/业务员便于追踪安排。Parquet 板块只读；**责任模式**额外读责任模式清单（缺失则降级跳过）。

---

## 诊断路由边界（先判定）

执行前先按 `/diagnose-router` 分流；本命令只处理**续保 funnel / 报价 / 续回 / 跟进清单**。

不得用 `/diagnose-agent`、`/diagnose-segment` 或 `/chexian-data-trends` 替代续保口径。若用户问“续保盘子是否影响经营利润”，先跑本命令确认续保漏斗，再另行用 `/diagnose-agent` 做经营汇总。

## 适合场景

- 「**全年/当月/未来 30 天到期**的续保盘子表现如何？」
- 「**自留 vs 兜底** 哪种责任模式续回率更高？」
- 「**报价提前 N 天** 对续回率影响有多大？」
- 「**报价折扣降幅** 多少时续回率最高？」
- 「**未报价的高价值优质客户** 是哪些（导给业务员跟进）？」
- 「**销售团队/业务员** 续保产能排名（含倒数末位预警）」

**不适合**：续保模块前端 UI 切片（用 `/api/query/renewal-tracker`）、跨年度趋势（用 `/chexian-data-trends`）、风险等级专项（用 `/diagnose-vehicle`）。

---

## 调用方式

### 默认全年应续（最常用）

```bash
python3 数据管理/pipelines/diagnose_renewal.py --year 2026
```

数据窗口：`expiry ∈ [2026-01-01, 2026-12-31]`，cutoff = today，按月切片漏斗。

### 时间视图选项（`--time-view`）

| 视图 | 含义 | 备注 |
|------|------|------|
| `ytd`（默认） | 全年应续，按月切片 | 与 `by_month` 等价 |
| `by_month` | 同 ytd | — |
| `mtd_today` | 当月应续 + cutoff=today | 看本月进度 |
| `next_to_eom` | today ~ 当月最后一天 | 月末冲刺名单 |
| `next_30_days` | today ~ today+30 | 滚动 30 天高优先级名单 |
| `custom` | `--start --end` 自定义 | 跨季 / 跨自然月 |

### 范围筛选

```bash
# 仅诊断「天府」机构
python3 数据管理/pipelines/diagnose_renewal.py --time-view ytd --year 2026 --org 天府

# 仅诊断「资阳销售一部」（模糊匹配 team_name）
python3 数据管理/pipelines/diagnose_renewal.py --time-view ytd --year 2026 --team 资阳销售一部

# 重点：本周高优先级跟进名单（未来 30 天）
python3 数据管理/pipelines/diagnose_renewal.py --time-view next_30_days
```

### 责任模式来源（板块 2，可插拔）

```bash
# A. 专项责任模式清单（已确定值，优先）— 含「责任模式」列，按车架号直接归类，支持 .xlsx/.csv
python3 数据管理/pipelines/diagnose_renewal.py --time-view custom --start 2026-06-01 --end 2026-06-30 \
  --resp-mode-list 责任模式清单.xlsx

# B. 不传则回退默认 wecom 电销续保清单（多 sheet，含「名单类型」列，按映射归类 + 保单到期时间过滤窗口）
#    默认路径：~/Library/Mobile Documents/.../四川5-7月 - 智能表.xlsx
```

优先级：`--resp-mode-list`（专项已定）> `--renewal-list`（wecom 名单类型映射）> 跳过板块。专项清单只需 `车架号` + `责任模式` 两列（车架号列名兼容 vehicle_frame_no/VIN），值直接采用不做映射、不按日期过滤。

### 进盘锚点提前期（报价响应速度板块）

```bash
# 报价响应速度按「进盘日 = 到期日 - pool_lead_days」衡量，默认 30（数据显示行动窗口约到期前 30 天）
python3 数据管理/pipelines/diagnose_renewal.py ... --pool-lead-days 30   # 默认；X=60 几乎全 0（无人提前 60 天报价）
```

### 分公司视角模式（`--branch-report`）

面向分公司管理者的 7 张三级机构窗口对照表，**以数据截止日当天所在月/年为窗口，忽略 `--time-view`/`--start`/`--end`**：

```bash
# 当前月/年的分公司视角 7 表（当月已到期/临期7天/未到期/当月/当年已到期 + 首日/首周可续期响应）
python3 数据管理/pipelines/diagnose_renewal.py --branch-report

# 可叠加机构/团队范围与可续期提前期
python3 数据管理/pipelines/diagnose_renewal.py --branch-report --org 天府 --pool-lead-days 30
```

输出 `数据管理/数据分析报告/续保分公司视角_{年}年{月}月_{ts}.md`，7 张表均以 `三级机构 + 应续件数` 起列（表一为经营盯盘主表，额外含未报价/流失/续保影响度）：

| # | 表 | 窗口 | 字段 |
|---|---|---|---|
| 一 | 当月已到期续保表 | 当月到期日 ≤ 数据截止日（已成熟，续保率亮灯） | 应续/已报价/已续保 + **未报价/流失件数 + 续保影响度** + 报价率/续保率；**按续保影响度降序** + 末尾口径附录 + 两段问题式结论（续保率缺口 / 未报价即流失） |
| 二 | 临期 7 天续保表 | 数据截止日后 7 天内到期（**未到期·临期进度**，续保率不亮灯） | 9 列同表一；结论用诚实进度措辞（临期续保进度 / 临期未报价风险），不说「已流失」 |
| 三 | 当月未到期续保表 | 当月到期日 > 数据截止日（续保率反映进度，不亮灯） | 应续/已报价/已续保件数 + 报价率 + 续保率 |
| 四 | 当月续保表 | 当月全部（= 一 + 三） | 同三 |
| 五 | 当年已到期续保表 | 当年到期日 ≤ 数据截止日（成熟口径，续保率亮灯，不被未来件稀释） | 同三，续保率亮灯 |
| 六 | 当月首日续保情况 | 当月 · 可续期首日（到期前 30 天当天，例 6/1） | 应续件数 + 首日报价数 + 首日续回数 + 首日报价率 + 首日续保率 |
| 七 | 当月首周续保情况 | 当月 · 可续期首周（到期前 30~24 天，含首日，例 6/1~6/7） | 同六，首日→首周 |

**口径要点**：
- 每张表在**自己窗口内**按车架号去重（与主报告单窗口口径一致）；跨月重复车架号（年内约 1099 个）在各自到期窗口分别计入，避免被「年表 MIN 去重」误归月份。
- **首日/首周续保率 = 可续期首日/首周内「已报价 且 最终续回」的件数 ÷ 应续件数**（口径 A，用户 2026-06-06 确认 + 2026-06-07 四川规则细化）。因续保成交日恒为到期前后（无提前成交信号），不以续保日切片，而衡量「快速响应客户的成交转化」。首日 → 首周 → 最终单调递增。
- **续保影响度（表一/临期表专项注册指标，用户 2026-06-07）= 流失件数 ÷ 合计应续件数**（先聚合后计算，什么分类就按什么合计；可加和，各机构之和 = 整体续保缺口 = 1 − 续保率）。未报价件数 = 应续 − 已报价；流失件数 = 应续 − 已续保（含未报价 + 已报价未成交）。定义单一事实源 `renewal_common.MATURED_GLOSSARY`，报告末尾附录列口径映射表防漂移。表一按续保影响度从高至低排序，结论只谈问题、每个问题一段。**续保影响度是负面指标**（流失越多越坏），措辞用"导致整体续保缺口扩大"，禁用"贡献"（中文语境贡献为褒义）。
- **领域铁律 · 临期表语义区分**：表二「临期 7 天」虽与表一同 9 列，但属**未到期·进度口径** —— 流失/续保影响度按"当前尚未续回进度"解读，结论用诚实措辞（不说「已流失」），与表一「已到期·成熟·已流失」语义区分（代码 `_branch_matured_section(kind='approaching')`）。
- **server 注册（未来 API 消费）**：三指标已注册进 server——`server/src/sql/renewal-tracker.ts` 主查询输出 D=未报价(A−B)/E=流失(A−C) 件数；`metric-registry` 登记 3 个 L4 占位符（`renewal_unquoted_count`/`renewal_lost_count`/`renewal_impact_rate`，真实 SQL 在续保生成器/本诊断脚本）。

### 三级机构视角模式（`--org-report`）— 三级机构续保诊断模板

面向三级机构负责人的**业务员维度**版分公司视角：锁定单一三级机构（`--org` 必填），同样 7 张窗口表、同套口径与亮灯，**仅分组维度由「三级机构」换成「业务员」**。定位为**三级机构续保诊断模板**（用户 2026-06-07）：

```bash
# 高新机构 · 当前月/年 · 业务员维度 7 表（当月应续 top15 固定贯穿，以有续保业务员数为上限）
python3 数据管理/pipelines/diagnose_renewal.py --org-report --org 高新

# 调整展示业务员数上限（默认 15，仍以有续保业务员数封顶）
python3 数据管理/pipelines/diagnose_renewal.py --org-report --org 乐山 --top-n 15

# 可叠加团队范围与可续期提前期
python3 数据管理/pipelines/diagnose_renewal.py --org-report --org 高新 --team 高新销售一部 --pool-lead-days 30
```

输出 `数据管理/数据分析报告/续保三级机构视角_{机构}_{年}年{月}月_{ts}.md`，7 张表结构与分公司视角逐表一致，**两点不同**：

| 维度 | 分公司视角（`--branch-report`） | 三级机构视角（`--org-report`） |
|------|------|------|
| 范围 | 全分公司 | 锁定单一三级机构（`--org` 必填） |
| 分组列 | 三级机构 | 业务员 |
| 展示行 | 全部三级机构 | **当月应续 top15 固定同一批业务员**（按当月应续去重车架号降序选定，7 表统一展示，便于横向追踪同一业务员；**以有续保业务员数为上限**，不足则全列） |
| 合计行 | 全分公司真实整体 | **该机构全部业务员真实整体**（所列各项之和 < 合计） |

**口径要点**：
- **top15 选取一次、贯穿 7 表**：候选 = 当月「有续保（is_renewed≥1）」业务员，按「当月应续」（去重车架号）降序选定，各窗口表统一展示这同一批人 —— 可横向追踪同一业务员在已到期/临期/未到期/首日/首周各窗口的表现（用户 2026-06-07 确认"跨表固定同一组"，非"每表各自取 top15"）。**展示上限 `--top-n`（默认 15），以「有续保业务员数」为天然封顶**：实际展示 = min(--top-n, 有续保业务员数)；只取有续保业务员，避免把零续保业务员列为「top 业务员」（用户 2026-06-07：top15，以有续保业务员人数为上限）。表头随实际展示数动态为 `top{N}业务员`。
- **合计 = 该机构全部业务员真实整体**，非仅展示的 topN：续保影响度分母恒为机构合计应续，故各业务员续保影响度仍可加和至机构整体续保缺口；展示的 topN 各项之和 < 合计（其余业务员计入合计、未单列）。报告头部明示"合计行 = X 全部 N 名业务员的真实整体"。
- **单一事实源复用**：`run_org_report` 与 `run_branch_report` 共用同一套 `_branch_matured_section` / `_branch_funnel_section` / `_branch_speed_section`（参数化 `dim_col`/`dim_header`/`keep_dims`，默认值即分公司视角，行为不变），口径只定义一次，杜绝两视角漂移。**新增其他三级机构诊断只需换 `--org <机构名>`**，模板即可复用。

### 关闭 CSV（仅看报告）

```bash
python3 数据管理/pipelines/diagnose_renewal.py --time-view ytd --year 2026 --no-action-list
```

---

## 输出

**Markdown 报告**：`数据管理/数据分析报告/续保诊断_{view_label}_{timestamp}.md`，6 大板块：

1. **机构经营盯盘总表** — 每个三级机构：应续 / 已报价 / 未报价 / 报价率 / 已续回 / 未续回 / 续回率 / **已到期续保率**（+ 合计行、亮灯）。分公司视角核心表
2. **续保进度与时效** — 2.1 成熟度切片（ytd 按月；其他按到期周次，含已到期续保率）+ 2.2 **报价响应速度**（进盘锚点 D-X：首日/首周/最终报价率）
3. **涨价异常专题** — 3.1 报价系数变化 × 续回率；3.2 **涨价客户报价风险等级 vs 上年风险等级**（一致 / 变好 / 小幅变差 / 大幅变差≥2档 × 续回率）。揭示涨价是否由风险恶化驱动
4. **机构下钻追业务员** — 每个三级机构独立 section：大机构（业务员 ≥ 10）列团队 + 前5/末位5业务员；小机构（< 10）直列全部业务员
5. **补充结构** — 5.1 责任模式（来源可插拔，标注实际来源）/ 5.2 报价提前天数 / 5.3 报价保费比值 / 5.4 客户结构 / 5.5 电销渠道交叉
6. **待跟进清单（重点）** — 未报价 + 上年保费 ≥ P75 + 上年自主系数 ≤ P50 的高价值优质客户

每板块含 `**结论**` 数据驱动文字（自动算出标杆/落后/差值/紧急户数）。

**3 份 CSV**（`--no-action-list` 可关）：
- `续保业务员盯盘_{ts}.csv` — 机构/团队/业务员/应续/已报价/未报价/已续回/未续回/续回率（分公司按机构筛选下发）
- `续保待跟进_{ts}.csv` — 14 列（org_level_3...insurance_grade, renewal_mode/competition_level 因 cohort 无源置 N/A）
- `续保涨价离谱_{ts}.csv` — 涨价 + 风险等级大幅变差≥2档客户（机构/团队/业务员/车架号/客类/上年等级/报价等级/变差档数/上年系数/距到期/已续回），供核保复核

---

## 业务口径锚点

| 维度 | 定义 | 字段 |
|------|------|------|
| **应续** | 落入 expiry 窗口的去重车架号 | renewal_tracker.vehicle_frame_no |
| **已报价** | 至少 1 次有效报价（quote_time ≥ 2025-12-03） | renewal_tracker.is_quoted |
| **已续回** | 续保单已签发 | renewal_tracker.is_renewed |
| **责任模式** | wecom 清单 `名单类型`：电销续保/网电电续/微保电续→电销自留；兜底→业务员兜底；白名单→电销转保；不在清单→业务员自留 | 四川5-7月 - 智能表.xlsx · 名单类型 |
| **电销渠道** | 实际成交走电销（项目设定口径） | policy.terminal_source = `0110融合销售` |
| **上年保费** | 原单保费合计（SUM premium per policy_no） | policy/current.premium |
| **上年自主系数** | 原单商车自主定价系数 | policy/current.commercial_pricing_factor |
| **报价提前天数** | first_quote_time → expiry_date | DATE_DIFF |

> **责任模式 vs 电销渠道是两回事**：责任模式=清单**指派**口径（谁负责跟进，板块 2）；电销渠道=签单数据的**实际成交渠道**（板块 7）。两者 measure 不同时点，勿混用。详见 memory `domain_renewal_responsibility_mode` / `project_telesales_terminal_source`。
> 责任模式与续回结果**相互独立**：自留不等于必续回。报告里交叉对比是为评估各产能路径效率。

---

## 亮灯阈值

| 指标 | 关注（🔵） | 预警（🟡） | 危险（🔴） |
|------|-----------|-----------|-----------|
| 报价率 | < 90% | < 80% | < 70% |
| 续回率 | < 75% | < 65% | < 55% |

---

## 常见问题

**Q: 提示「窗口内无数据」？**
A: 应续盘来自 `renewal_tracker/latest.parquet`（由 `convert_renewal_tracker.py` 派生，universe = 商业险 + 起期上年 + 止期续保年）。诊断窗口超出该表 expiry 覆盖时无数据。

**Q: 数据规模与续保模块前端不一致？**
A: 本诊断与前端 `/api/query/renewal-tracker`（`server/src/sql/renewal-tracker.ts`）共用同一 `renewal_tracker` 底表，口径一致。

**Q: 待跟进清单太短/太长？**
A: 阈值 P75 + P50 是相对当前样本的分位数，自适应窗口规模。要更激进可在脚本中改 `prior_premium >= P50` 与 `prior_factor <= P75` 放宽筛选。

**Q: 责任模式板块为空 / 覆盖率低？**
A: 清单是 wecom 电销续保表导出的多 sheet Excel（5月/6月/7月，每 sheet 含 `保单到期时间`），脚本按窗口过滤后 JOIN，未命中归「业务员自留」。⚠️ **DuckDB `read_xlsx` 默认只读第一个 sheet**——脚本已用 pandas 逐 sheet 读。清单陈旧（如只到 5/9 到期）会导致目标月命中率为 0，需导出覆盖目标月的最新清单。

---

## 复用的项目能力

- **分层架构（依赖树无环）**：`renewal_common.py`（口径常量+Report+rate/light，依赖叶子）← `renewal_sections.py`（主报告6板块）/ `diagnose_renewal_branch.py`（分公司6表）/ `renewal_resp_mode.py`（责任模式加载）；`diagnose_renewal.py` 仅做 CLI 编排（~145行）。口径只定义一次，主报告与分公司视角共享，杜绝漂移。改某板块只动对应 section 函数。
- 共享 `数据管理/pipelines/diagnose_common.py` 的亮灯 / 格式化函数（与 vehicle / agent 诊断同套范式）
- Parquet 数据源 100% 来自 `数据管理/warehouse/fact/`，与续保模块（`server/src/sql/renewal-tracker.ts`）共用 `renewal_tracker` 底表
- 责任模式 / 电销口径见 memory `domain_renewal_responsibility_mode`、`project_telesales_terminal_source`（用户 2026-06-06 确认）；报价窗口 `2025-12-03` 与 `convert_renewal_tracker.py` 对齐
