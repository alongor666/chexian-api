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

function getRunsDir(): string {
  return path.resolve(getDataDir(), RUNTIME_SUBDIR);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(getRunsDir(), { recursive: true });
}

export function generateRunId(skillId: string): string {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const uid = randomUUID().slice(0, 8);
  return `sr_${ts}_${skillId}_${uid}`;
}

export async function saveRun(record: SkillRunRecord): Promise<void> {
  await ensureDir();
  const filePath = path.join(getRunsDir(), `${record.runId}.json`);
  await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
}

export async function getRun(runId: string): Promise<SkillRunRecord | null> {
  const filePath = path.join(getRunsDir(), `${runId}.json`);
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
