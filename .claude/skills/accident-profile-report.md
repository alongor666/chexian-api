---
name: accident-profile-report
description: 事故画像专项报告 — 基于理赔明细文本（出险经过）+ 保单属性，生成分车种/分险种的事故画像报告（时段×路段热力、碰撞对象、事故场景等 9 章节）。Use when 用户说"事故画像"、"出险经过分析"、"分车种事故报告"，或需要从理赔明细文本挖掘事故模式时。
version: 1.0.0
---

# 事故画像专项报告

## 用途
基于理赔明细文本（出险经过）+ 保单属性，生成分车种/分险种的事故画像报告。

## 脚本
- **生成器**: `数据管理/scripts/accident_profile_report.py`
- **配置**: `数据管理/scripts/accident_profile_configs.json`
- **输出目录**: `数据管理/数据分析报告/事故画像/`

## 用法

```bash
# 列出所有可用分群
python3 数据管理/scripts/accident_profile_report.py --config 数据管理/scripts/accident_profile_configs.json --list

# 生成单个分群报告
python3 数据管理/scripts/accident_profile_report.py --config 数据管理/scripts/accident_profile_configs.json --segment 摩托车

# 全量生成
python3 数据管理/scripts/accident_profile_report.py --config 数据管理/scripts/accident_profile_configs.json --segment all
```

## 报告结构（每份报告 9 个章节）
1. 基线（件数/中位赔/P90/P99/大额率/人伤率）
2. 时段 × 路段热力图（件数+人伤率）
3. 碰撞对象构成（件数/占比/中位赔/人伤率）
4. 事故场景构成
5. 碰撞对象 × 时段交叉
6. 驾驶人年龄 × 时段
7. 驾驶人年龄 × 事故场景
8. NCD × 事故场景（有NCD数据时）
9. 车龄 × 碰撞对象
10. 出险城市TOP10

## 口径
- 仅非零赔案（排除零赔报案/撤案）
- 仅2021-2024年已结案件
- 需有出险经过文字描述
- 统计量用中位赔+大额率，不用均赔（肥尾分布）
- 关键词从文本提取碰撞对象/场景/路段

## 新增分群
编辑 `accident_profile_configs.json`，添加一个对象：
```json
{
  "id": "segment_id",
  "name": "显示名称",
  "filter": "p.customer_category = 'xxx' AND ..."
}
```
filter 中 `cd` = claims_detail, `p` = PolicyFact。

## 更新数据后重跑
当新的理赔明细数据到位后，直接重跑 `--segment all` 即可。
