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
  ];
  const obsoleteNames = ['车险业绩分析系统', '车险经营分析系统'];
  for (const relativePath of currentEntryFiles) {
    const content = read(root, relativePath);
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

function parseRegistry(source) {
  const file = ts.createSourceFile('routeRegistry.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let routesArray;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'ROUTES') {
      const callOrArray = node.initializer;
      routesArray = ts.isArrayLiteralExpression(callOrArray)
        ? callOrArray
        : callOrArray && ts.isCallExpression(callOrArray) && ts.isArrayLiteralExpression(callOrArray.arguments[0])
          ? callOrArray.arguments[0]
          : undefined;
    }
    node.forEachChild(visit);
  };
  visit(file);
  if (!routesArray) throw new Error('无法解析 ROUTES 数组');
  return routesArray.elements.filter(ts.isObjectLiteralExpression).map((route) => {
    const redirectsNode = property(route, 'redirects');
    const redirects = redirectsNode && ts.isArrayLiteralExpression(redirectsNode)
      ? redirectsNode.elements.filter(ts.isObjectLiteralExpression).map((redirect) => ({
        path: literalText(property(redirect, 'path')),
        to: literalText(property(redirect, 'to')),
      }))
      : [];
    return { id: literalText(property(route, 'id')), path: literalText(property(route, 'path')), redirects };
  });
}

function duplicates(values) {
  const seen = new Set();
  return [...new Set(values.filter((value) => value && (seen.has(value) || !seen.add(value))))];
}

export function checkRouteRegistry(root) {
  let routes;
  try {
    routes = parseRegistry(read(root, 'src/shared/config/routeRegistry.ts'));
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
  return errors;
}

export function checkNamingAndRouteGovernance(root) {
  return [...checkProductNaming(root), ...checkRouteRegistry(root)];
}
