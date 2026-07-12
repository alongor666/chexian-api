# Legacy reference：Python L0/L1/L2 子项目约定

> 历史状态：已退役。本文完整保留早期以独立 Python 子项目和 `input/output` 文件传递为中心的规范，仅用于理解旧提交；当前工程遵循根目录 `ARCHITECTURE.md` 的 warehouse/API-only 架构。

## 一、层级定义

| 层级 | 说明 | 示例 |
|---|---|---|
| L0 - 根项目 | 整体协调，不含业务逻辑 | `chexian-api/` |
| L1 - 功能域 | 按职责划分的模块集合 | `数据管理/`、`src/` |
| L2 - 子项目 | 独立可运行的最小单元 | `原始数据加工/`、`保单明细/` |

## 二、依赖与通信

允许 `L0 → L1 → L2` 向下调用，以及 L2 向共享库或配置依赖；禁止 L2 依赖 L0，禁止 L2 之间直接 import。

```text
原始数据加工/output/result.xlsx
        ↓ 文件传递，非代码依赖
保单明细/input/result.xlsx
```

子项目通过 `input/output` 目录交换数据，不共享代码。

## 三、L2 标准目录

```text
子项目名/
├── scripts/
│   └── main_xxx.py
├── config/
│   └── default.yaml
├── input/               # .gitignore
├── output/              # .gitignore
├── logs/                # .gitignore
├── docs/                # 可选
├── tests/               # 可选
├── requirements.txt
├── run.sh
├── .gitignore
└── README.md
```

### README 模板

```markdown
# 子项目名称

## 功能
一句话描述本子项目做什么

## 快速开始
./run.sh config/default.yaml

## 输入输出
- 输入：xxx.xlsx（保单号、续保业务类型等）
- 输出：xxx_已处理.xlsx

## 配置说明
见 config/default.yaml

## 依赖
- 上游：无 / xxx 子项目输出
- 下游：被 xxx 子项目使用
```

## 四、命名规范

- 功能域目录使用中文；子项目使用中文动宾短语；技术目录使用英文小写。
- Python 脚本使用 `动词_名词.py`，例如 `match_renewal_type.py`。
- 配置使用小写下划线，例如 `default.yaml`、`task_20260201.yaml`。
- 输出使用 `原名_处理类型.xlsx`；日志使用 `操作_时间戳.log`。

## 五、新建子项目检查清单

- 确认不能扩展现有子项目，且新职责边界清晰。
- 明确输入来源、输出去向和上下游。
- 遵循标准目录结构并编写 README。
- 配置 `.gitignore` 忽略 `input/`、`output/`、`logs/`。
- 在架构数据流向图中登记位置。

## 六、AI 协作指引

先读架构文档，定位 L0/L1/L2 层级；遵循依赖和文件通信规则；使用标准目录；架构变化后同步文档。

## 七、历史分支约定的最终校准

早期文档曾描述长期 `develop`/`feature` 分支，后校准为 `main` 唯一长期分支，加 `claude/<任务>`、`codex/<任务>` 等短生命周期 PR 分支。该校准同样属于历史记录，不替代仓库当前 Git 工作流规则。
