---
phase: 04
slug: materialization
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vite.config.ts` (test section) |
| **Quick run command** | `bun run test` |
| **Full suite command** | `bun run test:integration` |
| **Estimated runtime** | ~30 seconds (unit) / ~60 seconds (integration) |

---

## Sampling Rate

- **After every task commit:** Run `bun run build` (type check) + `bun run test`
- **After every plan wave:** Run `bun run test` + `bun run test:integration`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | MAT-02 | type check | `bun run build` | N/A | ⬜ pending |
| 04-01-02 | 01 | 1 | MAT-02 | static | `wc -l server/src/services/duckdb.ts` | N/A | ⬜ pending |
| 04-01-03 | 01 | 1 | MAT-02 | integration | `bun run test:integration` | ✅ (needs update) | ⬜ pending |
| 04-02-01 | 02 | 2 | MAT-01 | integration | new test: lazy-domain-registry.test.ts | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 2 | MAT-01 | unit | new test: concurrent Promise lock | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 2 | MAT-01 | integration | `curl` + response time check | N/A (manual) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `server/src/services/__tests__/lazy-domain-registry.test.ts` — stubs for MAT-01 lazy load + concurrency
- [ ] `server/src/services/__tests__/duckdb-parquet-loader.test.ts` — stubs for loadMultipleParquet fingerprint cache
- [ ] Update `duckdb-materialize-batches.test.ts` — change from proxy method to direct import
- [ ] Update `duckdb-derived-tables.test.ts` — change from proxy method to direct import

*Existing infrastructure (Vitest + DuckDB native binary) covers all framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PM2 memory baseline ~50% | MAT-01 | Requires VPS deployment | `pm2 monit` after deploy, observe RSS |
| First lazy request latency | MAT-01 | Requires real Parquet files | `curl -w '%{time_total}' /api/query/claims-detail/overview` on VPS |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
