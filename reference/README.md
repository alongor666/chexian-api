# /reference/ - 业务配置索引

> **说明**：本文件夹包含业务权威配置文件，定义业务规则、KPI 阈值、年度计划等。这些文件是**唯一事实来源**，受护栏保护。

---

## 🔒 护栏规则（CRITICAL）

⚠️ **禁止破坏性变更**：业务配置属于护栏保护范围，**禁止**以下操作：
1. **禁止重命名**现有字段、键名
2. **禁止删除**现有配置项
3. **禁止修改**现有口径（如阈值计算公式、业务分类逻辑）

✅ **允许的操作**：
1. **追加**新的配置项（不影响现有逻辑）
2. **扩展**现有配置（如添加新的业务类型映射）
3. **添加注释**说明配置用途

⚠️ **若必须进行破坏性变更**：
1. 在 `/BACKLOG.md` 登记任务，优先级设为 **P0**
2. 提供**充分的证据**（如业务部门邮件、会议纪要、政策文件）
3. 创建变更记录：`/docs/decisions/config-change-YYYYMMDD.md`
4. 使用版本化配置（如 `business_type_mapping_v2.json`）逐步迁移
5. 在 `/PROGRESS.md` 详细记录变更和影响范围

---

## 配置文件清单

### business_type_mapping.json - 业务类型映射
- **用途**: 定义业务类型分类规则（运营业务 vs 重点业务 vs 非车业务）
- **结构**:
  ```json
  {
    "运营业务": ["车损险", "三者险", ...],
    "重点业务": ["综合商业险", ...],
    "非车业务": ["意外险", "责任险", ...]
  }
  ```
- **被依赖**: DataService.ts:aggregate
- **口径来源**: 业务部门定义
- **最后更新**: [待补充]
- **变更记录**: 无
- **代码位置**: /reference/business_type_mapping.json

---

### thresholds.json - KPI 阈值配置
- **用途**: 定义 KPI 指标的阈值边界（优秀/良好/警告/危险）
- **结构**:
  ```json
  {
    "变动成本率": {
      "excellent": { "max": 65 },
      "good": { "min": 65, "max": 70 },
      "warning": { "min": 70, "max": 75 },
      "danger": { "min": 75 }
    },
    // 其他 KPI...
  }
  ```
- **被依赖**: ChartService.ts (KPI 卡片颜色判断)
- **口径来源**: 管理层制定
- **最后更新**: [待补充]
- **变更记录**: 无
- **代码位置**: /reference/thresholds.json

---

### year-plans.json - 年度计划配置
- **用途**: 定义年度保费计划、业务目标等
- **结构**:
  ```json
  {
    "2025": {
      "总保费计划": 1000000000,
      "运营业务计划": 600000000,
      "重点业务计划": 300000000,
      "非车业务计划": 100000000,
      "周计划": [
        { "week": 1, "plan": 19230769 },
        // ...
      ]
    }
  }
  ```
- **被依赖**: DataService.ts:calculateKPIs (计算完成率)
- **口径来源**: 年度经营计划
- **最后更新**: [待补充]
- **变更记录**: 无
- **代码位置**: /reference/year-plans.json

---

## 配置依赖关系图

```
业务部门定义
  ├── business_type_mapping.json
  │     └── 被依赖: DataService.aggregate
  ├── thresholds.json
  │     └── 被依赖: ChartService.renderKPICards
  └── year-plans.json
        └── 被依赖: DataService.calculateKPIs
```

---

## 配置验证规则

### business_type_mapping.json
- 必须包含 `运营业务`、`重点业务`、`非车业务` 三个键
- 每个键的值必须是字符串数组
- 不同分类中的险种名称不能重复
- 险种名称必须与 CSV 数据中的 `险种大类` 字段一致

### thresholds.json
- 每个 KPI 必须包含 `excellent`, `good`, `warning`, `danger` 四个等级
- 阈值边界必须连续无重叠（如 `good.max === warning.min`）
- 阈值必须为数字类型

