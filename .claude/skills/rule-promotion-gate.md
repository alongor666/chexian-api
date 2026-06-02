---
name: rule-promotion-gate
description: 规则/知识上提质量闸 — 把一条经验沉淀为通用规则前，过"语义独立测试 + 零上下文独立验证 + 三层过滤"，判定它该进通用层(共享仓)还是留项目级。Use when 用"沉淀成 skill/固化成技能"、提炼规则、写 memory、跑 crystallize/knowledge-miner，决定某条经验放哪一层时。
version: 1.0.0
---

# 规则上提质量闸（Rule Promotion Gate）

> 精髓借鉴：super-powers-team-suite rules-distiller 的"judge not lawyer / 语义独立测试"。本 skill 把它接到 chexian 的 `chexian-crystallize-skill` 流水线、`chexian-extract-knowledge`、共享记忆体系，作为"上提到通用层之前"的质量闸，治理 skills-map 担心的**漂移与重复**。
>
> 定位：crystallize 流水线决定"怎么装"，本闸决定"该不该上提、放哪一层"。

## 1. 语义独立测试（核心那把尺）

对每条候选规则问：**"抹掉项目名、技术栈、具体数据字段后，这条原则还成立吗？"**

- ✅ 仍成立 → 它是**通用工程/方法论原则**，可上提到共享仓（`alongor666/alongor666-skills`）或 `~/.claude/rules/common/`。
- ❌ 抹掉就垮（依赖 chexian 的 38 字段/DuckDB/车险口径）→ **Too Specific**，留在项目级 `.claude/skills/*.md` 或 `.claude/rules/`，不污染通用层。

## 2. 三层过滤（通过才够格当"规则"）

| 层 | 判据 | 通过标准 |
|----|------|---------|
| L1 多源印证 | 这条经验在 ≥2 个独立来源/场景出现过？ | 不是一次性偶发 |
| L2 可操作化 | 能写成"做 X / 避免 Y"的直接 checklist 项？ | 能放进 review 清单照着查 |
| L3 违反后果具体 | 不遵守会具体坏掉什么？ | 有具体后果（非泛泛"质量下降"）|

三层任一不过 → 不上提，退回继续观察或留作 agent/skill 层提示。

## 3. 零上下文独立验证（judge, not lawyer）

- 验证者**不读实现者的"已正确"结论**，从最终产物重新独立判一次——继承上游"我觉得对"的假设会让验证者瞎掉。
- 本项目落地：要第二意见时用 `codex` skill 做对抗式 review，**只喂代码/规则本身，不喂"我认为它对"的论证**。
- 每条规则答三问：①证据够吗、缺什么？ ②反例测试：什么条件下它失效？（构造具体场景，不是"极端情况"）③语义独立测试（见 §1）。

## 4. 判定输出（六类裁决）

| 裁决 | 含义 | chexian 去向 |
|------|------|-------------|
| Append | 补进某条现有规则 | 对应 `.claude/rules/*.md` 追加 |
| Revise | 修订现有规则措辞/范围 | 改对应规则，更新关联 |
| New Section | 现有规则文件加新节 | — |
| New File | 独立成新规则/skill | 走 crystallize 流水线 |
| Already Covered | 现有规则已足够 | 不动，避免重复（§ skills-map 防漂移）|
| Too Specific | 仅项目适用 | 留项目级，不上提共享仓 |

## 5. 与现有体系的关系

- **怎么装/装哪** → `chexian-crystallize-skill`（铁律"改在仓库·装到本地·本地只读"）。
- **从对话提取知识** → `chexian-extract-knowledge` / `knowledge-miner`。
- **本闸专管**：上提**之前**的"够不够格 + 放哪一层"判定，防止把项目专属经验污染进通用层、或重复登记已覆盖的规则。
- **单一事实源**：跨 skill 重复 ≥2 处的常量/规则 → 上提到 `chexian-report-shell/lib/`（见 skill-prefix.md）。
