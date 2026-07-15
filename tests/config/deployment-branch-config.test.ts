import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseEcosystemEnvKeys } from '../../scripts/lib/ecosystem-parser.mjs';

describe('生产部署省份码配置', () => {
  it('PM2 env 显式声明基准源 BRANCH_CODE=SC，禁止依赖静默回退', () => {
    const source = readFileSync('server/ecosystem.config.cjs', 'utf8');
    const { env } = parseEcosystemEnvKeys(source);
    expect(env.BRANCH_CODE).toBe('SC');
  });
});
