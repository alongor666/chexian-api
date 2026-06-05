# chexian-api 项目架构规范

> 本文档定义项目的模块边界、依赖规则和子项目开发标准，确保多人/多AI协作时保持一致性。

## 项目定位

**chexian-api** = 车险数据分析平台（API-only 版），从 chexianYJFX 双模式项目拆分而来。当前系统定位为：

- React 客户端只负责交互、渲染与调用 REST API
- Express 后端提供 `/api/*` 服务、认证、权限、缓存与业务路由
- DuckDB native 运行在后端 Node.js 进程中，通过 `@duckdb/node-api` 查询 Parquet / 预聚合数据
- 前端不运行 DuckDB-WASM，不保留浏览器 Local 查询模式

包含：
- 前端应用（React + TypeScript + Vite）
- 后端 API 服务（Express + DuckDB native）
- 数据管理模块（Python脚本集）
- 部署配置

---

## 一、目录结构总览

```
chexian-api/
├── src/                    # 前端源码（React + TS + Vite）
│   ├── app/                #   应用入口（App.tsx / main.tsx）
│   ├── features/           #   21 个业务功能模块（前端主体）
│   ├── shared/             #   共享层（api / contexts / hooks / ui / 设计系统）
│   ├── widgets/            #   通用 UI 组件库（charts / kpi / table）
│   ├── components/         #   全局布局组件（layout/）
│   ├── charts/ services/   #   特化图表 / 前端服务（PdfExport）
│   └── core/ types/ shims/ #   历史遗留区（core/types 待归档）+ 类型垫片
│
├── server/                 # 后端 API 服务（Express + DuckDB native）
│   └── src/
│       ├── routes/         #   API 路由层（12 顶层 + query/ 23 子路由）
│       ├── sql/            #   SQL 生成器（31 顶层 + 8 子目录，共 55 文件）
│       ├── services/       #   服务层（28 文件：DuckDB 簇 / 认证 / 权限 / 缓存）
│       ├── config/         #   配置注册表（字段 / 指标 / 客户类别 / 环境）
│       ├── agent/          #   AI Agent 系统（诊断 / 解释 / 预测 / 审计）
│       ├── skills/         #   后端技能编排（技能 + 工作流）
│       ├── middleware/ normalize/ utils/ scripts/ types/
│
├── cli/                    # @chexian/cli（PAT 只读 CLI，独立 package）
├── mcp/                    # @chexian/mcp（MCP server，独立 package）
├── public/                 # 前端静态资源（含 Service Worker sw.js）
├── tests/                  # 测试用例
├── deploy/                 # 部署配置（vps-wrapper 等）
│
├── 数据管理/                # 【功能域】数据仓库 + ETL 管道（详见下方说明）
│   ├── warehouse/          #   Parquet 数据仓库（fact / dim）— 本地源
│   ├── pipelines/          #   发布管道（preflight / refresh_metadata）
│   ├── knowledge/          #   业务规则字典 + Parquet schema 知识
│   ├── config/             #   固定成本参数 / shard-config
│   ├── integrations/       #   外部集成（wecom_smartsheet 等）
│   ├── patrol/ validation/ #   续保巡检引擎 / 数据校验
│   ├── lib/ tools/ scripts/ staging/ release-manifests/ archive/ logs/
│   ├── daily.mjs run.mjs   #   ETL 入口（智能检测 / 强制域）
│   └── data-sources.json   #   数据域注册表（ETL 自动派生）
│
├── 开发文档/                # 开发文档（含 00_index 四索引）
├── docs/ reference/        # 用户文档 / 参考资料
├── scripts/                # 项目级脚本（治理校验、构建、部署）
│
└── [配置文件]              # 根目录配置
    ├── CLAUDE.md           # AI协作指南
    ├── ARCHITECTURE.md     # 本文档
    └── README.md           # 项目入口
```

> **数据管理模型已演进**：早期（v1.0）的 `原始数据加工/`→`保单明细/`→`已赚保费/` 等"输入/输出文件传递的 Python 子项目"链路，已重构为 **`warehouse/`（Parquet 仓库）+ `pipelines/`（发布管道）+ `daily.mjs`（ETL 编排）** 的数据仓库模型。下文第三、五、六节描述的"L2 子项目标准结构 / input-output 通信"为**历史约定**，仅适用于新增独立 Python 子项目；当前 `数据管理/` 已不采用该目录形态。

---

## 二、模块层级与依赖规则

### 2.1 层级定义

| 层级 | 说明 | 示例 |
|------|------|------|
| L0 - 根项目 | 整体协调，不含业务逻辑 | chexian-api/ |
| L1 - 功能域 | 按职责划分的模块集合 | 数据管理/, src/ |
| L2 - 子项目 | 独立可运行的最小单元 | 原始数据加工/, 保单明细/ |

### 2.2 依赖方向（严格遵守）

```
✅ 允许的依赖方向：
L0 → L1 → L2（向下调用）
L2 → 共享库/配置（向外依赖）

❌ 禁止的依赖方向：
L2 → L0（子项目不能依赖根项目配置）
L2 → L2（子项目之间不能直接import）
```

### 2.3 子项目间通信方式

```
原始数据加工/output/result.xlsx
        ↓ （文件传递，非代码依赖）
保单明细/input/result.xlsx
```

