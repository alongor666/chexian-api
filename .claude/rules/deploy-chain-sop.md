# 部署链 SOP（RED LINE）

> 来源：PR #379 Phase 1-pre 部署链改造实施过程中沉淀的三条规则。
> 适用：任何改动 `deploy/`、`.github/workflows/deploy.yml`、`scripts/sync-vps.mjs` 的 PR。

## 1. Wrapper 源文件 vs runtime 二分（CRITICAL）

**事实**：
- 仓库源码：`deploy/vps-wrapper/deploy-chexian-api.sh`
- VPS runtime：`/usr/local/bin/deploy-chexian-api`（受限 sudoers 路径，由 root 安装）

**后果**：
- 改 wrapper 源文件 + PR merge **不会**自动同步到 VPS runtime
- CI 部署链 ssh 调用的是 VPS 上的旧 wrapper（旧的 `npm install` 行为、旧的子命令集）
- 表现是"PR 合并了但改造只生效一半"

**正确做法**：
1. wrapper 源文件变更的 PR 合并后，**第一件事**由 root 手工执行：
   ```bash
   ssh root@vps
   sudo cp /var/www/chexian/.../deploy-chexian-api.sh /usr/local/bin/deploy-chexian-api
   sudo chmod 755 /usr/local/bin/deploy-chexian-api
   sudo /usr/local/bin/deploy-chexian-api doctor   # 验证新子命令上线
   ```
2. 同步完成后再触发新部署，让新 CI deploy.yml 与新 wrapper 配合验证
3. 监控窗口必须覆盖 wrapper 同步 + 后续一次 deploy 的全程

**兜底建议（未实施）**：
- deploy.yml 可加 wrapper diff 检测步骤：对比 `deploy/vps-wrapper/deploy-chexian-api.sh` 与 VPS 上 `/usr/local/bin/deploy-chexian-api` 的 hash，不一致就在 CI 输出**警告**（不自动 sudo cp，避免提权）

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

## 关联

- 母 PR：[#379 feat(deploy): Phase 1-pre 部署链 lockfile-driven 完整回滚](https://github.com/alongor666/chexian-api/pull/379)
- 计划：[`/Users/alongor666/.claude/plans/vps-json-keen-clock.md`](../../) 中 Phase 1-pre 章节
- AGENTS.md §8.2 append-only：本文件作为新增护栏文件，无需 `[policy-override]` 授权
