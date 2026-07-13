import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

export function checkProductNaming(root) {
  const errors = [];
  const metadata = read(root, 'src/shared/config/productMetadata.ts');
  const productName = metadata.match(/productName\s*:\s*['"]([^'"]+)['"]/)?.[1];
  const htmlTitle = read(root, 'index.html').match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  if (!productName || htmlTitle !== productName) {
    errors.push(`index.html title 必须与 productMetadata 主名一致：${productName ?? '无法解析主名'}`);
  }

  const currentEntryFiles = [
    'src/components/layout/TopNavigation.tsx',
    'src/features/auth/LoginPage.tsx',
    'src/features/copilot/CopilotDrawer.tsx',
  ];
  const obsoleteNames = ['车险业绩分析系统', '车险经营分析系统'];
  for (const relativePath of currentEntryFiles) {
    const content = read(root, relativePath);
    const importsMetadata = /import\s*{[^}]*\bPRODUCT_METADATA\b[^}]*}\s*from/.test(content);
    const metadataReferences = content.match(/\bPRODUCT_METADATA\b/g)?.length ?? 0;
    if (!importsMetadata || metadataReferences < 2) {
      errors.push(`${relativePath} 必须 import 并实际引用 PRODUCT_METADATA`);
    }
    if (productName && new RegExp(`['\"]${productName}['\"]`).test(content)) {
      errors.push(`${relativePath} 不得硬编码当前产品主名：${productName}`);
    }
    for (const name of obsoleteNames) {
      if (content.includes(name)) errors.push(`${relativePath} 不得硬编码旧产品名：${name}`);
    }
  }

  const accessControl = read(root, 'src/features/admin/AccessControlPage.tsx');
  if (/\bALL_ROUTES\b/.test(accessControl)) {
    errors.push('AccessControlPage.tsx 不得本地维护 ALL_ROUTES');
  }
  return errors;
}

function literalText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

