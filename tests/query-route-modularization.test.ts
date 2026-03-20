import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const ARCHIVED_LEGACY_QUERY = path.resolve(
  ROOT,
  'archive/legacy-code/2026-03-query-route-split/query.legacy.ts'
);
const LIVE_QUERY_ENTRY = path.resolve(ROOT, 'server/src/routes/query.ts');
const LIVE_QUERY_DIR = path.resolve(ROOT, 'server/src/routes/query');
const OLD_LIVE_LEGACY_QUERY = path.resolve(ROOT, 'server/src/routes/query.legacy.ts');

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(ROOT, relativePath), 'utf-8');
}

function extractRouteSignatures(source: string): string[] {
  const routePattern = /router\.(get|post)\s*\(\s*(['"])([^'"]+)\2/g;
  const routes = new Set<string>();
  let match: RegExpExecArray | null = routePattern.exec(source);

  while (match) {
    routes.add(`${match[1].toUpperCase()} ${match[3]}`);
    match = routePattern.exec(source);
  }

  return [...routes].sort();
}

describe('query route modularization', () => {
  it('keeps query.ts as the only live route entry', () => {
    expect(fs.existsSync(LIVE_QUERY_ENTRY)).toBe(true);
    expect(fs.existsSync(OLD_LIVE_LEGACY_QUERY)).toBe(false);
    expect(read('server/src/app.ts')).toContain("import queryRoutes from './routes/query.js';");
  });

  it('preserves every legacy route signature after modular split', () => {
    const legacyRoutes = extractRouteSignatures(fs.readFileSync(ARCHIVED_LEGACY_QUERY, 'utf-8'));
    const modularSource = fs.readdirSync(LIVE_QUERY_DIR)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => fs.readFileSync(path.join(LIVE_QUERY_DIR, file), 'utf-8'))
      .join('\n');
    const modularRoutes = extractRouteSignatures(modularSource);

    expect(legacyRoutes).toHaveLength(33);
    expect(modularRoutes).toEqual(legacyRoutes);
  });
});
