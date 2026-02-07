# 业务员归属关系映射

## 概述

本目录包含业务员归属关系的完整映射数据，用于业务员业绩分析。数据整合自 2025 年和 2026 年销售人员分产品保费计划文件。

## 文件说明

### ⚠️ 重要说明

本文件提取的是**2026年车险保费计划**（Excel第5列，标题为"车"），而非所有险种的合计。

原始Excel文件结构：
- 列4：车（车险保费计划）← **已提取**
- 列5：财（财产险保费计划）
- 列6：人（人身险保费计划）
- 列7：合计（所有险种总计）

### 1. salesman_organization_mapping.json

**完整的数据文件，包含以下内容：**

- **salesman_mapping**: 业务员映射列表
  - `business_no`: 业务员编号
  - `salesman_name`: 业务员姓名
  - `full_name`: 编号+姓名（完整标识）
  - `team`: 所属团队
  - `organization`: 三级机构
  - `car_insurance_plan_2026`: 2026 年**车险**保费计划（单位：万）

- **statistics**: 统计信息
  - `total_salesmen`: 业务员总数
  - `total_teams`: 团队总数
  - `total_organizations`: 机构总数
  - `organizations`: 机构列表
  - `teams`: 团队列表
  - `sources`: 数据来源统计

### 2. generate_salesman_mapping.py

**数据生成脚本**

用法：
```bash
cd 数据管理/业务员归属与规划
python3 generate_salesman_mapping.py
```

脚本会自动：
1. 读取 2025 年和 2026 年 Excel 文件
2. 提取业务员归属数据
3. 去除汇总行
4. 合并并去重
5. 生成 JSON 文件

## 数据统计

当前数据版本（2026-01-16）：

- **总业务员数**: 206
- **有车险计划的业务员数**: 203
- **总团队数**: 46
- **总机构数**: 12
- **车险计划总额**: 34,967 万（约 3.5 亿）

### 机构列表

乐山、天府、宜宾、德阳、新都、武侯、泸州、自贡、资阳、达州、青羊、高新

### 团队列表

武侯业务一部/二部/五部、青羊业务一部/四部、高新业务二部/三部/四部、
泸州业务一部/二部/三部、宜宾业务一部/二部、德阳业务一部/三部、
新都业务一部/三部、自贡业务一部/四部、达州业务一部/三部/四部、
资阳业务四部、乐山业务一部等（共 46 个团队）

## 使用场景

### 1. 业务员业绩分析

在分析业务员业绩时，可通过业务员编号快速查找其所属团队和机构：

```javascript
// 查找业务员归属
function findSalesmanInfo(businessNo) {
  const mapping = require('./salesman_organization_mapping.json');
  return mapping.salesman_mapping.find(
    item => item.business_no === businessNo
  );
}

// 示例
const info = findSalesmanInfo('106014762');
// 返回: { business_no: "106014762", salesman_name: "刘刚", team: "武侯业务二部",
//         organization: "武侯", car_insurance_plan_2026: 5.0 }
```

### 2. 机构维度聚合

按机构聚合业务员数据：

```javascript
const mapping = require('./salesman_organization_mapping.json');

// 按机构分组
const byOrg = mapping.salesman_mapping.reduce((acc, item) => {
  if (!acc[item.organization]) {
    acc[item.organization] = [];
  }
  acc[item.organization].push(item);
  return acc;
}, {});

// 获取某个机构的所有业务员
const wuhouSalesmen = byOrg['武侯'];
```

### 3. 团队维度分析

按团队分析业绩：

```javascript
// 按团队分组
const byTeam = mapping.salesman_mapping.reduce((acc, item) => {
  if (!acc[item.team]) {
    acc[item.team] = {
      organization: item.organization,
      salesmen: []
    };
  }
  acc[item.team].salesmen.push(item);
  return acc;
}, {});

// 获取某个团队的信息
const teamInfo = byTeam['武侯业务二部'];
```

### 4. DuckDB 查询

将 JSON 数据导入 DuckDB 进行分析：

```sql
-- 读取 JSON 文件
CREATE VIEW salesman_mapping AS
SELECT *
FROM read_json_auto('数据管理/业务员归属与规划/salesman_organization_mapping.json', record_format='array');

-- 查询某个业务员的归属
SELECT
  salesman_name,
  team,
  organization,
  plan_2026
FROM salesman_mapping
WHERE business_no = '106014762';

-- 按机构统计业务员数量
SELECT
  organization,
  COUNT(*) AS salesman_count
FROM salesman_mapping
GROUP BY organization
ORDER BY salesman_count DESC;
```

### 5. TypeScript 类型定义

```typescript
interface SalesmanMapping {
  salesman_mapping: SalesmanInfo[];
  statistics: Statistics;
}

interface SalesmanInfo {
  business_no: string;
  salesman_name: string;
  full_name: string;
  team: string;
  organization: string;
  car_insurance_plan_2026?: number; // 2026年车险保费计划（单位：万）
}

interface Statistics {
  total_salesmen: number;
  total_teams: number;
  total_organizations: number;
  organizations: string[];
  teams: string[];
  sources: {
    '2026_plan_count': number;
    '2025_actual_count': number;
    unique_count: number;
  };
}
```

## 数据更新

当需要更新业务员归属数据时：

1. 将最新的 Excel 文件放到本目录
2. 修改 `generate_salesman_mapping.py` 中的文件名
3. 运行脚本：`python3 generate_salesman_mapping.py`
4. 验证生成的 JSON 文件
5. 提交到代码库

## 数据质量保证

- ✅ 已去除汇总行
- ✅ 已去重（以业务员编号为主键）
- ✅ 字段已清理（去除空格）
- ✅ 数据已验证（206 个唯一业务员）
- ✅ 包含完整的机构-团队-业务员三级关系

## 相关文件

- `2026年销售人员分产品保费计划.xlsx` - 2026 年计划数据源
- `2025年销售人员分产品保费计划达成情况.xlsx` - 2025 年实际数据源
- `generate_salesman_mapping.py` - 数据生成脚本
- `salesman_organization_mapping.json` - 最终的映射文件

## 版本历史

- **2026-01-16**: v2.0 - 车险计划版本
  - ✅ 修正：提取**车险**保费计划（列4），而非合计数据
  - 整合 2025 和 2026 年数据
  - 206 个业务员（203 个有车险计划），46 个团队，12 个机构
  - 车险计划总额：34,967 万（约 3.5 亿）
  - 生成 JSON 映射文件

- **2026-01-16**: v1.0 - 初始版本
  - 整合 2025 和 2026 年数据
  - 206 个业务员，46 个团队，12 个机构
  - 生成 JSON 映射文件（包含所有险种合计数据）
