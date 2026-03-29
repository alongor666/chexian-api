# 车险数据知识协议 (AI协作指引)

**目标**: 在最小token消耗下,确保AI准确理解车险数据结构和业务规则

**适用场景**: 所有涉及数据处理的AI协作任务(Claude Code、Subagents)

---

## 🎯 核心原则

### 原则1: 分层知识加载
```
第1层: 快速索引 (200 tokens)  → 判断任务相关性
第2层: 业务规则摘要 (500 tokens) → 理解关键字段
第3层: 完整字典 (按需加载) → 深度查阅
```

### 原则2: 任务驱动查询
- ✅ 只读取任务相关字段
- ✅ 用代码验证代替详细文档
- ✅ 复用已加载的上下文

### 原则3: 知识缓存机制
- 首次任务: 加载完整业务规则摘要
- 后续任务: 仅引用已加载上下文
- 跨会话: 通过INDEX.md快速定位

---

## 📋 第1层: 快速索引 (必读, ~200 tokens)

### ⭐ AI SQL 必读知识库
**[数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md](../数据管理/knowledge/ai/PARQUET_SCHEMA_KNOWLEDGE.md)**
- 完整表结构与30个字段的数据类型、值域范围
- 所有枚举字段的可能值及占比
- 自然语言关键词 → SQL 字段映射表
- **用途**: NL2SQL 语义理解、用户意图识别

### ⭐ 数据流字段变换规则
**[数据管理/knowledge/ai/DATA_FLOW_KNOWLEDGE.md](../数据管理/knowledge/ai/DATA_FLOW_KNOWLEDGE.md)**
- 9 个节点的字段名/值格式/JOIN 关系变换全景图
- 关键陷阱：工号前缀、双机构体系、achievement_cache 双来源
- **用途**: 维护映射文件、调试 JOIN 失败、理解数据流向

### 快速参考
**[数据管理/knowledge/QUICK_REFERENCE.md](../数据管理/knowledge/QUICK_REFERENCE.md)** (~200 tokens)

### 数据概况
```yaml
数据源: 数据管理/warehouse/fact/policy/车险保单综合明细表0127.parquet
记录数: ~440,000 条
字段数: 30 个
核心维度: 业绩、续保、产品、渠道、客户、批改、成本
```

### 字段分类
```yaml
永远非空 (20个):
  - 主键: 保单号、续保单号(条件)、批单号(条件)
  - 维度: 业务员、三级机构、签单日期、保险起期
  - 属性: 险类、险别组合、客户类别、厂牌车型、吨位分段
  - 标识: 6个布尔字段 (是否续保/可续/新车/新能源/过户车/电销)
  - 金额: 保费、新车购置价、商车自主定价系数(条件)
  - 渠道: 终端来源
  - 批改: 批改类型(条件)

条件非空 (4个):
  - 续保单号: 仅当 是否续保=True 时有值
  - 商车自主定价系数: 仅当 险类=商业保险 时有值
  - 批单号: 仅当存在批改时有值
  - 批改类型: 仅当存在批改时有值
```

### 关键关联
```yaml
强关联 (100%一致):
  - 是否续保 ↔ 续保单号非空
  - 险类=商业保险 ↔ 商车自主定价系数非空
  - 批单号非空 ↔ 批改类型非空

业务关联:
  - 险别组合 → 是否交商统保 (单交/交三/主全 → 单交/套单/单商)
  - 终端来源=0110融合销售 ↔ 是否电销=True
  - 客户类别=营业货车 → 吨位分段有意义
```

---

## 📖 第2层: 业务规则摘要 (按需加载, ~500 tokens)

### 核心业务概念 (任务相关时读取)

#### 1. 险类体系
```yaml
交强险 (76.2%): 国家强制,保费固定
商业保险 (23.8%): 自愿购买,保费可变,有定价系数
```

#### 2. 险别组合
```yaml
单交 (54.3%): 仅交强险
交三 (23.0%): 交强险 + 三者险
主全 (22.7%): 交强险 + 商业险全险种
```

#### 3. 统保类型
```yaml
单交 (54.3%): 仅交强险
套单 (44.1%): 交强险 + 商业险同保 (可享优惠)
单商 (1.6%): 仅商业险 (交强险已在其他保单)
```

#### 4. 客户类别
```yaml
主力市场:
  - 非营业个人客车 (58.8%)
  - 摩托车 (28.6%)

专项分析:
  - 营业货车 (2.9%) → 结合吨位分段分析
  - 非营业货车 (4.8%)
  - 非营业企业客车 (4.8%)
```

