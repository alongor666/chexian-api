---
name: diagnose-router
description: 诊断命令总路由 — 先判定业务域、时间口径和专属模型，再转交具体 diagnose 命令或 alongor666-skills 仓的诊断 skill（本地经 ~/.claude/skills/ 软链消费，按名触发）
category: data-analysis
version: 1.1.0
author: "@codex"
tags: [diagnosis, router, command-selection, cohort, renewal, motorcycle, fraud, ncd, incident-rate, accident-profile]
scope: project
requires:
  - 阅读目标 diagnose 命令或 skill
dependencies:
  - .claude/commands/diagnose-agent.md
  - .claude/commands/diagnose-segment.md
  - .claude/commands/diagnose-cohort-comparison.md
  - .claude/commands/diagnose-renewal.md
  - .claude/commands/diagnose-motorcycle.md
  - .claude/commands/diagnose-transfer-location.md
  - .claude/commands/diagnose-lr-projection.md
  - .claude/commands/diagnose-forecast-claim.md
  - alongor666-skills 仓 skills/incident-rate-development/SKILL.md（本地经 ~/.claude/skills/incident-rate-development 软链，按名触发，非项目内路径）
  - alongor666-skills 仓 skills/ncd-pricing-diagnosis/SKILL.md（本地经 ~/.claude/skills/ncd-pricing-diagnosis 软链，按名触发，非项目内路径）
  - alongor666-skills 仓 skills/accident-profile-report/SKILL.md（本地经 ~/.claude/skills/accident-profile-report 软链，按名触发，非项目内路径）
last_updated: "2026-06-09"
---

# 诊断命令总路由（/diagnose-router）

> 先分流，再执行。诊断命令不得平铺混用；专项命令优先，`/diagnose-agent` 只做经营诊断兜底。
>
> **视野范围**：本路由覆盖两层入口——命令层（`.claude/commands/diagnose-*.md`，9 个，用 `/` 前缀调用）与 skill 层（`incident-rate-development` / `ncd-pricing-diagnosis` / `accident-profile-report` 3 个诊断 skill，无 `/` 前缀，由 Skill 工具按名触发；2026-07-16 起建在 alongor666-skills 仓、项目内不再存放实体文件，见 `.claude/rules/skill-prefix.md`）。路由判断必须同时检视两层，不得只路由到命令层而忽略 skill 层。

---

## 固定路由顺序（RED LINE）

按以下顺序判断，命中后转交对应命令或 skill：

| 优先级 | 用户问题信号 | 使用命令/skill | 层级 | 边界 |
|---|---|---|---|---|
| 1 | 续保、应续、已报价、续回、责任模式、报价提前、待跟进名单 | `/diagnose-renewal` | 命令层 | 续保 funnel 专属，不用经营诊断替代 |
| 1 | 摩托车、交强 120 元、人身险捆绑、A/B 类机构、真实盈亏线 | `/diagnose-motorcycle` | 命令层 | 摩托车必须用专属成本模型 |
| 1 | 过户车、车牌归属地、出险地、异地出险、挂靠/假资料 | `/diagnose-transfer-location` | 命令层 | 风控/欺诈专项，不是普通事故地点下钻 |
| 2 | 两个 cutoff、3-31 vs 4-30、月末估值对比、同比发展、影响度分解 | `/diagnose-cohort-comparison` | 命令层 | 双 cutoff cohort 专项 |
| 2 | 全年预期赔付率、年终赔付率预测、平移预测、4 维细分矩阵、业务介入覆盖 | `/diagnose-lr-projection` | 命令层 | 结构性全年预期满期赔付率专项 |
| 2 | 赔款空间、还能赔多少、新增赔款余地、目标赔付率反推、赔付率推演 | `/diagnose-forecast-claim` | 命令层 | 任意维度筛选下的双向推演（给定目标赔付率求赔款空间 Δ，或给定 Δ 求赔付率） |
| 2 | NCD 定价、系数诊断、应提系数、定价扭曲、归一赔付率、商业/交强 NCD 档、哪个档赔付率过高、折扣是否合理 | `ncd-pricing-diagnosis` skill | skill 层 | 横向 NCD 档位定价结构分析；用 Skill 工具按名触发 `ncd-pricing-diagnosis`（alongor666-skills 仓，本地经 `~/.claude/skills/ncd-pricing-diagnosis` 软链） |
| 2 | 出险率同比、发展三角形、不满期对比、等天数出险率、赔案发展 | `incident-rate-development` skill | skill 层 | 纵向时间发展分析（按维度构建三角形）；用 Skill 工具按名触发 `incident-rate-development`（alongor666-skills 仓，本地经 `~/.claude/skills/incident-rate-development` 软链） |
| 2 | 事故画像、出险经过文本、碰撞对象构成、事故场景、时段×路段热力图、驾驶人年龄分布 | `accident-profile-report` skill | skill 层 | 基于理赔明细文本的事故画像专项；用 Skill 工具按名触发 `accident-profile-report`（alongor666-skills 仓，本地经 `~/.claude/skills/accident-profile-report` 软链） |
| 3 | 任意车型/客户类别/能源/吨位/WHERE 细分，90/180/270/满期发展 | `/diagnose-segment` | 命令层 | 细分 cohort 专项 |
| 4 | 机构、经代、经营单元、赚不赚、亏在哪、要不要继续 | `/diagnose-agent` | 命令层 | 总控型经营诊断兜底 |

若同时命中多个信号，按优先级高者先执行；需要组合分析时，先跑专项，再用经营诊断汇总，不得反向覆盖专项口径。

---

## 重叠处理

