# Phase D 复盘 · 业绩分析页 视觉重做

> 完成日期：2026-06-04
> 落地 PR：#477（merge `0ae8e586`） + follow-up #478（万元口径修复）
> Claude Design 会话链接：在 ChatGPT-codex-connector 三轮 review 已闭环
> 总耗时：单会话约 4 小时（Phase 0 发现 → Phase A 备料 → Phase B 用户操作 Claude Design → Phase C 落地 → 3 轮 codex review fix → merge → follow-up）

---

## 1. Claude Design 表现评估

### 1.1 简报理解度

| 简报段落 | 准确度 | 备注 |
|---------|--------|------|
| §1 用户场景 | A | "3 秒内看懂今天关注谁"完整保留 |
| §2 视觉调性（红线） | A | 无渐变 / 无装饰 emoji / 克制色彩全部遵守 |
| §3 设计系统 token | A | 直接用了 `getHeatmapColor` / `getYearChartColor` / `colorClasses` 名字 |
| §4 5 区块结构 | A | 5 区块 + 锚点完整保留 |
| §5 30+ 交互清单 | B | 把"8 维度横排 Tab"改成"2 组分段控件"——结构改进但偏离了"必保交互"语义。可接受 |
| §6 数值排版铁律 | A | 率值 1 位 / 系数 4 位 / 万元在列头 全过 |
| §7 业务阈值 | A | 99/80/60 阈值用对了 |
| §8 做与不做 | A | 无违反 |
| §9 交付物要求 | A | standalone HTML + 暗色 / 加载 / 空 / 错误态俱全 |

### 1.2 它没理解 / 理解偏的地方

- **无明显误解**——简报本身提供的设计系统 token 名字非常具体，Claude Design 直接复用，落地时 1:1 映射
- **新加了"今日焦点"strip**（简报未要求）—— 这是设计师**主动添加**的 anomaly-first 思路，质量高，最终成为本次 PR 的核心产出
- **超出预期**：把热力图 8 维度 Tab 重构为 2 组分段控件（组织/业务），这是设计创新而非偏离

### 1.3 偏离设计系统 / 交互 / 数据规范的地方

- **设计系统**：无
- **交互**：所有 30+ 交互在静态稿里都有视觉对应（虽然 JS 行为是 demo 级）
- **数据规范**：无（毕竟是设计稿）

---

## 2. 落地阶段问题（Phase C）

### 2.1 设计稿到代码的鸿沟

- **轻** — 设计师用真实 token 名字，落地保真度高
- **限制最大改动只做 FocusStrip 一块**：PerformanceAnalysisPanel.tsx 1347 行核心容器内部的"维度 Tab 分组改造 + 下钻深度徽章 + Slide-in FocusPanel + ECharts SVG"全部延后到独立 PR——本次 PR 仅 +399 行专注新增组件，回归面最小

### 2.2 真实数据暴露的设计缺陷（核心收益）

代码层与数据层联动时**发现 4 个真实 bug**，3 个由 codex 抓出：

| # | 来源 | bug | 严重性 |
|---|------|------|--------|
| 1 | 我自己浏览器 puppeteer 验证 | `formatAchievementRate` 把已是百分比的值 ×100 | 高 — 视觉错误 |
| 2 | codex P2-1 | 整体达成应从 `drilldown.summary` 取（summary.rows 后端写死 NULL） | 高 — 永远 fallback |
| 3 | codex P2-2 | 漏 `VITE_ENABLE_BUNDLE_ROUTES` 开关 | 中 — legacy 部署红卡 |
| 4 | codex P2-3 | 年度 plan 不能减当期 premium 算"缺口" | 高 — 业务公式错 |
| 5 | codex P2-4（merge 后抓） | `getPeriodGap` 返万元，再走 `formatPremiumWan` ÷10000 → "0" | 高 — 缺口金额二次缩水 |

**没有一个是"视觉不准"问题**——全部是**数据语义/公式/单位/契约**问题。这印证了 ui-redesign skill §6 "数据通"验收的必要性。

---

## 3. 归因 · 分流回写

### 3.1 通用经验（适用任何项目）→ 回写 ui-redesign skill 仓库

> 路径：clone `alongor666/alongor666-skills` → 编辑 `skills/ui-redesign/SKILL.md` 或 `references/*.md` → push → 重装。

#### 候选条目（建议在下次 crystallize-skill 流程中沉淀）

