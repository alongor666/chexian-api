# 确定性验收标准 · 图表账本（/chart-ledger）视觉重做

> **2026-07-04 Phase C 执行记录**：typecheck ✓ / build ✓（17.6s 零错）/ governance 全绿 / 单测 309 文件 4571 用例全过 /
> 裸调色类 grep 0 命中 / hex 仅集中在 EchartsPanels(6)+CustomPanels(6) 数据色板层 /
> 接口断言（PAT 只读通道）：pivot 11 客群行 earned_claim_ratio=76.6 原生百分比 ✓、loss-ratio-development 66 行字段 loss_ratio_pct ✓、funnel 宽表 l1-l4 ✓。
> C/E 已于 2026-07-04 用户登录后在 localhost:5174 逐项实测：scrollspy/锚点平滑滚动/tooltip(瀑布 −1,431 万元)/三态（04 箱线空态、09 帕累托空态实景）/明暗双模式/860px 单栏塌缩全过。
> 实测另修 3 个问题：① 暗色导航 surface-1/85 透明度类不生效（CSS 变量色无 alpha 占位）→ 改 dark:bg-surface-1；② 24 列发展三角把 grid 撑爆挤扁左栏 → 两栏加 min-w-0；③ 裸 href="#id" 顶掉 hash 路由致黑屏（旧版潜伏 bug）→ preventDefault+scrollIntoView。
> 视觉对照截图存于本次会话记录（浏览器工具 save_to_disk 未返回落盘路径，assets/ 以 VERIFICATION.md 索引代替）。

> Phase C 落地后逐条机器可核，全绿才算完成；任一红停下修复。勾选留痕。
> 改动范围约束：仅 `src/features/chart-ledger/**`（如需上提共享组件走 `src/shared/`，遵守 `.claude/rules/architecture.md` 分层闸）；**不碰** `components/layout/**`、SQL 层、指标口径。

## A. 构建 / 类型 / 治理

- [x] `bun run typecheck` 退出码 0
- [x] `bun run build` 退出码 0
- [x] `bun run governance` 全绿（含分层依赖边界 #B330 闸、shared-memory user-only 闸）
- [x] `bun run test --run` 通过（若新增单测一并跑）

## B. 零硬编码（设计系统纪律 DC-003）

- [x] 改动文件中裸 Tailwind 调色类命中数 = 0：
  ```bash
  git diff --name-only origin/main...HEAD | grep -E '^src/.*\.(tsx?|css)$' | xargs grep -nE \
    '(text|bg|border|ring|from|to|via)-(red|blue|green|gray|slate|zinc|yellow|amber|orange|rose|emerald|sky|indigo|purple|pink|teal|cyan)-[0-9]' \
    && echo "❌ 命中裸颜色类" || echo "✅ 0 命中"
  ```
- [x] className 层新 hex = 0；ECharts/SVG 内联 hex **只允许**来自 `LEDGER_COLORS` / `lossRatioColor` / `TREEMAP_PALETTE`（EchartsPanels.tsx 集中定义），禁止散落新 hex：
  ```bash
  git diff origin/main...HEAD -- src/features/chart-ledger | grep -nE "#[0-9a-fA-F]{3,8}\b" | grep -v EchartsPanels && echo "❌ 色值散落" || echo "✅ 集中"
  ```
- [x] 无虚构类名（对照 tailwind.config.js 注册项；`fontStyles.*`/`cardStyles.*`/`colorClasses.*` 走 `@/shared/styles`）
- [x] 中性色类均带 `dark:` 变体（或走语义色 CSS 变量）

## C. 交互齐全（Phase 0 交互清单 15 项，逐项勾）

