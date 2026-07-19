# 数据管理中心

> chexianYJFX 车险盈亏分析项目 - 企业级数据处理架构

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        数据处理流水线                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   📥 EXTRACT        📦 TRANSFORM       🔗 ENRICH       ✅ VALIDATE  │
│   ──────────       ──────────────      ─────────      ──────────  │
│   Excel导入   →    列名标准化    →    续保匹配   →    质量检查    │
│                    类型转换            业务增强        规则验证    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                        数据仓库 (warehouse/)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   📊 FACT (事实表)                    📐 DIM (维度表)             │
│   ───────────────                    ──────────────             │
│   policy/                            salesman_plan/             │
│   └─ 保单明细.parquet                └─ 业务员计划.parquet        │
│                                      业务员归属与规划/            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
数据管理/
├── README.md                    # 本文件
│
├── pipelines/                   # 📦 数据管道
│   ├── transform.py             # Excel→Parquet转换
│   ├── enrich.py                # 续保类型匹配增强
│   ├── 已赚保费/                # 已赚保费计算模块
│   └── __init__.py
│
├── warehouse/                   # 📊 数据仓库
│   ├── fact/                    # 事实表
│   │   └── policy/              # 保单明细 Parquet
│   └── dim/                     # 维度表
│       ├── salesman_plan/       # 业务员计划
│       └── 业务员归属与规划/     # 组织映射
│
├── staging/                     # 🔄 暂存区（临时数据）
│
├── knowledge/                   # 📚 知识库
│   ├── ai/                      # AI知识（NL2SQL）
│   │   └── PARQUET_SCHEMA_KNOWLEDGE.md
│   ├── rules/                   # 业务规则
│   │   └── 车险数据业务规则字典.md
│   ├── schema/                  # 数据模型
│   ├── INDEX.md                 # 知识索引
│   └── QUICK_REFERENCE.md       # 快速参考
│
├── config/                      # ⚙️ 配置中心
│   └── tasks/                   # 任务配置模板
│
├── integrations/                # 🔌 外部系统同步
│   └── wecom_smartsheet/        # 企业微信智能表格同步
│
├── run.mjs                       # 快捷执行脚本
└── logs/                        # 运行日志
```

## 快速开始

### 跨平台支持

| 平台 | 脚本 | 命令 |
|------|------|------|
| **Windows** | `daily.mjs` / `run.mjs` | `node daily.mjs` 或 `node run.mjs full ...` |
| **macOS/Linux** | `daily.mjs` / `run.mjs` | `./daily.mjs` 或 `./run.mjs full ...` |
| **智能启动** | `daily.mjs` | `node daily.mjs`（自动检测平台） |

### 数据更新（推荐：一键命令）

**Windows (PowerShell/CMD):**
```powershell
cd 数据管理

# ETL 入口（推荐）
node daily.mjs

# 或直接运行
node daily.mjs
```

**macOS/Linux (Bash):**
```bash
cd 数据管理

# ETL 入口（推荐）
node daily.mjs

# 或直接运行
./daily.mjs
```

**手动指定参数:**
```bash
# Windows
node run.mjs full --source "续保类型匹配至2026年4月.xlsx" --target "车险2526年清单更新至20260302.xlsx" --output "warehouse/fact/policy/test.parquet"

# macOS/Linux
./run.mjs full --source "续保类型匹配至2026年4月.xlsx" --target "车险2526年清单更新至20260302.xlsx" --output "warehouse/fact/policy/test.parquet"
```

### 其他命令

```bash
# Windows
node run.mjs help       # 查看所有命令
node run.mjs enrich     # 仅续保匹配
node run.mjs transform  # 仅转换Parquet

