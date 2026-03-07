# 2026-03-06 夜间流水线执行摘要

## 执行范围

- 驾乘险推介率日报自动生成
- 机构维度 CSV 拆分汇总
- VPS 业绩分析热力图与下钻链路线上复验

## 执行结果

- 日报产出：`数据管理/驾乘险推荐率/输出/数据分析报告/驾乘险推介率日报_2026-03-06.md`
  - 报告生成时间：`2026-03-06 08:26:55`
  - 分析周期：最近 14 天
  - 数据截止：`2026-03-06`
- 拆分汇总：`数据管理/驾乘险推荐率/机构数据/数据拆分汇总.json`
  - 源数据：`每日数据_20250101_20260304.parquet`
  - 覆盖机构：13 家
  - 总记录数：28,341
  - 汇总生成时间：`2026-03-06 09:06:32`
- 线上热力图复验：`output/playwright/vps-heatmap-verify-20260306_090250.json`、`output/playwright/vps-heatmap-verify-20260306_130325.json`、`output/playwright/vps-heatmap-verify-20260306_133056.json`
  - 三次通过，页面最终 URL 均为 `/#/performance-analysis`
  - 热力图接口 `performance-org-heatmap` 返回 200
  - 成功样本中 `performance-bundle` 返回 200，且 `consoleErrorCount=0`
- 下钻链路复验：`output/playwright/vps-heatmap-drilldown-verify-1772775070694.json`
  - 热力图标题已更新为“三级机构连续15天热力图”
  - 下钻标题正确显示“已选维度：业务员 · 热力图机构：资阳”
  - `performance-drilldown` 实际请求 1 次，HTTP 200

## 关键发现

- 今日验收存在两次瞬时失败：
  - `output/playwright/vps-heatmap-verify-20260306_090102.json`：等待“增长率”标签可见超时。
  - `output/playwright/vps-heatmap-verify-20260306_132949.json`：未捕获到 `performance-org-heatmap` 的 200 响应。
- 两类失败均在紧接着的复跑中恢复，说明当前更像页面加载时序或抓包窗口波动，而不是稳定性回退。
- 现有“性能监控”仍以专项验收脚本和 2026-03-02 的压测工件为主，还没有前端运行时 Web Vitals 与业务指标自动上报。

## 结论

- 今日夜间流水线已完成日报产出、机构拆分和线上专项复验，未发现阻断上线的持续性故障。
- 后续若继续推进性能治理，应优先落地 `B131/B132`，把当前脚本证据升级为持续监控。
