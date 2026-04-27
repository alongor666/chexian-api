/**
 * Skill 运行记录持久化 — 阶段 1
 *
 * 落盘到 server/data/runtime/skill-runs/{runId}.json
 * MVP 阶段不做并发锁，个人版概率极低。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDataDir } from '../config/paths.js';
import type { SkillRunRecord } from './types.js';

const RUNTIME_SUBDIR = 'runtime/skill-runs';

/** runId 安全字符白名单：与 generateRunId 输出格式严格匹配 */
const RUN_ID_PATTERN = /^sr_\d{14}_[a-z0-9-]{1,64}_[0-9a-f]{8}$/;

function getRunsDir(): string {
  return path.resolve(getDataDir(), RUNTIME_SUBDIR);
}

/**
 * 解析 runId 到绝对路径，并强制验证：
 * 1. runId 只含安全字符（白名单正则）
 * 2. 解析后的路径仍在 runs 目录内（防 path traversal）
 *
 * 任一校验失败返回 null，调用方按"未找到"处理。
 */
function resolveRunPath(runId: string): string | null {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) return null;
  const runsDir = getRunsDir();
  const candidate = path.resolve(runsDir, `${runId}.json`);
  // path.relative 在子路径时返回不以 .. 开头且非绝对路径的字符串
  const rel = path.relative(runsDir, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return candidate;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(getRunsDir(), { recursive: true });
}

export function generateRunId(skillId: string): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const uid = randomUUID().slice(0, 8);
  // skillId 归一化：只保留小写字母、数字、连字符，截断到 64 字符
  const safeSkillId = skillId.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64) || 'unknown';
  return `sr_${ts}_${safeSkillId}_${uid}`;
}

export async function saveRun(record: SkillRunRecord): Promise<void> {
  const filePath = resolveRunPath(record.runId);
  if (!filePath) {
    throw new Error(`Invalid runId for persistence: ${record.runId}`);
  }
  await ensureDir();
  await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
}

export async function getRun(runId: string): Promise<SkillRunRecord | null> {
  const filePath = resolveRunPath(runId);
  if (!filePath) return null;
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as SkillRunRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export interface ListRunsOptions {
  skillId?: string;
  username?: string;
  limit?: number;
}

export async function listRuns(options: ListRunsOptions = {}): Promise<SkillRunRecord[]> {
  await ensureDir();
  const dir = getRunsDir();
  const files = await fs.readdir(dir);
  const records: SkillRunRecord[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(dir, file), 'utf8');
      const rec = JSON.parse(raw) as SkillRunRecord;
      if (options.skillId && rec.skillId !== options.skillId) continue;
      if (options.username && rec.username !== options.username) continue;
      records.push(rec);
    } catch {
      // 损坏的记录跳过，不阻塞列表
    }
  }

  records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return options.limit ? records.slice(0, options.limit) : records;
}