# macOS/Linux
./run.mjs help       # 查看所有命令
./run.mjs enrich     # 仅续保匹配
./run.mjs transform  # 仅转换Parquet
```

## 数据资产清单

| 类型 | 路径 | 说明 | 更新频率 |
|------|------|------|----------|
| **保单明细** | `warehouse/fact/policy/` | 核心事实表，30字段 | 每周 |
| **业务员计划** | `warehouse/dim/salesman_plan/` | 保费计划目标 | 每月 |
| **组织映射** | `warehouse/dim/业务员归属与规划/` | 人员归属关系 | 按需 |

## 知识库导航

| 文档 | 用途 | 适用场景 |
|------|------|----------|
| [AI Schema知识](knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md) | NL2SQL字段映射 | AI SQL生成 |
| [业务规则字典](knowledge/rules/车险数据业务规则字典.md) | 完整字段定义 | 开发参考 |
| [快速参考](knowledge/QUICK_REFERENCE.md) | 自动刷新规模快照与权威入口 | 日常分析 |
| [知识索引](knowledge/INDEX.md) | 全量索引 | 深度开发 |

## 数据流水线说明

### 1. Transform (转换)

**脚本**: `pipelines/transform.py`

功能：
- Excel 文件读取
- 列名标准化（中文→英文映射）
- 数据类型推断与转换
- Parquet 格式输出

```bash
python3 pipelines/transform.py -i input.xlsx -o output.parquet
```

默认输出为 `full` 逐行事实表；如需显式合并批改记录，使用 `-m merged`。

### 2. Enrich (增强)

**脚本**: `pipelines/enrich.py`

功能：
- 续保业务类型匹配（自留/外呼）
- 基于保单号的历史数据关联

```bash
python3 pipelines/enrich.py \
    --source 历史数据.xlsx \
    --target 新数据.xlsx \
    --output 增强后数据.xlsx
```

### 3. 已赚保费计算

**模块**: `pipelines/已赚保费/`

功能：
- 按月计算已赚保费
- 时间比例法实现

### 4. 企业微信智能表格同步

**模块**: `integrations/wecom_smartsheet/`（多实例，`instances/*.yaml` 配置驱动，v2 引擎）

功能：
- 读取保单明细、报价数据和续回匹配口径（按实例 `branch_code` 省份隔离，fail-closed）
- 按车架号维护 `record_id` 状态（各实例独立 state 文件）
- 对企业微信智能表格执行新增/更新同步（payload hash 未变化则跳过）

每个 `instances/{instance}.yaml` 对应一张表，state 和 log 按 `instance_name` 独立命名：

```bash
# 手动 dry-run（不调用 webhook）
python3 integrations/wecom_smartsheet/sync_renewal_v2.py \
  --instance integrations/wecom_smartsheet/instances/sichuan_2025_h1.yaml --dry-run
```

**自动化**：`daily.mjs` 步骤 8 遍历模块内所有 `instances/*.yaml`，按 `WECOM_SMARTSHEET_ENABLED=1`（`.env.local`）开关决定是否推送。失败降级告警不阻塞 ETL。（旧 v1 `config.*.json` 推送链路已退役，详见模块 README。）

## 配置说明

### 任务配置示例

```yaml
# config/tasks/weekly_update.yaml
source_file: "/path/to/历史数据.xlsx"
target_file: "/path/to/本周新数据.xlsx"
output_file: "staging/本周数据_已匹配.xlsx"
key_column: "保单号"
match_column: "续保业务类型"
```

## 最佳实践

### 数据更新 SOP

1. **获取新数据** → 放入 `staging/`
2. **运行增强** → `pipelines/enrich.py`
3. **运行转换** → `pipelines/transform.py`
4. **输出到仓库** → `warehouse/fact/policy/`
5. **更新应用** → 加载新 Parquet

### 命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 保单明细 | `保单明细_YYYYMMDD.parquet` | `保单明细_20260201.parquet` |
| 中间文件 | `*_已匹配.xlsx` | `数据_已匹配.xlsx` |
| 日志文件 | `{task}_{timestamp}.log` | `transform_20260201_143000.log` |

## 架构设计原则

1. **分层清晰** - pipelines(处理) / warehouse(存储) / knowledge(文档)
2. **单一职责** - 每个脚本只做一件事
3. **可追溯** - staging保留中间数据，logs记录处理过程
4. **AI友好** - knowledge/ai/ 专门服务NL2SQL

---

**维护者**: chexianYJFX 项目组
**最后更新**: 2026-02-01
