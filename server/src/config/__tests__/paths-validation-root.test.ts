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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
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

// 注入临时候选 → 确定性覆盖「首个存在者」选择逻辑，不依赖本机 warehouse/data 真实状态
// （否则在跑过 SX ETL 的开发机上 warehouse/validation 存在会让回退用例被 skip 成空操作）。
describe('getValidationRootDir（首个存在者，注入候选）', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'val-root-')); });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('第一候选存在 → 优先返回第一（本地 warehouse 优先）', () => {
    const warehouse = path.join(root, 'warehouse-val');
    const dataVal = path.join(root, 'data-val');
    mkdirSync(warehouse); mkdirSync(dataVal);
    expect(getValidationRootDir([warehouse, dataVal])).toBe(warehouse);
  });

  it('仅第二候选存在（warehouse 缺）→ 回退到 data/validation（VPS 场景）', () => {
    const warehouse = path.join(root, 'missing-warehouse'); // 不创建
    const dataVal = path.join(root, 'data-val');
    mkdirSync(dataVal);
    expect(getValidationRootDir([warehouse, dataVal])).toBe(dataVal);
  });

  it('两候选皆不存在 → 默认返回首个候选（candidates[0]，existsSync guard 兜底字节安全）', () => {
    const warehouse = path.join(root, 'none-warehouse');
    const dataVal = path.join(root, 'none-data');
    expect(getValidationRootDir([warehouse, dataVal])).toBe(warehouse);
  });

  it('默认无参 → 等价 getValidationRootDirs() 的选择（生产调用方路径）', () => {
    expect(getValidationRootDir()).toBe(getValidationRootDir(getValidationRootDirs()));
  });
});
