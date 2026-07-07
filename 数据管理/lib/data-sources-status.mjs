/**
 * data-sources.json 契约 / 状态拆分 — 运行时状态读写层（纯函数 + 原子写）
 *
 * 背景（BACKLOG B314）：`数据管理/data-sources.json` 原本混装「契约」（域定义、字段、
 * 路由等入库信息）与「运行时状态」（row_count / last_updated / field_count / data_range，
 * 每次 ETL 都会变）。两者混放导致每日 ETL 必然改动这份入库文件，造成噪声 diff 且容易
 * 与契约变更混淆。本模块把状态字段拆到 `数据管理/data-sources-status.json`
 * （gitignored，ETL 自动生成/更新，首跑缺失时自动创建），契约文件保持纯粹。
 *
 * 合并语义：状态条目覆盖契约同名字段（`mergeDomainStatus`）。契约中 deprecated /
 * upstream_status 已停更域若仍保留旧的 row_count 等字段，可作为「冻结快照兜底」——
 * 状态文件没有该域记录时，展示的仍是契约里的旧值，而不是空白。
 *
 * 无副作用地读文件系统之外，本模块不做任何隐式全局状态；调用方显式传入状态文件路径。
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { dirname, join } from 'path';

/** 状态文件的标准文件名（同目录约定，调用方自行拼接绝对路径）。 */
export const STATUS_FILE_BASENAME = 'data-sources-status.json';

/** 状态文件缺失时的初始骨架（含说明注释，供人工打开时理解用途）。 */
function emptyStatusSkeleton() {
  return {
    _comment: '数据域运行时状态（ETL 自动生成，不入 git；缺失时首跑 ETL 自动创建）。契约见 data-sources.json。',
    domains: {},
  };
}

/**
 * 读取状态文件的 domains map。
 * 文件不存在或 JSON 损坏时返回 `{}`（损坏时打印警告，不抛异常——调用方按"无状态"降级处理）。
 *
 * @param {string} statusPath 状态文件绝对路径
 * @returns {Record<string, object>}
 */
export function readStatusDomains(statusPath) {
  if (!existsSync(statusPath)) return {};
  try {
    const raw = JSON.parse(readFileSync(statusPath, 'utf-8'));
    return raw?.domains && typeof raw.domains === 'object' ? raw.domains : {};
  } catch (e) {
    console.warn(`⚠️ 状态文件 JSON 损坏，按空状态处理: ${statusPath} (${e.message})`);
    return {};
  }
}

/**
 * 读-改-写单个域的状态条目（不可变更新：新条目 = { ...旧条目, ...patch }）。
 * patch 中值为 null/undefined 的键不写入（避免用"未传字段"意外抹掉旧值）。
 * 文件缺失时从空骨架起步；写入采用「同目录临时文件 + renameSync」原子替换，避免并发/中断写出半截文件。
 *
 * @param {string} statusPath 状态文件绝对路径
 * @param {string} domainId 域 id（对应契约 data-sources.json 的 domain.id）
 * @param {object} patch 待合并的字段（如 { last_updated, row_count, field_count, data_range }）
 * @returns {object} 写入后的该域状态条目
 */
export function writeStatusDomain(statusPath, domainId, patch = {}) {
  const current = existsSync(statusPath)
    ? (() => {
        try {
          const raw = JSON.parse(readFileSync(statusPath, 'utf-8'));
          return raw && typeof raw === 'object' ? raw : emptyStatusSkeleton();
        } catch {
          return emptyStatusSkeleton();
        }
      })()
    : emptyStatusSkeleton();

  const domains = current.domains && typeof current.domains === 'object' ? current.domains : {};
  const oldEntry = domains[domainId] || {};

  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== null && v !== undefined)
  );
  const newEntry = { ...oldEntry, ...cleanPatch };

  const next = {
    ...current,
    domains: { ...domains, [domainId]: newEntry },
  };

  const tmpPath = join(dirname(statusPath), `.${STATUS_FILE_BASENAME}.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmpPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, statusPath);

  return newEntry;
}

/**
 * 合并契约域定义与运行时状态条目，状态字段覆盖契约同名字段。
 * statusEntry 为空/undefined 时返回契约的浅拷贝（契约里若保留旧状态字段即"冻结快照兜底"）。
 *
 * @param {object} contractDomain 契约文件中的域定义（data-sources.json 的 domain 对象）
 * @param {object|undefined} statusEntry 状态文件中的对应条目
 * @returns {object} 合并后的视图（新对象，不修改入参）
 */
export function mergeDomainStatus(contractDomain, statusEntry) {
  if (!statusEntry) return { ...contractDomain };
  return { ...contractDomain, ...statusEntry };
}
