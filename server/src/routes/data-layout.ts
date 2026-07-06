/**
 * Phase B B4 — web 上传链路的 current/ 布局解析（扁平 vs 省份子目录）
 *
 * 三个纯函数供 routes/data.ts 消费，规则与 B1（装载层发现）/B2（ETL 写侧）同一套：
 *   - 开关 = env `POLICY_CURRENT_SUBDIR_LAYOUT`（isPolicyCurrentSubdirLayout，默认 off
 *     = 扁平 current/，SC 逐字节安全）；on = 落 current/<部署省>/。
 *   - 省份判定 = getDeploymentBranchCode()（部署省单一来源，上传是部署实例级操作，
 *     禁止从登录用户推断省份）。
 *   - 子目录发现/GATED 闸 = 复用 DataBootstrapper.discoverInDir + enforceProvinceSubdirGate
 *     （B1 单一事实源），禁止在 data.ts 手写第二份 readdir / 闸逻辑。
 *
 * 本模块不 import duckdb 原生模块（仅 path + 纯 TS 配置/服务），可被 vitest 单测直接加载。
 *
 * ⚠️ 运维前置（cutover SOP）：开启 POLICY_CURRENT_SUBDIR_LAYOUT 前必须先把 current/ 顶层
 * 扁平 parquet 一次性迁入 current/<省>/，否则上传后的合并加载会命中 GATED「迁移态冲突」闸
 * 而失败（新上传文件被自动清理，服务不落脏数据）——与 B1 启动装载、B3 sync-vps 同一契约。
 * 另：本模块对非基准省码不做写入禁止（任意合法省码统一 current/<省>/），省份隔离由下游
 * enforceProvinceSubdirGate 在装载阶段 fail-closed 兜底（先写入、后拒载清理，非禁止写入）。
 */
import path from 'path';
import {
  getDeploymentBranchCode,
  isPolicyCurrentSubdirLayout,
} from '../config/sql-federation-policy.js';
import { DataBootstrapper } from '../services/data-bootstrapper.js';

/** 与 sql-federation-policy BRANCH_CODE_RE 同约束（CHAR(2) 大写）。 */
const BRANCH_CODE_RE = /^[A-Z]{2}$/;

/**
 * fail-closed 二次断言：getDeploymentBranchCode 已白名单校验 + 回退 'SC'，
 * 此处再验一遍防上游语义漂移导致路径拼接逃逸（省码用于 path.join，必须两位大写字母）。
 */
function resolveGuardedBranchCode(): string {
  const branch = getDeploymentBranchCode();
  if (!BRANCH_CODE_RE.test(branch)) {
    throw new Error(
      `[data-layout] 部署省码非法（须 ^[A-Z]{2}$），拒绝拼接 current/ 子目录：${JSON.stringify(branch)}`
    );
  }
  return branch;
}

/**
 * 上传落盘目录（multer destination）。
 * 开关 off（默认）→ 扁平 current/（与现状逐字节一致）；on → current/<部署省>/。
 */
export function resolveUploadTargetDir(
  currentDataSubdir: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (!isPolicyCurrentSubdirLayout(env)) return currentDataSubdir;
  return path.join(currentDataSubdir, resolveGuardedBranchCode());
}

/**
 * 数据管理路由（files / load / download / clear）的候选目录。
 * 开关 off（默认）→ [current/, DATA_DIR]（现状不变）；
 * on → 前插 current/<部署省>/ —— 只下钻部署省自身子目录，绝不枚举他省
 * （clear/download 等管理操作不得触碰非部署省数据，他省隔离由 GATED 闸守住）。
 */
export function resolveManagedParquetDirs(
  currentDataSubdir: string,
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const flat = [currentDataSubdir, dataDir];
  if (!isPolicyCurrentSubdirLayout(env)) return flat;
  return [path.join(currentDataSubdir, resolveGuardedBranchCode()), ...flat];
}

/**
 * 上传成功后的 current/ 全量合并加载候选（顶层扁平 + 省份子目录）。
 * 复用 B1 装载层发现（discoverInDir：顶层复刻现状谓词 + ^[A-Z]{2}$ readdir 枚举实际子目录）
 * 与 GATED 闸（扁平/子目录并存、非基准省 + RLS 关 → fail-closed 抛错，不静默混载）。
 * 今天扁平布局下无子目录 → 返回集合与旧 readdirSync().filter(endsWith('.parquet')) 逐字节等价。
 */
export function discoverCurrentParquetPaths(currentDataSubdir: string): string[] {
  const discovered = DataBootstrapper.discoverInDir(currentDataSubdir);
  const gated = DataBootstrapper.enforceProvinceSubdirGate(discovered);
  return gated.map((f) => f.path);
}
