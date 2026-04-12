---
phase: 2
slug: sql
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vite.config.ts |
| **Quick run command** | `bun run test --reporter=verbose` |
| **Full suite command** | `bun run test && bun run build && bun run governance` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test --reporter=verbose`
- **After every plan wave:** Run `bun run test && bun run build && bun run governance`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | SQL-01 | — | N/A | integration | `bun run snapshot:build && bun run snapshot:verify` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | SQL-02 | — | N/A | unit | `bun run test --reporter=verbose` | ✅ | ⬜ pending |
| 02-02-02 | 02 | 2 | SQL-02 | — | N/A | build | `bun run build` | ✅ | ⬜ pending |
| 02-03-01 | 03 | 3 | SQL-02 | — | N/A | governance | `bun run governance` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/golden-baseline.mjs` — 全量端点黄金基线脚本（SQL-01）
- [ ] Golden baseline JSON snapshots — 50+ 端点返回值存档

*Existing `bun run snapshot:build` covers 9 bundles; SQL-01 requires full endpoint coverage.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 系数监控页面不可访问 | SQL-02 | 需要浏览器验证路由移除 | 访问 `/#/coefficient`，确认 404 或重定向 |
| 导航菜单无系数入口 | SQL-02 | 视觉验证 | 检查侧边栏导航，确认无"系数监控"菜单项 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
