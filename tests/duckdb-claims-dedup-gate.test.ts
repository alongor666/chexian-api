/**
 * claims_detail claim_no 去重闸（inspectClaimsClaimNoDuplication）集成测试。
 *
 * 命名 duckdb-*.test.ts → CI 单测排除（vite.config.ts exclude），仅 `bun run test:integration` 跑
 * （本地有 duckdb CLI + python3-duckdb）。worktree/CI 无 parquet 时整套 skip，不造假安全。
 *
 * 验证「让下游聚合可证明安全」的源头断言（PR #845 完整性审查 follow-up）：下游脚本对 claims
 * 做 LEFT JOIN ON policy_no 后 SUM(已决/未决) 不去重，重复 claim_no 即双计赔款。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectClaimsClaimNoDuplication } from '../scripts/check-governance.mjs';

function probe(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_DEPS = probe('duckdb', ['-c', 'SELECT 1']) && probe('python3', ['-c', 'import duckdb']);

function writeClaimsParquet(file: string, rows: Array<{ branch: string; claim: string }>): void {
  const values = rows.map((r) => `('${r.branch}','${r.claim}',100.0)`).join(',');
  const sql = `COPY (SELECT * FROM (VALUES ${values}) t(branch_code, claim_no, settled_amount)) TO '${file}' (FORMAT parquet)`;
  execFileSync('duckdb', ['-c', sql], { stdio: 'ignore' });
}

describe.skipIf(!HAS_DEPS)('claims_detail claim_no 去重闸', () => {
  let root: string;
  const dir = (name: string): string => {
    const p = path.join(root, name);
    fs.mkdirSync(p, { recursive: true });
    return p;
  };

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-dedup-'));
  });
  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('省内 claim_no 唯一 → pass', () => {
    const sc = dir('sc-clean');
    writeClaimsParquet(path.join(sc, 'claims_2025.parquet'), [
      { branch: 'SC', claim: 'C1' },
      { branch: 'SC', claim: 'C2' },
      { branch: 'SC', claim: 'C3' },
    ]);
    const res = inspectClaimsClaimNoDuplication([{ branch: 'SC', glob: path.join(sc, 'claims_*.parquet') }]);
    expect(res.status).toBe('pass');
    const p = res.provinces.find((x: any) => x.branch === 'SC');
    expect(p.dupGroups).toBe(0);
    expect(p.totalRows).toBe(3);
  });

  it('省内 claim_no 重复（跨分区文件）→ fail + 重复键样本', () => {
    const sc = dir('sc-dup');
    // 同一 claim_no C1 跨两个分区文件，模拟 CDC 双写 / 去重逻辑被破坏
    writeClaimsParquet(path.join(sc, 'claims_2024.parquet'), [
      { branch: 'SC', claim: 'C1' },
      { branch: 'SC', claim: 'C9' },
    ]);
    writeClaimsParquet(path.join(sc, 'claims_2025.parquet'), [
      { branch: 'SC', claim: 'C1' },
      { branch: 'SC', claim: 'C2' },
    ]);
    const res = inspectClaimsClaimNoDuplication([{ branch: 'SC', glob: path.join(sc, 'claims_*.parquet') }]);
    expect(res.status).toBe('fail');
    const p = res.provinces.find((x: any) => x.branch === 'SC');
    expect(p.dupGroups).toBe(1);
    expect(p.excessRows).toBe(1);
    expect(p.samples[0].claim_no).toBe('C1');
    expect(p.samples[0].count).toBe(2);
  });

  it('SC 干净 + SX 重复 → 整体 fail，仅 SX 标记 fail（省份隔离）', () => {
    const sc = dir('mix-sc');
    const sx = dir('mix-sx');
    writeClaimsParquet(path.join(sc, 'claims_2025.parquet'), [
      { branch: 'SC', claim: 'C1' },
      { branch: 'SC', claim: 'C2' },
    ]);
    writeClaimsParquet(path.join(sx, 'claims_2025.parquet'), [
      { branch: 'SX', claim: 'X1' },
      { branch: 'SX', claim: 'X1' },
    ]);
    const res = inspectClaimsClaimNoDuplication([
      { branch: 'SC', glob: path.join(sc, 'claims_*.parquet') },
      { branch: 'SX', glob: path.join(sx, 'claims_*.parquet') },
    ]);
    expect(res.status).toBe('fail');
    expect(res.provinces.find((x: any) => x.branch === 'SC').status).toBe('pass');
    expect(res.provinces.find((x: any) => x.branch === 'SX').status).toBe('fail');
  });

  it('跨省相同 claim_no 合法（省内唯一即可）→ pass', () => {
    const sc = dir('xp-sc');
    const sx = dir('xp-sx');
    writeClaimsParquet(path.join(sc, 'claims_2025.parquet'), [{ branch: 'SC', claim: 'SHARED' }]);
    writeClaimsParquet(path.join(sx, 'claims_2025.parquet'), [{ branch: 'SX', claim: 'SHARED' }]);
    const res = inspectClaimsClaimNoDuplication([
      { branch: 'SC', glob: path.join(sc, 'claims_*.parquet') },
      { branch: 'SX', glob: path.join(sx, 'claims_*.parquet') },
    ]);
    expect(res.status).toBe('pass');
  });

  it('无 parquet 文件 → skip（CI/worktree 安全，不造假安全）', () => {
    const empty = dir('empty');
    const res = inspectClaimsClaimNoDuplication([{ branch: 'SC', glob: path.join(empty, 'claims_*.parquet') }]);
    expect(res.status).toBe('skip');
  });
});