### 关键业务规则 (代码开发时必读)

#### 规则1: 空值含义
```python
# ❌ 错误: 将空值视为缺失
df[df['续保单号'].notna()]

# ✅ 正确: 空值有业务含义
df[df['是否续保'] == True]  # 续保保单
df[df['是否续保'] == False]  # 非续保保单
```

#### 规则2: 负保费处理
```python
# 负保费 = 批改退费
# 实收保费 = SUM(保费) (正负抵消)
# 毛保费 = SUM(ABS(保费)) (不考虑退费)

df[df['保费'] > 0]  # 承保保费
df[df['保费'] < 0]  # 退费金额 (必须伴随批改记录)
```

#### 规则3: 日期转换
```sql
-- DuckDB查询必须转换
CAST(签单日期 AS DATE)
CAST(保险起期 AS DATE)
DATEDIFF('day', CAST(签单日期 AS DATE), CAST(保险起期 AS DATE))
```

#### 规则4: 去重逻辑
```sql
-- 同一保单可能有多条记录 (交强险+商业险分开)
-- 按业务需求决定是否去重

SELECT COUNT(DISTINCT 保单号)  -- 唯一保单数
SELECT COUNT(*)                  -- 总记录数 (含交强+商险分开)
```

---

## 🔍 第3层: 完整字典 (深度查阅, 按需加载)

### 触发条件
- 需要字段详细值域 (枚举值、统计特征)
- 需要字段示例值
- 需要理解字段关联逻辑
- 出现数据异常需要验证

### 加载方式
```bash
# 方式1: 读取JSON (机器可读)
cat 签单清洗/字段字典_完整版.json

# 方式2: 读取Markdown (人类可读)
cat 签单清洗/字段字典_完整版.md

# 方式3: 读取业务规则 (唯一事实源)
cat 签单清洗/车险数据业务规则字典.md

# 方式4: 读取关联分析 (深入理解)
cat 签单清洗/字段关联分析报告.md
```

### 索引快速定位
```markdown
# 字段分类 (开发文档/00_index/DATA_INDEX.md)
- 按分析维度索引 (业绩/续保/产品/渠道/客户/批改)
- 按字段类型索引 (主键/维度/度量/标识)
- 按更新频率索引 (核心/衍生/批改)

# 快速查找
- `:policy_no` → 主键字段定义
- `:premium` → 金额字段处理规则
- `:is_renewal` → 布尔字段使用方法
- `:tonnage` → 营业货车专项分析
```

---

## 🔒 第3.5层: 技术约束 (数据处理的强制要求)

⚠️ **所有数据处理代码必须遵守**: [开发文档/SECURITY_CONSTRAINTS.md](../开发文档/SECURITY_CONSTRAINTS.md)

### DuckDB 强制要求

**COOP/COEP 配置**（必须）:
```typescript
// vite.config.ts
server: {
  headers: {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  },
}
```
- **不配置的后果**: DuckDB 无法初始化,应用完全无法使用
- **验证方法**: Chrome DevTools → Network → 检查响应头

**日期字段类型转换**（必须）:
```sql
-- ❌ 错误: VARCHAR 类型
YEAR(policy_date)  -- No function matches YEAR(VARCHAR)

-- ✅ 正确: 先转换为 DATE
YEAR(CAST(policy_date AS DATE))
```
- **原因**: DuckDB 日期函数必须接收 DATE 类型参数
- **位置**: PolicyFact 视图必须在创建时转换字段类型

**Worker 架构**（必须）:
```typescript
// server/src/services/duckdb.ts
this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
  type: 'module'
});
```
- **原因**: DuckDB 必须在独立线程运行,避免阻塞 UI
- **优势**: 并发控制、请求取消、沙箱安全

### Arrow IPC 协议约束

**禁止 JSON 序列化**:
```typescript
// ❌ 错误: JSON 序列化
const result = JSON.stringify(table);

// ✅ 正确: Arrow IPC
const result = tableToIPC(table, 'stream');
```
- **性能**: 序列化时间 10x 提升 (500ms→50ms)
- **传输**: 大小减少 70% (50MB→15MB)
- **保真度**: 保持原始数据类型,避免精度损失

### SQL 安全约束

**只读强制**:
```sql
-- ✅ 允许: SELECT 查询
SELECT org_level_3, SUM(premium) FROM PolicyFact

-- ❌ 禁止: 数据修改
INSERT INTO ...
UPDATE ...
DELETE FROM ...
```

