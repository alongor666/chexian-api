/**
 * 上传上限对齐闸（安全审计 1200d2·2026-07-03 L1）
 *
 * 单文件上传大小上限所有落点必须一致：
 *   env.ts dbEnv.MAX_UPLOAD_SIZE_MB（默认值，唯一事实源）
 *   ↔ multer（data.ts MAX_FILE_SIZE 须从 env 派生字节数，禁止硬编码）
 *   ↔ nginx client_max_body_size（静态模板不读 Node env，须手工对齐）
 *   ↔ 前端预校验 fileHelpers.ts MAX_IMPORT_SIZE（客户端 bundle 无法读 env，须镜像对齐）
 *   ↔ 安全清单文档 chexian-security-review.md（≤NMB）
 *
 * 生产有效上限由 nginx 先于 Express 拒绝决定；任一处漂移 = 配置/文档相互欺骗 → 逐落点校验防回归。
 * 诚实边界：闸只校验各落点源码默认，不覆盖部署期 MAX_UPLOAD_SIZE_MB 运行时 env 覆盖（nginx 静态
 * 模板无法读 env，若 ops 单改 env 不改模板会静默分叉，属已知不可自动覆盖的残余风险）。
 *
 * 从 check-governance.mjs 单体抽出（H5 行数棘轮），依赖以 { rootDir, io } 注入。
 */

import fs from 'fs';
import path from 'path';

export function checkUploadSizeLimitConsistency({ rootDir, io }) {
  const { info, success, error } = io;
  info('检查上传上限对齐（env.ts / multer / nginx / 前端预校验 / 安全清单文档）...');
  const problems = [];

  // 1. env.ts 默认值（唯一事实源）
  const envSrc = fs.readFileSync(path.join(rootDir, 'server/src/config/env.ts'), 'utf-8');
  const envMatch = envSrc.match(/MAX_UPLOAD_SIZE_MB'\s*,\s*process\.env\.MAX_UPLOAD_SIZE_MB\s*,\s*(\d+)\s*\)/);
  if (!envMatch) {
    error('env.ts 未找到 MAX_UPLOAD_SIZE_MB 默认值（parsePositiveInt(..., <数字>)）— 唯一事实源缺失');
    return false;
  }
  const envMB = parseInt(envMatch[1], 10);

  // 2. multer（data.ts）必须从 env 派生 MB→字节，禁止硬编码上限。
  //    放宽匹配：只要 MAX_FILE_SIZE 语句引用 dbEnv.MAX_UPLOAD_SIZE_MB 且含两次 1024 换算即可，
  //    不锁定乘法因子顺序（无害重排/加括号不误报），但仍要求真做了 ×1024×1024 字节换算。
  const dataSrc = fs.readFileSync(path.join(rootDir, 'server/src/routes/data.ts'), 'utf-8');
  const multerStmt = dataSrc.match(/MAX_FILE_SIZE:[^;\n]*/);
  const multerOk = multerStmt
    && multerStmt[0].includes('dbEnv.MAX_UPLOAD_SIZE_MB')
    && (multerStmt[0].match(/1024/g) || []).length >= 2;
  if (!multerOk) {
    problems.push('data.ts MAX_FILE_SIZE 未从 dbEnv.MAX_UPLOAD_SIZE_MB 派生（须 × 1024 × 1024，禁硬编码上限）');
  }

  // 3. nginx client_max_body_size
  const nginxSrc = fs.readFileSync(path.join(rootDir, 'deploy/nginx-fullstack.conf'), 'utf-8');
  const nginxMatch = nginxSrc.match(/client_max_body_size\s+(\d+)M\s*;/);
  if (!nginxMatch) {
    problems.push('nginx-fullstack.conf 未找到 client_max_body_size <N>M 声明');
  } else if (parseInt(nginxMatch[1], 10) !== envMB) {
    problems.push(`nginx client_max_body_size ${nginxMatch[1]}M ≠ env 默认 ${envMB}MB（生产有效上限漂移）`);
  }

  // 4. 前端预校验镜像常量（fileHelpers.ts MAX_IMPORT_SIZE）——比后端紧会让合规文件被浏览器提前拦下
  const feSrc = fs.readFileSync(path.join(rootDir, 'src/features/file/utils/fileHelpers.ts'), 'utf-8');
  const feMatch = feSrc.match(/MAX_IMPORT_SIZE\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
  if (!feMatch) {
    problems.push('fileHelpers.ts 未找到 MAX_IMPORT_SIZE = <N> * 1024 * 1024 前端上限');
  } else if (parseInt(feMatch[1], 10) !== envMB) {
    problems.push(`前端 MAX_IMPORT_SIZE ${feMatch[1]}MB ≠ env 默认 ${envMB}MB（前端预校验比后端紧 → 合规文件被浏览器提前拦下）`);
  }

  // 5. 安全清单文档（锚定「文件上传安全」行，避免误匹配文件内其它无关 ≤NNMB）
  const docSrc = fs.readFileSync(path.join(rootDir, '.claude/commands/chexian-security-review.md'), 'utf-8');
  const docLine = docSrc.split('\n').find((l) => l.includes('文件上传安全'));
  const docMatch = docLine ? docLine.match(/≤\s*(\d+)\s*MB/) : null;
  if (!docMatch) {
    problems.push('chexian-security-review.md「文件上传安全」行未找到 ≤<N>MB 上限声明');
  } else if (parseInt(docMatch[1], 10) !== envMB) {
    problems.push(`安全清单文档 ≤${docMatch[1]}MB ≠ env 默认 ${envMB}MB`);
  }

  if (problems.length > 0) {
    error('上传上限多处不对齐（安全审计 1200d2 防回归）：');
    for (const p of problems) console.log(`    - ${p}`);
    console.log('    修复：以 server/src/config/env.ts dbEnv.MAX_UPLOAD_SIZE_MB 为准，同步 multer 派生 / nginx / 前端 MAX_IMPORT_SIZE / 安全清单文档');
    return false;
  }
  success(`上传上限对齐（${envMB}MB：env.ts 默认 / multer 派生 / nginx / 前端预校验 / 安全清单文档一致）`);
  return true;
}
