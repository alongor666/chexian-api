---
name: chexian-security-review
description: 安全审查总路由 — 先判定检查范围和目标域，再转交具体安全子命令；支持全量 8 项直接执行。Use when 用户要做安全审查、安全检查、漏洞扫描，或触发词 security/sql注入/xss/cors 时。
category: security
version: 3.0.0
author: "@claude"
tags: [security, audit, router, sql-injection, xss, cors, validation]
scope: project
requires:
  - grep
  - bun
dependencies:
  - .claude/commands/chexian-security-sql.md
  - .claude/commands/chexian-security-xss.md
  - .claude/commands/chexian-security-cors.md
  - tests/security.test.ts
  - tests/sql-validator.test.ts
  - server/src/utils/security.ts
  - server/src/middleware/rateLimiter.ts
  - server/src/middleware/audit.ts
last_updated: "2026-05-30"
---

# 安全审查总路由（/chexian-security-review）

> 先分流，再执行。优先用窄口径子命令（sql/xss/cors）做专项检查；仅当需要全面覆盖或无法归类时才执行全量 8 项。

---

## 固定路由顺序（RED LINE）

按以下顺序判断，命中后转交对应命令：

| 优先级 | 用户问题信号 | 使用命令 | 边界 |
|---|---|---|---|
| 1 | SQL 注入、sanitizeInput、validateSQL、LIKE 子句、SQL 验证器、PolicyFact 边界、policy_no 隐私 | `/chexian-security-sql` | SQL 构建与验证层专项，不含 XSS/CORS |
| 1 | XSS、dangerouslySetInnerHTML、innerHTML、eval、React 转义、前端输出编码 | `/chexian-security-xss` | 前端渲染点专项，不含后端 SQL/CORS |
| 1 | CORS、COOP、COEP、CSP、文件上传、parquet 验证、路径遍历、文件类型限制 | `/chexian-security-cors` | 安全头 + 文件上传层专项，不含 SQL/XSS |
| 2 | 全量审查、所有检查、完整扫描、`--target all`、无明确专项信号 | 本命令直接执行全量 8 项 | 兜底路由，不再转发子命令 |

若同时命中多个专项信号，按最具体者优先；多域交叉时，先各跑专项，再汇总报告，不得反向用全量替代专项口径。

---

## 子命令速查

| 子命令 | 功能 | 检查项数 |
|--------|------|---------|
| `/chexian-security-sql` | SQL 注入防护 + SQL 验证器合规 | 2 项 |
| `/chexian-security-xss` | XSS 防护 + React/TS 安全 | 1 项 |
| `/chexian-security-cors` | CORS 配置 + 文件上传安全 | 2 项 |
| 本命令（全量） | 全部 8 项审查 | 8 项 |

---

## 重叠处理

### `/chexian-security-sql` vs `/chexian-security-xss`

- 后端 SQL 构建、参数化查询、输入清理函数（`sanitizeInput`/`validateSQL`/`buildSafeLikeClause`） → `/chexian-security-sql`
- 前端 HTML/JS 渲染输出编码（`dangerouslySetInnerHTML`/`innerHTML`/`eval`） → `/chexian-security-xss`
- 用户输入同时流向后端 SQL 和前端渲染时：先跑 sql，再跑 xss，各自独立报告

### `/chexian-security-sql` vs `/chexian-security-cors`

- SQL 验证器、PolicyFact 只读边界、policy_no 聚合要求 → `/chexian-security-sql`
- COOP/COEP 安全头、`.parquet` 文件类型验证、路径遍历（`../`）防护 → `/chexian-security-cors`
- 两者在「文件上传触发的 SQL 查询」场景有接触面：文件验证归 cors，SQL 查询参数化归 sql，不重叠

### `/chexian-security-xss` vs `/chexian-security-cors`

- 前端输出编码、React 组件渲染安全 → `/chexian-security-xss`
- 安全响应头（COOP/COEP/CSP）、跨域资源策略 → `/chexian-security-cors`
- CSP 既可限制 XSS 又属安全头：CSP 的**配置审查**（值是否合理）归 cors；CSP 的**绕过风险**（如 `unsafe-inline`）归 xss

### 何时直接用全量（本命令）

- 用户说"做一次全面安全审查"/"跑所有安全检查"/"PR 前安全扫描"
- 目标是生成完整合规性报告（8 项覆盖度 + 评分）
- 无法明确归入单一专项（如审查新引入的第三方库同时影响 SQL/XSS/CORS）
- **不得** 用全量替代专项：如果用户只问"SQL 注入安全吗"，直接用 `/chexian-security-sql`，不要跑全量 8 项

---

