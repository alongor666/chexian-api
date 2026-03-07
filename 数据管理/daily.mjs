#!/usr/bin/env node
/**
 * 每日一键 ETL：跨平台版本（Windows/macOS/Linux）
 * 
 * 源文件命名规范：
 *   续保类型匹配至*.xlsx            ← --source（续保匹配库）
 *   车险2024年清单更新至YYYYMMDD.xlsx  ← 历史数据（2023-11 ~ 2024-12）
 *   车险2526年清单更新至YYYYMMDD.xlsx  ← 每日数据（2025-01 ~ 今）
 * 
 * 输出目录结构：
 *   warehouse/fact/policy/current/   ← 服务器只加载此目录（≤2 个活跃文件）
 *   warehouse/fact/policy/archive/   ← 旧文件归档，不加载
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readdirSync, statSync, renameSync, mkdirSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { platform } from 'os';
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
    log('yellow', `📦 归档: ${old} → archive/${archivedName}`);
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

async function main() {
  const scriptDir = getScriptDir();
  process.chdir(scriptDir);

  const currentDir = join(scriptDir, 'warehouse/fact/policy/current');
  const archiveDir = join(scriptDir, 'warehouse/fact/policy/archive');

  ensureDir(currentDir);
  ensureDir(archiveDir);

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

  // 1. 找续保源文件
  const sourceFiles = ls('续保类型匹配*.xlsx', scriptDir);
  if (sourceFiles.length === 0) {
    log('red', '❌ 未找到续保源文件: 续保类型匹配*.xlsx');
    process.exit(1);
  }
  const source = sourceFiles[0].path;
  log('green', `续保源文件: ${basename(source)}`);

  // 2. 找历史清单文件
  const histFiles = ls('车险2024年清单更新至*.xlsx', scriptDir);
  let histOutput = null;
  if (histFiles.length > 0) {
    histOutput = join(currentDir, '历史数据_20231101_20241231.parquet');
    log('green', `历史清单: ${histFiles[0].name} → 历史数据_20231101_20241231.parquet`);
  } else {
    log('yellow', '⚠ 未找到历史清单（车险2024年清单更新至*.xlsx），跳过历史文件生成');
  }

  // 3. 找每日清单文件
  const dailyFiles = ls('车险2526年清单更新至*.xlsx', scriptDir);
  if (dailyFiles.length === 0) {
    log('red', '❌ 未找到每日清单（车险2526年清单更新至*.xlsx）');
    process.exit(1);
  }
  const dailyXlsx = dailyFiles[0];
  const dailyDate = extractDate(dailyXlsx.name);
  const dailyOutput = join(currentDir, `每日数据_20250101_${dailyDate}.parquet`);
  log('green', `每日清单: ${dailyXlsx.name} → 每日数据_20250101_${dailyDate}.parquet`);

  console.log('');

  // 4. 归档旧文件
  if (histOutput) archiveOld(currentDir, archiveDir, '历史数据', histOutput);
  archiveOld(currentDir, archiveDir, '每日数据', dailyOutput);

  console.log('');

  // 找 Python
  const python = findPython();
  log('green', `使用 Python: ${python}`);

  const enrichScript = join(scriptDir, 'pipelines/enrich.py');
  const transformScript = join(scriptDir, 'pipelines/transform.py');

  // 5. 执行历史文件转换
  if (histOutput && histFiles.length > 0) {
    log('green', '▶ 步骤 1/2: 历史数据转换');
    const stagingHist = join(scriptDir, `staging/${histFiles[0].name.replace('.xlsx', '_已匹配.xlsx')}`);

    runPythonScript(python, enrichScript, [
      '--source', `"${source}"`,
      '--target', `"${histFiles[0].path}"`,
      '--output', `"${stagingHist}"`
    ]);

    runPythonScript(python, transformScript, [
      '-i', `"${stagingHist}"`,
      '-o', `"${histOutput}"`
    ]);

    console.log('');
  }

  // 6. 执行每日文件转换
  log('green', '▶ 步骤 2/2: 每日数据转换');
  const stagingDaily = join(scriptDir, `staging/${dailyXlsx.name.replace('.xlsx', '_已匹配.xlsx')}`);

  runPythonScript(python, enrichScript, [
    '--source', `"${source}"`,
    '--target', `"${dailyXlsx.path}"`,
    '--output', `"${stagingDaily}"`
  ]);

  runPythonScript(python, transformScript, [
    '-i', `"${stagingDaily}"`,
    '-o', `"${dailyOutput}"`
  ]);

  console.log('');

  // 7. 运行本地预聚合 (export-for-vps.mjs)
  // 确保在上传之前在本地计算好所有聚合数据，防止 VPS 资源爆炸及数据不一致
  log('green', '▶ 步骤 3: 运行预聚合数据导出...');
  const projectRoot = dirname(scriptDir);
  const exportScript = join(projectRoot, 'scripts/export-for-vps.mjs');
  if (existsSync(exportScript)) {
    execSync(`node "${exportScript}"`, { stdio: 'inherit', cwd: projectRoot });
  } else {
    log('yellow', '⚠ 未找到 scripts/export-for-vps.mjs，跳过预聚合导出');
  }

  console.log('');

  // 8. 同步 current/ 下所有基础明细 parquet 以及 vps-export/ 下的预聚合 parquet 到 VPS
  if (!isWindows()) {
    const syncScript = join(projectRoot, 'deploy/sync-data.sh');
    const vpsExportDir = join(scriptDir, 'warehouse/vps-export');

    // 收集全量明细数据
    const currentFiles = readdirSync(currentDir)
      .filter(f => f.endsWith('.parquet'))
      .map(f => join(currentDir, f));

    // 收集预聚合数据
    const exportFiles = existsSync(vpsExportDir)
      ? readdirSync(vpsExportDir)
        .filter(f => f.endsWith('.parquet'))
        .map(f => join(vpsExportDir, f))
      : [];

    const allFiles = [...currentFiles, ...exportFiles];

    log('green', `📦 同步 ${allFiles.length} 个文件到 VPS`);
    for (const f of allFiles) {
      console.log(`   ${basename(f)}`);
    }
    console.log('');

    if (existsSync(syncScript)) {
      for (let i = 0; i < allFiles.length; i++) {
        const cleanFlag = i === 0 ? '--clean-vps' : '';
        const restartFlag = i < allFiles.length - 1 ? '--no-restart' : '';

        execSync(`bash "${syncScript}" "${allFiles[i]}" ${cleanFlag} ${restartFlag}`, {
          stdio: 'inherit'
        });
      }
      console.log('');
      log('green', '✅ 全部同步完成，服务器已重启并仅加载了最新的文件');
    } else {
      log('yellow', '⚠ 未找到 sync-data.sh，请手动同步');
      for (const f of allFiles) {
        console.log(`  ./deploy/sync-data.sh ${f}`);
      }
    }
  } else {
    console.log('');
    log('yellow', '⚠ Windows 环境不支持自动同步到 VPS，请手动同步以下文件:');
    const parquetFiles = readdirSync(currentDir).filter(f => f.endsWith('.parquet'));
    for (const f of parquetFiles) {
      console.log(`  ${join(currentDir, f)}`);
    }
    console.log('');
    log('blue', '提示: 在 macOS/Linux 上运行此脚本可自动同步到 VPS');
  }

  console.log('');
  log('green', '✅ ETL 流程完成！');
}

main().catch(err => {
  log('red', `❌ 错误: ${err.message}`);
  console.error(err);
  process.exit(1);
});
