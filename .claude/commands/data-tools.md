---
name: data-tools
description: Python数据分析工具库（Parquet分析、字段分析、数据转换）
category: data-analysis
version: 1.0.0
author: "@claude"
scope: project
requires:
  - python3
  - pandas
dependencies:
  - 数据管理/cli.py
last_updated: "2026-01-16"
---

# Python数据分析工具库

快速调用Python数据分析工具的Slash Command。

## 快速使用

```bash
# 列出所有工具
/data-tools --list

# 搜索工具
/data-tools --search parquet

# 运行工具
/data-tools analyze_parquet
/data-tools earned_premium
```

## 工具列表

| 工具名 | 功能 | 使用场景 |
|--------|------|----------|
| analyze_parquet | Parquet文件分析 | 探索Parquet数据结构 |
| analyze_excel | Excel文件分析 | 探索Excel数据结构 |
| deep_analysis | 深度数据探索 | 多维度数据分析 |
| field_relation | 字段关联分析 | 字段关系图谱 |
| field_deep | 字段深度分析 | 单字段质量评估 |
| field_exhaustive | 字段穷举分析 | 全面字段统计 |
| excel_to_parquet | Excel转Parquet | 数据格式转换 |
| earned_premium | 已赚保费计算 | 业务指标计算 |

## 按分类浏览

### 数据转换工具 (conversion-tools)
- **excel_to_parquet**: Excel→Parquet格式转换，支持字段映射、数据清洗、去重策略

### 数据分析工具 (data-tools)
- **analyze_parquet**: Parquet文件结构分析，显示数据维度、字段信息、统计摘要
- **analyze_excel**: Excel文件结构分析，显示工作表、字段类型、数据分布
- **deep_analysis**: 深度数据探索，多维度分析、关联性探索、异常检测

### 字段分析工具 (field-tools)
- **field_relation**: 字段关联分析，探索字段间的相关性和依赖关系
- **field_deep**: 字段深度分析，单个字段的数据分布、质量、特征分析
- **field_exhaustive**: 字段穷举分析，全面分析所有字段的统计特征

### 业务计算工具 (business-tools)
- **earned_premium**: 已赚保费计算，基于保险期限按比例计算已赚保费

## 详细文档

完整文档请参考：
- [数据管理/INDEX.md](../../数据管理/INDEX.md) - 主索引
- [数据管理/TOOLS.md](../../数据管理/TOOLS.md) - 快速查找表
- [数据管理/cli.py](../../数据管理/cli.py) - CLI入口

## 使用示例

### 场景1: 数据格式转换
```bash
# 将Excel转换为Parquet
/data-tools excel_to_parquet
```

### 场景2: 数据探索
```bash
# 分析Parquet文件结构
/data-tools analyze_parquet

# 深度数据分析
/data-tools deep_analysis
```

### 场景3: 字段质量评估
```bash
# 字段关联分析
/data-tools field_relation

# 字段深度分析
/data-tools field_deep

# 字段穷举分析
/data-tools field_exhaustive
```

### 场景4: 业务计算
```bash
# 计算已赚保费
/data-tools earned_premium
```

## CLI 高级用法

### 列出工具
```bash
# 列出所有工具
python3 cli.py --list

# 列出特定分类的工具
python3 cli.py --list data-tools
python3 cli.py --list field-tools
```

### 搜索工具
```bash
# 按关键词搜索
python3 cli.py --search parquet
python3 cli.py --search field
python3 cli.py --search premium
```

### 查看工具详情
```bash
# 显示工具详细信息
python3 cli.py --info analyze_parquet
python3 cli.py --info earned_premium
```

### 检查元数据
```bash
# 检查所有工具的元数据完整性
python3 cli.py --check
```

## 直接运行工具

除了通过CLI调用，每个工具也可以直接运行：

```bash
# 进入数据管理目录
cd 数据管理

# 直接运行工具
python3 data_tools/analyze_parquet.py
python3 conversion_tools/excel_to_parquet.py
python3 business_tools/earned_premium/calculate.py
```

## 工作流程示例

### 典型的数据处理流程
```bash
# 1. 分析Excel文件结构
/data-tools analyze_excel

# 2. 转换为Parquet格式
/data-tools excel_to_parquet

# 3. 分析Parquet文件结构
/data-tools analyze_parquet

# 4. 深度数据探索
/data-tools deep_analysis

# 5. 字段关联分析
/data-tools field_relation

# 6. 计算已赚保费
/data-tools earned_premium
```

### 字段质量评估流程
```bash
# 1. 深度分析单个字段
/data-tools field_deep

# 2. 穷举分析所有字段
/data-tools field_exhaustive

# 3. 字段关联关系分析
/data-tools field_relation
```

## 常见问题

**Q: 如何找到合适的工具？**
A: 使用 `python3 cli.py --search <keyword>` 搜索，或查看 INDEX.md 的"按数据类型"和"按任务类型"章节。

**Q: 工具的输入文件路径在哪里配置？**
A: 大部分工具在源代码中有默认路径，如需修改请编辑对应的工具脚本。

**Q: 如何确认工具是否正常工作？**
A: 运行 `python3 cli.py --check` 检查元数据完整性，然后运行工具查看输出。

**Q: 可以直接运行工具脚本而不通过CLI吗？**
A: 可以。每个工具都支持独立运行：`python3 category/tool_name.py`

## 相关文档

### 核心文档
- [CLAUDE.md](../../CLAUDE.md) - 项目协作协议
- [开发文档/TECH_STACK.md](../../开发文档/TECH_STACK.md) - 技术栈声明

### 业务知识
- [车险数据业务规则字典.md](../../数据管理/车险数据业务规则字典.md)
- [字段分析价值矩阵.md](../../数据管理/字段分析价值矩阵.md)

### 分析报告
- [数据分析报告目录](../../数据管理/数据分析报告/)

## 版本历史

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0.0 | 2026-01-16 | 初始版本，包含8个工具 |

---

**维护者**: @claude
**最后更新**: 2026-01-16
**版本**: 1.0.0
