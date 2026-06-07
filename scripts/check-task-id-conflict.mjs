#!/usr/bin/env bun
/**
 * 任务 ID 校验脚本（全局连续编号模型）
 *
 * 编号模型（2026-06 治理后）：BACKLOG 任务 ID 改为**全局连续递增**，由
 * `assign-task-id.mjs` 取 `BACKLOG.md + BACKLOG_ARCHIVE.md` 的全局 max+1 派生，
 * 永不复用历史编号（含已归档的）。归属对象（@user/@claude/...）只用于标注调用方，
 * **不再绑定 ID 区间**——故本脚本不做"归属对象 vs ID 区间"匹配检查。
 *
 * 校验项：
 *  1. 格式合规：标准 ID 形如 `B\d{3,}`；非标准 ID（如 B256-update）告警提示规范化
 *  2. 全局唯一：跨 BACKLOG.md + BACKLOG_ARCHIVE.md 同一编号不得重复出现（编号禁止复用）
 *  3. 范围合规：编号落在 B001-B999（超过须先扩位，见 assign-task-id.mjs）
 *  4. 输出全局最大编号 + 下一个建议编号（与 assign-task-id.mjs 同源口径）
 *
 * 使用方法：
 *   bun run scripts/check-task-id-conflict.mjs
 */

import { readFileSync, existsSync } from 'fs';

const SOURCES = ['./BACKLOG.md', './BACKLOG_ARCHIVE.md'];
const MAX_ID = 999;

/** 提取行首任务 ID（兼容 B256-update 这类非标准 ID） */
function rowId(line) {
  const m = line.match(/^\|\s*(B[\w-]+)\s*\|/);
  return m ? m[1] : null;
}

/** 标准 ID → 数字；非标准（含后缀）返回 null */
function toNum(id) {
  const m = id.match(/^B(\d{3,})$/);
  return m ? parseInt(m[1], 10) : null;
}

function checkTaskIds() {
  const errors = [];
  const warnings = [];
  const seen = new Map(); // 规范化数字 ID -> 首次出现位置 "文件:行"
  const ownerStats = new Map(); // owner -> 数量
  let maxNum = 0;
  let total = 0;

  for (const path of SOURCES) {
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, 'utf-8').split('\n');
    let inTable = false;
    let sepPassed = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const t = line.trim();
      if (t.startsWith('| ID |')) { inTable = true; sepPassed = false; continue; }
      if (inTable && !sepPassed && t.startsWith('|---')) { sepPassed = true; continue; }
      if (!inTable || !sepPassed) continue;
      const id = rowId(line);
      if (!id) continue;
      total++;
      const loc = `${path}:${i + 1}`;

      const cells = line.split('|').map(c => c.trim());
      const owner = cells[4] || '?'; // 第4列归属对象（cells[0] 为前导空串）
      ownerStats.set(owner, (ownerStats.get(owner) || 0) + 1);

      const num = toNum(id);
      if (num === null) {
        warnings.push(`⚠️  非标准 ID ${id}（${loc}）— 建议用 assign-task-id.mjs 规范化为 B\\d{3,}`);
        continue;
      }
      if (num < 1 || num > MAX_ID) {
        errors.push(`❌ ID ${id}（${loc}）超出范围 B001-B${MAX_ID}`);
      }
      if (seen.has(num)) {
        errors.push(`❌ 编号复用/重复：${id}（${loc}）已在 ${seen.get(num)} 出现 — 编号禁止复用`);
      } else {
        seen.set(num, loc);
      }
      if (num > maxNum) maxNum = num;
    }
  }

  const nextId = `B${String(Math.min(maxNum + 1, MAX_ID)).padStart(3, '0')}`;

  console.log('🔍 任务 ID 校验报告（全局连续编号模型）\n');
  console.log(`📊 共扫描 ${total} 个任务（BACKLOG.md + BACKLOG_ARCHIVE.md）`);
  console.log(`📈 全局最大编号 B${String(maxNum).padStart(3, '0')} → 下一个建议编号 ${nextId}`);
  console.log(`   （实际取号请用：bun scripts/assign-task-id.mjs @<agent>）\n`);

  if (warnings.length) {
    console.log('⚠️  告警：');
    warnings.forEach(w => console.log(`   ${w}`));
    console.log('');
  }
  if (errors.length) {
    console.log('❌ 发现错误：');
    errors.forEach(e => console.log(`   ${e}`));
    console.log('');
  }

  console.log('📋 归属对象分布（仅统计，不参与校验）：');
  [...ownerStats.entries()].sort((a, b) => b[1] - a[1]).forEach(([o, n]) =>
    console.log(`   ${o.padEnd(14)} ${n} 项`));
  console.log('');

  if (errors.length) {
    console.log('❌ 检查失败：存在编号重复/复用或超范围');
    process.exit(1);
  }
  console.log('✅ 检查通过：全局编号唯一、连续、未复用');
  process.exit(0);
}

try {
  checkTaskIds();
} catch (error) {
  console.error('❌ 脚本执行失败：', error.message);
  process.exit(1);
}
