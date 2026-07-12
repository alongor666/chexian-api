import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProductNaming, checkRouteRegistry } from '../governance/check-naming-route.mjs';

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'naming-route-governance-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

const validNamingFiles = {
  'src/shared/config/productMetadata.ts': "export const PRODUCT_METADATA = { productName: '车险经营分析平台' };",
  'index.html': '<title>车险经营分析平台</title>',
  'src/components/layout/TopNavigation.tsx': 'const title = PRODUCT_METADATA.productName;',
  'src/features/auth/LoginPage.tsx': 'const title = PRODUCT_METADATA.productName;',
  'src/features/admin/AccessControlPage.tsx': 'const routes = getPermissionRoutes();',
};

describe('产品命名治理', () => {
  it('拒绝 HTML 标题与产品元数据主名不一致', () => {
    const root = fixture({ ...validNamingFiles, 'index.html': '<title>另一产品</title>' });
    expect(checkProductNaming(root)).toEqual(expect.arrayContaining([
      expect.stringMatching(/index\.html.*车险经营分析平台/),
    ]));
  });

  it('拒绝当前用户入口重新硬编码旧产品名或权限路由列表', () => {
    const root = fixture({
      ...validNamingFiles,
      'src/components/layout/TopNavigation.tsx': "const title = '车险业绩分析系统';",
      'src/features/admin/AccessControlPage.tsx': "const ALL_ROUTES = ['/home'];",
    });
    expect(checkProductNaming(root)).toEqual(expect.arrayContaining([
      expect.stringMatching(/车险业绩分析系统/),
      expect.stringMatching(/ALL_ROUTES/),
    ]));
  });
});

describe('路由注册表治理', () => {
  it('重复 id、canonical path、redirect path 和 redirect/canonical 冲突均 fail-loud', () => {
    const root = fixture({
      'src/shared/config/routeRegistry.ts': `
        export const ROUTES = [
          { id: 'home', path: '/home', redirects: [{ path: '/legacy', to: '/home' }] },
          { id: 'home', path: '/dashboard', redirects: [{ path: '/legacy', to: '/dashboard' }] },
          { id: 'cost', path: '/home', redirects: [{ path: '/dashboard', to: '/cost' }] },
        ];
      `,
    });
    expect(checkRouteRegistry(root)).toEqual(expect.arrayContaining([
      expect.stringMatching(/重复 route id.*home/),
      expect.stringMatching(/重复 canonical path.*\/home/),
      expect.stringMatching(/重复 redirect path.*\/legacy/),
      expect.stringMatching(/redirect.*canonical.*\/dashboard/),
    ]));
  });
});
