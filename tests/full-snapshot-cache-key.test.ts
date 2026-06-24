import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// @ts-expect-error — 纯 JS 模块，无类型声明（仅在 ETL 内部使用）
import { buildFullSnapshotCacheKey } from '../数据管理/lib/full-snapshot-cache-key.mjs';

// 模拟 new_energy_claims：full_snapshot 策略，convert 时经 --policy-dir VIN JOIN 回填 org_level_3。
// 缓存键必须对 policy/current 内容变化敏感，否则命中缓存会服务用旧 policy 回填的陈旧 org_level_3。
const TRIGGER = { snapshot_mode: 'full_batch_replace', snapshot_output: 'new_energy_claims.parquet' };
const BATCH_DATE = '20260524';
// 源 xlsx 指纹：两次运行间不变（同一批次、同一文件内容）
const SOURCE_FP = [{ name: '20260524_新能源_出险信息表.xlsx', size: 1024, sha256: 'a'.repeat(64) }];

let root: string;
let scriptPath: string;
let policyDir: string;

function writePolicyParquet(content: string, file = 'policy-0.parquet') {
  writeFileSync(join(policyDir, file), content);
}

function keyWithPolicy(extraArgs: string[]) {
  return buildFullSnapshotCacheKey({
    id: 'new_energy_claims',
    batchDate: BATCH_DATE,
    sourceFingerprints: SOURCE_FP,
    scriptPath,
    trigger: TRIGGER,
    extraArgs,
  });
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'fs-cache-key-'));
  // convert 脚本 + 3 个共享 .py 依赖（缓存键已覆盖，两次运行间不变）
  const pipelineDir = join(root, 'pipelines');
  mkdirSync(pipelineDir, { recursive: true });
  scriptPath = join(pipelineDir, 'convert_new_energy_claims.py');
  for (const f of ['convert_new_energy_claims.py', 'base_converter.py', 'etl_validation.py', 'parquet_utils.py']) {
    writeFileSync(join(pipelineDir, f), `# ${f}\n`);
  }
  policyDir = join(root, 'policy', 'current');
  mkdirSync(policyDir, { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('buildFullSnapshotCacheKey — policy/current 内容敏感性（PR #732 codex 发现的陈旧缓存隐患）', () => {
  it('policy/current 内容变化 → 缓存键必须变化（核心回归：否则命中缓存服务陈旧 org_level_3）', () => {
    writePolicyParquet('policy-state-P1');
    const k1 = keyWithPolicy(['--policy-dir', policyDir]);
    writePolicyParquet('policy-state-P2-different-bytes');
    const k2 = keyWithPolicy(['--policy-dir', policyDir]);
    expect(k1).not.toBe(k2);
  });

  it('policy/current 内容不变 → 缓存键稳定（确定性，避免无谓重算）', () => {
    writePolicyParquet('policy-stable');
    const k1 = keyWithPolicy(['--policy-dir', policyDir]);
    const k2 = keyWithPolicy(['--policy-dir', policyDir]);
    expect(k1).toBe(k2);
  });

  it('新增/移除一个 policy 分片文件 → 缓存键变化', () => {
    writePolicyParquet('shard-0', 'policy-0.parquet');
    const k1 = keyWithPolicy(['--policy-dir', policyDir]);
    writePolicyParquet('shard-1', 'policy-1.parquet');
    const k2 = keyWithPolicy(['--policy-dir', policyDir]);
    expect(k1).not.toBe(k2);
  });
});

describe('buildFullSnapshotCacheKey — extraArgs 纳入', () => {
  it('extraArgs 标志变化（如新增 --branch-code）→ 缓存键变化', () => {
    writePolicyParquet('p');
    const base = keyWithPolicy(['--policy-dir', policyDir]);
    const withBranch = keyWithPolicy(['--policy-dir', policyDir, '--branch-code', 'SX']);
    expect(base).not.toBe(withBranch);
  });

  it('无 extraArgs（不传 --policy-dir）的域：缓存键与 policy 目录内容无关（不读取，向后兼容 customer_flow 等）', () => {
    writePolicyParquet('changed-after');
    const k1 = keyWithPolicy([]);
    writePolicyParquet('changed-again-different-length');
    const k2 = keyWithPolicy([]);
    expect(k1).toBe(k2);
  });
});

describe('buildFullSnapshotCacheKey — codex 闸-2 P2 加固', () => {
  const quoted = (dir: string) => `"${dir}"`;

  it('带字面引号的 --policy-dir：剥引号后仍对内容变化敏感（防 R17 同类 foot-gun）', () => {
    writePolicyParquet('quoted-P1');
    const k1 = keyWithPolicy(['--policy-dir', quoted(policyDir)]);
    writePolicyParquet('quoted-P2-different');
    const k2 = keyWithPolicy(['--policy-dir', quoted(policyDir)]);
    expect(k1).not.toBe(k2);
  });

  it('带引号 vs 裸路径（同内容）→ 缓存键一致（引号被规范化掉）', () => {
    writePolicyParquet('same-content');
    const bare = keyWithPolicy(['--policy-dir', policyDir]);
    const quotedKey = keyWithPolicy(['--policy-dir', quoted(policyDir)]);
    expect(bare).toBe(quotedKey);
  });

  it('--no-metadata 是内容中性参数：加/不加缓存键一致（避免 manifest/直接运行反复重算）', () => {
    writePolicyParquet('nometa');
    const without = keyWithPolicy(['--policy-dir', policyDir]);
    const withFlag = keyWithPolicy(['--no-metadata', '--policy-dir', policyDir]);
    expect(without).toBe(withFlag);
    // 但 --branch-code 改变产物（branch_code 常量列），不得被规范化掉
    const withBranch = keyWithPolicy(['--policy-dir', policyDir, '--branch-code', 'SX']);
    expect(without).not.toBe(withBranch);
  });

  it('以 .parquet 结尾的子目录被跳过、不抛错（policy/current 只应含常规文件）', () => {
    writePolicyParquet('only-regular-file', 'policy-0.parquet');
    const k1 = keyWithPolicy(['--policy-dir', policyDir]);
    mkdirSync(join(policyDir, 'stray-dir.parquet'), { recursive: true });
    let k2: string | undefined;
    expect(() => { k2 = keyWithPolicy(['--policy-dir', policyDir]); }).not.toThrow();
    expect(k2).toBe(k1);
  });

  // B2：cache key 指纹**故意保持 flat-within-dir**（isFile 过滤排除子目录），与消费者
  // convert_new_energy_claims.py 的 read_parquet('<--policy-dir>/*.parquet') 非递归 glob 严格对齐。
  // 子目录布局下 daily.mjs 传 --policy-dir=current/<省>/（指向子目录本身），故指纹仍读到该省 flat 分片。
  // 此测试锁定：在 --policy-dir=current/ 下放一个 SC/ 省份子目录，不影响 cache key（不下钻）。
  it('省份子目录 current/<省>/ 内的 parquet 不影响 cache key（flat-within-dir，对齐 convert 非递归 glob）', () => {
    writePolicyParquet('flat-baseline', 'policy-0.parquet');
    const k1 = keyWithPolicy(['--policy-dir', policyDir]);
    mkdirSync(join(policyDir, 'SC'), { recursive: true });
    writeFileSync(join(policyDir, 'SC', 'subdir-shard.parquet'), 'subdir-content');
    const k2 = keyWithPolicy(['--policy-dir', policyDir]);
    expect(k2).toBe(k1);
  });
});
