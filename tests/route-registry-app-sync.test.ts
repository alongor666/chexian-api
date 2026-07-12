import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../src/shared/config/routeRegistry';

const appSource = readFileSync(
  resolve(process.cwd(), 'src/app/App.tsx'),
  'utf8',
);

function declaredRoutePaths(source: string): Set<string> {
  const paths = new Set<string>();
  for (const match of source.matchAll(/<Route\s+[^>]*path=["']([^"']+)["']/gs)) {
    const declared = match[1];
    paths.add(declared.startsWith('/') ? declared : `/${declared}`);
  }
  return paths;
}

describe('route registry and App route synchronization', () => {
  it('keeps all 17 canonical pages as explicit App routes', () => {
    const declaredPaths = declaredRoutePaths(appSource);

    expect(ROUTES).toHaveLength(17);
    for (const route of ROUTES) {
      expect(declaredPaths, `missing explicit Route for ${route.id}: ${route.path}`).toContain(route.path);
    }
  });

  it('retains every registered legacy alias as an explicit redirect', () => {
    const declaredPaths = declaredRoutePaths(appSource);
    const aliases = ROUTES.flatMap((route) => route.aliases ?? []);

    expect(aliases).toEqual(expect.arrayContaining([
      '/old-dashboard',
      '/premium-report',
      '/marketing-report',
      '/truck',
      '/cross-sell',
      '/comparison',
      '/comprehensive-analysis',
    ]));
    for (const alias of aliases) {
      expect(declaredPaths, `missing redirect Route for alias ${alias}`).toContain(alias);
    }

    const redirects = new Map([
      ['/old-dashboard', '/dashboard'],
      ['/premium-report', '/reports'],
      ['/marketing-report', '/reports'],
      ['/truck', '/specialty?tab=truck'],
      ['/cross-sell', '/specialty?tab=cross-sell'],
      ['/comparison', '/growth'],
      ['/comprehensive-analysis', '/cost?view=comprehensive'],
    ]);
    for (const [alias, destination] of redirects) {
      const relativeAlias = alias.slice(1);
      const routePattern = new RegExp(
        `<Route\\s+path=["'](?:${alias}|${relativeAlias})["']\\s+element=\\{<Navigate\\s+to=["']${destination.replace('?', '\\?')}["']\\s+replace\\s*/>}`,
      );
      expect(appSource, `${alias} must remain a redirect to ${destination}`).toMatch(routePattern);
    }
  });
});
