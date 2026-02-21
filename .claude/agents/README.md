# AI Agents 索引 (v2.1)

> 车险业绩看板项目 - 专业化 AI 子代理完整参考

**最后更新**: 2026-02-20

---

## 📋 快速导航

| 我需要... | 使用代理 |
|-----------|----------|
| 🗄️ DuckDB 查询优化 | [`duckdb-optimizer`](#duckdb-optimizer) |
| ⚡ React 性能优化 | [`react-performance`](#react-performance) |
| 💡 业务分析与洞察 | [`business-intelligence`](#business-intelligence) |
| 🎨 UI/UX 设计优化 | [`ui-ux-designer`](#ui-ux-designer) |
| 🔍 代码简化与重构 | [`code-simplifier`](#code-simplifier) |
| ✅ 数据验证与清洗 | [`data-validator`](#data-validator) |
| 🔧 应用验证与测试 | [`verify-app`](#verify-app) |
| 💾 会话管理 | [`session-manager`](#session-manager) |
| 📚 知识提取与归档 | [`knowledge-miner`](#knowledge-miner) |
| 🏗️ 架构规划 | [`architect`](#architect) |
| 🔨 构建错误解决 | [`build-error-resolver`](#build-error-resolver) |
| 🔐 安全审查 | [`security-reviewer`](#security-reviewer) |
| 🧪 TDD 开发指导 | [`tdd-guide`](#tdd-guide) |
| 🎭 E2E 测试运行 | [`e2e-runner`](#e2e-runner) |

---

## 🗂️ 代理分类

### 性能优化 (2个代理)

#### duckdb-optimizer
**角色**: DuckDB-WASM 性能优化与 SQL 查询调优专家

**触发场景**:
- 查询执行时间超过 3 秒
- 内存占用过高导致浏览器卡顿
- 大数据集（10万+行）处理缓慢

**核心策略**:
- 避免 SELECT *，只查询需要的列
- 使用 WHERE 过滤数据，减少 JOIN 数据量
- 利用 CTE (WITH 子句) 提高可读性
- 实现查询结果缓存

**性能基准**:
- 简单查询: < 100ms
- 聚合查询: < 500ms
- 复杂 JOIN: < 2s
- 大数据集导出: < 5s

**详细文档**: [duckdb-optimizer.md](./duckdb-optimizer.md)

---

#### react-performance
**角色**: React 应用性能优化与用户体验提升专家

**触发场景**:
- 组件渲染卡顿或延迟
- 页面加载时间过长（FCP > 2s）
- 大数据列表滚动缓慢
- 图表渲染慢或交互不流畅

**核心策略**:
- 使用 React.memo 避免不必要的重渲染
- 使用 useMemo 缓存计算结果
- 使用 useCallback 稳定函数引用
- 实现虚拟滚动（react-window）
- 懒加载路由组件（React.lazy）

**性能基准**:
- FCP: < 1.5s
- LCP: < 2.5s
- FID: < 100ms
- CLS: < 0.1

**详细文档**: [react-performance.md](./react-performance.md)

---

### 业务分析 (1个代理)

#### business-intelligence
**角色**: 车险业务分析专家，数据洞察与可视化顾问

**触发场景**:
- 需要新增业务分析维度
- 指标计算逻辑复杂或不清晰
- 需要业务洞察和建议
- 可视化效果不理想

**核心知识**:
```sql
-- 保费指标
满期保费 = 保费 × MIN(统计截止日 - 起保日, 365) / 365

-- 赔付率指标
满期赔付率 = 已报告赔款 / 满期保费

-- 续保率指标
当日续保率 = 当日续保保单数 / 当日到期保单数

-- 增长率指标
同比增长率 = (本期保费 - 去年同期保费) / 去年同期保费
```

**分析维度**:
- 机构 (org_name) - 机构对比、排名
- 业务员 (salesman_name) - 业绩排名
- 客户类别 (customer_category) - 客户结构分析
- 险别组合 (insurance_type) - 险种结构
- 时间维度 - 趋势分析
- 续保模式 (renewal_mode) - 续保分析

**详细文档**: [business-intelligence.md](./business-intelligence.md)

---

### UI/UX 设计 (1个代理)

#### ui-ux-designer
**角色**: 用户界面与体验设计专家，现代化布局与交互顾问

**触发场景**:
- 需要新增或重构 UI 组件
- 布局不合理或视觉混乱
- 移动端显示效果差
- 交互体验不佳

**设计原则**:
1. **视觉层次**: 主操作区 > 次要操作区 > 辅助信息
2. **间距系统**: 使用 Tailwind 间距系统（4/8/12/16/24px）
3. **颜色系统**: 主色、成功、警告、错误、中性色
4. **响应式断点**: sm(640px) / md(768px) / lg(1024px) / xl(1280px)

**技术栈**: React 19 + TypeScript + Tailwind CSS + ECharts

**详细文档**: [ui-ux-designer.md](./ui-ux-designer.md)

---

### 代码质量 (3个代理)

#### code-simplifier
**角色**: 代码复杂度分析与简化重构专家

**职责**:
- 主动审查代码复杂度
- 消除重复代码
- 优化代码结构
- 提取可复用模式

**详细文档**: [code-simplifier.md](./code-simplifier.md)

---

#### data-validator
**角色**: 数据质量验证与清洗专家

**职责**:
- 数据加载前验证
- 格式检查
- 完整性检查
- 业务规则验证

**详细文档**: [data-validator.md](./data-validator.md)

---

#### verify-app
**角色**: 应用验证与测试专家

**职责**:
- 功能验证
- 性能测试
- 兼容性检查
- 回归测试

**详细文档**: [verify-app.md](./verify-app.md)

---

### 知识管理 (2个代理)

#### session-manager
**角色**: Claude Code CLI 对话历史管理专家

**职责**:
- 查看、搜索会话
- 重命名、导出会话
- 会话分析与总结

**详细文档**: [session-manager.md](./session-manager.md)

---

#### knowledge-miner
**角色**: 隐性知识提取与结构化归档专家

**职责**:
- 扫描对话历史
- 提取上下文知识
- 分类整理
- 归档存储

**详细文档**: [knowledge-miner.md](./knowledge-miner.md)

---

### 开发工作流 (5个代理)

#### architect
**角色**: 架构规划与设计专家

**职责**:
- 系统架构设计
- 技术选型建议
- 设计模式推荐
- 可扩展性规划

**项目技术栈**:
```
React 19.0.0 + TypeScript 5.9.3 + Vite 5.4.21
DuckDB-WASM 1.28.0 + Apache Arrow 17.0.0
```

**详细文档**: [architect.md](./architect.md)

---

#### build-error-resolver
**角色**: 构建错误自动解决专家

**职责**:
- 分析构建错误
- 识别根因
- 提供修复方案

**适配构建链**: Bun + Vite

**详细文档**: [build-error-resolver.md](./build-error-resolver.md)

---

#### security-reviewer
**角色**: 安全漏洞审查专家

**审查范围**:
- SQL 注入
- XSS / CSRF
- 认证授权
- 敏感数据处理

**详细文档**: [security-reviewer.md](./security-reviewer.md)

---

#### tdd-guide
**角色**: 测试驱动开发 (TDD) 指导专家

**职责**:
- TDD 工作流指导
- 测试用例设计
- 覆盖率提升

**目标**: 80%+ 测试覆盖率

**测试框架**: Vitest 2.1.9 + @testing-library/react

**详细文档**: [tdd-guide.md](./tdd-guide.md)

---

#### e2e-runner
**角色**: E2E 测试执行专家

**职责**:
- 端到端测试执行
- 用户流程验证
- 回归测试
- 测试报告生成

**测试框架**: Playwright

**详细文档**: [e2e-runner.md](./e2e-runner.md)

---

## 📊 代理统计

| 类别 | 代理数量 |
|------|---------|
| 性能优化 | 2 |
| 业务分析 | 1 |
| UI/UX 设计 | 1 |
| 代码质量 | 3 |
| 知识管理 | 2 |
| 开发工作流 | 5 |
| **总计** | **14** |

---

## 🚀 使用指南

### 何时使用代理

1. **性能问题**: 使用 `duckdb-optimizer` 或 `react-performance`
2. **业务分析**: 使用 `business-intelligence`
3. **UI 设计**: 使用 `ui-ux-designer`
4. **代码重构**: 使用 `code-simplifier`
5. **数据验证**: 使用 `data-validator`
6. **应用测试**: 使用 `verify-app`

### 代理协作模式

```
用户需求 → business-intelligence（设计分析方案）
         ↓
         duckdb-optimizer（优化 SQL 查询）
         ↓
         react-performance（优化组件渲染）
         ↓
         ui-ux-designer（优化用户界面）
         ↓
         code-simplifier（重构代码）
         ↓
         verify-app（验证功能）
```

---

## 🔒 项目约束 (RED LINE)

### 禁止修改区域

| 文件/路径 | 原因 | 允许操作 |
|-----------|------|----------|
| `src/shared/normalize/mapping.ts` | 业务口径定义 | 仅追加，禁止删除/修改 |
| `src/shared/sql/kpi.ts` | KPI 计算逻辑 | 仅追加新模板 |
| `src/shared/duckdb/client.ts:78-95` | PolicyFact 视图定义 | 需产品确认 |
| 所有 `*.md` 索引文件 | 知识库完整性 | 仅追加条目 |

### DC-002 用户筛选优先规则

- SQL 中禁止使用 `CURRENT_DATE`、`NOW()` 等硬编码日期
- 判断 filters 字段时必须使用 `??` 运算符
- 详细文档: [开发文档/DC-002_ROOT_CAUSE_ANALYSIS.md](../../开发文档/DC-002_ROOT_CAUSE_ANALYSIS.md)

---

## 🔗 相关文档

- **协作协议**: [AGENTS.md](../../AGENTS.md)
- **技术栈**: [开发文档/TECH_STACK.md](../../开发文档/TECH_STACK.md)
- **代码索引**: [开发文档/00_index/CODE_INDEX.md](../../开发文档/00_index/CODE_INDEX.md)
- **命令索引**: [.claude/commands/README.md](../commands/README.md)

---

**维护者**: @claude  
**版本**: 2.1.0  
**最后更新**: 2026-02-20
