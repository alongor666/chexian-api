---
paths: [".claude/commands/**", ".claude/skills/**", ".claude/rules/skill-caliber-ssot.md", ".claude/rules/skills-map.md", ".claude/rules/skill-prefix.md", "CLAUDE.md"]
---

# 技能口径挂靠 SSOT（RED LINE - 2026-06-27 起）

policy: append-only

> 来源：执行 `/chexian-data-kpi` 山西诊断暴露技能"输入契约"脱离 rules 体系——命令内联了一套口径 / 字段 / 枚举 / 阈值 / 参数默认值，成了游离于注册表之外的"影子事实源"，必然漂移且无闸拦截（实证：省份混查 + `endorsement_type` 跑挂 SQL）。CLAUDE.md §2 注册表 RED LINE 原只覆盖 `server/` 代码，未覆盖 `.claude/commands/**` 与 `.claude/skills/**`——本规则补此盲区。

## 1. 红线：技能禁内联，必挂靠 SSOT

技能文档**禁内联**下列五类，必须**引用** SSOT（链接指向，非复制字面量）：

| 内联禁项 | 唯一事实源（必引用） |
|---|---|
| 指标公式（赔付率 / 出险率 / 件均等） | 指标注册表 `server/src/config/metric-registry/`；取数用 `getMetricSql(id)`（`metric-registry/index.ts`）|
| 字段名（Parquet 列） | 字段注册表 `server/src/config/field-registry/fields.json`，且须 Parquet 实际落列（[省份数据隔离](./data-pipeline.md) + K3 字段闸双校验）|
| 枚举值（险种 / 客户类别 / 险别组合等） | 业务规则字典 `数据管理/knowledge/rules/车险数据业务规则字典.md`；客户类别 `src/shared/config/customer-categories.ts`（前端 repo-root `src/`，区别于后端 `server/src/`）|
| 阈值（亮灯 / 采样 / 口径边界） | 对应 rules（如 [时间口径反问](./time-caliber-disambiguation.md)）或注册表 testCase |
| **输入契约 / 参数默认值**（省份 / 时间窗口 / 分母 / 指标 id / 路由名 / 采样规则）| 省份→[省份数据隔离](./data-pipeline.md)；时间→[时间口径反问](./time-caliber-disambiguation.md)；路由参数→`server/src/config/route-param-contracts.ts`；**不得在技能中自造默认值** |

## 2. 挂靠方式（引用而非复制）

- 技能正文用**文内 link 指向 SSOT**（实例：`/chexian-data-kpi` 不再内联省份隔离 SQL，改引用 [data-pipeline.md 省份数据隔离](./data-pipeline.md)），不复制公式 / 枚举 / 字段字面量。
- 示例 SQL 仅作**实测验证样例**：须 duckdb 直查实测后写入（`CLAUDE.md §6` 验证协议），标注数据源 + 实测结果；**口径仍以 SSOT 为准**，示例不可作为口径来源。禁凭假设 / 记忆写未验证 SQL（K1 实证：内联未验证 `endorsement_type` → `Binder Error`）。

## 3. CLAUDE.md §2 注册表 RED LINE 延伸覆盖技能文档

CLAUDE.md §2「❌ 前端硬编码指标标签 / 阈值、❌ SQL 生成器硬编码公式」**延伸覆盖技能文档**：`.claude/commands/**` 与 `.claude/skills/**` 等同前端 / SQL 生成器，同受"禁硬编码、必派生自注册表"约束。本规则**不另定义**公式 / 字段 SSOT，始终回指 §2 / 注册表 / rules。

## 4. 执行边界（诚实声明：K2 是规范，K3 才是强制闸）

- **K2 是编辑期 / 审查期规范，不提供自动拦截**；自动失败只由 K3（governance 技能字段闸）提供。勿因本规则的"RED LINE / 必须"字样误以为已强制。
- **paths 自动注入仅覆盖项目内**技能（`.claude/commands/**`、`.claude/skills/**`）+ 技能治理文件（CLAUDE.md / skills-map / skill-prefix / 本规则）。
- **全局技能**（`~/.claude/skills/{chexian,diagnose}-*`，在用户 home，paths 无法匹配）：政策同样适用，但**未自动注入**——靠 `chexian-crystallize-skill` 流程在改 / 建时引用本规则 + K3 字段闸（仅字段层部分兜底，非全覆盖）。

## 5. 自动化兜底（K3）

本规则靠自觉 → K3（governance 技能字段闸）机制化：扫技能内 Parquet 字段名比对**实际落列**，注册表外 / 未落列字段（如 `endorsement_type`）即 error。见 BACKLOG `2026-06-27-claude-6f3275`。**当前 K3 仅强制字段层**（Parquet 字段名比对落列）；公式 / 枚举 / 阈值 / 输入契约四类仍属 K2 审查期规范，后续若需自动化须另建闸。

## 关联
- 上位红线：CLAUDE.md §2（注册表 RED LINE）、§0（先搜再写 / 验证不声称）、§12（扩展机制）
- K1 实例：[省份数据隔离](./data-pipeline.md) + `chexian-data-kpi.md` 挂靠
- AGENTS.md §8.2 append-only：本文件作为新增独立护栏文件，无需 `[policy-override]` 授权
