# 数据巡检框架 (Patrol Framework) — 实施计划

> **状态**: IMPLEMENTED
> **分支**: `feat/patrol-framework`（从 `refactor/renewal-analysis-v2` 或 `main` 切出）
> **创建日期**: 2026-04-11
> **CEO Review**: SELECTIVE EXPANSION, 4 扩展全部接受
> **关联设计文档**: `~/.gstack/projects/alongor666-chexian-api/ceo-plans/2026-04-11-patrol-framework.md`

## 核心理念

**从"用户告诉 AI 看什么"到"AI 自己发现什么值得看"。**

每天自动巡检续保数据的所有维度组合，标注异常，发现盲点，生成全员可读的文字+表格分析报告。

---

## Phase 1: 巡检引擎（Python）

### 1.1 通用巡检引擎
- [ ] 新建 `数据管理/patrol/patrol_engine.py`
  - `PatrolEngine` 类，接收 domain config JSON
  - DuckDB 直查 Parquet（复用 diagnose_vehicle.py 连接模式）
  - 单维度巡检：按每个配置维度 GROUP BY，计算配置的指标，对比阈值
  - 2-维交叉盲点发现：遍历 C(n,2) 维度组合，标注偏离整体 >20% 的交叉
  - 同比/环比检测：与上月（当月-1）和去年同月对比，标注显著变化
  - 四级亮灯：🟢(正常) 🟡(关注) 🟠(预警) 🔴(严重)
  - 输出：结构化 JSON（sections + findings + blindspots + comparisons）

### 1.2 续保域配置
- [ ] 新建 `数据管理/patrol/domain_configs/renewal.json`
  ```json
  {
    "domain": "renewal",
    "data_source": "renewal_universe/latest.parquet",
    "dimensions": ["organization", "channel", "customer_category", "vehicle_type_classification", "insurance_grade"],
    "metrics": [
      {"id": "renewal_rate", "sql": "...", "thresholds": {"red": 0.40, "orange": 0.45, "yellow": 0.50}},
      {"id": "quote_coverage_rate", "sql": "...", "thresholds": {...}},
      {"id": "loss_rate", "sql": "...", "thresholds": {...}},
      {"id": "competitor_net_flow", "sql": "...", "thresholds": {...}}
    ],
    "cross_analysis": {"enabled": true, "max_dimensions": 2, "deviation_threshold": 0.20},
    "comparison": {"periods": ["mom", "yoy"]},
    "output_path": "patrol_reports/renewal/latest.json"
  }
  ```

### 1.3 CLI 接口
- [ ] `python3 数据管理/patrol/patrol_engine.py --domain renewal`
  - 读取配置 → 执行巡检 → 输出 JSON
  - `--dry-run` 模式：只打印 SQL 不执行
  - 退出码：0=正常, 1=有严重异常, 2=引擎错误

**Gate**: 本地跑通，JSON 输出包含 sections + blindspots + comparisons，行数与 RenewalUniverse 基准吻合

## Phase 2: daily.mjs 集成

- [ ] **2.1** `数据管理/daily.mjs` 新增子命令 `patrol`
  - 在 `renewal_universe` 完成后自动触发
  - `node 数据管理/daily.mjs patrol` 或 `node 数据管理/daily.mjs all`（含巡检）
- [ ] **2.2** `scripts/sync-vps.mjs` 新增 `patrol_reports/` 同步目录
- [ ] **2.3** `server/src/config/paths.ts` 新增 `getPatrolReportPaths()`

**Gate**: `node 数据管理/daily.mjs patrol` 跑通，`patrol_reports/renewal/latest.json` 产出

## Phase 3: API 端点

- [x] **3.1** 新建 `server/src/routes/query/patrol.ts` — `GET /api/query/patrol/:domain`
- [ ] **3.2** `server/src/routes/query.ts` 注册新路由（待确认）
- [ ] **3.3** `server/src/config/api-routes.ts` 新增 `PATROL` 常量（待确认）
- [x] **3.4** `src/shared/api/routes.ts` 新增路由常量 (2026-04-11)
- [x] **3.5** `src/shared/api/client.ts` 新增 `getPatrolReport(domain: string)` 方法 (2026-04-11)
- [x] **3.6** `src/shared/api/query-keys.ts` 新增 patrol query key (2026-04-11)
- [x] **3.7** `server/src/config/paths.ts` 新增 `getPatrolReportPaths()` (2026-04-11)

**Gate**: `curl localhost:3000/api/query/patrol/renewal-latest | jq '.data.sections | length'` 返回有效数字

## Phase 4: 前端展示

