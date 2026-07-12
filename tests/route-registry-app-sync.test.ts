import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../src/shared/config/routeRegistry';

const appSource = readFileSync(resolve(process.cwd(), 'src/app/App.tsx'), 'utf8');
const sourceFile = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function jsxAttribute(node: ts.JsxAttributes, name: string): string | undefined {
  const attribute = node.properties.find((property): property is ts.JsxAttribute => (
    ts.isJsxAttribute(property) && property.name.getText(sourceFile) === name
  ));
  return attribute?.initializer && ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : undefined;
}

function appRoutes(): Map<string, string | undefined> {
  const routes = new Map<string, string | undefined>();
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === 'Route') {
      const path = jsxAttribute(node.attributes, 'path');
      if (path) {
        let destination: string | undefined;
        node.forEachChild(function findNavigate(child) {
          if (ts.isJsxSelfClosingElement(child) && child.tagName.getText(sourceFile) === 'Navigate') {
            destination = jsxAttribute(child.attributes, 'to');
          }
          child.forEachChild(findNavigate);
        });
        routes.set(path.startsWith('/') ? path : `/${path}`, destination);
      }
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return routes;
}

describe('route registry and App route synchronization', () => {
  it('keeps all 17 canonical pages as explicit App routes', () => {
    const declared = appRoutes();
    expect(ROUTES).toHaveLength(17);
    for (const route of ROUTES) {
      expect(declared.has(route.path), `missing explicit Route for ${route.id}: ${route.path}`).toBe(true);
    }
  });

  it('derives every explicit legacy redirect path and destination from the registry', () => {
    const declared = appRoutes();
    const redirects = ROUTES.flatMap((route) => route.redirects ?? []);

    expect(redirects).toHaveLength(7);
    for (const redirect of redirects) {
      expect(declared.get(redirect.path), `redirect drift for ${redirect.path}`).toBe(redirect.to);
    }
  });
});