- [ ] **设计简报里强制要求"列出所有 feature flag"**：项目级路由开关 / 环境变量 / 兼容部署模式必须显式列举，AI 落地时才不会漏。
- [ ] **简报必须含"后端字段契约速查表"**：每个要展示的字段标注【单位】【是否可能 NULL】【哪个 SQL 文件返回】。否则 AI 假设字段总是有值，实际后端 SQL 可能写死 NULL。
- [ ] **业务公式镜像协议**：前端镜像后端公式必须有 (a) 引用后端 SSOT 文件路径 (b) 单元测试 (c) 漂移防御注释。本次 `performancePlanDenominator.ts` 是好范例。
- [ ] **单位流转审计** ：任何使用格式化函数的地方，先确认值的单位（元 vs 万元 vs 比率 vs 小数）与函数期望一致。本次踩了 `formatAchievementRate(已百分比)` 和 `formatPremiumWan(已万元)` 两个雷。建议 acceptance.md 加 §B9 "单位流转审计"。
- [ ] **codex review 5 步 SOP 是 ui-redesign Phase D 强制环节**：抽 pattern → 全仓 grep → 修 → 加静态闸（governance 或单测） → 复盘评论 + 显式 @codex。本次三轮迭代证明：单次修复后必须加防回归措施，不然下次还会犯。
- [ ] **standalone HTML "数据通"验收应当包含真实 API 单元测试 / 接口断言**：仅 puppeteer DOM 验证不够，应当对每个数据 tile 的源字段做 jq 断言。本次第 1 轮 bug（formatAchievementRate）就是 DOM 看着对、jq 一看数字怪。

### 3.2 项目专属经验 → 留本文件夹 / 项目笔记

- [ ] 业绩分析页 `summary` 接口后端写死 plan_premium=NULL：未来类似 bundle 接口的 KPI 都要避免误读 summary，应读 drilldown.summary
- [ ] `formatPremiumWan` vs `formatWanAdaptive` 二选一陷阱：项目里两个函数差 ÷10000，命名相似，AI 极易踩坑——建议项目 frontend.md 加显式提示
- [ ] `VITE_ENABLE_BUNDLE_ROUTES` 是项目特定开关，任何新组件用 `usePerformanceBundle` 必须显式遵守——已加 governance #25 静态闸防回归

### 3.3 触发式进化（≥2 次重复）→ 当次必须回写

本次出现 ≥2 次的问题：
- **"假设字段总是有值"** 重复了 2 次（P2-1 整体达成、tile 计算缺口）——建议回写到 skill 仓库
- **"格式化函数误用"** 重复了 2 次（formatAchievementRate ×100、formatPremiumWan ÷10000）——建议加单位审计章节

→ **回写承诺**：用户下次说"crystallize skill"或"沉淀经验"时，把上面 3.1 全部回写到 ui-redesign skill 仓库。

---

## 4. 量化效果

| 指标 | 重做前 | 重做后 | 变化 |
|------|--------|--------|------|
| 业绩分析页首屏 anomaly-first 信号 | 0（需用户自己看热力图判断） | 4 块速览（3 秒看懂） | +∞ |
| 首屏 React Query HTTP 数 | 5（bundle + 4 个 hook） | 5（FocusStrip 复用 queryKey 去重） | 0（不退化） |
| codex review 第 1 轮 P2 数 | — | 2 | — |
| codex review 第 2 轮 P2 数 | — | 1（新发现） | — |
| codex review 第 3 轮 P2 数 | — | 1（merge 前最后一刻） | — |
| 总 commit | — | 3（PR #477）+ 1（PR #478） | — |
| 总测试 | 0 | +10 单测（performancePlanDenominator） | +10 |
| 新增 governance 检查项 | 23 | 24 | +1（Bundle路由开关合规） |

---

## 5. 下一次重做时要带的"经验包"

写给未来的我（跑 ui-redesign）：

1. **简报里硬性要求列出"feature flag + 字段契约表 + 业务公式 SSOT 路径"**——这三项漏一项，落地阶段必踩雷
2. **落地后第一轮 puppeteer 验证必须 jq 断言每个数字的单位**——DOM 看着对的"320%"和"3.2%"差 100 倍
3. **codex 一轮接受不算完——抓的越多说明组件越复杂，建议预留 3 轮迭代时间**——本次 3 轮，每轮抓 1-2 条新问题
4. **每修一个 codex 意见，立刻问"这是 pattern 吗"——是的话加静态闸/单测，否则下次还会犯**
5. **大容器（>1000 行）不要碰内部，只新增组件 + 在 page 集成**——本次 Panel 1347 行原地不动，回归面最小

---

## 6. 自进化回写记录

| 日期 | 改动文件 | commit | 说明 |
|------|---------|--------|------|
| 2026-06-04 | （待办）`alongor666-skills/skills/ui-redesign/references/acceptance-criteria.md` | — | 加 §B9 "单位流转审计"项 |
| 2026-06-04 | （待办）`alongor666-skills/skills/ui-redesign/references/design-brief-template.md` | — | 加 "feature flag 速查" + "后端字段契约表" + "业务公式 SSOT 路径"三节 |
| 2026-06-04 | （待办）`alongor666-skills/skills/ui-redesign/SKILL.md` | — | Phase D 增加"codex review 5 步 SOP"强制环节 |

**触发**：用户下次说 "crystallize" / "沉淀 skill" / "把这些经验沉淀进去" 时，按 `chexian-crystallize-skill` 流水线一并完成。