**聚合强制**:
```sql
-- ❌ 禁止: 返回明细数据
SELECT policy_no, premium FROM PolicyFact LIMIT 100

-- ✅ 允许: 聚合查询
SELECT COUNT(*) as total, SUM(premium) as total_premium FROM PolicyFact
```

**视图边界**:
- 允许访问: `PolicyFact`, `PolicyFactRenewal`
- 禁止访问: `raw_parquet` (原始数据表)

**隐私保护**:
- 禁止查询: `policy_no`, `renewal_policy_no`, `id_card`, `phone`
- 自动脱敏: 聚合查询不显示明细数据

### 数据质量约束

**空值处理规则**:
- 空值有业务含义(续保单号空=非续保,不是数据缺失)
- 使用布尔字段判断: `WHERE 是否续保 = True` (不是 `WHERE 续保单号 IS NULL`)

**负保费处理规则**:
- 保费 < 0 = 批改退费(必须伴随批改记录)
- 实收保费 = SUM(保费) (正负抵消)
- 毛保费 = SUM(ABS(保费)) (不考虑退费)

**类型容错规则**:
- 布尔字段支持: BOOLEAN, INTEGER(0/1), VARCHAR("true"/"false")
- 日期字段支持: DATE, VARCHAR(可解析格式)
- 数值字段支持: DOUBLE, DECIMAL, INTEGER, BIGINT

### 实现位置

**代码验证**:
- Arrow IPC: `server/src/services/duckdb.ts:76-77`
- Worker 初始化: `server/src/services/duckdb.ts:30`
- PolicyFact 视图: `server/src/services/duckdb.ts:136-156`
- SQL 验证: `src/shared/utils/sql-validator.ts`

**安全测试**:
- SQL 注入防护: `tests/sql-validator.test.ts`
- XSS 攻击防护: `tests/security.test.ts`

---

## 🚀 AI协作工作流

### 场景1: 新功能开发 (如新增KPI计算)

**Step 1**: 加载第1层快速索引 (200 tokens)
```
判断: 是否涉及业绩/续保/产品等维度?
```

**Step 2**: 加载第2层业务规则摘要 (500 tokens)
```
读取: 相关字段的业务规则 (如保费、签单日期、是否续保)
```

**Step 3**: 编写代码并验证
```
验证: 运行单元测试,验证SQL生成逻辑
```

**Step 4**: 如遇异常,加载第3层完整字典
```
查阅: 字段详细值域、示例值、关联关系
```

**总token消耗**: ~700 + 验证 (比一次性加载完整文档节省80%)

---

### 场景2: Bug修复 (如SQL执行失败)

**Step 1**: 定位错误字段
```
错误信息: Column '商车自主定价系数' does not exist
```

**Step 2**: 加载第3层完整字典 (定位字段)
```
查阅: 商车自主定价系数字段定义
发现: 仅当 险类=商业保险 时有值,交强险为NULL
```

**Step 3**: 修复代码
```python
# 添加筛选条件
WHERE 险类 = '商业保险' AND 商车自主定价系数 > 1.0
```

**总token消耗**: ~200 (索引) + ~1000 (详细字典) = 1200 tokens

---

### 场景3: 跨会话任务接力

**第1次会话**: 完整加载上下文
```
- 加载第1层 + 第2层 (700 tokens)
- 完成核心功能开发
- 在 PROGRESS.md 记录任务状态
```

**第2次会话**: 最小化加载
```
- 读取 PROGRESS.md 了解上下文 (100 tokens)
- 仅引用已加载的字段规则
- 继续完成剩余任务
```

**token节省**: 第2次会话仅消耗 100 tokens (vs 重复加载700)

---

## 📚 知识库组织结构

```
数据管理/                        # ⭐ 数据管理中心
├── README.md                    # 数据处理全景图
├── pipelines/                   # 数据处理管道
│   ├── transform.py             # Excel → Parquet
│   ├── enrich.py                # 续保类型匹配
│   └── 已赚保费/                # 已赚保费计算
├── warehouse/                   # 数据仓库
│   ├── fact/policy/             # 保单明细 Parquet
│   └── dim/                     # 维度表 (业务员计划等)
├── knowledge/                   # 知识库
│   ├── ai/PARQUET_SCHEMA_KNOWLEDGE.md  # AI SQL 知识
│   ├── rules/车险数据业务规则字典.md    # 业务规则
│   ├── INDEX.md                 # 知识索引
│   └── QUICK_REFERENCE.md       # 快速参考
├── config/                      # 配置中心
├── staging/                     # 暂存区
├── cli.py                       # 命令行工具
└── run.sh                       # 快捷脚本

开发文档/
├── 00_index/
│   ├── DATA_INDEX.md            # ⭐ 数据索引 (快速查找)
│   ├── DOC_INDEX.md             # 文档索引
│   └── CODE_INDEX.md            # 代码索引
└── TECH_STACK.md                # 技术栈说明
```

