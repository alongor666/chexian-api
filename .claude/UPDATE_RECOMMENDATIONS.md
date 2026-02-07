# 原有 Agents/Commands 更新建议

## 分析时间：2026-01-16

基于项目最新功能（成本分析、商车系数监控、视角切换、侧边栏布局），分析原有 agents 和 commands 的适应性。

---

## ✅ 无需更新（5个）

### 1. code-simplifier
- **状态**: 适应良好
- **原因**: 代码简化规则通用，禁止修改区域仍然适用
- **建议**: 保持现状

### 2. data-validator
- **状态**: 基本适应
- **原因**: 数据验证逻辑通用
- **可选增强**: 添加成本分析字段验证（已报告赔款、费用金额）

### 3. security-review
- **状态**: 适应良好
- **原因**: 安全审查清单仍然适用
- **建议**: 保持现状

### 4. commit-push-pr
- **状态**: 适应良好
- **原因**: Git 工作流未变化
- **建议**: 保持现状

### 5. sync-and-rebase
- **状态**: 适应良好
- **原因**: Git 工作流未变化
- **建议**: 保持现状

---

## ⚠️ 建议更新（3个）

### 1. data-analysis ⚠️

**当前版本**: 2.0.0 (2026-01-11)
**问题**: 缺少新增的分析维度

**缺失功能**:
- ❌ 成本分析（赔付率/费用率/综合费用率/变动成本率）
- ❌ 商车自主定价系数监控
- ❌ 视角切换分析（保费/件数）

**更新建议**:
```markdown
## 新增分析维度

### 成本分析
-- 赔付率分析
/data-analysis --focus cost-claim

-- 费用率分析
/data-analysis --focus cost-expense

-- 综合费用率分析
/data-analysis --focus cost-comprehensive

### 商车系数监控
/data-analysis --focus coefficient

### 视角切换分析
/data-analysis --perspective premium      # 保费口径
/data-analysis --perspective policy_count  # 件数口径
```

**更新文件**: `.claude/commands/data-analysis.md`

---

### 2. weekly-report ⚠️

**当前版本**: 基于 KPI/趋势/排名
**问题**: 缺少成本分析和商车系数监控章节

**当前结构**:
```markdown
1. 执行摘要
2. KPI 指标
3. 业绩排名
4. 趋势分析
5. 专项分析
```

**建议新增**:
```markdown
6. 成本分析分析 ⭐ NEW
   - 满期赔付率
   - 费用率
   - 综合费用率
   - 盈利能力评估

7. 商车系数监控 ⭐ NEW
   - NCD 保费分析
   - 商车自主定价系数分布
   - 系数使用合理性
```

**更新文件**: `.claude/commands/weekly-report.md`

---

### 3. verify-app ⚠️

**当前版本**: 基础功能验证
**问题**: 缺少新功能验证清单

**建议新增验证项**:
```yaml
# 成本分析模块验证
- [ ] 赔付率表格正确渲染
- [ ] 费用率计算准确
- [ ] 维度切换正常（机构/客户类别/险别）
- [ ] 截止日期筛选生效

# 视角切换验证
- [ ] 保费/件数视角切换正常
- [ ] 所有图表支持视角切换
- [ ] SQL 生成器正确应用视角

# 商车系数监控验证
- [ ] NCD 保费计算正确
- [ ] 商车系数分布显示
- [ ] 机构分组（成都/异地/其他）
```

**更新文件**: `.claude/agents/verify-app.md`

---

## 📊 更新优先级

| 代理/命令 | 优先级 | 工作量 | 影响 |
|-----------|--------|--------|------|
| data-analysis | P1 | 中 | 分析功能不完整 |
| weekly-report | P2 | 小 | 报告缺少成本章节 |
| verify-app | P2 | 小 | 新功能验证缺失 |

---

## 🚀 实施建议

### 方案 A: 渐进式更新（推荐）

```bash
# 第 1 步: 更新 data-analysis（P1）
- 添加成本分析维度
- 添加商车系数监控
- 添加视角切换参数

# 第 2 步: 更新 weekly-report（P2）
- 新增成本分析章节
- 新增商车系数章节

# 第 3 步: 更新 verify-app（P2）
- 添加新功能验证清单
```

### 方案 B: 创建新命令（备选）

```bash
# 保留原有命令不变，创建新命令
/cost-analysis          # 已创建 ✅
/coefficient-analysis   # 新建
/perspective-analysis   # 新建
```

---

## ✅ 已完成优化

通过本次优化，已新增：

### 新增 Agents (4个)
- ✅ duckdb-optimizer - DuckDB 性能优化
- ✅ react-performance - React 性能优化
- ✅ business-intelligence - 业务分析专家
- ✅ ui-ux-designer - UI/UX 设计专家

### 新增 Commands (4个)
- ✅ performance-audit - 性能审计
- ✅ cost-analysis - 成本分析
- ✅ ui-review - UI 审查
- ✅ test-coverage - 测试覆盖率

**结论**: 新增的 agents 和 commands 已覆盖项目最新功能，原有命令可以保持不变或按需渐进式更新。

---

**生成时间**: 2026-01-16
**分析范围**: `.claude/agents/` 和 `.claude/commands/`
**建议版本**: 渐进式更新（方案 A）
