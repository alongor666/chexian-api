# Agent Harness 对标评测（顶级水平基准）

> 日期：2026-06-10 · 方法：以业界顶级 agent harness（智能体运行框架）10 维度标准为标尺，对本项目自建 harness 逐维度实测打分。
> 一句话结论：**确定性内核（不让大模型生成 SQL、只复用既有 API、注册表声明能力边界、分阶段释放门禁）踩在 Anthropic / OpenAI / 学术界三方共识的最佳实践方向上**；短板集中在大模型专属能力层（可观测性、输出防护的量化覆盖、解释层评估闸）。综合加权约 **77 / 100**。

---

## 1. 范围与方法

### 1.1 「自建 harness」的所指（三层）

| 层 | 位置 | 职责 |
|---|------|------|
| 运行时 harness | `server/src/agent/` | 4 张声明式注册表（28 工具 / 13 能力 / 29 指标 / 5 禁用指标）+ 7 个确定性诊断服务 + Zod 请求/响应双向校验 + `sql-guard` 输出拦截 + `readyForLlm` 分阶段释放门禁 |
| 验收 harness | `scripts/verify-agent-production-smoke.mjs`（12 步生产 smoke）+ `tests/api/agent-*`（30 文件 / 167 用例） | 部署前/生产验收闸 |
| 治理 harness | `scripts/governance/harness.mjs`（H2–H4 静态合规检查） | 配置层合规防护 |

### 1.2 对标的 10 维度（业界基准来源）

调研覆盖：Anthropic「Building Effective Agents」、OpenAI Agents SDK guardrails、Harness-Bench（arXiv 2605.27922，实测同模型不同 harness 分差可达 36 个百分点）、Terminal-Bench 2.0、SWE-bench、OpenTelemetry GenAI 语义约定、NeMo Guardrails、Guardrails AI、ZenML 1200 生产部署报告、可信智能体确定性边界（arXiv 2602.09947）。

维度清单见 §2 表格首列。权重按本项目「确定性优先数据分析平台」场景定制（核心维度 ★5，最低 ★2）。

---

## 2. 评分矩阵

亮灯规则：🟢 优秀（≥85）· 🔵 良好（75–84）· 🟡 待提升（60–74）· 🔴 缺失（<60）。

| 维度（权重） | 顶级水平要求 | 本系统现状（证据） | 实测/事实 | 得分 |
|---|---|---|---|---|
| 确定性边界与权限门禁 ★★★★★ | 敏感操作不交给大模型决定；工具白名单静态声明、未列默认拒绝；权限可在配置层即时撤销 | 工具注册表 28 条带 `status`，blocked 工具无 `endpoint`（`tool-registry.ts:54`）；问题路由确定性识别禁用词→blocked；大模型完全不在执行路径 | route-question 测试全过；`readyForLlm` 恒为 `false`（fail-closed） | 🟢 88 |
| 注册表驱动能力声明 ★★★★★ | 集中声明含 ID/schema/测试用例/changelog；治理强制；前端从注册表派生不硬编码 | 4 张 agent 注册表全 Zod 校验；项目主注册表有 codegen + governance #17/#23 | 短板：agent 注册表无 `version/changelog` 字段；`metric-capability-mapping.ts` 是裸 `Record` 无 Zod 校验 | 🔵 80 |
| 工具设计质量 ★★★★ | 单一职责、完整 schema/边界/错误格式、防呆设计、禁用场景文档 | 每工具带 `metrics/blockedInterpretations/allowedInterpretations/note`；每能力带 `allowedUseCases/cautionNotes/forbiddenOutputs` | 边界声明完整，工具=封装 API；无独立工具单测（仅集成测试） | 🔵 80 |
| 双向防护机制 ★★★★ | 输入/输出/工具三层；触发即终止；防护有效性量化（精确率/标注集） | 输出 `sql-guard` + `forbiddenInterpretations` 四层（注册表/服务/提示词/guard）；输入 Zod 校验 | sql-guard 对抗 13 例：6 符合/7 漏；无标注集/精确率指标（见 §3.2） | 🟡 70 |
| 可观测性与追踪 ★★★★ | OTel `gen_ai.*` 语义约定；每步 span；token 计量；审计含 `auth_kind/token_id` | audit log 字段扎实（`request_id/route_key/query_hash/auth_kind/token_id/sql_time_ms`，`middleware/audit.ts`） | 最严重盲区：`AUDITED_PATHS` 不含 `/api/agent/explain`——唯一大模型入口不写审计；无 token 计量、无 OTel span | 🟡 60 |
| 评估与验证闸 ★★★ | 结果驱动；生成者/评估者分离；部署前评估闸；防自我评价偏差 | 12 步生产 smoke + 30 测试 + governance；验「调用方展示契约」而非步骤序列 | smoke 串行、需生产 token；解释层输出质量无评估闸（解释对不对无自动评分） | 🟡 72 |
| 确定性优先设计 ★★★ | 单次→链→路由→并行→多 agent 渐进；仅在可证明收益时加复杂度 | 大模型只做解释；`business-patrol` 并行编排 6 子诊断（确定性 fan-out + 超时降级） | 教科书式 deterministic-first，与三方共识高度吻合——本系统最大优势 | 🟢 92 |
| 上下文工程 ★★★ | 渐进披露、上下文压缩、工具遮蔽 | 注册表即结构化能力声明；`readyForLlm` 即能力门控 | 大模型用量极小，当前场景需求低，现状够用 | 🟡 70 |
| 人在回路 ★★ | 不可逆操作前停下确认；最大迭代上限；渐进自治 | 大模型不执行破坏性操作，人在回路=用户主动触发 | 场景适配，已够用 | 🔵 80 |
| 故障恢复与韧性 ★★ | 错误分类回退、熔断器、影子模式、重试上限配置化、schema 防护 | 三级限流+LRU 缓存+子诊断 `Promise.race` 超时降级（失败→partial+warning 不 500）；Zod 防 schema 违反 | 降级机制扎实；无熔断器/影子模式（场景需求低） | 🟡 72 |