---

## 🎯 实践建议

### 给AI的提示词模板

#### 简单任务 (如修改单个字段逻辑)
```
任务: 修改保费计算逻辑

参考:
- 签单清洗/车险数据业务规则字典.md § "保费字段"
- 负保费处理规则: 保费<0为批改退费

预期:
- SUM(保费) = 实收保费 (正负抵消)
- SUM(ABS(保费)) = 毛保费 (不考虑退费)
```

#### 复杂任务 (如新增多维度分析)
```
任务: 新增营业货车专项分析

参考:
1. 签单清洗/字段分析价值矩阵.md § "营业货车专项分析"
2. 签单清洗/车险数据业务规则字典.md § "客户类别" + "吨位分段"

关键字段:
- 客户类别 = '营业货车' (17,493条, 占2.9%)
- 吨位分段: 1吨以下/1-2吨/2-9吨/9-10吨/10吨以上

业务规则:
- 营业货车必须结合吨位分段分析
- 吨位顺序: 1吨以下 < 1-2吨 < 2-9吨 < 9-10吨 < 10吨以上
```

#### 跨会话接力
```
上下文:
- 前序任务: PROGRESS.md § "2026-01-11 字典生成"
- 已完成: 字段深度分析、业务规则提取
- 当前任务: 基于字典新增续保率KPI

快速参考:
- 签单清洗/.claude/data-knowledge-protocol.md § 第1层快速索引
- 字段: 是否续保 (布尔型)、续保单号 (条件非空)
```

---

## 🔧 工具支持

### 脚本自动化
```bash
# 生成数据索引
python3 签单清洗/生成数据索引.py

# 验证字段关联
python3 签单清洗/字段关联深度分析脚本.py

# 导出快速索引
python3 签单清洗/导出快速索引.py > 签单清洗/QUICK_REFERENCE.md
```

### VSCode集成
```json
// .vscode/settings.json
{
  "python.analysis.extraPaths": [
    "${workspaceFolder}/签单清洗"
  ],
  "files.watcherExclude": {
    "**/签单清洗/*.py": true
  }
}
```

### Claude Code Slash Command
```bash
# 快速查阅字段定义
/data-knowledge 保单号

# 查看分析场景
/data-knowledge 续保分析

# 验证业务规则
/data-knowledge 负保费处理
```

---

## 📊 效果评估

### Token消耗对比

| 场景 | 传统方式 (加载完整文档) | 分层加载方式 | 节省比例 |
|------|----------------------|------------|---------|
| 简单任务 (单字段) | ~5000 tokens | ~700 tokens | 86% ↓ |
| 中等任务 (多字段) | ~5000 tokens | ~1500 tokens | 70% ↓ |
| 复杂任务 (新功能) | ~5000 tokens | ~2500 tokens | 50% ↓ |
| 跨会话接力 | ~5000 tokens | ~100 tokens | 98% ↓ |

### 准确性保障
- ✅ 第1层索引确保不遗漏关键字段
- ✅ 第2层摘要覆盖核心业务规则
- ✅ 第3层完整字典支持深度验证
- ✅ 代码验证确保逻辑正确性

---

## 🔄 持续优化

### 定期更新
1. **每月**: 重新运行字段分析脚本,更新字典
2. **每季度**: 审查业务规则,删除过时内容
3. **每次新增字段**: 同步更新字典和索引

### 反馈机制
1. 在BACKLOG.md记录数据质量问题
2. 在PROGRESS.md记录AI协作经验
3. 优化提示词模板,减少重复查询

---

**版本**: v1.0
**维护**: 数据分析团队
**更新**: 2026-01-11

---

## 🎓 快速上手 (5分钟指南)

### 新手AI开发者
1. 阅读: 第1层快速索引 (2分钟)
2. 标记: 常用字段 (保单号、保费、是否续保)
3. 实践: 运行1个简单任务 (如统计续保率)
4. 进阶: 遇到问题时查阅第3层完整字典

### 资深AI开发者
1. 快速扫描: DATA_INDEX.md (30秒)
2. 按需查阅: 根据任务选择相关章节
3. 代码验证: 用单元测试验证理解
4. 持续优化: 积累提示词模板

---

**总结**: 通过分层知识加载 + 任务驱动查询 + 上下文复用,在保证准确性的前提下,实现token消耗降低70-90%。
