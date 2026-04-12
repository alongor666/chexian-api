---
phase: 01-security-baseline
plan: 01
subsystem: server/middleware
tags: [security, snapshot, permissions, typescript]
requirements: [SEC-01]

dependency_graph:
  requires: []
  provides:
    - permissionToScope returns string | null (SEC-01 mitigation)
    - snapshotServe null scope bypass
  affects:
    - server/src/middleware/snapshot-serve.ts
    - tests/middleware/snapshot-serve.test.ts

tech_stack:
  added: []
  patterns:
    - TypeScript union type narrowing (string | null)
    - Fail-safe default: unknown permission → next(), never file system access

key_files:
  created: []
  modified:
    - server/src/middleware/snapshot-serve.ts
    - tests/middleware/snapshot-serve.test.ts

decisions:
  - "返回 null 而非 'unknown'：让 TypeScript 类型系统在编译时强制检查 null 分支，消除运行时 scope 碰撞"
  - "不修改 resolveSnapshotPath 签名：null 检查前置于调用点，scope 类型在调用时已收窄为 string"

metrics:
  duration_minutes: 3
  completed_date: "2026-04-12T12:12:02Z"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 2
---

# Phase 01 Plan 01: SEC-01 快照层 scope 碰撞修复 Summary

**One-liner:** 将 permissionToScope 未知权限返回值从 'unknown' 改为 null，并在 snapshotServe 中对 null scope 提前 next()，从类型系统层面消除未知权限用户通过路径碰撞访问快照的风险。

## What Was Built

修复了快照服务中间件的安全漏洞 SEC-01：

1. **`permissionToScope` 返回类型变更**（`server/src/middleware/snapshot-serve.ts` L94）
   - 签名从 `string` 改为 `string | null`
   - 末尾 `return 'unknown'` 改为 `return null; // 未知权限：不查快照，直接穿透到 DuckDB`

2. **`snapshotServe` null 短路保护**（L154-158）
   - 在 `const scope = permissionToScope(req.permissionFilter)` 之后插入：
     ```typescript
     if (scope === null) { next(); return; }
     ```
   - TypeScript 将 scope 类型从 `string | null` 收窄为 `string`，`resolveSnapshotPath` 调用点无需修改

3. **单元测试更新**（`tests/middleware/snapshot-serve.test.ts`）
   - 更新断言：`'unknown'` → `null`（含描述文本更新）
   - 新增测试：`permissionToScope('')` 返回 `'all'`
   - 新增测试块：`snapshotServe null scope bypass`，验证未知权限时 `next()` 被调用，`res.setHeader` 和 `res.json` 均未被调用

## Verification Results

```
bun run test -- --run tests/middleware/snapshot-serve.test.ts
✓ tests/middleware/snapshot-serve.test.ts (13 tests) 8ms
Test Files  1 passed (1)
      Tests  13 passed (13)

bun run build
✓ built in 5.09s  (零 TypeScript 错误)

grep -n "unknown" server/src/middleware/snapshot-serve.ts
→ 仅 Record<string, unknown> 类型用法，无 'unknown' 字符串返回值
```

## Deviations from Plan

None — 计划完全按照指定步骤执行。

## Threat Surface Scan

修复前（漏洞）：未知权限用户 permissionFilter 被解析为 scope='unknown'，可能与其他用户的快照路径 `snapshots/{bundle}/unknown/{hash}.json` 发生碰撞，导致信息泄露（T-1-01）。

修复后（已缓解）：未知权限用户 scope=null → 提前 next() → 穿透到 DuckDB 实时查询，永远不触碰快照文件系统。TypeScript 编译器保证调用方必须处理 null 分支。

## Self-Check: PASSED

| Item | Status |
|------|--------|
| SUMMARY.md 存在 | FOUND |
| snapshot-serve.ts 存在 | FOUND |
| snapshot-serve.test.ts 存在 | FOUND |
| commit f335a31 存在 | FOUND |
| 13 tests passing | PASSED |
| TypeScript build 零错误 | PASSED |