**原则**：子项目通过 `input/output` 目录交换数据，不共享代码。

---

## 三、子项目标准结构

每个 L2 子项目必须遵循以下结构：

```
子项目名/
├── scripts/           # 核心脚本
│   └── main_xxx.py    # 主入口脚本
├── config/            # 配置文件
│   └── default.yaml   # 默认配置
├── input/             # 输入数据（.gitignore）
├── output/            # 输出数据（.gitignore）
├── logs/              # 运行日志（.gitignore）
├── docs/              # 子项目文档（可选）
├── tests/             # 单元测试（可选）
├── requirements.txt   # Python依赖
├── run.sh             # 一键运行脚本
├── .gitignore         # 忽略规则
└── README.md          # 使用说明（必须）
```

### 3.1 README.md 模板

```markdown
# 子项目名称

## 功能
一句话描述本子项目做什么

## 快速开始
\`\`\`bash
./run.sh config/default.yaml
\`\`\`

## 输入输出
- 输入：xxx.xlsx（保单号、续保业务类型...）
- 输出：xxx_已处理.xlsx

## 配置说明
见 config/default.yaml

## 依赖
- 上游：无 / xxx子项目的输出
- 下游：被xxx子项目使用
```

---

## 四、命名规范

### 4.1 目录命名
- 功能域：中文（数据管理/、开发文档/）
- 子项目：中文动宾短语（原始数据加工/、保单明细/）
- 技术目录：英文小写（scripts/, config/, logs/）

### 4.2 文件命名
| 类型 | 规范 | 示例 |
|------|------|------|
| Python脚本 | 动词_名词.py | match_renewal_type.py |
| 配置文件 | 小写下划线.yaml | default.yaml, task_20260201.yaml |
| 输出文件 | 原名_处理类型.xlsx | 签单数据_已匹配.xlsx |
| 日志文件 | 操作_时间戳.log | match_20260201_1430.log |

### 4.3 Git分支
```
main                    # 稳定版本
develop                 # 开发主线
feature/数据管理/xxx    # 功能域前缀
hotfix/xxx              # 紧急修复
```

---

## 五、数据流向图

```
┌─────────────────────────────────────────────────────────────┐
│                     外部数据源                               │
│  (车险签单报价数据.xlsx, 业务员计划表.xlsx, 理赔数据 等)       │
└─────────────────────────────────────────────────────────────┘
                              │  数据管理/daily.mjs（ETL 编排）
                              ▼  + pipelines/（preflight / refresh_metadata）
┌─────────────────────────────────────────────────────────────┐
│              数据管理/warehouse/  Parquet 数据仓库            │
│  - fact/（事实表：保费/赔案/报价/交叉销售/客户流转）          │
│  - dim/（维度表：业务员/机构/计划）                          │
│  - data-sources.json（9 域元数据，ETL 自动派生）             │
└─────────────────────────────────────────────────────────────┘
                              │  scripts/sync-vps.mjs（rsync 同步）
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   server/ 后端 API 服务                       │
│  路由聚合 query.ts → sql/*.ts 生成器 → duckdb.ts 查询执行     │
│  - DuckDB native 引擎、route-cache LRU、JWT/PAT 认证鉴权      │
│  - /api/query · /api/agent · /api/skills · /api/ai …         │
└─────────────────────────────────────────────────────────────┘
                              │  REST /api/* （Service Worker 缓存）
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      src/ 前端应用                           │
│  apiClient → React Query → features/ 渲染（ECharts 可视化）   │
│  - React + TypeScript，通过 REST API 访问后端，无 DuckDB-WASM │
└─────────────────────────────────────────────────────────────┘
```

---

## 六、新建子项目检查清单

创建新子项目前，确认以下事项：

- [ ] 是否真的需要新子项目？能否扩展现有子项目？
- [ ] 职责边界是否清晰？一个子项目只做一件事
- [ ] 输入来源确定？上游子项目/外部文件
- [ ] 输出去向确定？下游子项目/最终产物
- [ ] 遵循标准目录结构
- [ ] 编写 README.md
- [ ] 配置 .gitignore（忽略 input/, output/, logs/）
- [ ] 在本文档"数据流向图"中更新位置

---

## 七、AI协作指引

当使用 Claude/Cursor/其他AI工具 开发本项目时：

1. **先读本文档**：理解项目边界和规范
2. **定位层级**：确定要修改的是 L0/L1/L2 哪一层
3. **遵循依赖规则**：不创建违规的 import
4. **使用标准结构**：新子项目按模板创建
5. **更新文档**：修改架构后同步更新本文档

---

## 八、版本记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.2 | 2026-06-05 | 目录结构总览补全 src/、server/src/ 一级目录与真实 `数据管理/` 仓库结构（含 cli/mcp/public）；数据流向图重构为 warehouse + ETL 管道 + API 服务模型；标注早期"输入/输出 Python 子项目"模型为历史约定 |
| v1.1 | 2026-02-13 | 更新为 chexian-api（API 版），移除 chexianYJFX 引用，补充 server/ 后端 API 层 |
| v1.0 | 2026-02-01 | 初始版本，定义基本架构规范 |

---

*维护者：alongor | 最后更新：2026-06-05*
