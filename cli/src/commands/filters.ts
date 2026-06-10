/**
 * cx filters [--dimension <name>] [-f table|json|csv]
 *
 * GET /api/filters/options — 列出各筛选维度的可选值（受 dataScope 限制）。
 * 写 cx query 的过滤参数前，先用本命令查维度有哪些值。
 */
import kleur from 'kleur';
import { cxGet } from '../api.js';
import { renderOutput, type OutputFormat } from '../output.js';
import { failWith, EXIT } from '../exit-codes.js';

export async function filtersCommand(opts: { dimension?: string; format?: OutputFormat }): Promise<void> {
  try {
    const resp = await cxGet<{ success: boolean; data: Record<string, unknown> }>('/api/filters/options');
    const all = resp.data ?? {};
    if (opts.dimension && !(opts.dimension in all)) {
      console.error(kleur.red(`✘ 未知维度: ${opts.dimension}`));
      console.error(kleur.gray(`  可用维度: ${Object.keys(all).join(', ')}`));
      process.exit(EXIT.USAGE);
    }
    const picked = opts.dimension ? { [opts.dimension]: (all as Record<string, unknown>)[opts.dimension] ?? [] } : all;
    const rows = Object.entries(picked).map(([dimension, values]) => ({
      dimension,
      count: Array.isArray(values) ? values.length : '',
      values: Array.isArray(values) ? values.join(' | ') : JSON.stringify(values),
    }));
    const fmt: OutputFormat = opts.format ?? (process.stdout.isTTY ? 'table' : 'json');
    console.log(renderOutput(rows, fmt));
  } catch (err) {
    failWith(err);
  }
}