---

## 7. 延后任务完成情况（2026-06-04 后续会话）

> 来源：[next-session-handoff.md](./next-session-handoff.md) 四项延后任务全部实施。

### 7.1 PR 链与提交

| PR | 任务 | 范围 | commit head | codex P 修复 |
|----|------|------|------|------|
| #479 | 任务 1：趋势图 SVG renderer + 智能标签 | 低风险 / 独立 PR | `3b9c859a` | 0 P 反馈（第 1 轮） |
| #480 | 任务 2+3：维度分段控件 + 下钻深度徽章 | 中风险 / Panel.tsx 浅层 | `c28090cb` → `9dd9628b`（P2 fix） | P2-1（双 radiogroup ARIA）已修 |
| #481 | 任务 4：HeatmapFocusPanel slide-in 抽屉 | 高风险 / 独立 PR | `f7c937e7` → `ff5bfb17`（P1 fix） | P1-1（document mousedown vs picker overlay）已修 |

### 7.2 实施层关键决策

- **任务 1 ECharts SVG renderer**：本组件按业务维度配色（`getLineColor` SSOT，非年色），handoff prompt 中 "year 色用 getYearChartColor 不硬编码" 不适用；保留现有色板，仅给 line_order 最小的"主线"加 `markPoint`（峰值）+ `endLabel`（最新值），formatter 严格按 metric 走 `formatWanAdaptive`（保费=元）/ `formatCount`（件数=件）
- **任务 2 分段控件**：维度分组（组织/业务）从 `HEATMAP_DIMENSION_LABELS` SSOT 取 label，不硬编码字符串 — 改 SSOT 时自动跟进
- **任务 3 下钻徽章**：chip 仅 `heatmapDrillPath.length > 0` 渲染，颜色用 `colorClasses.bg.primary` + `colorClasses.text.primaryDark`
- **任务 4 抽屉关闭路径**：×按钮 / ESC / 切换单元格 三路；**不**挂 document 外部点击关闭（codex P1 抓出与 DimensionPicker overlay 时序冲突）

### 7.3 codex review 第 1 轮新经验（追加到 §3.1 候选条目）

- [ ] **ARIA radiogroup × 状态映射 invariant**：sibling 多个 `role="radiogroup"` 共享单一互斥状态 → 必然存在某组无任何 `aria-checked=true` → 屏幕阅读器单选语义破坏。修法：外层包单一 radiogroup，内层视觉分组用 div + `aria-hidden="true"`。静态闸：把分组常量提到独立文件 + invariant 单测（keys 联合 == labels 全集）
- [ ] **document 全局监听 × React 合成 onClick 时序铁律**：任何 `document.addEventListener('mousedown' | 'click')` 都会先于子树外 `fixed` overlay 内的 React 合成 onClick 触发；若该监听写状态 → onClick 拿到的状态已被改写。修法：避免在交互密集页面挂 document 全局监听，优先 ESC / 按钮 / 切换替代「外部点击关闭」
- [ ] **设计稿外的"自加交互"风险**：本次任务 4 抽屉的"外部点击关闭"在设计稿 chat1.md / line 526-528 中无要求，是落地时自加的便利特性，但引入 P1 时序 bug。建议落地前对照设计稿剔除无明确要求的"我以为更好"功能

### 7.4 新增静态闸

- 新增文件 `src/features/dashboard/config/heatmapDimGroups.ts`（HEATMAP_DIM_GROUPS SSOT）
- 新增单测 `src/features/dashboard/config/__tests__/heatmapDimGroups.test.ts`（4 个 invariant：keys 全集 / 无重复 / groupLabel 非空无重 / 每组 ≥1 key）

### 7.5 工程经验：bcrypt native binding 在新 worktree 失败

`bun install` 在 server/ 装 bcrypt@5.1.1 时 node-pre-gyp 报错（macOS arm64 prebuilt binary 异常 — `__LINKEDIT load command content extends beyond end of file`），导致 pre-push hook 跑集成测试 fail。
- 排查：`node -e "require('.../bcrypt')"` 直接验证 dlopen
- 修复：`rm -rf server/node_modules/bcrypt && bun install --force` 重装；或从 known-good worktree `cp -R bcrypt/` 过去（最快）
- 复用：3 个 worktree 中后两个都复用 perf-followup 的已修 bcrypt，省时

### 7.6 完成标志（来自 next-session-handoff）

- [x] 4 项任务全部实施（PR #479 / #480 / #481）
- [x] 每 PR 走 5 步 SOP（抽 pattern / 全仓 grep / 修 / 加静态闸 / 复盘评论 + @codex review）
- [x] retro.md 本节已加（§7）
- [ ] PR 全部 merged（等异步 review 收敛）
- [ ] 通用经验回写 ui-redesign skill 仓库（§3.1 候选 + §7.3 新经验，由 `chexian-crystallize-skill` 流水线触发执行）
