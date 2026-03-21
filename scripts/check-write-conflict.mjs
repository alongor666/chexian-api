#!/usr/bin/env bun
/**
 * PR前冲突检测工具
 *
 * 功能：
 * 1. 检查当前分支是否基于最新main
 * 2. 检查BACKLOG.md是否有追加冲突
 * 3. 检查索引文件是否跨区写入
 * 4. 检查任务ID是否在分配范围内
 * 5. 检查是否修改了禁止修改的文件
 *
 * 使用：
 * bun run scripts/check-write-conflict.mjs
 *
 * 退出码：
 * 0 - 无冲突
 * 1 - 发现冲突
 *
 * @author @claude
 * @version 1.0.0
 * @date 2026-01-11
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

// 任务ID范围定义
const TASK_ID_RANGES = {
  '@user': { min: 1, max: 99 },
  '@claude': { min: 100, max: 199 },
  '@codex': { min: 200, max: 299 },
  '@gemini': { min: 300, max: 399 },
};

// 禁止修改的文件（CLAUDE.md § 2）
const PROTECTED_FILES = [
  'src/shared/normalize/mapping.ts',
  'src/shared/sql/kpi.ts',
  'src/shared/duckdb/client.ts',
];

// 核心协议文件（只有@user可以修改）
const CORE_PROTOCOL_FILES = ['CLAUDE.md'];

let hasErrors = false;
let hasWarnings = false;

/**
 * 执行git命令
 */
function git(command) {
  try {
    return execSync(`git ${command}`, { encoding: 'utf-8' }).trim();
  } catch (error) {
    return null;
  }
}

/**
 * 检查1：当前分支是否基于最新main
 */
function checkBranchBase() {
  console.log('📍 检查1：分支基准检查...');

  // 获取远程main的最新提交
  const remoteMain = git('rev-parse origin/main');
  if (!remoteMain) {
    console.error('  ❌ 无法获取origin/main的提交哈希');
    hasErrors = true;
    return;
  }

  // 获取当前分支的merge-base
  const mergeBase = git(`merge-base HEAD origin/main`);
  if (!mergeBase) {
    console.error('  ❌ 无法获取merge-base');
    hasErrors = true;
    return;
  }

  if (mergeBase !== remoteMain) {
    console.error(`  ❌ 当前分支未基于最新main`);
    console.error(`     - 最新main: ${remoteMain.slice(0, 7)}`);
    console.error(`     - 分支基准: ${mergeBase.slice(0, 7)}`);
    console.error(`     - 解决方法: git fetch origin main && git rebase origin/main`);
    hasErrors = true;
  } else {
    console.log(`  ✅ 分支基于最新main (${remoteMain.slice(0, 7)})`);
  }
}

/**
 * 检查2：BACKLOG.md是否有追加冲突
 */
function checkBacklogConflict() {
  console.log('\n📍 检查2：BACKLOG.md冲突检查...');

  // 检查BACKLOG.md是否被修改
  const changedFiles = git('diff --name-only origin/main...HEAD');
  if (!changedFiles || !changedFiles.includes('BACKLOG.md')) {
    console.log('  ✅ BACKLOG.md未修改，跳过冲突检查');
    return;
  }

  // 读取当前分支和main的BACKLOG.md
  const currentBacklog = readFileSync('BACKLOG.md', 'utf-8');
  const mainBacklog = git('show origin/main:BACKLOG.md');

  if (!mainBacklog) {
    console.warn('  ⚠️  无法获取main分支的BACKLOG.md');
    hasWarnings = true;
    return;
  }

  // 解析任务ID
  const currentTasks = parseBacklogTaskIds(currentBacklog);
  const mainTasks = parseBacklogTaskIds(mainBacklog);

  // 检查是否有新增任务
  const newTasks = currentTasks.filter((id) => !mainTasks.includes(id));
  if (newTasks.length > 0) {
    console.log(`  ℹ️  新增任务：${newTasks.join(', ')}`);

    // 检查是否存在潜在冲突（main也新增了任务）
    const mainNewTasks = mainTasks.filter((id) => {
      const idNum = parseInt(id.slice(1));
      // 检查是否在当前分支的新任务范围内
      const currentMaxId = Math.max(...currentTasks.map((t) => parseInt(t.slice(1))));
      return idNum > currentMaxId - newTasks.length;
    });

    if (mainNewTasks.length > 0) {
      console.warn('  ⚠️  检测到潜在冲突：main分支也新增了任务');
      console.warn(`     - Main新增: ${mainNewTasks.join(', ')}`);
      console.warn(`     - 建议使用: bun run scripts/merge-backlog.mjs`);
      hasWarnings = true;
    }
  }

  console.log('  ✅ BACKLOG.md冲突检查完成');
}

