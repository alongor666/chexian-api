/**
 * 单元测试：时间口径反问协议（B290 语义层 v0.1，决策 2 — 全 4 触发）
 *
 * 协议是机器可读 SSOT，定义"何种歧义应让 LLM 先反问用户而非自由选口径"。
 * 测试断言：
 *   1. 4 类触发齐全且字段完整
 *   2. 关联的 timeWindow 均为合法 RouteTimeWindow 枚举
 *   3. composeAskBackHint('ytd-progress') 非空且含反问指令（原始事故口径）
 *   4. composeAskBackHint('window') 为空（窗口口径无歧义，不打扰）
 *   5. 真实消费断言：每个 ytd-progress 路由的 timeWindowNote 已含反问提示
 */
import { describe, expect, it } from 'vitest';
import {
  DISAMBIGUATION_PROTOCOL,
  composeAskBackHint,
  type DisambiguationTrigger,
} from '../disambiguation-protocol.js';
import {
  QUERY_ROUTE_METADATA,
  type RouteTimeWindow,
} from '../query-routes-metadata.js';

const VALID_ROUTE_TIME_WINDOWS: ReadonlySet<RouteTimeWindow> = new Set([
  'window',
  'rolling',
  'policy-year',
  'ytd-progress',
  'cohort-development',
  'snapshot',
  'any',
]);

describe('时间口径反问协议 SSOT', () => {
  it('4 类触发齐全', () => {
    const ids = DISAMBIGUATION_PROTOCOL.map((t) => t.id).sort();
    expect(ids).toEqual(
      ['cross-caliber', 'date-anchor', 'denominator-period', 'window-vs-progress'].sort()
    );
  });

  it('每条触发字段完整（name/triggerWhen/askBackTemplate 非空）', () => {
    for (const t of DISAMBIGUATION_PROTOCOL) {
      expect(t.name.trim(), `${t.id} name`).not.toBe('');
      expect(t.triggerWhen.trim(), `${t.id} triggerWhen`).not.toBe('');
      expect(t.askBackTemplate.trim(), `${t.id} askBackTemplate`).not.toBe('');
    }
  });

  it('关联 timeWindow 均为合法 RouteTimeWindow 枚举', () => {
    for (const t of DISAMBIGUATION_PROTOCOL) {
      for (const tw of t.relatedTimeWindows) {
        expect(VALID_ROUTE_TIME_WINDOWS.has(tw), `${t.id} 关联非法口径 ${tw}`).toBe(true);
      }
    }
  });

  it('window-vs-progress 触发关联 ytd-progress（原始事故口径）', () => {
    const t = DISAMBIGUATION_PROTOCOL.find((x) => x.id === 'window-vs-progress');
    expect(t?.relatedTimeWindows).toContain('ytd-progress');
  });
});

describe('composeAskBackHint', () => {
  it('ytd-progress 口径返回含反问指令的提示', () => {
    const hint = composeAskBackHint('ytd-progress');
    expect(hint).not.toBe('');
    expect(hint).toContain('反问');
  });

  it('window 口径返回空（无歧义不打扰）', () => {
    expect(composeAskBackHint('window')).toBe('');
  });
});

describe('真实消费断言（协议 → 路由 timeWindowNote）', () => {
  it('每个 ytd-progress 路由的 timeWindowNote 已含反问提示', () => {
    const ytdRoutes = QUERY_ROUTE_METADATA.filter((m) => m.timeWindow === 'ytd-progress');
    expect(ytdRoutes.length).toBeGreaterThan(0);
    const hint = composeAskBackHint('ytd-progress');
    for (const r of ytdRoutes) {
      expect(r.timeWindowNote ?? '', `${r.path} 的 timeWindowNote 应含反问提示`).toContain(hint);
    }
  });
});
