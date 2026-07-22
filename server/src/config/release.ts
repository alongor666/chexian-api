import { readFileSync } from 'node:fs';

export interface ReleaseMetadata {
  releaseSha: string;
  builtAt: string | null;
}

export function normalizeReleaseMetadata(value: unknown): ReleaseMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.releaseSha !== 'string' || !/^(dev|[0-9a-f]{7,40})$/i.test(candidate.releaseSha)) {
    return null;
  }
  if (typeof candidate.builtAt !== 'string' || Number.isNaN(Date.parse(candidate.builtAt))) {
    return null;
  }
  return { releaseSha: candidate.releaseSha, builtAt: candidate.builtAt };
}

function loadReleaseMetadata(): ReleaseMetadata {
  try {
    const raw = readFileSync(new URL('../release.json', import.meta.url), 'utf8');
    const parsed = normalizeReleaseMetadata(JSON.parse(raw));
    if (parsed) return parsed;
  } catch {
    // 本地开发没有构建产物时允许使用 dev；生产部署闸会验证真实 SHA。
  }
  const envSha = process.env.RELEASE_SHA?.trim();
  return {
    releaseSha: envSha && /^[0-9a-f]{7,40}$/i.test(envSha) ? envSha : 'dev',
    builtAt: null,
  };
}

const releaseMetadata = loadReleaseMetadata();

export function getReleaseMetadata(): ReleaseMetadata {
  return releaseMetadata;
}
