import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8');
}

describe('permission injection chain regression', () => {
  it('query route keeps auth + permission middleware chain', () => {
    const content = readSource('server/src/routes/query.ts');
    expect(content).toContain('router.use(authMiddleware);');
    expect(content).toContain('router.use(permissionMiddleware);');
  });

  it('ai route keeps auth + permission middleware chain', () => {
    const content = readSource('server/src/routes/ai.ts');
    expect(content).toContain('router.use(authMiddleware);');
    expect(content).toContain('router.use(permissionMiddleware);');
  });
});

