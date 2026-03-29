#!/usr/bin/env node
/**
 * 主 ETL 脚本：3层分片架构（cold/warm/hot）
 *
 * 分片类型（由 shard-config.json 配置边界）：
 *   static  — 签单日期 <= static_cutoff，已满期1年+，永不重新转换
 *   weekly  — 签单日期 >= weekly_start，每周日重新转换
 *   daily   — 日增量小文件，转到 staging/（不进 current/）
 *
 * 输出目录结构：
 *   warehouse/fact/policy/current/   ← DuckDB 加载（4个文件）
 *   warehouse/fact/policy/staging/   ← 日增量暂存（周更时清空）
 *
 * 用法：
 *   node daily.mjs           # 自动处理所有分片
 *   node daily.mjs --no-sync # 跳过 VPS 同步
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync, renameSync, mkdirSync, unlinkSync, readFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { platform, homedir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── 颜色与日志 ──

const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// ── 工具函数 ──

function isWindows() {
  return platform() === 'win32';
}

function findPython() {
  const pythonCmds = isWindows() ? ['python', 'python3', 'py'] : ['python3', 'python'];
  for (const cmd of pythonCmds) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe' });
      return cmd;
    } catch (e) { /* next */ }
  }
  throw new Error('未找到 Python，请确保已安装 Python 并添加到 PATH');
}