## 输入参数

```bash
/chexian-security-review                              # 默认：审查所有已修改文件（全量 8 项）
/chexian-security-review --target src/shared/utils    # 指定目录（全量 8 项）
/chexian-security-review --target all                 # 全量审查所有文件
```

---

## 项目安全架构

- **后端**: Express + JWT 认证 + 三级限流（通用 100/min、登录 5/min、查询 30/min）
- **数据引擎**: DuckDB（服务端，非浏览器）
- **安全层**: SQL 验证器、输入清理、文件上传防护、审计日志
- **测试覆盖**: 136+ 安全测试用例

### 关键安全文件

| 文件 | 职责 |
|------|------|
| `server/src/utils/security.ts` | 输入清理、文件验证、SQL 表名验证 |
| `server/src/middleware/rateLimiter.ts` | 三级限流（禁止降低） |
| `server/src/middleware/audit.ts` | 审计日志 |
| `server/src/services/auth.ts` | JWT 认证、bcrypt 密码验证 |
| `tests/security.test.ts` | 安全测试（74 用例） |
| `tests/sql-validator.test.ts` | SQL 验证器测试（62 用例） |

---

## 全量 8 项审查清单

| # | 检查项 | 严重性 | 要点 |
|---|--------|--------|------|
| 1 | **SQL 注入防护** | Critical | 所有用户输入经 `sanitizeInput()` 清理；禁止字符串拼接 SQL；LIKE 用 `buildSafeLikeClause()` |
| 2 | **SQL 验证器合规** | Critical | 只读限制（仅 SELECT/WITH）；单语句；必须引用 PolicyFact；禁止 SELECT policy_no；必须聚合 |
| 3 | **文件上传安全** | Critical | 仅 `.parquet`/`.pq`；≤50MB；路径遍历防护（`../`）；文件名非法字符过滤 |
| 4 | **CORS 与安全头** | High | COOP: same-origin；COEP: require-corp；建议添加 CSP |
| 5 | **XSS 防护** | High | 禁止 `dangerouslySetInnerHTML`/`innerHTML`/`eval()`；React 自动转义 |
| 6 | **数据隐私保护** | High | policy_no 仅 WHERE 可用；日志脱敏；错误消息不泄露 SQL/表结构；导出必须聚合 |
| 7 | **依赖包安全** | Medium | `bun audit` 无漏洞；版本固定；定期更新 |
| 8 | **错误处理与构建** | Low | 不暴露堆栈跟踪；生产禁用 source maps；Error Boundary |

---

## 审查流程（全量模式）

### 1. 自动扫描（5 分钟）

```bash
bun run tsc --noEmit                          # TypeScript 类型检查
bun test tests/security.test.ts               # 安全测试
bun test tests/sql-validator.test.ts          # SQL 验证器测试
bun audit                                     # 依赖漏洞扫描
```

### 2. 代码审查（10-15 分钟）

按优先级逐项检查上述 8 项清单，使用 `grep -r` 搜索潜在问题模式：
- SQL 拼接：`WHERE.*\${`、`SELECT.*\${`
- XSS 风险：`dangerouslySetInnerHTML`、`innerHTML`、`eval(`
- 敏感信息：`password.*=`、`api_key`、`console.log.*policy_no`

### 3. 生成报告

---

## 输出格式

```markdown
# 车险业绩看板安全审查报告

**审查时间**: YYYY-MM-DD HH:mm
**审查范围**: N 个文件
**合规性评分**: XX/100

## 概览
| 指标 | 数值 |
|------|------|
| 发现问题 | 0 Critical / N High / N Medium / N Low |

## Critical/High/Medium/Low 问题
（每个问题：文件:行号 → 问题描述 → 修复建议 → 修复优先级）

## 已实现的安全措施（良好）
## 改进建议
## 修复优先级时间线
```

---

## 严重性定义

| 级别 | 修复时限 | 示例 |
|------|---------|------|
| Critical | 立即 | SQL 注入、文件上传漏洞、硬编码密钥 |
| High | 本周内 | XSS、敏感数据存储、CORS 错误、信息泄露 |
| Medium | 下次发版 | 依赖不固定、缺少 CSP、日志含敏感信息 |
| Low | 下次迭代 | console.log 残留、source maps、代码质量 |

---

## 执行协议

1. 先用本路由判断专项还是全量。
2. 专项时：打开目标子命令文档，按子命令的检查清单执行。
3. 全量时：按上方「全量 8 项审查清单」顺序执行，生成完整报告。
4. 组合专项时：在最终报告中显式标明各专项来源和各自口径。

**目标**: $ARGUMENTS（如未指定，审查所有变更文件）
