---
name: silent-failure-guard
description: 静默失败五铁律 — code review / 提交前审查代码是否吞掉错误（空catch/吞异常不记日志/裸null返回/?.掩盖失败/生产回退mock）。Use when 做 code review、提交前自查、排查"为什么没报错但结果不对"，或编写 try/catch、错误处理、DuckDB 查询兜底逻辑时。
version: 1.0.0
---

# 静默失败五铁律（Silent Failure Guard）

> 精髓借鉴：super-powers-team-suite analyst 的 "Five Iron Laws of Silent Failure"。本 skill 用 chexian 的栈（DuckDB/Express 后端 + React/TS 前端）重写示例，并接入 `bun run governance` 与 `chexian-security-review`。
>
> 为什么重要：本项目是数据分析平台，**静默失败比崩溃更危险**——查询悄悄返回空/错值，用户看到的是"看起来正常但错误"的 KPI。

## 五铁律

| # | 铁律 | 反模式 | chexian 正确做法 |
|---|------|--------|-----------------|
| 1 | **不留空 catch** | `try { ... } catch (e) {}` | catch 内必须：记日志（含上下文）+ 重抛或返回带错误标记的结果 |
| 2 | **不吞异常不记日志** | `catch (e) { return [] }` 直接吞 | DuckDB 查询失败必须 `logger.error` + 让上层感知（route 返回 5xx 或带 `error` 字段），禁止悄悄返回空数组冒充"无数据" |
| 3 | **不返回裸 null 无解释** | `return null` 不说明何时/为何 | 返回 null/undefined 必须注释触发条件，或用判别联合（`{ ok: false, reason }`），让调用方必须处理 |
| 4 | **`?.` 不掩盖失败** | `data?.rows?.[0]?.value ?? 0` 把"查询失败"和"值为0"混为一谈 | 先判别"是否查到"，再取值；可选链只用于"合法可缺省"字段，不用于"本该存在却没有=出错"的场景 |
| 5 | **生产不回退 mock** | 查询异常时 `return MOCK_KPI` | 生产代码任何路径都不得回退到 mock/假数据；测试桩只存在于测试文件 |

## 审查动作

1. **快速扫描（提交前自查）**——⚠️ 真实 TS/Express 代码常把 `} catch (err) {` 与 `return []/null` 或空块**分成多行**，普通 `grep` 逐行匹配会漏掉它们（恰好是本 skill 要拦的吞异常）。故用 ripgrep 多行模式 `rg -U`（PCRE `-P`）：
   ```bash
   # 空 catch（含跨行 } catch (e) { \n }）
   rg -UP 'catch\s*\([^)]*\)\s*\{\s*\}' server/src -g '*.ts'
   # catch 块里直接 return 空值（含跨行，启发式：catch 到最近 } 之间出现 return []/null/{}）
   rg -UP 'catch\s*\([^)]*\)\s*\{[^}]*return\s*(\[\]|null|\{\})' server/src -g '*.ts'
   # 生产代码里的 mock 回退
   rg -ni 'mock|fixture|fakeData' server/src -g '*.ts' -g '!*test*'
   ```
   > grep/rg 终究是**启发式**（`[^}]*` 跨不过嵌套大括号、无法判断"有没有 logger"）。**结构性强制拦截应走 AST/lint**：ESLint `no-empty`（空块）、`no-useless-catch`，或自定义 rule 检测"catch 内仅 return 空值且无 log 调用"。grep 用于人工自查的快速定位，lint 用于 CI 硬拦截——按 `code-search-routing` 原则各司其职。
2. **逐处判定**：每个命中点按"是合法可缺省，还是掩盖了错误？"二选一定性。
3. **置信度阈值**：报告问题时只报 ≥75% 把握的（与 analyst 一致），避免误报淹没真问题。

## 严重度与处置

| 级别 | 标准 | 动作 |
|------|------|------|
| Critical | 静默失败导致 KPI/赔付率等核心指标错误且无人察觉 | 合并前必修 |
| High | 错误被吞但有日志可追 | 强烈建议修 |
| Medium | 防御性兜底但语义不清 | 登记，不阻塞 |

## 与现有护栏的关系

- **注入/XSS/CORS** 类安全 → 走 `chexian-security-review` 全家桶，本 skill 不覆盖。
- **本 skill 专管**：错误处理的"静默性"——代码不崩但悄悄给错结果。
- **固化为自动拦截**：稳健做法是 ESLint rule（`no-empty` / `no-useless-catch` / 自定义"catch 仅 return 空值且无 log"）进 CI 硬拦截；§审查动作 的 `rg -UP` 仅作人工自查的快速定位。先以 skill 形态验证误报率，再固化为 lint 规则。
