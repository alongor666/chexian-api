/**
 * 影子对账计数器持久化测试（2026-07-09 审计修复·灰度样本死锁）
 *
 * 背景：计数器历史纯内存态，PM2 每日 reload 清零 → cube-promote 的样本门槛
 * （match ≥ 1000/路由）在生产流量下（trend ≈ 25 次/天）数学上永不可达，
 * 灰度被结构性锁死在阶段 1。修复后计数器落盘并在启动时加载，跨 reload 累计。
 *
 * 测试用 CUBE_SHADOW_PERSIST_PATH 注入 tmp 路径（vitest 下默认关闭持久化，
 * 显式设路径即启用），模拟「进程重启」= resetShadowStatsForTest 后重新读取。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  runShadowCompare,
  getShadowStats,
  resetShadowStatsForTest,
  flushShadowStatsForTest,
} from '../cube-shadow.js';

let tmpDir: string;
let statsFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cube-shadow-persist-'));
  statsFile = path.join(tmpDir, 'cube-shadow-stats.json');
  process.env.CUBE_SHADOW_PERSIST_PATH = statsFile;
  resetShadowStatsForTest();
});

afterEach(() => {
  delete process.env.CUBE_SHADOW_PERSIST_PATH;
  resetShadowStatsForTest();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 等 fire-and-forget 的影子比对落到计数器 */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('影子计数器持久化（跨 reload 累计）', () => {
  it('计数落盘后，模拟进程重启（reset + 重新加载）计数不清零', async () => {
    const rows = [{ a: 1 }];
    runShadowCompare('trend', rows, async () => rows);
    runShadowCompare('trend', rows, async () => rows);
    await settle();
    expect(getShadowStats().trend.match).toBe(2);

    flushShadowStatsForTest();
    expect(fs.existsSync(statsFile)).toBe(true);

    // 模拟 PM2 reload：内存态清空，新进程从文件加载
    resetShadowStatsForTest();
    expect(getShadowStats().trend.match).toBe(2); // 跨"重启"保留

    // 新进程继续累计
    runShadowCompare('trend', rows, async () => rows);
    await settle();
    expect(getShadowStats().trend.match).toBe(3);
  });

  it('mismatch 与 lastMismatchDetail 同样持久化', async () => {
    runShadowCompare('growth', [{ v: 1 }], async () => [{ v: 2 }]);
    await settle();
    flushShadowStatsForTest();

    resetShadowStatsForTest();
    const stats = getShadowStats();
    expect(stats.growth.mismatch).toBe(1);
    expect(stats.growth.lastMismatchDetail).toContain('字段 v');
  });

  it('文件损坏时从零开始，不抛错', () => {
    fs.writeFileSync(statsFile, '{ 这不是合法 JSON');
    resetShadowStatsForTest();
    expect(getShadowStats()).toEqual({});
  });

  it('文件不存在（首次运行）时从零开始', () => {
    resetShadowStatsForTest();
    expect(getShadowStats()).toEqual({});
  });

  it('未设 CUBE_SHADOW_PERSIST_PATH（vitest 默认）时不写任何文件', async () => {
    delete process.env.CUBE_SHADOW_PERSIST_PATH;
    resetShadowStatsForTest();
    const rows = [{ a: 1 }];
    runShadowCompare('trend', rows, async () => rows);
    await settle();
    flushShadowStatsForTest(); // 无路径 → 空操作
    expect(fs.existsSync(statsFile)).toBe(false);
  });
});