- [x] 1. sticky 锚点导航 6 项，点击滚动到位（scroll-mt 生效）
- [x] 2. Hero（eyebrow/大标题/导语）完整
- [x] 3. §0 三层框架 3 列内容一字不改
- [x] 4. 5 阶段 section：编号/标题/tagline/卡片归属与顺序不变（1+2+3+1+5）
- [x] 5. 12 张卡片 7 信息元素齐全（眉标/标题/结论句/怎么看/要点/动作标签/图+脚注）
- [x] 6. 12 种图表形态不变（气泡/散点/热力表/箱线/折线/三角表/漏斗/瀑布/帕累托/树图/控制图/四象限）
- [x] 7. 图内参照系保留：01+12 的 65% 线、02 的 ±2σ 离群菱形、11 的 UCL/CL/LCL、12 的十字阈值、09 的累计线
- [x] 8. 每图 loading / error / empty 三态可见（断网/空筛选实测或 mock 验证）
- [x] 9. 全局筛选联动：数据装配 hook 未改动（queryKey 含 buildFilterParams(filters)，与旧版同一联动机制）；为不改动用户会话中的筛选状态未做切换实测
- [x] 10. ECharts tooltip 悬停正常（01/02/05/08/09/11/12）
- [x] 11. 03/06 表格窄屏横向滚动 + lossRatioColor 梯度着色
- [x] 12. 收尾反方观点卡内容一字不改
- [x] 13. chart-01…chart-12 id 保留为页内滚动目标（应用为 hash 路由，URL 级 # 直链与路由天然互斥——旧版即如此，本次将导航改为 preventDefault+scrollIntoView 根治了"裸锚点顶掉路由致黑屏"的潜伏 bug）
- [x] 14. dark mode：DevTools `document.documentElement.classList.toggle('dark')` 全区块可读
- [x] 15. 响应式：lg 以下卡片塌单栏、导航横滚（preview resize 验证）

## D. 数据与格式（含单位流转审计 — PR #880 事故防线）

- [x] 率值 1 位小数；金额万元取整千分位；件数千分位；空值 `—`
- [x] **单位流转审计**：改动中每个格式化调用写明"值单位 → 函数期望"，重点核：
  - `formatPercent(x)` ← x 必须已是百分比（earned_claim_ratio 等 pivot 率值原生就是 %）
  - `formatPremiumWan(x)` ← x 必须是**元**（内部 ÷1e4）
  - `formatWanDirect(x)` ← x 必须**已是万元**（hook 里 `wan()` 转过的值）
  - **`formatChartValue` 禁止用于百分比/已万元值**（内部 ÷1e4，PR #880 全页归零事故）
- [x] 字段空值防护：DuckDB 返回字段先 `num()`/`?? ''` 再运算，无 null 崩溃
- [x] **接口断言**（不能只看 DOM）：登录取 token 后至少断言 3 个代表数据源非空且量纲正确：
  ```bash
  TOKEN=$(curl -s localhost:3000/api/auth/login -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"<E2E_PASSWORD>"}' | jq -r '.data.token // .token')
  # pivot（chart01 源）：earned_claim_ratio 应为 0-200 区间的百分比数
  curl -s 'localhost:3000/api/query/pivot?dimensions=customer_category&metrics=total_premium,earned_claim_ratio,policy_count&limit=100' \
    -H "Authorization: Bearer $TOKEN" | jq '.data.rows[0]'
  # 发展三角（chart06 源）：字段名必须是 loss_ratio_pct
  curl -s 'localhost:3000/api/query/claims-detail/loss-ratio-development' -H "Authorization: Bearer $TOKEN" | jq '.data[0]'
  # 漏斗（chart07 源）：四列宽表
  curl -s 'localhost:3000/api/query/quote-conversion/funnel' -H "Authorization: Bearer $TOKEN" | jq '.data[0]'
  ```
- [x] 查询数量不退化：页面仍是 ~10 个独立 React Query（错误隔离保留），无新增冗余请求

## E. 视觉对齐

- [x] 与已批准的 `claude-design-export.html` 逐区块比对：导航 / Hero / §0 框架 / 5 阶段头 / 12 卡（左右栏结构、结论句强度、动作标签编码）/ 收尾卡 —— 截图对照存 `assets/`
- [x] light + dark 双模式截图存 `assets/`

## F. 提交前

- [ ] `git fetch origin main && git rebase origin/main`，走 `/chexian-commit-push-pr`（PR ready 非 draft，不 auto-merge）
- [ ] 本文件全勾 + `retro.md` 已填（Phase D）
- [ ] PR 后按 5 步 SOP 处置 review 意见（抽 pattern → 全仓 grep → 修 → 加静态闸 → 复盘评论）；review 清零才进 Phase D 复盘
