# 数据分析工具库索引 (v1.0)

**最后更新**: 2026-01-16
**维护者**: @claude
**工具总数**: 8个（2,508行代码）
**分类数量**: 4个分类

---

## 📋 快速导航

| 我想... | 使用工具 | 命令 |
|---------|----------|------|
| 🔄 转换数据格式 | excel_to_parquet | `python3 cli.py excel_to_parquet` |
| 📊 分析Parquet文件 | analyze_parquet | `python3 cli.py analyze_parquet` |
| 📈 分析Excel文件 | analyze_excel | `python3 cli.py analyze_excel` |
| 🔍 深度数据探索 | deep_analysis | `python3 cli.py deep_analysis` |
| 🔗 分析字段关联 | field_relation | `python3 cli.py field_relation` |
| 📝 深度分析字段 | field_deep | `python3 cli.py field_deep` |
| 📊 穷举字段统计 | field_exhaustive | `python3 cli.py field_exhaustive` |
| 💰 计算已赚保费 | earned_premium | `python3 cli.py earned_premium` |
| 📋 查看所有工具 | - | `python3 cli.py --list` |
| 🔍 搜索工具 | - | `python3 cli.py --search <keyword>` |

---

## 🗂️ 按类别分组

### 📦 数据转换工具 (conversion-tools) - 1个工具

用于数据格式转换、ETL处理等任务。

#### excel_to_parquet
**描述**: Excel转Parquet格式，支持字段映射、数据清洗、去重策略

**运行方式**:
```bash
python3 cli.py excel_to_parquet
```

**功能特点**:
- 支持字段重命名（如：签单/批改保费含税 → 保费）
- 新增字段计算（如：是否可续）
- 两种模式：合并模式（保留唯一保单）vs 全量模式（保留所有记录）
- 优化去重逻辑：提供基于不同主键的去重策略
- 数据质量报告生成

**输入**:
- 文件类型: `.xlsx` / `.xls`
- 必需字段: 保单号、业务员、三级机构、签单日期、保险起期、险类、险别组合、保费
- 可选字段: 批单号、是否交商统保、商车自主定价系数、批改类型

**输出**:
- 文件类型: `.parquet`
- 附加文件: 数据质量报告 (JSON)

**源文件**: `conversion_tools/excel_to_parquet.py` (624行)

**详细文档**: [源代码](./conversion_tools/excel_to_parquet.py)

---

### 📊 数据分析工具 (data-tools) - 3个工具

用于数据结构分析、探索性数据分析等任务。

#### analyze_parquet
**描述**: Parquet文件结构分析，显示数据维度、字段信息、统计摘要

**运行方式**:
```bash
python3 cli.py analyze_parquet
```

**功能特点**:
- 数据维度统计（行数、列数、内存占用）
- 字段信息详情（类型、非空数、空值数）
- 前5行数据预览
- 数据类型统计
- 数值型字段统计（describe）
- 字符型字段统计（唯一值数量）
- 缺失值分析
- 重复数据检查

**输入**:
- 文件类型: `.parquet`
- 数据要求: 至少1行数据

**输出**:
- 输出类型: 终端输出 + 文本报告
- 附加文件: `车险数据分析报告.txt`

**源文件**: `data_tools/analyze_parquet.py` (133行)

**详细文档**: [源代码](./data_tools/analyze_parquet.py)

---

#### analyze_excel
**描述**: Excel文件结构分析，显示工作表、字段类型、数据分布

**运行方式**:
```bash
python3 cli.py analyze_excel
```

**功能特点**:
- 工作表结构分析
- 字段类型识别
- 数据分布统计
- 数据质量评估

**输入**:
- 文件类型: `.xlsx` / `.xls`

**输出**:
- 输出类型: 终端输出

**源文件**: `data_tools/analyze_excel.py` (268行)

**详细文档**: [源代码](./data_tools/analyze_excel.py)

---

#### deep_analysis
**描述**: 深度数据探索，多维度分析、关联性探索、异常检测

**运行方式**:
```bash
python3 cli.py deep_analysis
```

**功能特点**:
- 多维度数据分析
- 字段关联性探索
- 异常值检测
- 高级统计分析

**输入**:
- 文件类型: `.parquet`

**输出**:
- 输出类型: 终端输出

**源文件**: `data_tools/deep_analysis.py` (229行)