### year-plans.json
- 必须包含当前年度的计划数据
- `周计划` 数组必须包含 52 周的数据
- 总保费计划 = 运营业务计划 + 重点业务计划 + 非车业务计划

---

## 开发指南

### 新增配置文件
如需新增配置文件（如 region_mapping.json），请遵循以下步骤：
1. 在 `/BACKLOG.md` 登记任务
2. 提供证据（业务需求文档、邮件等）
3. 创建配置文件 `/reference/new_config.json`
4. 添加 JSON Schema 验证（如需要）
5. 在代码中使用配置（确保类型安全）
6. 更新本 README.md，添加配置文件条目
7. 更新 `/docs/00_index/DOC_INDEX.md`
8. 在 `/PROGRESS.md` 记录完成信息

### 修改现有配置
如需修改现有配置（如调整阈值），请遵循以下步骤：
1. 在 `/BACKLOG.md` 登记任务
2. 提供证据（会议纪要、邮件、政策文件）
3. 创建变更记录：`/docs/decisions/config-change-YYYYMMDD.md`
4. 使用 `mcp__serena__find_referencing_symbols` 查找配置引用
5. 评估影响范围（哪些服务、图表会受影响）
6. 进行修改（仅追加或扩展，不删除不改名）
7. 运行 `bun run type-check && bun run lint`
8. 更新本 README.md 的"最后更新"和"变更记录"
9. 在 `/PROGRESS.md` 详细记录变更详情

### 配置迁移（破坏性变更）
如果**必须**进行破坏性变更：
1. 创建新版本配置文件（如 `business_type_mapping_v2.json`）
2. 创建迁移计划：`/docs/decisions/config-migration-YYYYMMDD.md`
3. 记录变更原因、影响范围、迁移步骤
4. 保留旧配置文件标记为 `@deprecated`
5. 逐步迁移代码引用
6. 在 `/PROGRESS.md` 详细记录迁移过程

---

## 配置使用示例

### 加载业务类型映射
```typescript
// DataService.ts
import businessTypeMapping from '@/reference/business_type_mapping.json';

function classifyBusinessType(insuranceType: string): string {
  for (const [category, types] of Object.entries(businessTypeMapping)) {
    if (types.includes(insuranceType)) {
      return category;
    }
  }
  return '其他';
}
```

### 加载 KPI 阈值
```typescript
// ChartService.ts
import thresholds from '@/reference/thresholds.json';

function getKPILevel(kpiName: string, value: number): string {
  const threshold = thresholds[kpiName];
  if (value <= threshold.excellent.max) return 'excellent';
  if (value <= threshold.good.max) return 'good';
  if (value <= threshold.warning.max) return 'warning';
  return 'danger';
}
```

### 加载年度计划
```typescript
// DataService.ts
import yearPlans from '@/reference/year-plans.json';

function getYearPlan(year: number): number {
  return yearPlans[year]?.总保费计划 || 0;
}
```

---

## 质量检查

运行以下命令确保配置质量：
```bash
# JSON 格式验证
bun run validate:config

# 类型检查（确保配置被正确引用）
bun run type-check

# 代码规范检查
bun run lint
```

---

## 相关链接

- **全局文档索引**: /docs/00_index/DOC_INDEX.md
- **类型定义**: /src/types/README.md (配置对应的 TypeScript 类型)
- **服务层**: /src/services/README.md (配置的使用者)
- **决策记录**: /docs/decisions/ (配置变更记录)
- **开发进展**: /PROGRESS.md
- **任务清单**: /BACKLOG.md
- **协作规范**: /AGENTS.md

---

**最后更新**: 2026-01-06
**维护者**: All AI Agents

**重要提醒**：配置文件是业务规则的唯一事实来源，修改前请务必获取业务部门确认！
