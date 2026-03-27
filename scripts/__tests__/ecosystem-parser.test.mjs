/**
 * parseEcosystemEnvKeys 夹具测试
 *
 * 8 个配置变体，覆盖正常/异常解析场景。
 */
import { describe, expect, it } from 'vitest';
import { parseEcosystemEnvKeys } from '../lib/ecosystem-parser.mjs';

// ─── 夹具 ──────────────────────────────────────────────────

const MINIMAL_VALID = `
module.exports = {
  apps: [{
    name: 'chexian-api',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      VPS_MODE: 'true',
      CORS_ORIGIN: 'https://chexian.cretvalu.com',
      DUCKDB_MAX_MEMORY: '2GB',
      DUCKDB_THREADS: 2,
    },
  }],
};
`;

const ENV_PRODUCTION_BEFORE_ENV = `
module.exports = {
  apps: [{
    name: 'chexian-api',
    env_production: {
      NODE_ENV: 'production',
      EXTRA_KEY: 'only-in-prod',
    },
    env: {
      NODE_ENV: 'development',
      PORT: 3000,
      VPS_MODE: 'false',
      CORS_ORIGIN: 'http://localhost:5173',
      DUCKDB_MAX_MEMORY: '1GB',
      DUCKDB_THREADS: 1,
    },
  }],
};
`;

const CORS_WITH_SPACES = `
module.exports = {
  apps: [{
    env: {
      CORS_ORIGIN: '  https://chexian.cretvalu.com  ',
    },
  }],
};
`;

const INLINE_COMMENT = `
module.exports = {
  apps: [{
    env: {
      NODE_ENV: 'production', // do not change
      PORT: 3000, // default port
      CORS_ORIGIN: 'https://chexian.cretvalu.com', // prod only
    },
  }],
};
`;

const LOCALHOST_IN_CORS = `
module.exports = {
  apps: [{
    env: {
      CORS_ORIGIN: 'https://chexian.cretvalu.com,http://localhost:5173',
    },
  }],
};
`;

const MISSING_REQUIRED = `
module.exports = {
  apps: [{
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
  }],
};
`;

const NO_ENV_BLOCK = `
module.exports = {
  apps: [{
    name: 'chexian-api',
    script: './dist/index.js',
  }],
};
`;

const BLOCK_COMMENT_FAKE_ENV = `
module.exports = {
  apps: [{
    /*
    env: {
      FAKE_KEY: 'should-not-extract',
      ANOTHER_FAKE: 'nope',
    },
    */
    name: 'chexian-api',
    script: './dist/index.js',
  }],
};
`;

// ─── 测试 ──────────────────────────────────────────────────

describe('parseEcosystemEnvKeys — 夹具测试', () => {
  // TC-01: 最小合法配置
  it('TC-01: 最小合法配置提取 6 个必需键', () => {
    const { keys } = parseEcosystemEnvKeys(MINIMAL_VALID);
    const required = ['NODE_ENV', 'PORT', 'VPS_MODE', 'CORS_ORIGIN', 'DUCKDB_MAX_MEMORY', 'DUCKDB_THREADS'];
    for (const key of required) {
      expect(keys).toContain(key);
    }
    expect(keys.length).toBe(6);
  });

  // TC-02: env_production 在 env 之前
  it('TC-02: env_production 在 env 之前时仍正确提取 env 块', () => {
    const { keys } = parseEcosystemEnvKeys(ENV_PRODUCTION_BEFORE_ENV);
    expect(keys).toContain('NODE_ENV');
    expect(keys).toContain('PORT');
    expect(keys).not.toContain('EXTRA_KEY');
  });

  // TC-03: CORS_ORIGIN 有前后空格
  it('TC-03: CORS_ORIGIN 前后空格被 trim', () => {
    const { corsOrigin } = parseEcosystemEnvKeys(CORS_WITH_SPACES);
    expect(corsOrigin).toBe('https://chexian.cretvalu.com');
    expect(corsOrigin).not.toMatch(/^\s|\s$/);
  });

  // TC-04: 行内注释不干扰 KEY 提取
  it('TC-04: 行内注释 // 不干扰 KEY 和 value 提取', () => {
    const { keys, corsOrigin } = parseEcosystemEnvKeys(INLINE_COMMENT);
    expect(keys).toContain('NODE_ENV');
    expect(keys).toContain('PORT');
    expect(keys).toContain('CORS_ORIGIN');
    expect(corsOrigin).toBe('https://chexian.cretvalu.com');
    // 行内注释文本不应残留在值中
    expect(corsOrigin).not.toContain('prod only');
    expect(corsOrigin).not.toContain('do not change');
  });

  // TC-05: localhost 混入 CORS
  it('TC-05: corsOrigin 包含 localhost', () => {
    const { corsOrigin } = parseEcosystemEnvKeys(LOCALHOST_IN_CORS);
    expect(corsOrigin).toContain('localhost');
    expect(corsOrigin).toContain('https://chexian.cretvalu.com');
  });

  // TC-06: 缺失必需字段
  it('TC-06: 缺失字段不在 keys 中', () => {
    const { keys } = parseEcosystemEnvKeys(MISSING_REQUIRED);
    expect(keys).toContain('NODE_ENV');
    expect(keys).toContain('PORT');
    expect(keys).not.toContain('VPS_MODE');
    expect(keys).not.toContain('CORS_ORIGIN');
    expect(keys).not.toContain('DUCKDB_MAX_MEMORY');
    expect(keys).not.toContain('DUCKDB_THREADS');
  });

  // TC-07: 无 env 块
  it('TC-07: 无 env 块返回空', () => {
    const { keys, corsOrigin } = parseEcosystemEnvKeys(NO_ENV_BLOCK);
    expect(keys).toEqual([]);
    expect(corsOrigin).toBe('');
  });

  // TC-08: 块注释中的假 env 不被提取
  it('TC-08: /* */ 块注释中的假 env 不被提取', () => {
    const { keys, corsOrigin } = parseEcosystemEnvKeys(BLOCK_COMMENT_FAKE_ENV);
    expect(keys).toEqual([]);
    expect(corsOrigin).toBe('');
  });
});