function ls(pattern, dir = '.') {
  const absDir = resolve(dir);
  if (!existsSync(absDir)) return [];
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  return readdirSync(absDir)
    .filter(f => regex.test(f))
    .map(f => ({ name: f, path: join(absDir, f) }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function formatDate() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function runPythonScript(python, scriptPath, args) {
  const cmd = `"${python}" "${scriptPath}" ${args.join(' ')}`;
  log('blue', `执行: ${cmd}`);
  const env = { ...process.env };
  if (isWindows()) {
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';
  }
  execSync(cmd, { stdio: 'inherit', cwd: __dirname, env });
}

function checkVpsConnectivity() {
  try {
    execSync('ssh -o BatchMode=yes -o ConnectTimeout=10 chexian-vps-deploy true', { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

// ── 分片逻辑 ──

/** 从文件名提取日期范围，支持下划线和连字符 */
function extractDateRange(filename) {
  const m = filename.match(/每日数据_(\d{8})[_-](\d{8})/);
  return m ? { start: m[1], end: m[2] } : null;
}

/** 判断分片类型 */
function getShardType(filename, config) {
  const range = extractDateRange(filename);
  if (!range) return null;

  const cutoff = parseInt(config.static_cutoff.replace(/-/g, ''));
  const weeklyStart = config.weekly_start.replace(/-/g, '');

  if (parseInt(range.end) <= cutoff) return 'static';
  if (range.start === weeklyStart) return 'weekly';
  return 'daily';
}

/** xlsx 比 parquet 更新时返回 true */
function isCacheStale(xlsxPath, parquetPath) {
  if (!existsSync(parquetPath)) return true;
  return statSync(xlsxPath).mtimeMs > statSync(parquetPath).mtimeMs;
}

/** 清空 staging 目录中的 parquet 文件 */
function cleanStaging(stagingDir) {
  if (!existsSync(stagingDir)) return;
  const files = readdirSync(stagingDir).filter(f => f.endsWith('.parquet'));
  for (const f of files) {
    unlinkSync(join(stagingDir, f));
    log('yellow', `🗑  清理 staging: ${f}`);
  }
}

// ── 主流程 ──

async function main() {
  const scriptDir = __dirname;
  process.chdir(scriptDir);

  const noSync = process.argv.includes('--no-sync');

  // 路径定义
  const currentDir = join(scriptDir, 'warehouse/fact/policy/current');
  const stagingDir = join(scriptDir, 'warehouse/fact/policy/staging');
  const archiveDir = join(homedir(), 'chexian-archive');

  ensureDir(currentDir);
  ensureDir(stagingDir);
  ensureDir(archiveDir);

  // 读取分片配置
  const configPath = join(scriptDir, 'shard-config.json');
  if (!existsSync(configPath)) {
    log('red', '❌ 未找到 shard-config.json');
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  log('green', `分片配置: static_cutoff=${config.static_cutoff}, weekly_start=${config.weekly_start}`);

  // 0. 迁移旧格式文件
  const policyDir = join(scriptDir, 'warehouse/fact/policy');
  if (existsSync(policyDir)) {
    const oldFiles = readdirSync(policyDir)
      .filter(f => f.startsWith('车险保单综合明细表') && f.endsWith('.parquet'));
    if (oldFiles.length > 0) {
      log('yellow', '📦 发现旧格式文件，迁移到 archive/');
      for (const f of oldFiles) {
        renameSync(join(policyDir, f), join(archiveDir, f));
        console.log(`   → ${f}`);
      }
    }
  }

  const old2426Files = readdirSync(currentDir)
    .filter(f => f.startsWith('车险24-26年清单_') && f.endsWith('.parquet'));
  if (old2426Files.length > 0) {
    log('yellow', '📦 发现旧命名格式文件，迁移到 archive/');
    for (const f of old2426Files) {
      renameSync(join(currentDir, f), join(archiveDir, f));
      console.log(`   → ${f}`);
    }
  }

  // 1. 找续保源文件
  const sourceFiles = [
    ...ls('续保业务类型匹配*.xlsx', scriptDir),
    ...ls('续保类型匹配*.xlsx', scriptDir)
  ].sort((a, b) => b.name.localeCompare(a.name));
  const renewalSource = sourceFiles.length > 0 ? sourceFiles[0].path : null;
  if (renewalSource) {
    log('green', `续保源文件: ${basename(renewalSource)}`);
  } else {
    log('yellow', '⚠ 未找到续保源文件，将跳过续保业务类型匹配');
  }

  // 2. 识别所有 xlsx 分片
  const allXlsx = ls('每日数据_*.xlsx', scriptDir);
  if (allXlsx.length === 0) {
    log('red', '❌ 未找到任何 每日数据_*.xlsx 文件');
    process.exit(1);
  }

  const shards = { static: [], weekly: [], daily: [] };
  for (const file of allXlsx) {
    const type = getShardType(file.name, config);
    if (!type) {
      log('yellow', `⚠ 无法识别分片类型: ${file.name}`);
      continue;
    }
    shards[type].push(file);
  }

  console.log('');
  log('green', '╔══════════════════════════════════════════╗');
  log('green', '║  3层分片 ETL                              ║');
  log('green', '╚══════════════════════════════════════════╝');
  console.log('');
  log('cyan', `  静态分片: ${shards.static.length} 个`);
  log('cyan', `  周更分片: ${shards.weekly.length} 个`);
  log('cyan', `  日增量:   ${shards.daily.length} 个`);
  console.log('');

  const python = findPython();
  log('green', `使用 Python: ${python}`);
  const transformScript = join(scriptDir, 'pipelines/transform.py');

  // 3. 处理静态分片（存在就跳过）
  for (const file of shards.static) {
    const range = extractDateRange(file.name);
    const outputName = `每日数据_${range.start}_${range.end}.parquet`;
    const outputPath = join(currentDir, outputName);

    if (existsSync(outputPath)) {
      log('green', `✓ 静态分片已存在，跳过: ${outputName}`);
      continue;
    }

    log('green', `▶ 转换静态分片: ${file.name} → ${outputName}`);
    runPythonScript(python, transformScript, [
      '-i', `"${file.path}"`,
      '-o', `"${outputPath}"`
    ]);
  }

  // 4. 处理周更分片（每次重新转换）
  for (const file of shards.weekly) {
    const range = extractDateRange(file.name);
    const outputName = `每日数据_${range.start}_${range.end}.parquet`;
    const outputPath = join(currentDir, outputName);

    // 归档旧的周更 parquet（不同结束日期的）
    const weeklyStart = config.weekly_start.replace(/-/g, '');
    const existingWeekly = readdirSync(currentDir)
      .filter(f => f.endsWith('.parquet') && f !== outputName && extractDateRange(f)?.start === weeklyStart);
    for (const old of existingWeekly) {
      const archivedName = `${old.replace('.parquet', '')}_${formatDate()}.parquet`;
      renameSync(join(currentDir, old), join(archiveDir, archivedName));
      log('yellow', `📦 归档旧周更: ${old} → ${archivedName}`);
    }

    log('green', `▶ 转换周更分片: ${file.name} → ${outputName}`);
    const args = ['-i', `"${file.path}"`, '-o', `"${outputPath}"`];

    // 续保匹配只应用于周更分片
    if (renewalSource && config.renewal_apply_to === 'weekly') {
      args.push('-r', `"${renewalSource}"`);
      log('green', `  续保匹配: ${basename(renewalSource)}`);
    }

    runPythonScript(python, transformScript, args);

    // 清空 staging（日增量已合入周更 xlsx）
    cleanStaging(stagingDir);
  }

  // 5. 处理日增量（转到 staging/）
  for (const file of shards.daily) {
    const range = extractDateRange(file.name);
    const outputName = `每日数据_${range.start}_${range.end}.parquet`;
    const outputPath = join(stagingDir, outputName);

    if (!isCacheStale(file.path, outputPath)) {
      log('green', `✓ 日增量缓存命中: ${outputName}`);
      continue;
    }

    log('green', `▶ 转换日增量: ${file.name} → staging/${outputName}`);
    runPythonScript(python, transformScript, [
      '-i', `"${file.path}"`,
      '-o', `"${outputPath}"`
    ]);
  }

  console.log('');

  // 6. 预聚合（TODO: 重建 scripts/export-for-vps.mjs 后启用）
  const projectRoot = dirname(scriptDir);

  console.log('');

  // 7. VPS 同步
  if (noSync) {
    log('yellow', '已跳过 VPS 同步（--no-sync）');
  } else if (!isWindows() || true) {
    const syncScript = join(projectRoot, 'scripts/sync-vps.mjs');
    const vpsExportDir = join(scriptDir, 'warehouse/vps-export');

    if (!checkVpsConnectivity()) {
      log('red', '❌ 无法连接 VPS（chexian-vps-deploy），终止同步');
      console.log('建议先执行：bash scripts/setup-local-env.sh');
      console.log('验证命令：ssh chexian-vps-deploy echo ok');
      process.exit(1);
    }

    const currentFiles = readdirSync(currentDir)
      .filter(f => f.endsWith('.parquet'))
      .map(f => join(currentDir, f));

    const exportFiles = existsSync(vpsExportDir)
      ? readdirSync(vpsExportDir)
        .filter(f => f.endsWith('.parquet'))
        .map(f => join(vpsExportDir, f))
      : [];

    const allFiles = [...currentFiles, ...exportFiles];

    if (allFiles.length === 0) {
      log('red', '❌ 未找到可同步的 Parquet 文件，终止同步');
      process.exit(1);
    }

    log('green', `📦 同步 ${allFiles.length} 个文件到 VPS`);
    for (const f of allFiles) {
      console.log(`   ${basename(f)}`);
    }
    console.log('');

    if (existsSync(syncScript)) {
      for (let i = 0; i < allFiles.length; i++) {
        const cleanFlag = i === 0 ? '' : '--keep-old';
        const restartFlag = i < allFiles.length - 1 ? '--no-restart' : '';

        execSync(`node "${syncScript}" "${allFiles[i]}" ${cleanFlag} ${restartFlag}`, {
          stdio: 'inherit',
          env: { ...process.env, RUN_MAIN: '1' }
        });
      }
      console.log('');
      log('green', '✅ 全部同步完成，服务器已重启并仅加载了最新的文件');
    } else {
      log('yellow', '⚠ 未找到 scripts/sync-vps.mjs，请手动同步');
      for (const f of allFiles) {
        console.log(`  ./scripts/sync-vps.mjs ${f}`);
      }
    }
  }

  console.log('');
  log('green', '✅ ETL 流程完成！');

  // 提示可清理的旧文件
  const staleXlsx = allXlsx.filter(f => {
    const type = getShardType(f.name, config);
    if (type !== 'static' && type !== 'weekly' && type !== 'daily') return true;
    // 检查是否有更新版本（同 start 日期、更新的 end 日期）
    const range = extractDateRange(f.name);
    if (!range) return false;
    return allXlsx.some(other => {
      const otherRange = extractDateRange(other.name);
      return otherRange && otherRange.start === range.start && otherRange.end > range.end;
    });
  });
  if (staleXlsx.length > 0) {
    console.log('');
    log('yellow', '以下旧 xlsx 文件可以安全归档:');
    for (const f of staleXlsx) {
      log('yellow', `  mv "${f.path}" ~/chexian-archive/`);
    }
  }
}

main().catch(err => {
  log('red', `❌ 错误: ${err.message}`);
  console.error(err);
  process.exit(1);
});
