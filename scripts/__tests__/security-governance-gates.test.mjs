/**
 * 红绿夹具测试：安全审查新增两条治理闸（M1 RLS 总闸 / M7 PAT 只读端点覆盖）
 *
 * 用临时目录构造合规/违规布局，断言闸的 pass/fail 行为——证明闸真能拦，不是空过。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runBranchRlsEnabledCheck } from '../governance/branch-rls-enabled.mjs';
import { runPatReadonlyCoverageCheck } from '../governance/pat-readonly-coverage.mjs';

const silentIo = { info: () => {}, success: () => {}, error: () => {} };

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-gov-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeEcosystem(value) {
  const dir = path.join(tmp, 'server');
  fs.mkdirSync(dir, { recursive: true });
  const decl = value === null ? '' : `      BRANCH_RLS_ENABLED: '${value}',\n`;
  fs.writeFileSync(
    path.join(dir, 'ecosystem.config.cjs'),
    `module.exports = { apps: [{ name: 'x', env: {\n      NODE_ENV: 'production',\n${decl}    } }] };\n`,
  );
}

function writeRoute(relPath, contents) {
  const full = path.join(tmp, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

describe('M1 — RLS 总闸必开', () => {
  it('绿：BRANCH_RLS_ENABLED=true 通过', () => {
    writeEcosystem('true');
    expect(runBranchRlsEnabledCheck({ rootDir: tmp, io: silentIo })).toBe(true);
  });
  it('红：=false 拦截', () => {
    writeEcosystem('false');
    expect(runBranchRlsEnabledCheck({ rootDir: tmp, io: silentIo })).toBe(false);
  });
  it('红：未声明拦截', () => {
    writeEcosystem(null);
    expect(runBranchRlsEnabledCheck({ rootDir: tmp, io: silentIo })).toBe(false);
  });
  it('红：文件缺失拦截', () => {
    expect(runBranchRlsEnabledCheck({ rootDir: tmp, io: silentIo })).toBe(false);
  });
});

describe('M7 — PAT 只读端点覆盖', () => {
  it('绿：router 级 auth→readonly 覆盖写端点', () => {
    writeRoute(
      'server/src/routes/ok-router-level.ts',
      `router.use(authMiddleware);\nrouter.use(readonlyMiddleware);\nrouter.post('/x', asyncHandler(async (req, res) => { res.json({}); }));\n`,
    );
    expect(runPatReadonlyCoverageCheck({ rootDir: tmp, io: silentIo })).toBe(true);
  });

  it('绿：per-route readonly-after-auth 覆盖', () => {
    writeRoute(
      'server/src/routes/ok-per-route.ts',
      `router.post('/x', authMiddleware, readonlyMiddleware, requireRole(X), asyncHandler(async (req, res) => { res.json({}); }));\n`,
    );
    expect(runPatReadonlyCoverageCheck({ rootDir: tmp, io: silentIo })).toBe(true);
  });

  it('绿：requireSessionAuth 覆盖（无 readonly 亦可）', () => {
    writeRoute(
      'server/src/routes/ok-session.ts',
      `router.post('/x', authMiddleware, asyncHandler(async (req, res) => { requireSessionAuth(req); res.json({}); }));\n`,
    );
    expect(runPatReadonlyCoverageCheck({ rootDir: tmp, io: silentIo })).toBe(true);
  });

  it('绿：未认证写端点（无 authMiddleware）不要求覆盖', () => {
    writeRoute(
      'server/src/routes/ok-public.ts',
      `router.post('/login', asyncHandler(async (req, res) => { res.json({}); }));\n`,
    );
    expect(runPatReadonlyCoverageCheck({ rootDir: tmp, io: silentIo })).toBe(true);
  });

  it('红：认证写端点无 readonly 且无 requireSessionAuth', () => {
    writeRoute(
      'server/src/routes/bad-missing.ts',
      `router.post('/x', authMiddleware, requireRole(X), asyncHandler(async (req, res) => { res.json({}); }));\n`,
    );
    expect(runPatReadonlyCoverageCheck({ rootDir: tmp, io: silentIo })).toBe(false);
  });

  it('红：router.use(readonly) 挂在 auth 之前（P0 失效顺序）', () => {
    writeRoute(
      'server/src/routes/bad-order.ts',
      `router.use(readonlyMiddleware);\nrouter.use(authMiddleware);\nrouter.post('/x', asyncHandler(async (req, res) => { res.json({}); }));\n`,
    );
    expect(runPatReadonlyCoverageCheck({ rootDir: tmp, io: silentIo })).toBe(false);
  });

  it('绿：下一路由 JSDoc 提到 authMiddleware 不误伤本公开端点', () => {
    writeRoute(
      'server/src/routes/comment-bleed.ts',
      `router.post('/logout', asyncHandler(async (req, res) => { res.json({}); }));\n\n/**\n * 该端点被 authMiddleware 拦截\n */\nrouter.post('/protected', authMiddleware, readonlyMiddleware, asyncHandler(async (req, res) => { res.json({}); }));\n`,
    );
    expect(runPatReadonlyCoverageCheck({ rootDir: tmp, io: silentIo })).toBe(true);
  });

  it('绿：governance-allow 逃生阀豁免', () => {
    writeRoute(
      'server/src/routes/allow.ts',
      `router.post('/x', authMiddleware, asyncHandler(async (req, res) => {\n  // governance-allow: pat-readonly 测试豁免\n  res.json({});\n}));\n`,
    );
    expect(runPatReadonlyCoverageCheck({ rootDir: tmp, io: silentIo })).toBe(true);
  });
});