- [x] **4.1** 新建 `src/features/renewal-v2/tabs/RenewalPatrolTab.tsx` (2026-04-11)
  - 异常摘要卡片区（四级亮灯，移动端 2x2 网格）
  - 重点关注区（自动提取红/橙灯 top 5）
  - 维度分析表格（默认折叠，只展开红灯最多维度）
  - 盲点发现列表（严重度芯片筛选）
  - 同比/环比变化表格
  - 行动看板跳转按钮
  - 空/错态拆分 + retry
  - aria-expanded 无障碍
  - 报告生成时间戳
- [x] **4.2** `src/features/renewal-v2/hooks/useRenewalV2.ts` 新增 `usePatrolReport` hook (2026-04-11)
- [x] **4.3** `src/features/pages/RenewalAnalysisPage.tsx` 添加第 5 个 Tab "巡检报告" (2026-04-11)
- [x] **4.4** 响应式：移动端 2x2 摘要网格 + 表格隐藏指标列 (2026-04-11)

**Gate**: `bun run build` 零 TS 报错 + 第 5 Tab 正常加载数据

## Phase 5: /chexian-patrol Skill

- [ ] **5.1** 新建 `.claude/skills/patrol/SKILL.md` 或 `.claude/commands/patrol.md`
  - 触发 `python3 数据管理/patrol/patrol_engine.py --domain renewal`
  - 读取产出 JSON
  - 用 Claude 写文本摘要，更新 JSON 的 `summary` 字段
  - 保存 → 可选同步到 VPS
  - 支持交互追问："XX 机构为什么续保率下降？"→ 自动下钻查询
- [ ] **5.2** 更新 `.claude/commands/README.md` 注册新命令

**Gate**: `/chexian-patrol` 跑通，产出带文本摘要的完整巡检报告

## Phase 6: 文档与验证

- [ ] **6.1** 更新 `CLAUDE.md` — API 前缀清单、关键文件、巡检相关
- [ ] **6.2** 更新 `开发文档/00_index/CODE_INDEX.md`
- [ ] **6.3** 更新 `数据管理/data-sources.json` 新增 patrol 域元数据
- [ ] **6.4** `bun run governance` 通过
- [ ] **6.5** 端到端验证：daily.mjs patrol → sync-vps → curl API → 前端 Tab 加载

---

## 关键设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 引擎架构 | 通用引擎 + JSON 配置 | AI 让完整性免费，12月愿景需要可扩展 |
| 数据访问 | DuckDB 直查 Parquet | 与 diagnose_vehicle.py 一致 |
| API 实现 | 读文件而非实时查询 | 巡检是离线产物，VPS 不做计算 |
| 前端展示 | 嵌入页面第 5 Tab | 贴近数据上下文 |
| 文本摘要 | Claude Opus 开发阶段生成 | 质量高，避免在线 LLM 不稳定 |
| 盲点发现 | 2-维交叉，偏离 >20% | 在计算成本和发现价值之间平衡 |
| 信息层级 | 摘要→重点关注→按需展开 | 用户要知道"什么出了问题"，不是"给我所有数据" |
| 维度折叠 | 默认折叠，只展开红灯最多维度 | 减少信息过载，引导注意力 |
| 空/错态 | 拆分"未生成"和"加载失败"+retry | 空状态是功能不是 bug |
| 用户旅程 | 巡检→重点关注→行动看板(Tab跳转) | 用户旅程需要闭环 |
| 盲点筛选 | 严重度芯片筛选器(红灯/橙灯) | 199 条 flat list 无法导航 |
| 移动端 | 摘要 2x2，表格简化为2列 | 分析师常在手机查看 |
| 多域策略 | 每域独立页面，不汇总 | 续保巡检留在续保 Tab，赔付巡检放赔付页 |
| 无障碍 | 折叠按钮 aria-expanded | 屏幕阅读器支持 |

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 2-维交叉组合爆炸 | C(5,2)=10 种，每种 GROUP BY，耗时可控 |
| 同比缺历史数据 | 首次跑时用 PolicyFact 上年数据计算基准 |
| VPS 磁盘空间 | 每个域巡检报告 ~100KB JSON，19域 < 2MB |
| 前端渲染大 JSON | 服务端截取 TopN，不返回全量明细 |
| Claude 文本质量不稳定 | 文本摘要是增量，不影响结构化数据展示 |

## 实施顺序

```
Phase 1 (引擎) → Phase 2 (集成) → Phase 3 (API) → Phase 4 (前端) → Phase 5 (Skill)
     └── Phase 6 (文档) 贯穿始终
```

**建议新开会话执行实施，本会话用于规划和决策。**

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | HOLD_SCOPE, 0 critical gaps, 1 deferred |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | ISSUES | 5 findings, 0 fixed |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 2 issues, 1 critical gap |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 4/10 → 8/10, 8 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **UNRESOLVED:** 0 design decisions unresolved
- **VERDICT:** CEO + ENG + DESIGN CLEARED — ready to implement design improvements
