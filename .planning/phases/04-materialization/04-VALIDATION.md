---
phase: 04
slug: materialization
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-14
audited: 2026-04-14
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
| **Estimated runtime** | ~7 seconds (unit) / ~60 seconds (integration) |

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
| 04-01-01 | 01 | 1 | MAT-02 | type check | `bun run build` | N/A | ✅ green |
| 04-01-02 | 01 | 1 | MAT-02 | static | `wc -l server/src/services/duckdb.ts` (≤110) | N/A | ✅ green |
| 04-01-03 | 01 | 1 | MAT-02 | integration | `bun run test` (duckdb-derived-tables + duckdb-materialize-batches) | ✅ | ✅ green |
| 04-01-04 | 01 | 1 | MAT-02 | unit | `npx vitest run server/src/services/__tests__/type-converter.test.ts` | ✅ | ✅ green |
| 04-01-05 | 01 | 1 | MAT-02 | unit | `npx vitest run server/src/services/__tests__/parquet-fingerprint.test.ts` | ✅ | ✅ green |
| 04-02-01 | 02 | 2 | MAT-01 | unit | `npx vitest run server/src/services/__tests__/lazy-domain-registry.test.ts` | ✅ | ✅ green |
| 04-02-02 | 02 | 2 | MAT-01 | unit | `npx vitest run server/src/services/__tests__/bootstrapper-registry.test.ts` | ✅ | ✅ green |
| 04-02-03 | 02 | 2 | MAT-01 | unit | `npx vitest run server/src/routes/query/__tests__/domain-middleware.test.ts` | ✅ | ✅ green |
| 04-02-04 | 02 | 2 | MAT-01 | manual | `curl` + `pm2 monit` on VPS | N/A (manual) | ⬜ pending (VPS) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Test Files Summary

| Test File | Tests | Requirement | Coverage |
|-----------|-------|-------------|----------|
| `server/src/services/__tests__/type-converter.test.ts` | 12 | MAT-02 | convertBigIntToNumber 全类型分支 + SLOW_QUERY_THRESHOLD_MS |
| `server/src/services/__tests__/parquet-fingerprint.test.ts` | 6 | MAT-02 | computeParquetFingerprint 确定性/顺序无关/null/mtimes |
| `server/src/services/__tests__/bootstrapper-registry.test.ts` | 3 | MAT-01 | 注册/取用/覆盖 单例行为 |
| `server/src/routes/query/__tests__/domain-middleware.test.ts` | 4 | MAT-01 | null bootstrapper/成功/503 超时/通用错误 |
| `server/src/services/__tests__/lazy-domain-registry.test.ts` | 6 | MAT-01 | 首次加载/并发锁/失败/超时/依赖链/不重复加载 |
| `server/src/services/__tests__/duckdb-derived-tables.test.ts` | 6 | MAT-02 | dropAllDerivedTables 行为（已有，已更新） |
| `server/src/services/__tests__/duckdb-materialize-batches.test.ts` | 9 | MAT-02 | materializeInBatches 批处理（已有，已更新） |
| `tests/api/data-load-raw-parquet-contract.test.ts` | — | MAT-02 | 契约测试（已有，已更新） |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PM2 memory baseline ~50% | MAT-01 | Requires VPS deployment | `pm2 monit` after deploy, observe RSS |
| First lazy request latency | MAT-01 | Requires real Parquet files | `curl -w '%{time_total}' /api/query/claims-detail/overview` on VPS |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Manual-Only designation
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s (7.04s actual)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** PASSED

---

## Validation Audit 2026-04-14

| Metric | Count |
|--------|-------|
| Gaps found | 5 |
| Resolved | 5 |
| Escalated | 0 |

**Details:**
- Gap 1 (MISSING → COVERED): `type-converter.test.ts` — 12 tests for convertBigIntToNumber + SLOW_QUERY_THRESHOLD_MS
- Gap 2 (MISSING → COVERED): `parquet-fingerprint.test.ts` — 6 tests for computeParquetFingerprint
- Gap 3 (MISSING → COVERED): `domain-middleware.test.ts` — 4 tests for createDomainMiddleware factory
- Gap 4 (MISSING → COVERED): `bootstrapper-registry.test.ts` — 3 tests for singleton registry
- Gap 5 (PARTIAL → COVERED): `lazy-domain-registry.test.ts` TC-05/TC-06 — domain dependency chain (ClaimsAgg → ClaimsDetail)

**Full suite:** 91 files / 1543 tests / 0 failures / 7.04s
