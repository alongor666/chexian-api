# KPI看板优化计划

**目标**：增强KPI卡片可视化，占比类指标以迷你环形图直观展示数据分布，并降低理解成本

**创建时间**：2026-01-09
**分支**：`feature/kpi-visualization-enhanced`
**状态**：PROPOSED

---

## 1. 需求分析

### 1.1 用户需求
- **问题**：当前KPI卡片只显示数值（如"过户占比：35.0%"），不够直观
- **期望**：占比类指标显示小型图表，一眼看出各类别的占比分布
- **例子**：过户占比 = 显示过户/非过户的环形图

### 1.1.1 价值衡量（新增）
- **理解效率**：用户无需二次计算即可判断主次占比
- **误读降低**：明确标注口径（承保/净额），减少口径误判

### 1.2 当前KPI指标分类

**数值类指标**（3个 - 保持现状）：
1. 总保费：`SUM(premium)`
2. 保单件数：`COUNT(DISTINCT policy_no)`
3. 人均保费：`SUM(premium) / COUNT(DISTINCT salesman_name)`

**占比类指标**（6个 - 需要增强）：
1. 过户占比：`COUNT(CASE WHEN is_transfer THEN 1 END) / COUNT(*)`
2. 电销占比：`COUNT(CASE WHEN is_telemarketing THEN 1 END) / COUNT(*)`
3. 续保占比：`COUNT(CASE WHEN is_renewal THEN 1 END) / COUNT(*)`
4. 商业险占比：`SUM(CASE WHEN insurance_type='商业保险' THEN premium ELSE 0 END) / SUM(premium)`
5. 新能源占比：`COUNT(CASE WHEN is_nev THEN 1 END) / COUNT(*)`
6. 新车占比：`COUNT(CASE WHEN is_new_car THEN 1 END) / COUNT(*)`

### 1.3 数据口径与异常处理

- **承保口径（默认）**：仅统计 `保费 > 0` 的记录，作为件数与占比类 KPI 的分母。
- **净额口径（补充）**：统计包含正/零/负保费，反映财务净值。
- **负保费含义**：以前年度保单在当年退保。
- **零保费含义**：当年保单在当年起保前/后退保，或次年退保。
- **商业险占比**：使用承保口径保费作为分母与分子。
- **口径文档**：新增 `开发文档/KPI口径说明.md` 作为唯一口径说明。

### 1.4 可视化范围（先行范围）

- **首期展示**：仅对 2~3 个核心占比（过户/续保/商业险）启用环形图。
- **其余占比**：保持数值展示，降低视觉噪音并缩短首期开发周期。

---

## 2. UI设计方案（简化版）

### 2.1 布局设计

**数值类KPI卡片**（保持不变）：
```
┌────────────────────┐
│  总保费            │
│  ¥1,234,567        │
└────────────────────┘
```

**占比类KPI卡片**（新增圆环图）：
```
┌─────────────────────────────────┐
│  过户占比                        │
│                                 │
│  65.0%        [🍩  35.0%]      │ ← 左侧非过户占比 + 圆环图(中心显示过户占比)
│                                 │
│  ● 非过户  ○ 过户                │ ← 底部图例
└─────────────────────────────────┘
```

**说明**：
- 左侧：显示非过户占比（次要类别）
- 右侧：圆环图，圆环中心显示过户占比（主要类别）
- 无需tooltip，直接展示数据
- 底部图例：显示类别标签+颜色点

### 2.2 交互设计（简化）
- **无复杂交互**：不提供tooltip，数据直接显示在卡片上
- **颜色方案**：蓝色(过户) + 灰色(非过户)
- **图例**：显示2个类别的标签+颜色点

### 2.3 响应式布局
- **大屏**（≥1024px）：6列网格，每个卡片宽度合适
- **中屏**（768px-1024px）：3列网格
- **小屏**（<768px）：2列网格

---

## 3. 技术实现方案

### 3.1 新增组件

**文件**：`src/widgets/kpi/EnhancedKpiCard.tsx`

**Props设计**：
```typescript
export interface EnhancedKpiCardProps {
  title: string;                    // KPI标题
  value: number | string;           // KPI数值
  formatter?: (val: number) => string;  // 格式化函数
  loading?: boolean;                // 加载状态
  type?: 'value' | 'donut'; // 卡片类型
  ratioData?: Array<{               // 占比数据（type='donut'时必填）
    label: string;                  // 标签（如"过户"、"非过户"）
    value: number;                  // 数值
    color?: string;                 // 颜色（可选）
  }>;
  chartSize?: number;               // 图表尺寸（默认60px）
}
```

