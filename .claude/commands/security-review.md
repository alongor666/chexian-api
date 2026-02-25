---
name: security-review
description: 车险业绩看板全面安全审查（SQL注入、XSS、CORS等8项检查）
category: security
version: 2.1.0
author: "@claude"
tags: [security, audit, sql-injection, xss, cors, validation]
scope: project
requires:
  - grep
  - bun
dependencies:
  - tests/security.test.ts
  - tests/sql-validator.test.ts
  - server/src/utils/security.ts
  - server/src/middleware/rateLimiter.ts
  - server/src/middleware/audit.ts
last_updated: "2026-02-24"
---

# 车险业绩看板安全审查

对车险业绩看板进行全面的安全审查，识别潜在的安全漏洞和最佳实践违规。

---

## 子命令速查（推荐）

| 子命令 | 功能 | 检查项数 |
|--------|------|---------|
| `/security-sql` | SQL注入防护 + SQL验证器合规 | 2项 |
| `/security-xss` | XSS防护 + React/TS安全 | 1项 |
| `/security-cors` | CORS配置 + 文件上传安全 | 2项 |
| `/security-all` | 全量审查 | 8项 |

**完整审查**: 使用本命令执行所有 8 项安全检查。

---

## 输入参数

```bash
/security-review                              # 默认：审查所有已修改文件
/security-review --target src/shared/utils    # 指定目录
/security-review --target all                 # 全量审查
```

---

## 项目安全架构

- **后端**: Express + JWT 认证 + 三级限流（通用100/min、登录5/min、查询30/min）
- **数据引擎**: DuckDB（服务端，非浏览器）
- **安全层**: SQL 验证器、输入清理、文件上传防护、审计日志
- **测试覆盖**: 136+ 安全测试用例

### 关键安全文件

| 文件 | 职责 |
|------|------|
| `server/src/utils/security.ts` | 输入清理、文件验证、SQL表名验证 |
| `server/src/middleware/rateLimiter.ts` | 三级限流（禁止降低） |
| `server/src/middleware/audit.ts` | 审计日志 |
| `server/src/services/auth.ts` | JWT 认证、bcrypt 密码验证 |
| `tests/security.test.ts` | 安全测试（74 用例） |
| `tests/sql-validator.test.ts` | SQL 验证器测试（62 用例） |

---

## 8 项审查清单

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

## 审查流程

### 1. 自动扫描（5分钟）

```bash
bun run tsc --noEmit                          # TypeScript 类型检查
bun test tests/security.test.ts               # 安全测试
bun test tests/sql-validator.test.ts          # SQL 验证器测试
bun audit                                     # 依赖漏洞扫描
```

### 2. 代码审查（10-15分钟）

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

## 执行

现在请对以下文件执行安全审查：

**目标**: $ARGUMENTS（如未指定，审查所有变更文件）

1. 运行自动化工具
2. 执行手动代码审查（按优先级检查 8 项清单）
3. 生成详细报告
4. 提供修复优先级和时间线
