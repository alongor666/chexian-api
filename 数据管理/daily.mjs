#!/usr/bin/env node
/**
 * 每日一键 ETL：跨平台版本（Windows/macOS/Linux）
 * 
 * 源文件命名规范：
 *   续保业务类型匹配更新至YYYY年M月.xlsx
 *   每日数据_20231101_YYYYMMDD.xlsx
 * 
 * 输出目录结构：
 *   warehouse/fact/policy/current/   ← 服务器只加载此目录（单个活跃文件）
 *   warehouse/fact/policy/archive/   ← 旧文件归档，不加载
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readdirSync, statSync, renameSync, mkdirSync, unlinkSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { platform, homedir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 颜色定义
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function getScriptDir() {
  return __dirname;
}

function isWindows() {
  return platform() === 'win32';
}

function findPython() {
  // Windows 优先使用 python，其他系统使用 python3
  const pythonCmds = isWindows() ? ['python', 'python3', 'py'] : ['python3', 'python'];

  for (const cmd of pythonCmds) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe' });
      return cmd;
    } catch (e) {
      // 尝试下一个
    }
  }
  throw new Error('未找到 Python，请确保已安装 Python 并添加到 PATH');
}

function ls(pattern, dir = '.') {
  const absDir = resolve(dir);
  if (!existsSync(absDir)) return [];

  const files = readdirSync(absDir);
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');

  return files
    .filter(f => regex.test(f))
    .map(f => ({ name: f, path: join(absDir, f) }))
    .sort((a, b) => b.name.localeCompare(a.name)); // 降序，取最新的
}

function extractDate(filename) {
  const match = filename.match(/(\d{8})/);
  return match ? match[1] : null;
}

function formatDate() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function archiveOld(currentDir, archiveDir, prefix, newFile) {
  if (!existsSync(currentDir)) return;

  const files = readdirSync(currentDir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.parquet') && f !== basename(newFile));

  for (const old of files) {
    const oldPath = join(currentDir, old);
    const baseName = old.replace('.parquet', '');
    const archivedName = `${baseName}_${formatDate()}.parquet`;
    const archivePath = join(archiveDir, archivedName);

    ensureDir(archiveDir);
    renameSync(oldPath, archivePath);
    log('yellow', `📦 归档: ${old} → ${archivePath}`);
  }

  // 清理 15 天前的旧归档，防止项目外目录膨胀
  if (!existsSync(archiveDir)) return;
  const cutoff = Date.now() - 15 * 24 * 60 * 60 * 1000;
  const stale = readdirSync(archiveDir)
    .filter(f => f.endsWith('.parquet') && statSync(join(archiveDir, f)).mtimeMs < cutoff);
  for (const f of stale) {
    unlinkSync(join(archiveDir, f));
    log('yellow', `🗑  清理过期归档: ${f}`);
  }
}

function runPythonScript(python, scriptPath, args) {
  const cmd = `"${python}" "${scriptPath}" ${args.join(' ')}`;
  log('blue', `执行: ${cmd}`);

  // Windows 下设置 UTF-8 编码，解决 emoji 显示问题
  const env = { ...process.env };
  if (isWindows()) {
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';
  }

  execSync(cmd, {
    stdio: 'inherit',
    cwd: getScriptDir(),
    env
  });
}

function checkVpsConnectivity() {
  try {
    execSync('ssh -o BatchMode=yes -o ConnectTimeout=10 chexian-vps-deploy true', { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

// 从文件名提取日期范围，如 "每日数据_20231201-20241231.xlsx" → { start: "20231201", end: "20241231" }
function extractDateRange(filename) {
  const m = filename.match(/每日数据_(\d{8})-(\d{8})/);
  return m ? { start: m[1], end: m[2] } : null;
}

// 历史文件判断：结束日期固定为 20241231（2024年保单已全部满期）
function isHistoricalFile(filename) {
  return /每日数据_\d{8}-20241231\.xlsx$/i.test(filename);
}

// 缓存是否过期：xlsx 比缓存 parquet 更新时返回 true
function isCacheStale(xlsxPath, cachePath) {
  if (!existsSync(cachePath)) return true;
  return statSync(xlsxPath).mtimeMs > statSync(cachePath).mtimeMs;
}

async function main() {
  const scriptDir = getScriptDir();
  process.chdir(scriptDir);

  const currentDir = join(scriptDir, 'warehouse/fact/policy/current');
  // 归档目录放在项目外，避免 git 仓库膨胀
  const archiveDir = join(homedir(), 'chexian-archive');
  const cacheDir  = join(scriptDir, 'warehouse/fact/policy/cache');
  const tmpDir    = join(scriptDir, 'warehouse/fact/policy/tmp');

  ensureDir(currentDir);
  ensureDir(archiveDir);
  ensureDir(cacheDir);
  ensureDir(tmpDir);

  // 0. 迁移旧格式文件
  const policyDir = join(scriptDir, 'warehouse/fact/policy');
  if (existsSync(policyDir)) {
    const oldFiles = readdirSync(policyDir)
      .filter(f => f.startsWith('车险保单综合明细表') && f.endsWith('.parquet'));

    if (oldFiles.length > 0) {
      log('yellow', '📦 发现旧格式文件，迁移到 archive/');
      for (const f of oldFiles) {
        const src = join(policyDir, f);
        const dst = join(archiveDir, f);
        renameSync(src, dst);
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
  const source = sourceFiles.length > 0 ? sourceFiles[0].path : null;
  if (source) {
    log('green', `续保源文件: ${basename(source)}`);
  } else {
    log('yellow', '⚠ 未找到续保源文件，将跳过续保业务类型匹配');
  }

  // 2. 识别历史文件 vs 当前文件
  const allPolicyFiles = ls('每日数据_*.xlsx', scriptDir);
  const histFile    = allPolicyFiles.find(f => isHistoricalFile(f.name)) || null;
  const currentFile = allPolicyFiles.find(f => !isHistoricalFile(f.name)) || null;

  if (!currentFile) {
    log('red', '❌ 未找到当前数据文件（每日数据_YYYYMMDD-YYYYMMDD.xlsx，结束日期≠20241231）');
    process.exit(1);
  }

  const currentRange = extractDateRange(currentFile.name);
  const histRange    = histFile ? extractDateRange(histFile.name) : null;

  // 输出文件名：历史起始日（若有）+ 当前结束日
  const outputStart  = histRange ? histRange.start : currentRange.start;
  const outputEnd    = currentRange.end;
  const outputName   = `每日数据_${outputStart}-${outputEnd}.parquet`;
  const finalOutput  = join(currentDir, outputName);

  if (histFile) {
    log('green', `历史数据: ${histFile.name}`);
  } else {
    log('yellow', '⚠ 未找到历史数据文件（每日数据_YYYYMMDD-20241231.xlsx），仅处理当前文件');
  }
  log('green', `当前数据: ${currentFile.name}`);
  log('green', `输出文件: ${outputName}`);
  console.log('');

  // 3. 归档旧 current/ 中的同前缀文件（保留最新输出）
  archiveOld(currentDir, archiveDir, '每日数据', finalOutput);
  // 同时归档历史数据_ 前缀文件（合并后不再需要，避免 DuckDB 重复计入）
  archiveOld(currentDir, archiveDir, '历史数据', finalOutput);
  console.log('');

  // 找 Python
  const python = findPython();
  log('green', `使用 Python: ${python}`);
  const transformScript = join(scriptDir, 'pipelines/transform.py');
  const mergeScript     = join(scriptDir, 'pipelines/merge_parquet.py');

  // === Stage A: 历史缓存（仅在 xlsx 更新时重建）===
  let histCachePath = null;
  if (histFile && histRange) {
    const histCacheFile = `每日数据_${histRange.start}-${histRange.end}.parquet`;
    histCachePath = join(cacheDir, histCacheFile);

    if (isCacheStale(histFile.path, histCachePath)) {
      log('green', `▶ Stage A: 历史缓存过期，重建 → ${histCacheFile}`);
      runPythonScript(python, transformScript, [
        '-i', `"${histFile.path}"`,
        '-o', `"${histCachePath}"`
        // 无 -r：历史年度无续保类型匹配数据
      ]);
    } else {
      log('green', `▶ Stage A: 历史缓存命中，跳过重建 → ${histCacheFile}`);
    }
    console.log('');
  }

  // === Stage B: 当前数据转换（每日必跑）===
  const needMerge     = !!(histFile && histCachePath);
  const currentTmpPath = needMerge
    ? join(tmpDir, `current_tmp_${formatDate()}.parquet`)
    : finalOutput;

  if (source) {
    log('green', '▶ Stage B: 续保匹配 + 转换当前数据 → Parquet');
  } else {
    log('green', '▶ Stage B: 转换当前数据 → Parquet（跳过续保匹配）');
  }
  const transformArgs = ['-i', `"${currentFile.path}"`, '-o', `"${currentTmpPath}"`];
  if (source) transformArgs.push('-r', `"${source}"`);
  runPythonScript(python, transformScript, transformArgs);
  console.log('');

  // === Stage C: 合并（仅在双文件模式下）===
  if (needMerge) {
    log('green', `▶ Stage C: 合并历史缓存 + 当前数据 → ${outputName}`);
    runPythonScript(python, mergeScript, [
      `"${histCachePath}"`, `"${currentTmpPath}"`, `"${finalOutput}"`
    ]);
    try { unlinkSync(currentTmpPath); } catch (_) {}
    console.log('');
  }

  console.log('');

  // 5. 运行本地预聚合 (export-for-vps.mjs)
  // 确保在上传之前在本地计算好所有聚合数据，防止 VPS 资源爆炸及数据不一致
  log('green', '▶ 步骤 2: 运行预聚合数据导出...');
  const projectRoot = dirname(scriptDir);
  const exportScript = join(projectRoot, 'scripts/export-for-vps.mjs');
  if (existsSync(exportScript)) {
    execSync(`node "${exportScript}"`, { stdio: 'inherit', cwd: projectRoot });
  } else {
    log('yellow', '⚠ 未找到 scripts/export-for-vps.mjs，跳过预聚合导出');
  }

  console.log('');

  // 6. 同步 current/ 下所有基础明细 parquet 以及 vps-export/ 下的预聚合 parquet 到 VPS
  if (!isWindows()) {
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
      log('yellow', '⚠ 未找到 sync-data.sh，请手动同步');
      for (const f of allFiles) {
        console.log(`  ./scripts/sync-vps.mjs ${f}`);
      }
    }
  } else {
    const syncScript = join(projectRoot, 'scripts/sync-vps.mjs');
    const vpsExportDir = join(scriptDir, 'warehouse/vps-export');

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

    log('green', `📦 Windows 开始同步 ${allFiles.length} 个文件到 VPS`);
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
        console.log(`  ${f}`);
      }
    }
  }

  console.log('');
  log('green', '✅ ETL 流程完成！');
}

main().catch(err => {
  log('red', `❌ 错误: ${err.message}`);
  console.error(err);
  process.exit(1);
});