**详细文档**: [源代码](./data_tools/deep_analysis.py)

---

### 🔍 字段分析工具 (field-tools) - 3个工具

用于字段级别分析、数据质量评估等任务。

#### field_relation
**描述**: 字段关联分析，探索字段间的相关性和依赖关系

**运行方式**:
```bash
python3 cli.py field_relation
```

**功能特点**:
- 字段相关性矩阵
- 字段依赖关系图
- 关联规则发现
- 交互式可视化

**输入**:
- 文件类型: `.parquet`

**输出**:
- 输出类型: 终端输出 + JSON报告
- 附加文件: `字段关联分析报告.json`, `字段关联分析报告.md`

**源文件**: `field_tools/field_relation.py` (450行)

**详细文档**: [源代码](./field_tools/field_relation.py)

---

#### field_deep
**描述**: 字段深度分析，单个字段的数据分布、质量、特征分析

**运行方式**:
```bash
python3 cli.py field_deep
```

**功能特点**:
- 单字段统计特征
- 数据分布分析
- 质量指标计算
- 可视化展示

**输入**:
- 文件类型: `.parquet`
- 参数: 目标字段名

**输出**:
- 输出类型: 终端输出

**源文件**: `field_tools/field_deep.py` (216行)

**详细文档**: [源代码](./field_tools/field_deep.py)

---

#### field_exhaustive
**描述**: 字段穷举分析，全面分析所有字段的统计特征

**运行方式**:
```bash
python3 cli.py field_exhaustive
```

**功能特点**:
- 所有字段的统计分析
- 字典生成
- 价值矩阵生成
- 分类总结

**输入**:
- 文件类型: `.parquet`

**输出**:
- 输出类型: 终端输出 + 多个报告文件
- 附加文件:
  - `字段字典_完整版.json`
  - `字段字典_完整版.md`
  - `字段分析价值矩阵.md`
  - `字段分类总结.md`

**源文件**: `field_tools/field_exhaustive.py` (392行)

**详细文档**: [源代码](./field_tools/field_exhaustive.py)

---

### 💼 业务计算工具 (business-tools) - 1个工具

用于保险业务相关的指标计算。

#### earned_premium
**描述**: 已赚保费计算，基于保险期限按比例计算已赚保费

**运行方式**:
```bash
python3 cli.py earned_premium
```

**功能特点**:
- 按保险期限比例计算已赚保费
- 支持批量计算
- 结果导出

**输入**:
- 文件类型: `.parquet`
- 必需字段: 保单号、保险起期、保险止期、签单保费

**输出**:
- 输出类型: 终端输出 + 数据文件
- 附加文件: 计算结果数据文件

**源文件**: `business_tools/earned_premium/calculate.py` (196行)

**详细文档**:
- [源代码](./business_tools/earned_premium/calculate.py)
- [已赚保费计算知识.md](./business_tools/earned_premium/已赚保费计算知识.md)
- [README.md](./business_tools/earned_premium/README.md)

---

## 📊 工具统计

| 分类 | 工具数 | 总行数 | 平均行数 | 状态 |
|------|--------|--------|----------|------|
| conversion-tools | 1 | 624 | 624 | ✅ 完整 |
| data-tools | 3 | 630 | 210 | ✅ 完整 |
| field-tools | 3 | 1,058 | 353 | ✅ 完整 |
| business-tools | 1 | 196 | 196 | ✅ 完整 |
| **总计** | **8** | **2,508** | **314** | ✅ **完整** |

---

## 🔍 搜索工具

### 按数据类型

| 数据类型 | 相关工具 |
|----------|----------|
| **Parquet** | analyze_parquet, deep_analysis, field_relation, field_deep, field_exhaustive, earned_premium |
| **Excel** | analyze_excel, excel_to_parquet |

### 按任务类型

| 任务类型 | 相关工具 |
|----------|----------|
| **数据转换** | excel_to_parquet |
| **数据探索** | analyze_parquet, analyze_excel, deep_analysis |
| **字段分析** | field_relation, field_deep, field_exhaustive |
| **业务计算** | earned_premium |

### 按输出格式

| 输出格式 | 相关工具 |
|----------|----------|
| **终端输出** | 所有工具 |
| **JSON报告** | field_relation, field_exhaustive, excel_to_parquet |
| **Markdown报告** | field_relation, field_exhaustive |
| **文本报告** | analyze_parquet |
| **Parquet文件** | excel_to_parquet, earned_premium |

