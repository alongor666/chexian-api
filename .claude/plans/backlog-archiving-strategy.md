# BACKLOG 归档策略设计

## 问题诊断

**症状**：
- BACKLOG.md 已达 63KB（26000+ tokens）
- 87个DONE任务占据82.8%空间
- 文件过大导致Read工具无法一次性读取
- 查找活跃任务困难

**根因**：
- 缺乏自动化归档机制
- 所有历史任务堆积在单一文件
- 归档判定标准不明确

---

## 归档策略设计

### 1. 三层文件结构

```
BACKLOG.md              # 活跃任务（< 5000 tokens）
├─ PROPOSED              # 待评审
├─ IN_PROGRESS           # 进行中
├─ BLOCKED               # 阻塞中
└─ DONE（近7天）         # 最近完成（保留7天供快速查阅）

BACKLOG_ARCHIVE.md      # 历史归档（按月份分组）
├─ 2026年1月
├─ 2026年2月
└─ ...

BACKLOG_ARCHIVED_REPLACED.md  # 已被替代的任务
└─ 被后续任务优化/重构/废弃的任务
```

---

### 2. 归档判定规则

#### 立即归档（ARCHIVED）
```markdown
条件1：状态=DONE 且 完成时间 > 7天
条件2：状态=ARCHIVED（已标记为归档）
条件3：验收/证据列包含"已被BXXX优化/重构/替代"
```

#### 特殊归档（REPLACED）
```markdown
条件：验收/证据列包含关键词：
- "已被BXXX优化"
- "已被BXXX重构"
- "原始设计，后被BXXX优化"
示例：B023（已被B022优化为下钻式堆叠图）
```

#### 保留在BACKLOG
```markdown
条件1：状态 ∈ {PROPOSED, IN_PROGRESS, BLOCKED}
条件2：状态=DONE 且 完成时间 ≤ 7天
```

---

### 3. 归档脚本实现

**文件**：`scripts/archive-backlog.mjs`

**核心功能**：
1. 解析BACKLOG.md，识别可归档任务
2. 按月份分组归档到BACKLOG_ARCHIVE.md
3. 已替代任务单独归档到BACKLOG_ARCHIVED_REPLACED.md
4. 生成归档报告（任务数、token节省、归档月份）
5. 更新BACKLOG.md，仅保留活跃任务

**运行方式**：
```bash
# 手动触发归档（安全模式，先预览）
bun run scripts/archive-backlog.mjs --dry-run

# 正式归档
bun run scripts/archive-backlog.mjs

# 定期自动归档（集成到治理检查）
bun run scripts/check-governance.mjs --auto-archive
```

---

### 4. 归档文件格式

#### BACKLOG_ARCHIVE.md
```markdown
# 需求账本归档（历史记录）

**归档规则**：状态=DONE 且 完成时间 > 7天

---

## 2026年1月

| ID | 提出时间 | 板块 | 归属对象 | 需求描述 | 优先级 | 状态 | 关联文档 | 关联代码 | 验收/证据 | 归档时间 |
|----|----------|------|----------|----------|--------|------|----------|----------|-----------|----------|
| B001 | 2026-01-07 | ... | ... | ... | P0 | DONE | ... | ... | Commit `3538897` | 2026-01-15 |
| B002 | 2026-01-07 | ... | ... | ... | P1 | DONE | ... | ... | ... | 2026-01-15 |
...
```

#### BACKLOG_ARCHIVED_REPLACED.md
```markdown
# 已替代任务归档

**归档规则**：任务已被后续任务优化/重构/废弃

---

| ID | 提出时间 | 原需求描述 | 替代任务 | 替代原因 | 归档时间 |
|----|----------|-----------|---------|---------|----------|
| B023 | 2026-01-08 | 实现营业货车专项分析（双Y图） | B022 | 优化为下钻式堆叠图 | 2026-01-15 |
| B102 | 2026-01-13 | 续保总览/排名 | B103 | 重构为续保明细表格 | 2026-01-15 |
```

---

### 5. 治理校验集成

**扩展 `scripts/check-governance.mjs`**：

```javascript
// 第8项检查：BACKLOG 大小控制
const backlogSize = fs.statSync('BACKLOG.md').size / 1024;
if (backlogSize > 30) { // 30KB 阈值
  console.warn(`⚠️  BACKLOG.md 过大 (${backlogSize.toFixed(1)}KB)，建议运行归档脚本`);
  console.log(`   bun run scripts/archive-backlog.mjs`);
}
```

---

### 6. 自动化归档触发点

**方案A：手动触发**（推荐初期）
```bash
# 每周一次或BACKLOG超过50个DONE任务时手动运行
bun run scripts/archive-backlog.mjs
```

**方案B：自动触发**（长期目标）
```bash
# 集成到 check-governance.mjs
# 当检测到可归档任务>20个时，自动提示或执行
```

---

## 实施计划

### Phase 1：创建归档脚本（30分钟）
- [ ] 创建 `scripts/archive-backlog.mjs`
- [ ] 实现任务解析、分类、归档逻辑
- [ ] 支持 `--dry-run` 预览模式

### Phase 2：执行首次归档（10分钟）
- [ ] 运行 `--dry-run` 验证归档规则
- [ ] 正式归档，生成 BACKLOG_ARCHIVE.md
- [ ] 验证 BACKLOG.md 瘦身效果（目标：< 10KB）

### Phase 3：治理集成（10分钟）
- [ ] 扩展 check-governance.mjs 添加大小检查
- [ ] 更新 CLAUDE.md §3 添加归档协议
- [ ] 文档更新（DOC_INDEX.md）

---

## 预期效果

**归档前**：
- BACKLOG.md: 63KB, 105任务, 87个DONE
- 难以快速定位活跃任务

**归档后**：
- BACKLOG.md: < 10KB, ~20任务（15 PROPOSED + 5 近期DONE）
- BACKLOG_ARCHIVE.md: ~53KB, 82个历史任务
- BACKLOG_ARCHIVED_REPLACED.md: ~1KB, 2个替代任务

**效率提升**：
- ✅ BACKLOG.md 可一次性读取（<25000 tokens）
- ✅ 活跃任务一目了然
- ✅ 历史可追溯（按月份快速查找）
- ✅ 防止未来再次膨胀（自动化检查）

---

## 备注

**注意事项**：
1. 首次归档前备份 BACKLOG.md
2. 归档脚本必须通过单元测试（防止数据丢失）
3. ARCHIVED 状态的任务优先级最高归档
4. 保留"证据链"完整性（关联代码/文档/验收证据）

**后续优化**：
- [ ] 添加归档统计（按板块/归属对象分析生产力）
- [ ] 实现归档搜索（快速定位历史任务）
- [ ] 归档可视化（月度任务完成趋势图）
