# AI协作治理规范实施计划

## 📋 项目盘点结果

### 第一阶段:必需文件检查

| 文件名 | 路径 | 检查状态 | 优先级 |
|--------|------|----------|--------|
| CLAUDE.md | 根目录 | ✅ 存在 | 🔴 高 |
| AGENTS.md | 根目录 | ❌ 缺失 | 🔴 高 |
| BACKLOG.md | 根目录 | ❌ 缺失 | 🔴 高 |
| PROGRESS.md | 根目录 | ❌ 缺失 | 🔴 高 |
| project_rules.md | 根目录 | ❌ 缺失(可选) | 🟡 中 |
| DOC_INDEX.md | /docs/00_index/ | ❌ 缺失 | 🔴 高 |
| CODE_INDEX.md | /docs/00_index/ | ❌ 缺失 | 🔴 高 |
| PROGRESS_INDEX.md | /docs/00_index/ | ❌ 缺失 | 🔴 高 |

### 第二阶段:核心层目录识别

基于项目结构分析,核心层目录为:

1. **`/js/core/`** - 核心业务逻辑层
   - event-bus.js (事件总线)
   - state-manager.js (状态管理)
   - worker-bridge.js (Worker通信)

2. **`/js/components/`** - UI组件层
   - file-uploader.js (文件上传)
   - dimension-selector.js (维度选择器)
   - metric-card.js (指标卡片)

3. **`/js/services/`** - 外部服务层
   - chart-service.js (图表服务)

4. **`/js/utils/`** - 工具函数层
   - formatters.js, validators.js, storage.js, exporter.js等

5. **`/js/workers/`** - Web Worker层
   - data.worker.js (数据处理)

6. **`/config/`** - 配置驱动层
   - dimensions.json (9个维度定义)
   - app-config.json (应用配置)

7. **`/css/`** - 样式系统
   - themes.css, main.css, components.css

### 第三阶段:唯一事实来源识别

#### 🎯 指标口径文档
- **文件路径**: `/config/dimensions.json`
- **负责人**: 数据分析团队
- **最后更新**: 2025-12-26
- **内容**: 9个维度定义 + 保费收入指标

#### 🎯 数据字典文档
- **文件路径**: `config/app-config.json` + `CLAUDE.md`
- **负责人**: 开发团队
- **最后更新**: 2025-12-26

#### 🎯 业务规则文档
- **文件路径**: `CLAUDE.md`
- **负责人**: 架构师
- **最后更新**: 2025-12-26

---

## 🎯 实施计划

### 阶段1:创建治理文件(根目录)

#### 1.1 AGENTS.md
**目的**: 定义AI角色职责和协作协议
**路径**: `/AGENTS.md`
**内容**:
- Claude (结构化分析师)
- ChatGPT (格式化输出器)
- Gemini (多模态处理器)

#### 1.2 BACKLOG.md
**目的**: 需求账本,记录所有需求
**路径**: `/BACKLOG.md`
**初始内容**: 从ACTION_PLAN.md中提取待完成任务

#### 1.3 PROGRESS.md
**目的**: 进展账本,记录当前状态
**路径**: `/PROGRESS.md`
**初始内容**: 当前项目状态 + 正在进行的任务

#### 1.4 project_rules.md (可选)
**目的**: 项目特定规则
**路径**: `/project_rules.md`
**内容**: 纯前端项目特殊规则

---

### 阶段2:创建三大索引

#### 2.1 创建索引目录
**操作**: 使用现有的 `/docs/` 目录,创建 `/docs/00_index/` 子目录
**决策**: 用户选择使用现有的 `/docs/` 目录而非创建 `/开发文档/` 目录

#### 2.2 DOC_INDEX.md
**路径**: `/docs/00_index/DOC_INDEX.md`
**内容结构**:
```markdown
# 文档索引

## 📖 项目文档
- [用户指南](../USER_GUIDE.md)
- [API文档](../API.md)
- [部署指南](../DEPLOYMENT.md)

## 📋 治理文档
- [AI协作治理规范](../../AI协作治理规范.md)
- [架构批判报告](../../架构批判报告.md)
- [实施计划](../../ACTION_PLAN.md)

## 🎯 业务文档
- [CLAUDE.md](../../CLAUDE.md)
```

#### 2.3 CODE_INDEX.md
**路径**: `/docs/00_index/CODE_INDEX.md`
**内容结构**:
```markdown
# 代码索引

## 🏗️ 核心层架构
- [/js/core/](../../js/core/) - 核心业务逻辑层
- [/js/components/](../../js/components/) - UI组件层
- [/js/services/](../../js/services/) - 外部服务层
- [/js/utils/](../../js/utils/) - 工具函数层
- [/js/workers/](../../js/workers/) - Web Worker层
- [/config/](../../config/) - 配置驱动层
- [/css/](../../css/) - 样式系统

## 🔗 关键文件
- [app.js](../../js/app.js) - 应用入口
- [data.worker.js](../../js/workers/data.worker.js) - 数据处理引擎
```

