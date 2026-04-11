# 续保分析重构 — 交接 Prompt

> 复制以下内容到新会话的第一条消息。

---

请执行续保分析板块的全面重构。计划文件在 `.claude/plans/renewal-analysis-v2.md`，先完整阅读，然后从 Phase 1 开始实施。

## 背景（不需要重新验证，已在 2026-04-10 用数据确认）

1. **续保清单（`renewal/latest.parquet`）完全冗余** — 10 个字段逐一验证，全部可从 PolicyFact + 报价清单推导。唯一曾被认为独有的 `quote_time` 也可由报价清单补全。
2. **应续口径**：2025年起保 + 同一车架号交强险与商业险均在我司投保 + 排除摩托车/挂车/拖拉机 + 排除退保（负保费批改）。PolicyFact 推算 117,214 VINs，与续保清单 117,213 几乎完全吻合。
3. **PolicyFact `renewal_policy_no` 是反向链接**（"我是从哪个旧保单续来的"），不是前向链接。要查"2025保单是否被续保"，需在 2026 PolicyFact 中反查 `renewal_policy_no = 2025_policy_no`。
4. **VPS 2核4G 内存红线** — 禁止在 VPS 做多表 JOIN。采用方案 A：本地 ETL 预计算 `renewal_universe/latest.parquet` 扁平表，VPS 只加载。
5. **旧 QuoteConversion 和新 quotes/latest.parquet schema 不兼容**（9 列互不存在）— 不能换路径，不新建 VIEW，报价 JOIN 在 ETL 完成。

## 分支

```bash
git checkout refactor/renewal-analysis-v2
```

## 已验证基准（用于 Phase 结束时对照）

```
应续: 117,213 VINs
1-4月漏斗: 应续 45,156 → 已报价 40,708(90.1%) → 已续保 21,930(48.6%)
未报价流失: 4,408(9.8%)   报价未续: 18,818(41.7%)
竞争流失 TOP3: 人保 981, 平安 892, 华农 417
竞争转入 TOP3: 人保 5,606, 锦泰 4,403, 平安 3,467
```

## 实施顺序

P1 数据层（ETL + 服务端加载 + SQL 生成器 + 测试 + 指标注册）→ P1.5 VPS 内存压测 → P2 API → P3 前端 → P4a/b/c 分步清理

## 关键注意事项

- 计划末尾有 **影响范围清单**（50+ 文件），标注了 `[计划已覆盖]` 和 `[计划遗漏]`，清理阶段必须逐项核对
- AI Insights 模块（`src/shared/ai-insights/` 6 文件）有 `RenewalDataContext` 依赖，计划最初遗漏，已补入清单
- `SpecialtyPage.tsx` 是续保 Tab 的宿主页面，必须同步修改
- 领域知识详见 memory: `domain_renewal_universe.md`