/**
 * 解析BACKLOG.md中的任务ID
 */
function parseBacklogTaskIds(content) {
  const ids = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^\|\s*(B\d+)\s*\|/);
    if (match) {
      ids.push(match[1]);
    }
  }

  return ids;
}

/**
 * 检查3：任务ID是否在分配范围内（仅检查新增任务）
 */
function checkTaskIdRange() {
  console.log('\n📍 检查3：任务ID范围检查...');

  if (!existsSync('BACKLOG.md')) {
    console.log('  ✅ BACKLOG.md不存在，跳过检查');
    return;
  }

  // 检查BACKLOG.md是否被修改
  const changedFiles = git('diff --name-only origin/main...HEAD');
  if (!changedFiles || !changedFiles.includes('BACKLOG.md')) {
    console.log('  ✅ BACKLOG.md未修改，跳过检查');
    return;
  }

  // 获取当前分支和main分支的BACKLOG.md
  const currentBacklog = readFileSync('BACKLOG.md', 'utf-8');
  const mainBacklog = git('show origin/main:BACKLOG.md');

  if (!mainBacklog) {
    console.warn('  ⚠️  无法获取main分支的BACKLOG.md');
    hasWarnings = true;
    return;
  }

  // 解析两边的任务ID
  const currentTasks = parseBacklogTaskIds(currentBacklog);
  const mainTasks = parseBacklogTaskIds(mainBacklog);

  // 找出新增的任务ID
  const newTaskIds = currentTasks.filter((id) => !mainTasks.includes(id));

  if (newTaskIds.length === 0) {
    console.log('  ✅ 无新增任务，跳过ID范围检查');
    return;
  }

  console.log(`  ℹ️  检测到新增任务：${newTaskIds.join(', ')}`);

  // 获取新增任务的完整行
  const violations = [];
  const lines = currentBacklog.split('\n');

  for (const line of lines) {
    const match = line.match(/^\|\s*(B\d+)\s*\|.*?\|\s*(@\w+)\s*\|/);
    if (match) {
      const [, taskId, agent] = match;
      // 只检查新增的任务
      if (newTaskIds.includes(taskId)) {
        const taskNum = parseInt(taskId.slice(1));
        const range = TASK_ID_RANGES[agent];

        if (range && (taskNum < range.min || taskNum > range.max)) {
          violations.push({ taskId, agent, taskNum, range });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('  ❌ 发现任务ID范围违规：');
    for (const v of violations) {
      console.error(
        `     - ${v.taskId} (归属${v.agent}) 超出范围 [B${v.range.min.toString().padStart(3, '0')}-B${v.range.max.toString().padStart(3, '0')}]`
      );
    }
    hasErrors = true;
  } else {
    console.log('  ✅ 新增任务ID在分配范围内');
  }
}

/**
 * 检查4：是否修改了禁止修改的文件
 */
function checkProtectedFiles() {
  console.log('\n📍 检查4：禁止修改文件检查...');

  const changedFiles = git('diff --name-only origin/main...HEAD');
  if (!changedFiles) {
    console.log('  ✅ 无文件修改');
    return;
  }

  const modifiedProtected = PROTECTED_FILES.filter((file) => changedFiles.includes(file));

  if (modifiedProtected.length > 0) {
    console.warn('  ⚠️  修改了受保护的文件（需要证据和BACKLOG登记）：');
    for (const file of modifiedProtected) {
      console.warn(`     - ${file}`);
    }
    console.warn('     - 参考: CLAUDE.md § 2 护栏规则');
    hasWarnings = true;
  } else {
    console.log('  ✅ 未修改受保护的文件');
  }

  // 检查是否修改了核心协议文件
  const modifiedCore = CORE_PROTOCOL_FILES.filter((file) => changedFiles.includes(file));

  if (modifiedCore.length > 0) {
    console.error('  ❌ 修改了核心协议文件（仅@user可修改）：');
    for (const file of modifiedCore) {
      // 检查是否只是追加到特定section
      const diff = git(`diff origin/main...HEAD -- ${file}`);
      if (diff && diff.includes('§ 9')) {
        console.warn(`     - ${file} (修改了§9章节)`);
        hasWarnings = true;
      } else {
        console.error(`     - ${file}`);
        hasErrors = true;
      }
    }
  }
}

/**
 * 检查5：索引文件分区写入
 */
function checkIndexFileSections() {
  console.log('\n📍 检查5：索引文件分区检查...');

  const indexFiles = [
    '开发文档/00_index/DOC_INDEX.md',
    '开发文档/00_index/CODE_INDEX.md',
    '开发文档/00_index/PROGRESS_INDEX.md',
  ];

  const changedFiles = git('diff --name-only origin/main...HEAD');
  if (!changedFiles) {
    console.log('  ✅ 无文件修改');
    return;
  }

  const modifiedIndexes = indexFiles.filter((file) => changedFiles.includes(file));

  if (modifiedIndexes.length > 0) {
    console.warn('  ⚠️  修改了索引文件：');
    for (const file of modifiedIndexes) {
      console.warn(`     - ${file}`);

      // 检查是否有分区标记
      if (existsSync(file)) {
        const content = readFileSync(file, 'utf-8');
        const hasSection = content.includes('<!-- @claude-section-start -->');

        if (!hasSection) {
          console.warn(`       ⚠️  未找到分区标记，建议添加`);
          hasWarnings = true;
        }
      }
    }
    console.warn('     - 参考: CLAUDE.md § 9.3 索引文件分区写入');
  } else {
    console.log('  ✅ 索引文件未修改');
  }
}

/**
 * 主函数
 */
function main() {
  console.log('🔍 PR前冲突检测工具 v1.0.0');
  console.log('━'.repeat(50));

  // 检查是否在git仓库中
  const isGitRepo = git('rev-parse --git-dir');
  if (!isGitRepo) {
    console.error('❌ 当前目录不是git仓库');
    process.exit(1);
  }

  // 检查当前分支
  const currentBranch = git('rev-parse --abbrev-ref HEAD');
  if (currentBranch === 'main') {
    console.log('ℹ️  当前在main分支，跳过检查');
    process.exit(0);
  }

  console.log(`ℹ️  当前分支: ${currentBranch}\n`);

  // 执行所有检查
  checkBranchBase();
  checkBacklogConflict();
  checkTaskIdRange();
  checkProtectedFiles();
  checkIndexFileSections();

  // 输出结果
  console.log('\n' + '━'.repeat(50));
  if (hasErrors) {
    console.error('❌ 检测到错误，请修复后再创建PR');
    process.exit(1);
  } else if (hasWarnings) {
    console.warn('⚠️  检测到警告，建议处理后再创建PR');
    process.exit(0); // 警告不阻塞
  } else {
    console.log('✅ 所有检查通过，可以创建PR');
    process.exit(0);
  }
}

main();