**组件实现**：
- 优先轻量 Canvas/SVG 自绘（保留后续切换 ECharts 的扩展位）
- 布局：左侧数值 + 右侧图表 + 底部图例
- 图表尺寸：60x60px（紧凑不占用过多空间）

### 3.2 SQL查询优化

**问题**：当前`generateKpiQuery`只返回占比值（如0.35），没有返回分解数据

**解决方案**：新增`generateKpiDetailQuery`，返回占比类指标的分解数据（承保口径）

**新增文件**：`src/shared/sql/kpi-detail.ts`

**SQL设计**：
```sql
SELECT
  -- 基础KPI（数值类）
  SUM(premium) as total_premium,
  COUNT(DISTINCT policy_no) as policy_count,
  SUM(premium) / NULLIF(COUNT(DISTINCT salesman_name), 0) as per_capita_premium,

  -- 过户占比（分解数据）
  COUNT(CASE WHEN is_transfer THEN 1 END) as transfer_count,
  COUNT(CASE WHEN NOT is_transfer THEN 1 END) as non_transfer_count,

  -- 电销占比（分解数据）
  COUNT(CASE WHEN is_telemarketing THEN 1 END) as telesales_count,
  COUNT(CASE WHEN NOT is_telemarketing THEN 1 END) as non_telesales_count,

  -- 续保占比（分解数据）
  COUNT(CASE WHEN is_renewal THEN 1 END) as renewal_count,
  COUNT(CASE WHEN NOT is_renewal THEN 1 END) as non_renewal_count,

  -- 商业险占比（分解数据）
  SUM(CASE WHEN insurance_type = '商业保险' THEN premium ELSE 0 END) as commercial_premium,
  SUM(CASE WHEN insurance_type != '商业保险' THEN premium ELSE 0 END) as non_commercial_premium,

  -- 新能源占比（分解数据）
  COUNT(CASE WHEN is_nev THEN 1 END) as nev_count,
  COUNT(CASE WHEN NOT is_nev THEN 1 END) as non_nev_count,

  -- 新车占比（分解数据）
  COUNT(CASE WHEN is_new_car THEN 1 END) as new_car_count,
  COUNT(CASE WHEN NOT is_new_car THEN 1 END) as non_new_car_count
FROM PolicyFact
WHERE {whereClause}
```

### 3.3 Dashboard集成

**修改文件**：`src/features/dashboard/PremiumDashboard.tsx`

**改动点**：
1. 导入新组件：
   ```tsx
   import { EnhancedKpiCard } from '../../widgets/kpi/EnhancedKpiCard';
   import { generateKpiDetailQuery } from '../../shared/sql/kpi-detail';
   ```

2. 新增state存储KPI详细数据：
   ```tsx
   const [kpiDetails, setKpiDetails] = useState<any>({});
   ```

3. 修改KPI查询逻辑：
   ```tsx
   // 原有查询（基础KPI）
   const kpiSql = generateKpiQuery(where);
   // 新增查询（KPI详细数据）
   const kpiDetailSql = generateKpiDetailQuery(where);
   ```

4. 替换KPI卡片渲染：
   ```tsx
   {/* 数值类KPI */}
   <EnhancedKpiCard
     title="总保费"
     value={kpis.total_premium}
     formatter={formatPremium}
     loading={loadingKpi}
     type="value"
   />

   {/* 占比类KPI */}
   <EnhancedKpiCard
     title="过户占比"
     value={kpis.transfer_rate}
     formatter={formatRate}
     loading={loadingKpi}
     type="donut"
     ratioData={[
       { label: '过户', value: kpiDetails.transfer_count },
       { label: '非过户', value: kpiDetails.non_transfer_count },
     ]}
   />
   ```

---

## 4. 实施步骤

### Phase 1: SQL层（数据准备）
- [ ] 创建 `src/shared/sql/kpi-detail.ts`
- [ ] 实现 `generateKpiDetailQuery` 函数
- [ ] 明确承保/净额口径的过滤条件（默认承保口径）
- [ ] 约定占比类 KPI 由明细聚合计算，避免双口径漂移
- [ ] 编写单元测试验证SQL正确性

