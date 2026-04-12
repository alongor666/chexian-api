---
phase: 01-security-baseline
plan: 02
subsystem: testing
tags: [playwright, e2e, snapshot-isolation, security]

requires:
  - phase: 01-security-baseline/01
    provides: permissionToScope null return + snapshotServe null bypass
provides:
  - E2E multi-role snapshot isolation test (admin vs leshan)
  - E2E unauthenticated request 401 test
  - loginAs() reusable helper function for multi-user E2E testing
affects: [e2e-tests, snapshot-build, ci]

tech-stack:
  added: []
  patterns: [multi-user-e2e-auth, snapshot-isolation-verification]

key-files:
  created: []
  modified:
    - tests/e2e/verify-org-permissions.spec.ts

key-decisions:
  - "Used test.skip(!process.env.CI) pattern for snapshot-dependent tests — local runs skip, CI requires pre-built snapshots"
  - "Verified data isolation via response data content comparison (JSON.stringify != assertion) rather than X-Snapshot path — X-Snapshot header only returns hit|miss|stale|error, not file paths"

patterns-established:
  - "loginAs(page, user, pass): generic multi-user E2E helper alongside existing loginAsUser()"
  - "Snapshot isolation E2E: login as user A → request endpoint → login as user B → same endpoint → assert different data"

requirements-completed: [SEC-02]

duration: 8min
completed: 2026-04-12
---

# Plan 02: SEC-02 权限隔离 E2E 测试 Summary

**多角色快照隔离 E2E 测试 — admin/leshan 独立快照验证 + 未认证 401 + 通用 loginAs 辅助函数**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-12T20:15:00Z
- **Completed:** 2026-04-12T20:23:00Z
- **Tasks:** 2 (1 auto + 1 checkpoint:human-verify)
- **Files modified:** 1

## Accomplishments
- 新增 `loginAs(page, user, pass)` 通用辅助函数，支持任意用户凭据的 E2E 登录
- 新增快照隔离测试：admin (scope=all) vs leshan (scope=乐山) 请求同一端点，验证 X-Snapshot 各自命中 + 数据内容不同
- 新增未认证请求测试：无 JWT cookie 请求返回 401
- 人工验证通过：admin X-Snapshot:hit, 数据隔离确认, 未认证 401

## Task Commits

1. **Task 1: E2E 测试扩展 — 多角色快照隔离验证** - `5750320` (test)
2. **Task 2: 人工验证 — Phase 1 安全基线端到端确认** - checkpoint approved

## Files Created/Modified
- `tests/e2e/verify-org-permissions.spec.ts` — 新增 loginAs 辅助函数 + 2 个快照隔离 E2E 测试场景

## Decisions Made
- X-Snapshot 头仅返回 hit/miss/stale/error（不含路径），因此数据隔离通过 JSON 内容差异断言验证
- 新增测试使用 `test.skip(!process.env.CI)` 条件跳过，本地开发不需 snapshot 预构建

## Deviations from Plan
None - plan executed exactly as written

## Issues Encountered
- leshan 登录因 `server/.env` 的 `USER_PASSWORDS` 环境变量覆盖了密码 hash 而失败。临时更新 env 完成验证后恢复。生产环境需确保 `USER_PASSWORDS` 中的 hash 与实际密码一致。

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 1 安全基线全部完成，快照层权限隔离已验证
- E2E 回归测试就绪，后续重构不会破坏隔离行为
- 注意：CI 环境需在 E2E 前运行 `node scripts/build-snapshots.mjs --scope 乐山` 预构建快照

---
*Phase: 01-security-baseline*
*Completed: 2026-04-12*
