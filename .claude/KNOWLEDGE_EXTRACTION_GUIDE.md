# 知识提取系统使用指南

**版本**: v1.0
**更新**: 2026-01-11

---

## 🎯 系统概述

这是一个基于Claude Code生态的可复用知识提取系统,用于从对话中提取隐性知识并结构化归档。

**核心组件**:
1. **Subagent**: `.claude/subagents/knowledge-miner.md` - AI知识提取专家
2. **Slash Command**: `/extract-knowledge` - 快捷触发命令
3. **辅助脚本**: `.claude/scripts/extract_knowledge.py` - Python辅助工具
4. **协议文档**: `.claude/knowledge-extraction-protocol.md` - 完整协议说明

---

## 🚀 快速开始

### 方式1: 使用Slash Command (推荐)

```bash
# 在Claude Code对话中输入
/extract-knowledge

# 参数示例
/extract-knowledge --scope current --focus business-rules
/extract-knowledge --mode batch
```

**优点**:
- ✅ 无需手动调用脚本
- ✅ AI自动执行提取流程
- ✅ 支持交互确认

### 方式2: 直接调用Subagent

```bash
# 在Claude Code对话中
Task: 启动knowledge-miner subagent
参数: scope=current, focus=business-rules, mode=interactive
```

**优点**:
- ✅ 更精细的控制
- ✅ 可自定义参数

### 方式3: 使用Python脚本 (辅助)

```bash
# 准备对话文本文件
cat > conversation.txt << EOF
User: 什么是续保单号?
Assistant: 续保单号是...
User: 不对,续保单号为空表示非续保保单
...
EOF

# 运行脚本
python .claude/scripts/extract_knowledge.py conversation.txt
```

**优点**:
- ✅ 可离线使用
- ✅ 批量处理历史对话
- ✅ 生成候选清单

---

## 📋 工作流程

### 完整流程 (交互模式)

```
Step 1: 触发提取
  → 输入 /extract-knowledge

Step 2: 扫描对话
  → AI扫描本次对话
  → 识别关键词命中

Step 3: 提取上下文
  → 提取完整对话片段
  → 生成候选知识清单

Step 4: 分类整理
  → 按6类知识体系分类
  → A类: 业务规则
  → B类: 技术约束
  → C类: 开发规范
  → D类: 历史决策
  → E类: 例外情况
  → F类: 待确认问题

Step 5: 请求确认
  → AI逐项输出理解
  → 您确认/修正/补充/删除

Step 6: 归档存储
  → 更新知识库文档
  → 添加交叉引用
  → 维护索引

Step 7: 生成报告
  → 变更摘要
  → 新增/修改统计
  → 健康度检查
```

**预计时间**: 20-40分钟 (交互模式)

---

## 🎨 使用场景

### 场景1: 重要对话结束后

**触发时机**: 完成重要功能开发/业务讨论后

**执行方式**:
```bash
/extract-knowledge --scope current --focus all
```

**预期产出**:
- 5-10条新知识
- 更新的知识库文档
- 变更摘要报告

### 场景2: 项目初始化

**触发时机**: 新项目开始,需要从历史对话补齐知识库

**执行方式**:
```bash
# 方式A: 提供历史对话文本
python .claude/scripts/extract_knowledge.py history_conversations.txt

# 方式B: 使用Subagent处理
Task: knowledge-miner subagent
参数: scope=history, mode=batch
```

**预期产出**:
- 50-100条新知识
- 完整的知识库文档

### 场景3: 定期维护

**触发时机**: 每月/每季度定期检查

**执行方式**:
```bash
# AI自动检查知识库健康度
Task: knowledge-miner subagent
操作: health_check
```

**预期产出**:
- 健康度报告
- 过时规则列表
- 冲突检测报告

---

## 📊 知识分类说明

### A类: 业务规则
**定义**: 描述业务逻辑、数据含义、计算规则

