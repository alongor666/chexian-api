## 变更摘要

<!-- 用 1-3 条说明本 PR 做了什么 -->
-

## 变更类型

- [ ] feat（新功能）
- [ ] fix（Bug 修复）
- [ ] refactor（重构，无功能变化）
- [ ] chore/docs（工具、文档、配置）
- [ ] perf（性能优化）

## 体量检查

- [ ] 本 PR 变更行数 ≤ 800 LOC，**或**已在下方说明大体量原因
- [ ] 工具/文档批量导入与业务逻辑变更已拆分为独立 PR（若适用）

<!-- 大体量原因（超过 800 行时必填，否则 governance 会报 WARNING）: -->

## 测试计划

- [ ] `bun run governance` 通过
- [ ] `bun run build` 零 TS 报错
- [ ] 相关 API 端点已用 `curl` 验证返回 200 + 非空数据
- [ ] （若涉及 SQL 变更）`bun run test tests/performance-sql.test.ts` 通过

## 验收证据

<!-- PR 链接 / Commit 哈希 / curl 输出截图 / 测试报告（至少一项） -->