function property(object, name) {
  const member = object.properties.find((candidate) => ts.isPropertyAssignment(candidate)
    && candidate.name.getText().replace(/^['"]|['"]$/g, '') === name);
  return member && ts.isPropertyAssignment(member) ? member.initializer : undefined;
}

function assertSupportedObject(node, label) {
  if (!ts.isObjectLiteralExpression(node)) throw new Error(`${label} 必须是 object literal`);
  for (const member of node.properties) {
    if (ts.isSpreadAssignment(member)) throw new Error(`${label} 不支持 spread`);
    if (!ts.isPropertyAssignment(member)) throw new Error(`${label} 仅支持 property assignment`);
    if (ts.isComputedPropertyName(member.name)) {
      throw new Error(`${label} 不支持 computed property`);
    }
  }
  return node;
}

function requiredString(object, name, label) {
  const node = property(object, name);
  const value = node && literalText(node);
  if (value === undefined) throw new Error(`${label}.${name} 必须是 string literal`);
  return value;
}

function findArray(file, variableName) {
  let result;
  let found = false;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === variableName) {
      found = true;
      const initializer = node.initializer;
      result = ts.isArrayLiteralExpression(initializer)
        ? initializer
        : initializer && ts.isCallExpression(initializer) && ts.isArrayLiteralExpression(initializer.arguments[0])
          ? initializer.arguments[0]
          : undefined;
    }
    node.forEachChild(visit);
  };
  visit(file);
  if (found && !result) throw new Error(`${variableName} 必须使用 array literal 初始化`);
  return result;
}

function parseAliasArray(array, label) {
  if (!array) return [];
  return array.elements.map((element, index) => {
    const alias = assertSupportedObject(element, `${label}[${index}]`);
    return {
      path: requiredString(alias, 'path', `${label}[${index}]`),
      to: requiredString(alias, 'to', `${label}[${index}]`),
    };
  });
}

function parseRegistry(source) {
  const file = ts.createSourceFile('routeRegistry.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (file.parseDiagnostics.length > 0) {
    throw new Error(`TypeScript 语法错误：${ts.flattenDiagnosticMessageText(file.parseDiagnostics[0].messageText, ' ')}`);
  }
  const routesArray = findArray(file, 'ROUTES');
  if (!routesArray) throw new Error('无法解析 ROUTES 数组');
  const routes = routesArray.elements.map((element, index) => {
    const route = assertSupportedObject(element, `ROUTES[${index}]`);
    const redirectsNode = property(route, 'redirects');
    if (redirectsNode && !ts.isArrayLiteralExpression(redirectsNode)) {
      throw new Error(`ROUTES[${index}].redirects 必须是 array literal`);
    }
    const redirects = parseAliasArray(redirectsNode, `ROUTES[${index}].redirects`);
    return {
      id: requiredString(route, 'id', `ROUTES[${index}]`),
      path: requiredString(route, 'path', `ROUTES[${index}]`),
      redirects,
    };
  });
  return { routes, permissionAliases: parseAliasArray(findArray(file, 'LEGACY_PERMISSION_ALIASES'), 'LEGACY_PERMISSION_ALIASES') };
}

function duplicates(values) {
  const seen = new Set();
  return [...new Set(values.filter((value) => value && (seen.has(value) || !seen.add(value))))];
}

export function checkRouteRegistry(root) {
  let routes;
  let permissionAliases;
  try {
    ({ routes, permissionAliases } = parseRegistry(read(root, 'src/shared/config/routeRegistry.ts')));
  } catch (error) {
    return [`route registry 解析失败：${error.message}`];
  }
  const errors = [];
  for (const id of duplicates(routes.map((route) => route.id))) errors.push(`重复 route id：${id}`);
  for (const routePath of duplicates(routes.map((route) => route.path))) errors.push(`重复 canonical path：${routePath}`);
  const canonical = new Set(routes.map((route) => route.path));
  const redirectPaths = routes.flatMap((route) => route.redirects.map((redirect) => redirect.path));
  for (const redirectPath of duplicates(redirectPaths)) errors.push(`重复 redirect path：${redirectPath}`);
  for (const redirectPath of new Set(redirectPaths)) {
    if (canonical.has(redirectPath)) errors.push(`redirect 与 canonical path 冲突：${redirectPath}`);
  }
  for (const redirect of routes.flatMap((route) => route.redirects)) {
    const target = redirect.to.split('?')[0];
    if (!canonical.has(target)) errors.push(`browser redirect target 未登记 canonical：${target}`);
  }
  const permissionPaths = permissionAliases.map((alias) => alias.path);
  for (const aliasPath of duplicates(permissionPaths)) errors.push(`重复 permission alias path：${aliasPath}`);
  for (const aliasPath of new Set(permissionPaths)) {
    if (canonical.has(aliasPath)) errors.push(`permission alias 与 canonical path 冲突：${aliasPath}`);
    if (redirectPaths.includes(aliasPath)) errors.push(`permission alias 与 browser redirect 冲突：${aliasPath}`);
  }
  for (const alias of permissionAliases) {
    const target = alias.to.split('?')[0];
    if (!canonical.has(target)) errors.push(`permission alias target 未登记 canonical：${target}`);
  }
  return errors;
}

const README_STALE_COUNT_PATTERNS = [
  /\b\d+\s*个业务功能模块/, /\b\d+\s*个查询子路由模块/, /\b\d+\s*个 SQL 生成器/,
  /\b\d+\s*个字段/, /\b\d+\s*域元数据注册表/, /\b\d+\s*个事实域/, /\b\d+\s*个维度表/,
  /测试（\d+\s*个文件）/, /\b\d+\s*个工程脚本/, /\b\d+\s*条 CI\/CD pipeline/,
  /\b\d+\+?\s*变量/, /业务查询[^\n]*\d+\s*个子路由模块/, /数据域注册表（\d+\s*个活跃域）/,
];
const LEGACY_ANCHORS = [
  '## 二、模块层级与依赖规则', '### 2.3 子项目间通信方式', '## 三、子项目标准结构',
  '### 3.1 README.md 模板', '## 四、命名规范', '### 4.3 Git分支',
  'git fetch origin main && git rebase origin/main && bun run governance',
  '## 六、新建子项目检查清单', '## 七、AI协作指引',
];

export function checkDocumentationTruth(root) {
  const errors = [];
  const readme = read(root, 'README.md');
  if (README_STALE_COUNT_PATTERNS.some((pattern) => pattern.test(readme))) errors.push('README 含易腐快照计数');
  const currentStart = readme.indexOf('## 1) 项目概述');
  const currentEnd = readme.indexOf('## 2) 技术栈');
  const currentCapabilities = currentStart >= 0 && currentEnd > currentStart
    ? readme.slice(currentStart, currentEnd)
    : '';
  for (const retired of ['marketing-report', 'coefficient']) {
    if (currentCapabilities.includes(retired)) errors.push(`README 不得把 ${retired} 声明为当前能力`);
  }
  try {
    const { routes } = parseRegistry(read(root, 'src/shared/config/routeRegistry.ts'));
    const canonical = new Set(routes.map((route) => route.path));
    const pageHeading = currentCapabilities.indexOf('### 前端页面');
    const pageSection = pageHeading >= 0 ? currentCapabilities.slice(pageHeading) : '';
    const documented = new Set([...pageSection.matchAll(/`(\/[^`?]+)`/g)].map((match) => match[1]));
    const missingRoutes = [...canonical].filter((routePath) => !documented.has(routePath));
    const extraRoutes = [...documented].filter((routePath) => !canonical.has(routePath));
    if (missingRoutes.length) errors.push(`README 前端页面路由缺少：${missingRoutes.join('、')}`);
    if (extraRoutes.length) errors.push(`README 前端页面路由多出：${extraRoutes.join('、')}`);
  } catch (error) {
    errors.push(`README 路由对账失败：${error.message}`);
  }
  const legacy = read(root, 'reference/legacy-python-subproject-convention.md');
  const missing = LEGACY_ANCHORS.filter((anchor) => !legacy.includes(anchor));
  if (missing.length) errors.push(`legacy reference 缺少原文锚点：${missing.join('、')}`);
  return errors;
}

export function checkNamingAndRouteGovernance(root) {
  return [...checkProductNaming(root), ...checkRouteRegistry(root), ...checkDocumentationTruth(root)];
}
