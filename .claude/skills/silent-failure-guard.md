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

1. **grep 扫描**（提交前自查）：
   ```bash
   # 空 catch / 吞异常嫌疑
   grep -rn "catch" server/src --include=*.ts | grep -E "catch.*\{\s*\}|catch.*\{\s*return (\[\]|null|\{\})"
   # 生产代码里的 mock 回退
   grep -rni "mock\|fixture\|fakeData" server/src --include=*.ts | grep -v test
   ```
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
- **可固化为 governance 检查项**：上面的 grep 规则可加进 `scripts/check-governance.mjs` 做自动拦截（按需，先以 skill 形态人工审查验证误报率，再固化）。
