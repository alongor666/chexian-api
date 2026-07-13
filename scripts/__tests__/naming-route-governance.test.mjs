import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDocumentationTruth, checkProductNaming, checkRouteRegistry } from '../governance/check-naming-route.mjs';

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
  'src/components/layout/TopNavigation.tsx': "import { PRODUCT_METADATA } from './productMetadata'; const title = PRODUCT_METADATA.productName;",
  'src/features/auth/LoginPage.tsx': "import { PRODUCT_METADATA } from './productMetadata'; const title = PRODUCT_METADATA.productName;",
  'src/features/copilot/CopilotDrawer.tsx': "import { PRODUCT_METADATA } from './productMetadata'; const title = PRODUCT_METADATA.aiName;",
  'src/features/admin/AccessControlPage.tsx': 'const routes = getPermissionRoutes();',
};

const LEGACY_ANCHOR_FIXTURE = `
## 二、模块层级与依赖规则
### 2.3 子项目间通信方式
## 三、子项目标准结构
### 3.1 README.md 模板
## 四、命名规范
### 4.3 Git分支
git fetch origin main && git rebase origin/main && bun run governance
## 六、新建子项目检查清单
## 七、AI协作指引
`;

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

  it('拒绝当前入口硬编码当前主名或未消费 PRODUCT_METADATA', () => {
    const root = fixture({
      ...validNamingFiles,
      'src/features/auth/LoginPage.tsx': "const title = '车险经营分析平台';",
      'src/features/copilot/CopilotDrawer.tsx': 'const title = localMetadata.aiName;',
    });
    expect(checkProductNaming(root)).toEqual(expect.arrayContaining([
      expect.stringMatching(/LoginPage.*硬编码.*车险经营分析平台/),
      expect.stringMatching(/CopilotDrawer.*PRODUCT_METADATA/),
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

  it('permission-only alias 与 canonical 冲突或自身重复时 fail-loud', () => {
    const root = fixture({
      'src/shared/config/routeRegistry.ts': `
        export const ROUTES = [{ id: 'home', path: '/home' }];
        export const LEGACY_PERMISSION_ALIASES = [
          { path: '/home', to: '/home' },
          { path: '/renewal', to: '/home' },
          { path: '/renewal', to: '/home' },
        ];
      `,
    });
    expect(checkRouteRegistry(root)).toEqual(expect.arrayContaining([
      expect.stringMatching(/permission alias.*canonical.*\/home/),
      expect.stringMatching(/重复 permission alias path.*\/renewal/),
    ]));
  });

  it.each([
    ['常量引用重复 path', "const P='/home'; export const ROUTES=[{id:'home',path:P},{id:'dashboard',path:P}];"],
    ['spread', "const base={id:'home'}; export const ROUTES=[{...base,path:'/home'}];"],
    ['缺 path', "export const ROUTES=[{id:'home'}];"],
    ['语法错误', "export const ROUTES=[{id:'home',path:'/home' }"],
  ])('%s 必须解析失败', (_name, source) => {
    const root = fixture({ 'src/shared/config/routeRegistry.ts': source });
    expect(checkRouteRegistry(root)).toEqual([expect.stringMatching(/解析失败/)]);
  });

  it('browser redirect 与 permission alias 的 target 必须指向 canonical', () => {
    const root = fixture({
      'src/shared/config/routeRegistry.ts': `
        export const ROUTES = [
          { id: 'home', path: '/home', redirects: [{ path: '/old', to: '/missing?tab=x' }] },
        ];
        export const LEGACY_PERMISSION_ALIASES = [{ path: '/renewal', to: '/also-missing' }];
      `,
    });
    expect(checkRouteRegistry(root)).toEqual(expect.arrayContaining([
      expect.stringMatching(/browser redirect target.*\/missing/),
      expect.stringMatching(/permission alias target.*\/also-missing/),
    ]));
  });
});

describe('当前文档治理', () => {
  it('README 拒绝易腐快照计数与已退役当前能力', () => {
    const root = fixture({
      'README.md': '# 项目\n## 1) 项目概述\nmarketing-report\n### 前端页面\n| 页面 | 路由 |\n| x | `/coefficient` |\n## 2) 技术栈\n22 个业务模块；35 个 SQL 生成器',
      'reference/legacy-python-subproject-convention.md': '',
      'src/shared/config/routeRegistry.ts': "export const ROUTES=[{id:'home',path:'/home'}]",
    });
    expect(checkDocumentationTruth(root)).toEqual(expect.arrayContaining([
      expect.stringMatching(/易腐快照计数/),
      expect.stringMatching(/marketing-report/),
      expect.stringMatching(/coefficient/),
    ]));
  });

  it('历史章节可提及退役能力，但当前页面表与17 canonical必须精确一致', () => {
    const canonical = Array.from({ length: 17 }, (_, index) => `/r${index + 1}`);
    const registry = `export const ROUTES=[${canonical.map((path, i) => `{id:'r${i + 1}',path:'${path}'}`).join(',')}]`;
    const table = canonical.map((path) => `| 页面 | \`${path}\` |`).join('\n');
    const base = {
      'reference/legacy-python-subproject-convention.md': LEGACY_ANCHOR_FIXTURE,
      'src/shared/config/routeRegistry.ts': registry,
    };
    const valid = fixture({ ...base, 'README.md': `# 项目\n## 1) 项目概述\n### 前端页面\n${table}\n## 2) 技术栈\n## 历史\nmarketing-report 已退役，不是当前能力` });
    expect(checkDocumentationTruth(valid)).toEqual([]);
    const missing = fixture({ ...base, 'README.md': `# 项目\n## 1) 项目概述\n### 前端页面\n${table.replace('| 页面 | `/r17` |', '')}\n| 多余 | \`/extra\` |\n## 2) 技术栈` });
    expect(checkDocumentationTruth(missing)).toEqual(expect.arrayContaining([
      expect.stringMatching(/前端页面路由.*缺少.*\/r17/),
      expect.stringMatching(/前端页面路由.*多出.*\/extra/),
    ]));
  });

  it('legacy reference 必须保留旧规范关键章节原文锚点', () => {
    const root = fixture({
      'README.md': '当前数量以目录为准',
      'reference/legacy-python-subproject-convention.md': '# 摘要',
    });
    expect(checkDocumentationTruth(root)).toEqual(expect.arrayContaining([
      expect.stringMatching(/legacy.*缺少原文锚点/),
    ]));
  });
});
