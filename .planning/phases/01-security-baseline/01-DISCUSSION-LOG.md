# Phase 1: 安全基线 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-12
**Phase:** 01-security-baseline
**Areas discussed:** 成功标准解读, SEC-02测试形式, unknown scope 实现位置

---

## 成功标准解读（从前次会话恢复）

| Option | Description | Selected |
|--------|-------------|----------|
| 保持原始成功标准 | admin 和 leshan 都需要命中各自的快照，不共享任何快照文件 | ✓ |
| 仅 admin 快照 | Phase 1 只修漏洞，不构建 org scope 快照 | |

**User's choice:** 保持原始成功标准 — admin 和 leshan 都需要命中独立快照。仅构建已知机构快照（预配置用户列表），不动态查询 DuckDB。
**Notes:** 从上次中断的检查点恢复，此决策已锁定。

---

## SEC-02 测试形式

| Option | Description | Selected |
|--------|-------------|----------|
| 扩展现有 E2E spec（推荐） | 在 verify-org-permissions.spec.ts 中新增 admin vs leshan 快照隔离场景，真实走完 auth→permission→snapshot 全链路 | ✓ |
| snapshot-serve 单元测试扩展 | mock permissionFilter，验证 scope 映射和路径查找，最快但不验证真实 auth 链路 | |
| 两者都写 | 单元测试覆盖边界用例 + E2E 覆盖端到端隔离，最全面但工作量翻倍 | |

**User's choice:** 扩展现有 E2E spec
**Notes:** 已有 verify-org-permissions.spec.ts 提供 loginAsUser 辅助函数和 retry 逻辑，可直接复用。

---

## unknown scope 实现位置

| Option | Description | Selected |
|--------|-------------|----------|
| permissionToScope 返回 null（推荐） | 返回类型改为 string \| null，未知权限返回 null，snapshotServe 中 null 直接 next()。类型安全，编译器强制处理。 | ✓ |
| snapshotServe 拦截 'unknown' | 保持返回 'unknown'，在中间件加字符串判断。最小改动但依赖字符串约定。 | |
| 两处都改（防御最严） | null + 字符串双层判断。逻辑重复。 | |

**User's choice:** permissionToScope 返回 null
**Notes:** TypeScript 类型系统强制调用方处理 null，比字符串约定更可靠，未来新增 scope 时编译器会报错提醒。

---

## Claude's Discretion

- 快照目录结构细节（沿用现有模式）
- E2E 测试具体 assertion 写法和 retry 策略

## Deferred Ideas

None — discussion stayed within phase scope
