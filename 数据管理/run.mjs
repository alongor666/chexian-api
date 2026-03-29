#!/usr/bin/env node
/**
 * 数据管理中心 - 统一执行脚本（跨平台版本）
 * 用法: node run.mjs [command] [args...]
 * 
 * 命令:
 *   transform   Excel → Parquet 转换
 *   enrich      续保类型匹配增强
 *   full        完整流程（enrich + transform）
 *   help        显示帮助
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { platform } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function isWindows() {
  return platform() === 'win32';
}

function findPython() {
  const pythonCmds = isWindows() ? ['python', 'python3', 'py'] : ['python3', 'python'];
  
  for (const cmd of pythonCmds) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe' });
      return cmd;
    } catch (e) {}
  }
  throw new Error('未找到 Python，请确保已安装 Python 并添加到 PATH');
}

function printHeader(title) {
  console.log('');
  console.log(`${colors.blue}════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.blue}  数据管理中心 - ${title}${colors.reset}`);
  console.log(`${colors.blue}════════════════════════════════════════════════════════════${colors.reset}`);
  console.log('');
}

function printUsage() {
  console.log('用法: node run.mjs [command] [options]');
  console.log('');
  console.log('命令:');
  console.log('  transform   Excel → Parquet 转换');
  console.log('  enrich      续保类型匹配增强');
  console.log('  full        完整流程（enrich + transform）');
  console.log('  help        显示帮助');
  console.log('');
  console.log('示例:');
  console.log('  node run.mjs transform -i input.xlsx -o output.parquet');
  console.log('  node run.mjs enrich --source hist.xlsx --target new.xlsx --output matched.xlsx');
  console.log('  node run.mjs full --source 续保业务类型匹配更新至2026年4月.xlsx --target 每日数据_20231101_20260307.xlsx --output result.parquet');
  console.log('  node run.mjs full --target 每日数据_20231101_20260307.xlsx --output warehouse/fact/policy/current/每日数据_20231101_20260307.parquet');
  console.log('  node run.mjs full --source hist.xlsx --target new.xlsx --output result.parquet --no-sync');
}

function checkDeps(python) {
  log('yellow', '检查依赖...');
  try {
    execSync(`${python} -c "import pandas, openpyxl, yaml, pyarrow"`, { stdio: 'pipe' });
    log('green', '依赖检查完成');
  } catch (e) {
    log('yellow', '正在安装依赖...');
    try {
      execSync(`${python} -m pip install pandas openpyxl pyyaml pyarrow --user -q`, { stdio: 'inherit' });
    } catch (e2) {
      execSync(`${python} -m pip install pandas openpyxl pyyaml pyarrow -q`, { stdio: 'inherit' });
    }
    log('green', '依赖安装完成');
  }
}

function ensureDirs(scriptDir) {
  const dirs = [
    'warehouse/fact/policy',
    'warehouse/fact/renewal',
    'staging',
    'logs',
    '数据分析报告'
  ];
  for (const d of dirs) {
    const fullPath = join(scriptDir, d);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
    }
  }
}

function parseArgs(args) {
  const result = {
    source: null,
    target: null,
    output: null,
    noSync: false,
    input: null,
    mode: 'full'
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--source':
      case '-s':
        result.source = args[++i];
        break;
      case '--target':
      case '-t':
        result.target = args[++i];
        break;
      case '--input':
      case '-i':
        result.input = args[++i];
        break;
      case '--output':
      case '-o':
        result.output = args[++i];
        break;
      case '--mode':
      case '-m':
        result.mode = args[++i];
        break;
      case '--no-sync':
        result.noSync = true;
        break;
    }
  }
  return result;
}

function runPython(python, script, args) {
  const cmd = `${python} "${script}" ${args.join(' ')}`;
  log('blue', `执行: ${cmd}`);
  
  // Windows 下设置 UTF-8 编码，解决 emoji 显示问题
  const env = { ...process.env };
  if (isWindows()) {
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';
  }
  
  execSync(cmd, { stdio: 'inherit', cwd: __dirname, env });
}

async function main() {
  const scriptDir = __dirname;
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  
  const python = findPython();
  const enrichScript = join(scriptDir, 'pipelines/enrich.py');
  const transformScript = join(scriptDir, 'pipelines/transform.py');
  
  switch (command) {
    case 'transform': {
      printHeader('Excel → Parquet 转换');
      checkDeps(python);
      ensureDirs(scriptDir);
      
      const opts = parseArgs(args.slice(1));
      if (!opts.input || !opts.output) {
        log('red', '错误: 需要 -i/--input 和 -o/--output 参数');
        process.exit(1);
      }
      
      const transformArgs = [`-i "${opts.input}"`, `-o "${opts.output}"`];
      if (opts.mode) transformArgs.push(`-m ${opts.mode}`);
      
      runPython(python, transformScript, transformArgs);
      break;
    }
    
    case 'enrich': {
      printHeader('续保类型匹配增强');
      checkDeps(python);
      ensureDirs(scriptDir);
      
      const opts = parseArgs(args.slice(1));
      if (!opts.source || !opts.target || !opts.output) {
        log('red', '错误: 需要 --source, --target, --output 参数');
        process.exit(1);
      }
      
      runPython(python, enrichScript, [
        `--source "${opts.source}"`,
        `--target "${opts.target}"`,
        `--output "${opts.output}"`
      ]);
      break;
    }
    
    case 'full': {
      printHeader('完整数据处理流程');
      checkDeps(python);
      ensureDirs(scriptDir);
      
      const opts = parseArgs(args.slice(1));
      if (!opts.target && opts.input) {
        opts.target = opts.input;
      }

      if (!opts.target) {
        log('red', '错误: 完整流程至少需要 --target 或 --input 参数');
        process.exit(1);
      }

      if (!opts.output) {
        const rangeMatch = basename(opts.target).match(/每日数据_(\d{8})[_-](\d{8})/);
        if (rangeMatch) {
          opts.output = join(scriptDir, 'warehouse/fact/policy/current', `每日数据_${rangeMatch[1]}_${rangeMatch[2]}.parquet`);
        } else {
          const dateMatch = basename(opts.target).match(/(\d{8})/g);
          const fileDate = dateMatch && dateMatch.length > 0
            ? dateMatch[dateMatch.length - 1]
            : new Date().toISOString().slice(0, 10).replace(/-/g, '');
          opts.output = join(scriptDir, 'warehouse/fact/policy/current', `每日数据_${fileDate}.parquet`);
        }
      }
      
      if (opts.source) {
        log('blue', '步骤 1/1: 续保匹配 + 转换为 Parquet（单次读取）');
        runPython(python, transformScript, [
          `-i "${opts.target}"`,
          `-o "${opts.output}"`,
          `-r "${opts.source}"`,
          '-m full'
        ]);
      } else {
        log('blue', '步骤 1/1: 单文件直转 Parquet（跳过续保匹配）');
        runPython(python, transformScript, [
          `-i "${opts.target}"`,
          `-o "${opts.output}"`,
          '-m full'
        ]);
      }
      
      console.log('');
      log('green', `✅ 完整流程执行完成！`);
      console.log(`输出文件: ${opts.output}`);
      
      // 同步到 VPS
      if (!opts.noSync && !isWindows()) {
        const syncScript = join(dirname(scriptDir), 'scripts/sync-vps.mjs');
        if (existsSync(syncScript)) {
          console.log('');
          log('blue', '步骤 3/3: 同步 Parquet 到 VPS');
          execSync(`bash "${syncScript}" "${opts.output}"`, { stdio: 'inherit' });
        } else {
          log('yellow', '⚠ 未找到 sync-data.sh，跳过 VPS 同步');
          console.log(`  手动同步: ./scripts/sync-vps.mjs ${opts.output}`);
        }
      } else if (opts.noSync) {
        log('yellow', '已跳过 VPS 同步（--no-sync）');
      } else {
        log('yellow', 'Windows 环境跳过 VPS 同步');
      }
      break;
    }
    
    case 'help':
    case '--help':
    case '-h':
      printHeader('帮助');
      printUsage();
      break;
      
    default:
      log('red', `未知命令: ${command}`);
      printUsage();
      process.exit(1);
  }
  
  console.log('');
  log('green', '════════════════════════════════════════════════════════════');
  log('green', '  处理完成!');
  log('green', '════════════════════════════════════════════════════════════');
}

main().catch(err => {
  log('red', `❌ 错误: ${err.message}`);
  console.error(err);
  process.exit(1);
});
