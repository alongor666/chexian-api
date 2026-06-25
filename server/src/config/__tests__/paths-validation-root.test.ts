/**
 * validation 隔离区根目录 VPS 回退测试（PR-2 · 部署链 cutover 能力）。
 *
 * 被测：getValidationRootDirs（纯函数·两候选）+ getValidationRootDir（首个存在者，default warehouse）。
 *
 * 动机：0a 期 validation/<省> 派生域产物落本地 warehouse；VPS 运行时无 warehouse，须从
 * server/data/validation 读（sync-vps 推送目标）。原 getValidationRootDir 只返 warehouse 单路径 →
 * VPS 上恒不存在 → loader 探测 [] → SX 派生域永远进不去。加 VPS 回退后 VPS 能读到。
 *
 * 字节安全：本地 warehouse/validation 存在时 getValidationRootDir 返回它（与历史一致）；
 * 两者皆不存在 → default warehouse 候选 + 调用方 existsSync guard → 行为逐字节等价历史。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { getValidationRootDirs, getValidationRootDir, getDataDir } from '../paths.js';

describe('getValidationRootDirs（VPS 回退候选）', () => {
  it('返回本地 warehouse + VPS data/validation 两候选（顺序：本地优先）', () => {
    const dirs = getValidationRootDirs();
    expect(dirs).toHaveLength(2);
    expect(dirs[0]).toMatch(/warehouse[/\\]validation$/);
    expect(dirs[1]).toBe(path.resolve(getDataDir(), 'validation'));
  });
});

describe('getValidationRootDir（首个存在者，default warehouse）', () => {
  const dataValidation = path.resolve(getDataDir(), 'validation');

  afterEach(() => {
    try { rmSync(dataValidation, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('两候选皆不存在 → 默认返回 warehouse 候选（=dirs[0]，existsSync guard 兜底字节安全）', () => {
    const dirs = getValidationRootDirs();
    // 测试环境 warehouse/validation 与 data/validation 通常均不存在（CI/clean checkout）
    if (existsSync(dirs[0]) || existsSync(dirs[1])) return; // 本地 dev 有 warehouse 数据则跳过
    expect(getValidationRootDir()).toBe(dirs[0]);
  });

  it('仅 VPS data/validation 存在（warehouse 缺）→ 回退到 data/validation（VPS 场景）', () => {
    const dirs = getValidationRootDirs();
    if (existsSync(dirs[0])) return; // warehouse/validation 存在（本地 dev）则本用例不适用
    mkdirSync(dataValidation, { recursive: true });
    expect(getValidationRootDir()).toBe(dataValidation);
  });
});
