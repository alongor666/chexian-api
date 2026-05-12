/**
 * 输出格式化：table / json / csv
 */
import Table from 'cli-table3';
import kleur from 'kleur';

export type OutputFormat = 'table' | 'json' | 'csv';

export function renderOutput(data: unknown, format: OutputFormat): string {
  if (format === 'json') return JSON.stringify(data, null, 2);

  const rows = extractRows(data);
  if (!rows || rows.length === 0) return kleur.gray('(no rows)');

  if (format === 'csv') return toCsv(rows);
  return toTable(rows);
}

/** 从 API 响应里挖出 rows 数组 */
function extractRows(data: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  // 优先 .data.rows / .data，其次顶层 .rows
  if (Array.isArray(d.rows)) return d.rows as Record<string, unknown>[];
  if (d.data && typeof d.data === 'object') {
    const inner = d.data as Record<string, unknown>;
    if (Array.isArray(inner)) return inner as Record<string, unknown>[];
    if (Array.isArray(inner.rows)) return inner.rows as Record<string, unknown>[];
  }
  return null;
}

function toTable(rows: Record<string, unknown>[]): string {
  const headers = collectHeaders(rows);
  const t = new Table({
    head: headers.map((h) => kleur.cyan(h)),
    style: { head: [], border: ['gray'] },
  });
  for (const r of rows) {
    t.push(headers.map((h) => formatCell(r[h])));
  }
  return t.toString();
}

function toCsv(rows: Record<string, unknown>[]): string {
  const headers = collectHeaders(rows);
  const lines: string[] = [headers.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(formatCell(r[h]))).join(','));
  }
  return lines.join('\n');
}

function collectHeaders(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return Array.from(seen);
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
