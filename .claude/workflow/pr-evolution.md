# PR 工作流进化日志

> 每次 PR 失败（CI 不过、merge 冲突、governance 拦截），在此记录根因和修复措施。
> `/chexian-commit-push-pr` 执行前必读此文件，将已记录的失败模式纳入前置检查。

---

## 格式

```markdown
### YYYY-MM-DD — PR #N: 一句话描述
- **症状**: CI/merge 具体报错
- **根因**: 为什么现有检查没拦住
- **修复**: 本次怎么修的
- **预防**: 加入了什么新检查（写到 /chexian-commit-push-pr 的哪一步）
```

---

## 失败记录

### 2026-04-11 — 直接推 main（无 PR）
- **症状**: `git push origin main` 绕过分支+PR 流程
- **根因**: AI 手动执行 git push，没有调用 `/chexian-commit-push-pr`；无 hook 拦截
- **修复**: 手动推送后补建了 PR
- **预防**: 新增 PreToolUse hook，拦截在 main 分支上的 `git push`（exit 2 阻断）

### 2026-04-11 — CI 监控 API 不可用
- **症状**: `gh pr checks` 返回 403 `Resource not accessible by personal access token`
- **根因**: Token 缺 `checks:read`；步骤 6 写了 `gh pr checks --watch` 但未验证能否执行
- **修复**: 改用 `gh api .../actions/runs`（已验证可用）
- **预防**: 步骤 6 改为 actions/runs API；标注"禁止用 `gh pr checks`"

### 2026-04-11 — 服务端依赖遗漏（两次 commit）
- **症状**: pre-commit tsc 报错 `getPatrolReportPaths` 不存在；query.ts 未注册路由
- **根因**: 改前端没完整梳理后端依赖链（paths.ts / query.ts / api-routes.ts）
- **修复**: 补建第二个 commit
- **预防**: `/chexian-commit-push-pr` 步骤 1 新增「依赖链完整性检查」——修改前端 API 调用时，必须 grep 确认后端路由、paths、api-routes 三处均已注册