### `/diagnose-agent` vs `/diagnose-segment`

- 问”机构/经代/经营单元赚不赚、亏在哪、是否继续” → `/diagnose-agent`
- 问”某类车/某个 WHERE 细分 cohort 的赔付发展和事故原因” → `/diagnose-segment`

### `/diagnose-agent` vs `/diagnose-motorcycle`

- 只要出现”摩托车”且问题涉及经营/盈亏/赔付 → `/diagnose-motorcycle`
- `/diagnose-agent` 不得用普通车险综合成本率替代摩托车捆绑模型

### `/diagnose-segment` vs `/diagnose-cohort-comparison`

- 90/180/270/满期四桩发展 → `/diagnose-segment`
- 同一 policy-year cohort 在两个 cutoff 之间变化 → `/diagnose-cohort-comparison`

### `/diagnose-lr-projection` vs `/diagnose-cohort-comparison` / `/diagnose-segment`

- “全年预期 LR 会到多少 / 年终结构性预测” → `/diagnose-lr-projection`（4 维 cell × burning-cost 平移）
- “两个 cutoff 间历史 LR 怎么变” → `/diagnose-cohort-comparison`（历史发展）
- “某细分 cohort 90/180/270/满期发展曲线” → `/diagnose-segment`（cohort 时间发展）
- 关键区别：lr-projection 是**预测未来**，cohort-comparison/segment 是**复盘历史**

### `/diagnose-lr-projection` vs `/diagnose-forecast-claim`

- “全年预期 LR 是多少 + 4 维结构归因” → `/diagnose-lr-projection`（结构性平移）
- “若达到目标 LR，剩余期还能新增多少赔款” → `/diagnose-forecast-claim`（what-if 反推空间）
- 两者正交互补：lr-projection 给”会到多少”，forecast-claim 给”还能承受多少”

### `/diagnose-segment` vs `/diagnose-transfer-location`

- 普通事故地点/事故原因下钻 → `/diagnose-segment`
- 过户车 + 车牌归属地 vs 实际出险地异常 → `/diagnose-transfer-location`

---

### `ncd-pricing-diagnosis` skill vs `/diagnose-segment`（skill 层 vs 命令层）

- 问”NCD 档位定价是否扭曲、归一赔付率是多少、哪个档应提系数” → `ncd-pricing-diagnosis` skill（横向：同一时段按 NCD 档切）
- 问”某维度（含 NCD 维度）cohort 90/180/270 天发展如何” → `/diagnose-segment`（纵向：时间发展曲线）
- 两者正交互补：ncd-pricing-diagnosis 给”哪个档定价扭曲”，diagnose-segment 给”该档近年出险率是否恶化”

### `incident-rate-development` skill vs `/diagnose-segment`（skill 层 vs 命令层）

- 问”出险率同比、发展三角形、等天数截断、跨年纵向对比” → `incident-rate-development` skill（纵向：日历发展口径三角形，支持 60/120/180/240/300/365 天里程碑）
- 问”某细分 cohort 的发展曲线（90/180/270/满期四桩）” → `/diagnose-segment`（命令层封装的 cohort 分析）
- 区别：incident-rate-development skill 提供 SQL 模板 + 口径框架，适合直接跑 DuckDB；diagnose-segment 是封装好的完整命令，适合标准化输出

### `incident-rate-development` skill vs `ncd-pricing-diagnosis` skill（skill 内部边界）

- 纵向（跨年同维度发展趋势）→ `incident-rate-development` skill
- 横向（同时段 NCD 档位定价是否匹配风险）→ `ncd-pricing-diagnosis` skill
- 典型组合顺序：先跑 ncd-pricing-diagnosis 判出”0.8 档应提系数”，再跑 incident-rate-development 验证”0.8 档出险率近年是否恶化”

### `accident-profile-report` skill vs `/diagnose-segment` / `/diagnose-transfer-location`（skill 层 vs 命令层）

- 基于**理赔明细文本**（出险经过字段）+ 保单属性，分析碰撞对象/事故场景/时段×路段/驾驶人年龄等画像 → `accident-profile-report` skill（执行 Python 脚本生成报告）
- 按维度条件筛选保单做发展分析 → `/diagnose-segment`（数值 cohort 分析，不读文本）
- 过户车 + 地域异常风控 → `/diagnose-transfer-location`（欺诈判定，不是事故场景分析）
- accident-profile-report 是**文本挖掘**入口；diagnose-segment 是**数值发展**入口；两者互补不替代

### skill 层 vs 命令层（通用说明）

- **命令层**（`/diagnose-*.md`）：用 `/` 前缀调用，有完整的 pre-flight、数据验证、输出格式约束，适合标准化生产输出
- **skill 层**（`incident-rate-development` / `ncd-pricing-diagnosis` / `accident-profile-report`）：无 `/` 前缀，用 Skill 工具按名触发，实体文件建在 alongor666-skills 仓（本地经 `~/.claude/skills/` 软链消费，项目内不再存放实体文件），包含 SQL 模板/Python 脚本/口径框架，适合灵活的临时分析和扩展
- 两层不互斥：同一诊断需求可先查路由选 skill 层快速验证，再用命令层做完整报告

---

## 执行协议

1. 先用本路由判断唯一主命令。
2. 打开目标命令文档，按目标命令的 pre-flight 和验证要求执行。
3. 若需要组合诊断，在最终报告中显式标明：
   - 主命令
   - 辅助命令
   - 各自口径
   - 哪个结论来自哪个命令
4. 不确定时只问最少确认项，不要一次性抛出多命令方案。

---

ARGUMENTS: {用户的自然语言诊断需求}