**示例**:
- "续保单号为空表示非续保保单"
- "负保费=批改退费,必须伴随批改记录"
- "实收保费 = SUM(保费) (正负抵消)"

**存储位置**: `签单清洗/车险数据业务规则字典.md`

### B类: 技术约束
**定义**: 描述技术实现限制、架构要求

**示例**:
- "日期字段必须CAST转换后才能计算"
- "Worker通信必须用Arrow IPC"

**存储位置**: `CLAUDE.md § 2 护栏`

### C类: 开发规范
**定义**: 描述代码风格、工作流程、验证协议

**示例**:
- "所有修改必须先写单元测试"
- "禁止自我安慰式开发"

**存储位置**: `CLAUDE.md § 6 验证协议`

### D类: 历史决策
**定义**: 描述为什么采用某种方案

**示例**:
- "为什么用DuckDB: 支持大规模数据分析"
- "为什么采用分层加载: Token消耗降低80%"

**存储位置**: `PROGRESS.md § 决策记录`

### E类: 例外情况
**定义**: 描述特殊场景、边界条件

**示例**:
- "营业货车必须结合吨位分段分析"
- "过户车不一定有批改记录"

**存储位置**: `签单清洗/字段关联分析报告.md`

### F类: 待确认问题
**定义**: 对话中提出但未确认的问题

**示例**:
- "是否需要考虑跨年续保?"
- "批改记录是否可能有多条?"

**存储位置**: `BACKLOG.md` (状态=PROPOSED)

---

## 🔧 高级用法

### 自定义关键词

编辑 `.claude/scripts/extract_knowledge.py`:

```python
KEYWORDS = {
    'your_category': ['关键词1', '关键词2'],
    # 添加更多类别
}
```

### 自定义存储位置

编辑 `.claude/subagents/knowledge-miner.md`:

```markdown
**存储位置映射**:
- A类: your/path/to/file.md
- B类: your/path/to/file.md
```

### 批量处理历史对话

```bash
# 准备历史对话文件目录
mkdir -p history_conversations/

# 批量提取
for file in history_conversations/*.txt; do
    python .claude/scripts/extract_knowledge.py "$file"
done

# 合并结果
cat knowledge_candidates_*.md > all_candidates.md
```

---

## 📈 效果评估

### 知识积累速度
- **每次对话**: +5-10条新知识
- **每月**: +50-100条新知识
- **一年后**: 600-1200条结构化知识

### 协作效率提升
- **Token节省**: 70-90% (复用已有知识)
- **准确性提升**: 零误解 (基于确认过的规则)
- **维护成本**: 降低 (结构化存储)

---

## ❓ 常见问题

### Q1: 提取的知识不准确怎么办?
**A**: 系统会逐项请求您确认,可以修正理解后再归档。

### Q2: 历史对话太多,如何处理?
**A**: 建议分批处理,按时间/主题分割对话文件。

### Q3: 如何验证知识被正确应用?
**A**: 系统支持代码反向扫描,检查实现是否与规则一致。

### Q4: 知识冲突怎么办?
**A**: 系统会检测冲突并标记,需要您确认哪个规则正确。

### Q5: 如何删除过时知识?
**A**: 定期运行健康度检查,系统会提示过时规则。

---

## 🔄 持续改进

### 反馈机制
1. 每次提取后记录改进建议
2. 优化关键词配置
3. 调整分类逻辑

### 版本管理
- 主知识库: 当前版本
- 历史版本: 归档 (文件名带日期)
- 变更日志: 记录所有更新

### 质量监控
- 每月: 健康度检查
- 每季度: 知识审计
- 每年: 全面审查

---

## 📞 支持与反馈

**问题反馈**: 在BACKLOG.md提交任务
**改进建议**: 在对话中直接告诉AI
**文档更新**: 定期同步到项目文档

---

**最后更新**: 2026-01-11
**维护**: 知识管理团队