**加权综合**：约 76.7 / 100（权重作系数）。定位：业界先进架构方向，确定性内核扎实，大模型专属能力层（可观测/防护量化/评估闸）待补。

---

## 3. 实测证据（可复现）

### 3.1 自动化验收

```bash
# 治理 harness（H2–H4 静态合规）
node scripts/governance/harness.mjs            # → [harness] H2-H4 检查通过

# 全部 agent 测试（30 文件 / 167 用例）
CI=1 npx vitest run tests/api/agent           # → 30 passed / 167 passed（约 2.3s）
```

### 3.2 sql-guard 对抗实测（13 例 → 6 符合 / 7 漏）

`server/src/skills/adapters/llm/sql-guard.ts` 正则 `\b(关键字)\b\s+[\w*"'(]`，15 个关键字。

| 类别 | 用例 | 结果 |
|------|------|------|
| 拦得住 | `SELECT ... FROM`、小写 `select`、CTE `WITH`、```` ```sql ```` 围栏 | ✅ 4/4 拦截 |
| 不误伤 | 中文「建议选择一个机构」「我们 update 了口径」 | ✅ 2/2 放行 |
| **漏过** | DuckDB 方言 `COPY` / `ATTACH` / `PRAGMA` / `DESCRIBE` / `SUMMARIZE`、裸 `FROM` 子句、注释分割 `SEL/**/ECT` | ⚠️ 7/7 漏 |

**威胁模型澄清（重要）**：`sql-guard` 拦的是大模型**解释文本里**的 SQL，这些文本不进执行路径——漏过 `COPY/ATTACH` 的实际危害只是「用户看到一段没用的伪 SQL 文本」，不是数据被导出。真正的执行防线是「大模型根本不生成可执行 SQL + 注册表白名单」。因此这 7 个漏过属于「质量待提升」，不是「安全漏洞」。

> **修复记录（2026-06-11，PR #580）**：上表 7 例漏过已全部修复——`sql-guard.ts` 补齐 DuckDB 方言关键字，对抗集固化为 `server/src/skills/__tests__/llm-adapter.test.ts` 回归用例。本表保留为评测时点的历史实测证据。

### 3.3 本地环境限制

worktree 无 `server/data` 本地数据、无 `E2E_PASSWORD` / `AGENT_SMOKE_TOKEN`，跑不了需真实数据或线上 token 的端到端生产 smoke。完整 `bun run verify:agent:smoke` 需线上只读 token，应在有数据的环境执行。

---

## 4. 释放大模型解释层前的三道硬门槛

`readyForLlm` 当前恒为 `false`、Stage 5A 已注册 `explain` 路由——系统正站在「释放前夜」。**三道硬门槛已于 2026-06-11 全部完成**（门槛 1/2 见 PR #580，门槛 3 见 PR #586）：

1. **✅ 把 `/api/agent/explain` 纳入审计日志**（2026-06-11 已完成，PR #580）。`server/src/middleware/audit.ts` 的 `AUDITED_PATHS` 已加入 `/api/agent/explain`，「就绪门禁要求审计可见」与审计覆盖恢复自洽。契约回归：`tests/api/audit-paths-contract.test.ts`。

2. **✅ 补 `sql-guard` 覆盖 + 对抗集固化为回归测试**（2026-06-11 已完成，PR #580）。已加 DuckDB 方言关键字（`COPY/ATTACH/INSTALL/LOAD/PRAGMA/DESCRIBE/SUMMARIZE` 等）；§3.2 对抗探针已固化为 `server/src/skills/__tests__/llm-adapter.test.ts` 对抗集用例（原 7 例漏过全部转为拦截，不误伤中文叙述用例保持放行）。

3. **✅ 给 agent 注册表补 `version/changelog` 字段**（2026-06-11 已完成，BACKLOG 2026-06-11-claude-f5646f）。三件套落地：① 4 张注册表导出经 `AgentRegistryMetaSchema`（Zod）校验的表级 meta（version + changelog，refine 强制 version === changelog 末条）；② `/api/agent/audit/metrics|capabilities|unsupported|readiness` 响应新增 `registryVersions`（registryId / version / entryCount）；③ governance 新增「Agent注册表版本」检查 —— 注册表文件相对 origin/main 有变更但未更新 version 字段即阻断。回归测试：`tests/api/agent-registry-version.test.ts`。

---

## 5. 第二梯队改进（释放后/有余力时）

4. 大模型 token 计量 + 向 OpenTelemetry `gen_ai.*` 语义约定靠拢（金融审计场景的行业锚点）。
5. 解释层加 model-based grader（用模型给解释正确性打分），补「评估者/生成者分离」。
6. `readyForLlm` 从硬编码常量改成基于 5 个前置条件自动计算的状态机，让门禁能在配置层渐进释放而非改代码。
7. `metric-capability-mapping.ts` 补 Zod 校验，进启动期一致性检查。
8. 生产 smoke 12 步并行化（当前串行，耗时=各步之和）。

---

## 6. 最佳实践：这套 harness 该怎么持续运营

业界对「确定性优先 + 渐进释放大模型权限」的评价是正面的（Anthropic 渐进自治、OpenAI 策略即代码、arXiv 2602.09947 确定性边界）。把它落到本项目的持续运营，最佳实践有六条：

1. **Harness 是分数的一半，把投入从「换更强模型」转向「打磨 harness」**。Harness-Bench 实测：同模型不同 harness 分差可达 36 个百分点。能力提升的杠杆在工具设计、上下文、防护，不在模型选型。

2. **大模型只解释、不决策、不执行——这条红线不退**。所有「是否可执行敏感操作」的判断必须由确定性机制（注册表白名单 + 权限门禁）回答，不交给概率推理。新增能力先登记注册表、再写服务，杜绝能力漂移。

3. **渐进释放：先建议模式，后扩自治**。`readyForLlm` 门禁是对的设计——保持「默认关闭、证据齐了才单点释放」。释放任一大模型能力前，先过 §4 三道硬门槛（审计覆盖 / 防护量化 / 变更可追溯）。

4. **防护要量化，不能只「有」**。每条防护规则（sql-guard、forbiddenInterpretations）都应有标注对抗集 + 精确率/召回率指标，且对抗集进回归测试。防护从「人工检查」升级为「代码 CI」。

5. **可观测性内置而非事后叠加**。释放大模型前就规划 span 结构与 token 计量，向 OTel `gen_ai.*` 对齐——金融审计场景这是监管前提，事后改造成本远高于设计期内建。

6. **随模型变强反向简化 harness**。Anthropic 的演化方向是「模型能力提升后，重新验证 harness 里每个『模型做不到 X』的假设并删冗余」。每次模型升级都该问一遍：哪些注册表约束 / 防护层 / 降级逻辑现在已经多余？token 效率本身就是设计质量的信号（Harness-Bench 中最高分 harness 同时 token 消耗最少）。

---

## 关联

- 自建 harness 现状：`docs/AGENT_ADAPTATION_AUDIT.md`、`docs/AGENT_STAGE5_LLM_BOUNDARY_AUDIT.md`、`docs/AGENTIC_UPGRADE.md`
- 注册表体系：CLAUDE.md §2
- 业界出处：[Anthropic Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) · [OpenAI Agents SDK Guardrails](https://openai.github.io/openai-agents-python/guardrails/) · [Harness-Bench arXiv 2605.27922](https://arxiv.org/html/2605.27922v1) · [Trustworthy Agentic AI arXiv 2602.09947](https://arxiv.org/pdf/2602.09947) · [OpenTelemetry GenAI 语义约定](https://opentelemetry.io/blog/2025/ai-agent-observability/) · [ZenML 1200 生产部署](https://www.zenml.io/blog/what-1200-production-deployments-reveal-about-llmops-in-2025)
