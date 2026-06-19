---
paths: ["deploy/**", ".github/workflows/deploy.yml", "scripts/sync-vps.mjs", "ecosystem.config.cjs"]
---

# 部署链 SOP（RED LINE）

> 来源：PR #379 Phase 1-pre 部署链改造实施过程中沉淀的三条规则。
> 适用：任何改动 `deploy/`、`.github/workflows/deploy.yml`、`scripts/sync-vps.mjs` 的 PR。

## 1. Wrapper 源/runtime 同步（B294 已实施：CI 自动）

**历史背景（B292/B293 已修复）**：
- 仓库源码：`deploy/vps-wrapper/deploy-chexian-api.sh`
- VPS runtime：`/usr/local/bin/deploy-chexian-api`（受限 sudoers 路径，由 root 安装）
- 历史问题：改 wrapper 源文件 + PR merge **曾经不会**自动同步到 VPS runtime（PR #379 之前都靠手工 root sync，长期漂移到 25 行旧版）。

**现状（B294 之后）**：
- `deploy/vps-wrapper/deploy-chexian-api.sh` 已加入 deploy bundle
- VPS wrapper 含 `self-update` 子命令：从 `/var/www/chexian/server/.wrapper-source/deploy-chexian-api.sh` 自我替换（cmp 检测无变化时 skip）
- `.github/workflows/deploy.yml` 在 `install` 之前调 `sudo /usr/local/bin/deploy-chexian-api self-update`
- 任何 wrapper 源文件改动随 PR merge → CI 自动同步 → 5 分钟内 VPS runtime 更新到位
- sudoers 不变：self-update 仍属同一 wrapper 的子命令，沿用现有 `deployer ALL=(root) NOPASSWD: /usr/local/bin/deploy-chexian-api`

**Bootstrap（仅首次需要）**：
- B294 PR 合并时，VPS wrapper 已经手工预装含 self-update 的版本（B293 SSH sync 已铺到位）
- 之后所有 wrapper 改动 PR 都不需要任何手工操作

**降级策略**：
- 若 self-update 失败（旧 wrapper 不识别子命令 / 源损坏被 `bash -n` 拒绝）：`|| true` 让 deploy 继续，旧 wrapper 保持工作（无半升级风险）
- 真正坏的 wrapper 改动会在后续 install/reload 失败时被 trap rollback 链路抓出（覆盖完整 5 对象还原）

**禁止**：
- ❌ 手工 sudo cp wrapper 到 VPS（破坏 CI 单一来源原则，导致 main 与 VPS 漂移再现）
- ❌ deploy.yml 跳过 self-update 步骤（即使认为 wrapper 无改动，cmp 检测会自动 skip 不增成本）

## 2. 部署链 PR 不可 auto-merge（RED LINE）

**事实**：
- `deploy.yml` push 到 main 即触发生产部署
- 改 deploy.yml 的 PR 把"部署链本身"也改了，没有"上一版正常的 deploy.yml"作对照（CI 用的就是 main 的最新版）

**后果**：
- 一旦 deploy.yml 自身有 bug，自我恢复路径都跟着坏掉
- 没人盯监控时段 merge，故障窗口可能数小时

**正确做法**：
- **禁止** 用 `gh pr merge --auto` 或类似 auto-merge 工具合并部署链 PR
- 必须满足：
  1. 人工选监控窗口（业务低峰）
  2. 人工执行 merge
  3. merge 后**立刻**盯 GitHub Actions run + 健康检查（前 5 分钟不离开）
  4. 同 PR 还改 wrapper 源文件的，merge 后立刻按 §1 同步 wrapper

**适用范围**：
- `.github/workflows/deploy.yml`
- `deploy/vps-wrapper/**`
- `scripts/sync-vps.mjs`
- `ecosystem.config.cjs`
- 任何被 deploy.yml 直接调用的脚本

## 3. codex review 不要轮询（成本控制）

**事实**：
- codex review 是异步的，PR 提交后几分钟到几十分钟才出结果
- `gh pr view` 循环既费 token 又无进展

**正确做法**：
- 用 `ScheduleWakeup` 一次性约 20–30 分钟后回来检查（cache 已凉，但只回来一次）
- 或等用户主动通知（"codex 评了，看一下"）
- **禁止**：`while true; do gh pr view ...; sleep 60; done` 类轮询

**信号判断**：
- `gh pr view <num> --json reviews` 返回 `reviews` 非空 → codex 已评
- `gh pr checks <num>` 看 codex check 状态

## 4. 部署清单（CLAUDE.md §9 下沉）

声称"已部署"前，按顺序逐项验证：

1. `bun run build` — 零 TS 报错
2. `bun run governance` — 治理通过
3. PM2 状态检查 — `sudo /usr/local/bin/deploy-chexian-api describe`，若 errored 则 `sudo /usr/local/bin/deploy-chexian-api reload`（禁止只 restart）
4. 环境变量 — 确认 `ecosystem.config.cjs` 中所有 env 变量在 VPS 上有值
5. CORS 配置 — 确认不会因 env 缺失抛异常
6. DuckDB/Parquet 兼容 — `union_by_name` schema 一致性
7. 健康检查 — `curl -s https://chexian.cretvalu.com/health` 返回 200
8. 核心 API — 至少一个 `/api/query/*` 返回 200 + 非空 JSON

## 关联

- 母 PR：[#379 feat(deploy): Phase 1-pre 部署链 lockfile-driven 完整回滚](https://github.com/alongor666/chexian-api/pull/379)
- 计划：[`/Users/alongor666/.claude/plans/vps-json-keen-clock.md`](../../) 中 Phase 1-pre 章节
- AGENTS.md §8.2 append-only：本文件作为新增护栏文件，无需 `[policy-override]` 授权
