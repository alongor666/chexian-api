#!/usr/bin/env node
/** 生成一次发布元数据，同时写入前后端构建产物。 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const releaseSha = String(process.env.RELEASE_SHA || 'dev').trim();
const requireCommitSha = process.env.REQUIRE_RELEASE_SHA === '1';
if (requireCommitSha && !/^[0-9a-f]{40}$/i.test(releaseSha)) {
  throw new Error(`生产发布必须提供 40 位提交 SHA，实际值: ${releaseSha || '<empty>'}`);
}
if (releaseSha !== 'dev' && !/^[0-9a-f]{7,40}$/i.test(releaseSha)) {
  throw new Error(`releaseSha 格式无效: ${releaseSha}`);
}

const metadata = {
  releaseSha,
  builtAt: new Date().toISOString(),
};
const output = `${JSON.stringify(metadata, null, 2)}\n`;
const targets = [resolve('dist/release.json'), resolve('server/dist/release.json')];

for (const target of targets) {
  await mkdir(resolve(target, '..'), { recursive: true });
  await writeFile(target, output, 'utf8');
}

console.log(`[release] metadata generated for ${releaseSha}`);