#### 2.4 PROGRESS_INDEX.md
**路径**: `/docs/00_index/PROGRESS_INDEX.md`
**内容结构**:
```markdown
# 进展索引

## 📊 账本链接
- [需求账本](../../BACKLOG.md)
- [进展账本](../../PROGRESS.md)

## 🎯 里程碑
- [已完成功能](../../ACTION_PLAN.md#已完成功能)
- [待完成任务](../../ACTION_PLAN.md#待完成任务)
```

---

### 阶段3:创建核心层目录索引

#### 3.1 /js/core/INDEX.md
**职责**: 事件驱动架构和状态管理
**关键入口**:
- event-bus.js (Pub-Sub模式)
- state-manager.js (draft→applied状态)
- worker-bridge.js (一次性监听器)

#### 3.2 /js/components/INDEX.md
**职责**: 可复用UI组件
**关键入口**:
- file-uploader.js (拖拽上传)
- dimension-selector.js (电商式筛选)
- metric-card.js (KPI卡片)

#### 3.3 /js/utils/INDEX.md
**职责**: 纯函数工具集
**关键入口**:
- formatters.js (数值格式化)
- validators.js (数据验证)
- storage.js (localStorage封装)
- exporter.js (CSV/Excel导出)

#### 3.4 /config/INDEX.md
**职责**: JSON驱动配置
**关键入口**:
- dimensions.json (9个维度定义)
- app-config.json (性能/UI配置)
**约束**:
- 🚫 **禁止修改**: 修改dimensions.json需要经过业务部门批准
- ✅ **允许操作**: 添加CSV字段别名

---

### 阶段4:创建校验机制

#### 4.1 创建scripts目录
**操作**: 创建 `/scripts/` 目录

#### 4.2 check-governance.mjs
**路径**: `/scripts/check-governance.mjs`
**功能**:
1. 检查根目录文件存在性
2. 检查三大索引存在性
3. 检查核心层目录INDEX.md
4. 验证BACKLOG.md中DONE条目的完整性

**输出格式**:
```bash
✅ 治理校验通过
📊 统计信息:
   - 根目录文件: 4/8 通过
   - 索引文件: 3/3 通过
   - 核心目录: 7/7 通过
   - BACKLOG条目: 12/12 通过
```

#### 4.3 GitHub Actions工作流
**路径**: `/.github/workflows/governance-check.yml`
**触发条件**: push, pull_request
**环境**: Node.js 18+
**工作流内容**:
```yaml
name: Governance Check

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  governance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Run governance check
        run: node scripts/check-governance.mjs

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: governance-report
          path: governance-report.txt
```

---

## 🔧 重要约束

### 禁止操作
- 🚫 **禁止修改**: `/js/` 下任何业务实现文件(用户确认:约束适用于本项目)
- 🚫 **禁止修改**: `/config/dimensions.json` 中的维度定义
- 🚫 **禁止修改**: 目录结构
- 🚫 **禁止修改**: `/css/` 样式文件
- 🚫 **禁止修改**: `index.html` 入口文件

### 允许操作
- ✅ **允许创建**: `/docs/` 下的治理文档和索引
- ✅ **允许创建**: 根目录治理文件(AGENTS.md, BACKLOG.md, PROGRESS.md)
- ✅ **允许创建**: `/scripts/` 校验脚本
- ✅ **允许创建**: 核心层目录的INDEX.md
- ✅ **允许创建**: `.github/workflows/` GitHub Actions配置

---

## 📊 实施优先级

### Phase 1 (立即执行)
1. 创建 `/docs/00_index/` 目录
2. 创建三大索引文件
3. 创建AGENTS.md

### Phase 2 (紧接着)
1. 创建BACKLOG.md和PROGRESS.md
2. 为核心层目录创建INDEX.md

### Phase 3 (最后)
1. 创建校验脚本(`check-governance.mjs`)
2. 创建GitHub Actions工作流(`.github/workflows/governance-check.yml`)
3. 运行首次校验
4. 推送代码触发GitHub Actions验证

---

## 🎯 验收标准

### 完成条件
- [ ] 所有根目录治理文件存在
- [ ] 三大索引文件存在且格式正确
- [ ] 每个核心层目录都有INDEX.md
- [ ] 校验脚本可执行且通过
- [ ] GitHub Actions工作流已创建
- [ ] BACKLOG.md中的初始任务已从ACTION_PLAN.md迁移
- [ ] GitHub Actions首次运行成功

### 质量标准
- [ ] 所有INDEX.md包含必需部分(职责、入口、索引链接、约束)
- [ ] BACKLOG.md符合DONE规则(文档路径 + 代码路径 + 验收证据)
- [ ] 三大索引相互引用正确
- [ ] 校验脚本输出清晰的错误信息

---

## 📞 后续维护

### 更新频率
- **BACKLOG.md**: 每次需求变更时
- **PROGRESS.md**: 每日或每次重要进展
- **索引文件**: 添加新文件/目录时
- **校验脚本**: 发现规则漏洞时

### 责任分工
- **Claude**: 结构化分析、状态管理、校验执行
- **ChatGPT**: 格式化输出、可视化
- **Gemini**: PDF处理、多模态转换

---

*计划创建时间: 2026-01-04*
*预计完成时间: 2026-01-04*
*负责人: AI协作团队*