---

## 🎯 工作流程示例

### 典型的数据处理流程

```bash
# 1. 分析Excel文件结构
python3 cli.py analyze_excel

# 2. 转换为Parquet格式
python3 cli.py excel_to_parquet

# 3. 分析Parquet文件结构
python3 cli.py analyze_parquet

# 4. 深度数据探索
python3 cli.py deep_analysis

# 5. 字段关联分析
python3 cli.py field_relation

# 6. 计算已赚保费
python3 cli.py earned_premium
```

### 字段质量评估流程

```bash
# 1. 深度分析单个字段
python3 cli.py field_deep

# 2. 穷举分析所有字段
python3 cli.py field_exhaustive

# 3. 字段关联关系分析
python3 cli.py field_relation
```

---

## 📚 相关文档

### 核心文档
- **CLI入口**: [cli.py](./cli.py) - 统一命令行接口
- **快速查找**: [TOOLS.md](./TOOLS.md) - 工具快速查找表

### 业务知识
- **业务规则字典**: [车险数据业务规则字典.md](./车险数据业务规则字典.md)
- **快速参考**: [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)
- **字段价值矩阵**: [字段分析价值矩阵.md](./字段分析价值矩阵.md)

### 分析报告
- **数据分析报告目录**: [数据分析报告/](./数据分析报告/)
- **业务员保费计划**: [业务员保费计划标准化数据.parquet](./业务员保费计划标准化数据.parquet)
- **业务员归属与规划**: [业务员归属与规划/](./业务员归属与规划/)

---

## 🛠️ 开发指南

### 新增工具流程

1. **创建工具脚本**：在对应分类目录下创建Python脚本
2. **补充元数据**：添加标准docstring（包含工具名称、分类、版本、依赖、输入、输出）
3. **注册到CLI**：在 `cli.py` 的 `TOOL_REGISTRY` 中添加工具元数据
4. **更新索引**：在本文件 (`INDEX.md`) 中添加工具条目
5. **编写测试**：在 `tests/` 目录下创建对应的测试文件
6. **验证完整性**：运行 `python3 cli.py --check`

### 元数据模板

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
工具名称：简短描述（不超过80字符）

分类: data-tools | field-tools | conversion-tools | business-tools
版本: 1.0.0
作者: "@claude"
标签: [analysis, parquet, data-quality]

依赖:
  - pandas >= 1.3.0
  - numpy >= 1.20.0

输入:
  - 文件类型: .parquet
  - 必需字段: policy_no, premium
  - 可选字段: org_name, salesman_name
  - 数据要求: 至少100行数据

输出:
  - 文件类型: .txt (终端输出)
  - 输出内容: 数据结构统计摘要
  - 附加文件: 无

使用示例:
    python3 cli.py tool_name

    或直接运行:
    python3 category/tool_name.py

参数说明:
    --input: 输入文件路径（可选，默认路径）
    --output: 输出文件路径（可选）

最后更新: 2026-01-16
"""

def main():
    """主函数"""
    pass

if __name__ == "__main__":
    main()
```

---

## 📞 获取帮助

### CLI 帮助

```bash
# 查看帮助信息
python3 cli.py --help

# 列出所有工具
python3 cli.py --list

# 搜索工具
python3 cli.py --search <keyword>

# 查看工具详情
python3 cli.py --info <tool_name>

# 检查元数据
python3 cli.py --check
```

### 常见问题

**Q: 如何找到合适的工具？**
A: 使用 `python3 cli.py --search <keyword>` 搜索，或查看本索引的"按数据类型"和"按任务类型"章节。

**Q: 工具的输入文件路径在哪里配置？**
A: 大部分工具在源代码中有默认路径，如需修改请编辑对应的工具脚本。

**Q: 如何确认工具是否正常工作？**
A: 运行 `python3 cli.py --check` 检查元数据完整性，然后运行工具查看输出。

**Q: 可以直接运行工具脚本而不通过CLI吗？**
A: 可以。每个工具都支持独立运行：`python3 category/tool_name.py`

---

## 📝 变更历史

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| 1.0.0 | 2026-01-16 | 初始版本，包含8个工具，完整分类体系 |

---

**维护者**: @claude
**最后更新**: 2026-01-16
**版本**: 1.0.0
