---
name: diagnose_vehicle.py 7板块通用诊断工具
description: 车型/客户类别/机构通用诊断脚本，7板块结构，支持任意 SQL WHERE 筛选
type: project
---

`数据管理/pipelines/diagnose_vehicle.py` v3.0（2026-03-31）

**用法**：
```bash
python3 数据管理/pipelines/diagnose_vehicle.py --filter "厂牌车型 LIKE '%牵引%'" --title 牵引车
python3 数据管理/pipelines/diagnose_vehicle.py --filter "客户类别 = '营业货车'" --title 营业货车
```

**7 板块结构**：
1. 整体经营概况（按年份展开 + 趋势分析文字）
2. 新转续过户维度（2.0 汇总 + 2.1-2.4 分项分年）
3. 能源类型（非新-燃/非新-天/新能源，天然气预留空列）
4. 风险评分（智能检测字段 + 无评分列）
5. 季度趋势（汇总表 + 7 个 ASCII 条形图，21Q1 格式）
6. 险类（商业险/交强险）
7. 诊断总结（亮灯 + 关键发现 + 更多维度建议）

**与 diagnose_agent.py 的关系**：
- diagnose_agent.py：按经代公司诊断（需 --org + --agent）
- diagnose_vehicle.py：按任意 WHERE 条件诊断（更通用）

**文件名**：`{title}_经营诊断_{min_yr}_{max_yr}_截至{最新签单日期}.md`

**Why:** 用户需要对不同车型、客户类别、机构进行标准化的全维度诊断，输出格式统一便于横向对比。
