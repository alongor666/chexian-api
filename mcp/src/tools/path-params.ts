/**
 * path 模板参数替换：/api/query/patrol/:domain + {domain:'renewal'} → /api/query/patrol/renewal
 *
 * 已消费的参数从 query args 中移除，避免重复出现在 query string。
 * 缺少必需 path 参数时抛错（调用前置校验）。
 */
export function applyPathParams(
  pathTemplate: string,
  args: Record<string, string | number | boolean>,
): { resolvedPath: string; restArgs: Record<string, string | number | boolean> } {
  const restArgs = { ...args };
  const resolvedPath = pathTemplate.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
    const value = restArgs[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`缺少必需的 path 参数: ${name}（路由 ${pathTemplate}）`);
    }
    delete restArgs[name];
    return encodeURIComponent(String(value));
  });
  return { resolvedPath, restArgs };
}