### Phase 2: 组件层（UI组件）
- [ ] 创建 `src/widgets/kpi/EnhancedKpiCard.tsx`
- [ ] 实现2种类型：value/donut（简化，去掉 pie）
- [ ] 圆环图中心显示主要占比，左侧显示次要占比
- [ ] 无tooltip，数据直接展示
- [ ] 添加响应式布局
- [ ] 编写单元测试验证组件渲染

### Phase 3: 集成层（Dashboard）
- [ ] 修改 `PremiumDashboard.tsx` 导入新组件
- [ ] 修改KPI查询逻辑（同时查询基础KPI和详细KPI）
- [ ] 替换KPI卡片渲染（首期仅核心占比启用 donut）
- [ ] 添加错误处理和loading状态

### Phase 4: 测试验证
- [ ] **单元测试**：`bun test` 确保所有测试通过
- [ ] **类型检查**：`bun run build` 确保无TypeScript错误
- [ ] **浏览器实测**：
  - 启动开发服务器：`bun run dev`
  - 上传测试数据：`签单清洗/优化处理后的业务数据.parquet`
  - 验证KPI卡片显示正确
  - 验证迷你环形图渲染正确
  - 验证无 tooltip 设计符合预期
  - 验证响应式布局

### Phase 5: 文档与治理
- [ ] 更新 `src/widgets/kpi/INDEX.md`（新增EnhancedKpiCard组件说明）
- [ ] 更新 `src/shared/sql/INDEX.md`（新增kpi-detail.ts说明）
- [ ] 新增 `开发文档/KPI口径说明.md` 并纳入 DOC_INDEX
- [ ] 运行治理校验：`bun run scripts/check-governance.mjs`
- [ ] 在 BACKLOG.md 添加任务记录（状态=DONE）

---

## 5. 关键文件清单

**新增文件**：
- `src/widgets/kpi/EnhancedKpiCard.tsx` - 增强型KPI卡片组件
- `src/shared/sql/kpi-detail.ts` - KPI详细数据SQL生成器
- `tests/kpi-detail.test.ts` - kpi-detail SQL测试

**修改文件**：
- `src/features/dashboard/PremiumDashboard.tsx` - 集成新组件
- `src/widgets/kpi/INDEX.md` - 更新组件索引
- `src/shared/sql/INDEX.md` - 更新SQL索引
- `BACKLOG.md` - 添加任务记录

---

## 6. 验收标准

### 6.1 功能验收
- ✅ 数值类KPI（总保费、保单件数、人均保费）保持原有显示
- ✅ 核心占比类 KPI（过户/续保/商业险）显示迷你环形图
- ✅ 环形图正确显示各类别的占比分布
- ✅ 图例显示类别标签+颜色
- ✅ 数据直接展示，符合“无 tooltip”设计
- ✅ 负/零保费按承保/净额口径正确区分

### 6.2 性能验收
- ✅ 迷你图渲染不影响页面加载速度
- ✅ 首屏包体积增量可控（如仅引入轻量绘制方案）
- ✅ 查询优化：一次查询获取所有KPI详细数据

### 6.3 兼容性验收
- ✅ 响应式布局：支持大/中/小屏
- ✅ 浏览器兼容：Chrome/Safari/Firefox最新版
- ✅ 数据为空时显示loading状态

---

## 7. 风险与备选方案

### 风险1：迷你图太小看不清
- **缓解措施**：设置最小尺寸60px，中心数值直显占比
- **备选方案**：提供"放大查看"功能（点击卡片打开大图）

### 风险2：SQL查询变慢（新增分解数据查询）
- **缓解措施**：使用单次联合查询，避免多次查询
- **备选方案**：前端根据占比值反算分解数据（估算）

### 风险3：ECharts包体积增大
- **缓解措施**：默认使用自绘方案，仅在必要时引入 ECharts
- **备选方案**：保留轻量 SVG 方案作为后备

---

## 8. 后续优化方向

1. **下钻功能**：点击KPI卡片跳转到详细分析页面
2. **对比功能**：支持时间段对比（环比、同比）
3. **自定义图表**：允许用户切换饼图/环形图/条形图
4. **导出功能**：导出KPI卡片为图片（用于报告）
5. **阈值告警**：KPI异常时高亮显示（如占比过低）

---

**变更历史**：
- 2026-01-09：初始版本创建
- 2026-01-09：补充口径范围、首期可视化范围与轻量绘制策略
