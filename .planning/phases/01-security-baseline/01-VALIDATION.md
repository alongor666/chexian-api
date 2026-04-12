---
phase: 1
slug: security-baseline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + @playwright/test |
| **Config file** | `vite.config.ts` (vitest) / `playwright.config.ts` (E2E) |
| **Quick run command** | `bun run test -- --run tests/middleware/snapshot-serve.test.ts` |
| **Full suite command** | `bun run test && bun run test:e2e` |
| **Estimated runtime** | ~30 seconds (unit) + ~60 seconds (E2E) |

---

## Sampling Rate

- **After every task commit:** Run `bun run test -- --run tests/middleware/snapshot-serve.test.ts`
- **After every plan wave:** Run `bun run test && bun run test:e2e`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | SEC-01 | T-1-01 | permissionToScope returns null for unknown permissions | unit | `bun run test -- --run tests/middleware/snapshot-serve.test.ts` | ✅ | ⬜ pending |
| 1-01-02 | 01 | 1 | SEC-01 | T-1-01 | snapshotServe calls next() when scope is null | unit | `bun run test -- --run tests/middleware/snapshot-serve.test.ts` | ✅ | ⬜ pending |
| 1-02-01 | 02 | 2 | SEC-02 | T-1-02 | admin and leshan hit different snapshot files | E2E | `bun run test:e2e -- tests/e2e/verify-org-permissions.spec.ts` | ✅ | ⬜ pending |
| 1-02-02 | 02 | 2 | SEC-02 | T-1-02 | unauthenticated requests bypass snapshots | E2E | `bun run test:e2e -- tests/e2e/verify-org-permissions.spec.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*
- `tests/middleware/snapshot-serve.test.ts` — existing unit tests for permissionToScope
- `tests/e2e/verify-org-permissions.spec.ts` — existing E2E spec with loginAsUser helper

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| X-Snapshot response header shows different scope paths | SEC-02 | Header value inspection in browser dev tools | Login as admin → request /api/query/kpi → check X-Snapshot header; repeat as leshan → verify different path |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
