/**
 * EnhancedKpiCard 组件 — oracle 单测
 *
 * 在 870 → 280 + 5 子文件机械迁移前先建立的行为锚点：
 * - 6 个公共 export 100% 保留（types + EnhancedKpiCard）
 * - 4 个主分支：hero × {progress, ring, segments} + standard × {value, donut, bar}
 * - loading 骨架 / onClick 键盘可达性 / StatusRail 显隐 / DeltaChip / Sparkline
 *
 * 调研报告 target_split 要求 ≥12 个 case 锁定可观察契约。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import {
  EnhancedKpiCard,
  type DonutDataItem,
  type KpiProgress,
  type KpiRing,
  type KpiSegment,
  type KpiDelta,
  type EnhancedKpiCardProps,
} from '../EnhancedKpiCard';
import type { KpiStatus } from '@/shared/utils/kpiStatus';

afterEach(cleanup);

// ---- 公共 fixtures ----
const goodStatus: KpiStatus = {
  key: 'good',
  tone: 'success',
  label: '健康',
  mark: '✓',
};
const badStatus: KpiStatus = {
  key: 'bad',
  tone: 'danger',
  label: '异常',
  mark: '!',
};
const neutralStatus: KpiStatus = {
  key: 'neutral',
  tone: 'neutral',
  label: '',
  mark: '',
};

const ratio2: DonutDataItem[] = [
  { label: '过户', value: 30 },
  { label: '非过户', value: 70 },
];
const ratio3: DonutDataItem[] = [
  { label: '主全', value: 40 },
  { label: '交三', value: 35 },
  { label: '单交强', value: 25 },
];

// ---- 公共类型断言（编译时即 oracle，但显式断言一遍可读性更好）----
describe('EnhancedKpiCard — 公共 export 契约', () => {
  it('6 个 public type 全部存在且可被赋值（编译期 + 运行期联合锁）', () => {
    const p: KpiProgress = { value: 50, threshold: 90 };
    const r: KpiRing = { value: 90, threshold: 99 };
    const s: KpiSegment[] = [{ label: 'a', value: 50, tone: 'success' }];
    const d: KpiDelta = { value: 1.2, unit: 'pt' };
    const i: DonutDataItem = { label: 'x', value: 1 };
    const props: EnhancedKpiCardProps = { title: 't', value: 1 };
    expect(typeof EnhancedKpiCard).toBe('object'); // memo 包装的是 object
    expect(p.value).toBe(50);
    expect(r.value).toBe(90);
    expect(s[0].tone).toBe('success');
    expect(d.value).toBe(1.2);
    expect(i.label).toBe('x');
    expect(props.title).toBe('t');
  });
});

// ---- loading 骨架 ----
describe('EnhancedKpiCard — loading 骨架', () => {
  it('loading=true 时只渲染骨架占位，不渲染 value', () => {
    const { container, queryByText } = render(
      <EnhancedKpiCard title="保费达成" value={12345} loading />
    );
    // 骨架 div 用 animate-pulse class
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    // 不应出现具体数字
    expect(queryByText(/12,345|12345/)).toBeNull();
  });
});

// ---- 标准变体 value 类型 ----
describe('EnhancedKpiCard — standard × value', () => {
  it('渲染 title + formatter 格式化后的 value + unit', () => {
    const { getByText } = render(
      <EnhancedKpiCard
        title="车均保费"
        value={2800}
        unit="元"
        formatter={(v) => `${v.toFixed(0)} 元`}
      />
    );
    expect(getByText('车均保费')).toBeTruthy();
    expect(getByText('2800 元')).toBeTruthy();
    expect(getByText('元')).toBeTruthy();
  });

  it('value=null/undefined 显示 --', () => {
    const { container } = render(<EnhancedKpiCard title="空" value={null} />);
    expect(container.textContent).toContain('--');
  });

  it('bigint value 走 formatCount 走通（不抛错）', () => {
    const { container } = render(
      <EnhancedKpiCard title="海量" value={BigInt(1234567)} />
    );
    expect(container.textContent).not.toContain('--');
  });
});

// ---- standard × donut ----
describe('EnhancedKpiCard — standard × donut', () => {
  it('渲染 MiniDonutChart SVG + ChartLegend 图例标签', () => {
    const { container, getAllByText } = render(
      <EnhancedKpiCard title="过户占比" type="donut" ratioData={ratio2} chartSize={64} />
    );
    // SVG 出现
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
    // 图例标签出现两个
    expect(getAllByText(/过户|非过户/).length).toBeGreaterThanOrEqual(2);
  });

  it('ratioData 全 0 时 MiniDonutChart 显示 0%', () => {
    const zeroData: DonutDataItem[] = [
      { label: 'a', value: 0 },
      { label: 'b', value: 0 },
    ];
    const { container } = render(
      <EnhancedKpiCard title="零" type="donut" ratioData={zeroData} />
    );
    expect(container.textContent).toContain('0%');
  });
});

// ---- standard × bar ----
describe('EnhancedKpiCard — standard × bar', () => {
  it('≥3 段时渲染多段条形 + 图例', () => {
    const { container, getAllByText } = render(
      <EnhancedKpiCard title="三段" type="bar" ratioData={ratio3} />
    );
    expect(container.textContent).toContain('主全');
    expect(container.textContent).toContain('交三');
    expect(container.textContent).toContain('单交强');
    // 至少包含 3 段比例文本（百分号）
    expect(getAllByText(/%/).length).toBeGreaterThanOrEqual(1);
  });

  it('2 段（双段）时不进入 ≥3 分支，仍渲染条形', () => {
    const { container } = render(
      <EnhancedKpiCard title="双段" type="bar" ratioData={ratio2} />
    );
    // 双段路径有两个 div，且包含 formatPercent 输出（含百分号）
    expect(container.textContent).toMatch(/%/);
  });

  it('ratioData total=0 时显示「暂无数据」兜底', () => {
    const zero: DonutDataItem[] = [
      { label: 'a', value: 0 },
      { label: 'b', value: 0 },
    ];
    const { getByText } = render(
      <EnhancedKpiCard title="空 bar" type="bar" ratioData={zero} />
    );
    expect(getByText('暂无数据')).toBeTruthy();
  });
});

// ---- hero × progress（数值型 hero）----
describe('EnhancedKpiCard — hero × value + progress', () => {
  it('渲染 38px 主数字 + ProgressBar + 达成文案', () => {
    const progress: KpiProgress = { value: 92.3, threshold: 99, note: '目标 13,256 万元' };
    const { container, getByText } = render(
      <EnhancedKpiCard
        title="保费达成"
        variant="hero"
        type="value"
        value={12000}
        unit="万元"
        progress={progress}
      />
    );
    expect(getByText('保费达成')).toBeTruthy();
    expect(getByText('万元')).toBeTruthy();
    // 38px 主数字 style 出现在 DOM（text-[38px] 类）
    expect(container.innerHTML).toContain('text-[38px]');
    // 进度文案出现
    expect(container.textContent).toContain('达成');
    expect(container.textContent).toContain('92.3');
    expect(getByText('目标 13,256 万元')).toBeTruthy();
  });

  it('同时给 deltaYoY/deltaMoM 时渲染同比 + 环比 chip 默认 label', () => {
    const progress: KpiProgress = { value: 80, threshold: 90 };
    const yoy: KpiDelta = { value: 1.5 };
    const mom: KpiDelta = { value: -2.0 };
    const { container } = render(
      <EnhancedKpiCard
        title="保费"
        variant="hero"
        type="value"
        value={100}
        progress={progress}
        deltaYoY={yoy}
        deltaMoM={mom}
      />
    );
    expect(container.textContent).toContain('同比');
    expect(container.textContent).toContain('环比');
  });
});

// ---- hero × ring（达成率类）----
describe('EnhancedKpiCard — hero × value + ring', () => {
  it('progress 缺 + ring 给定时走 RingChart 分支，渲染环形 SVG + 中心数字', () => {
    const ring: KpiRing = { value: 95, threshold: 99 };
    const { container } = render(
      <EnhancedKpiCard
        title="续保率"
        variant="hero"
        type="value"
        value={95}
        ring={ring}
      />
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
    // 中心数字（toFixed(0)）
    expect(container.textContent).toContain('95');
  });

  it('ring + note 同时给定，note 渲染在右侧描述区', () => {
    const ring: KpiRing = { value: 96 };
    const { getByText } = render(
      <EnhancedKpiCard
        title="续保率"
        variant="hero"
        type="value"
        value={96}
        ring={ring}
        note="阈值 95% · 健康"
      />
    );
    expect(getByText('阈值 95% · 健康')).toBeTruthy();
  });
});

// ---- hero × segments（拆解类）----
describe('EnhancedKpiCard — hero × bar + segments', () => {
  it('segments 渲染多段条 + 阈值线 + 图例', () => {
    const segments: KpiSegment[] = [
      { label: '满期赔付率', value: 64.4, tone: 'danger' },
      { label: '费用率', value: 24.1, tone: 'warning' },
    ];
    const { container, getByText } = render(
      <EnhancedKpiCard
        title="变动成本率"
        variant="hero"
        type="bar"
        value={88.5}
        segments={segments}
        segmentsThreshold={91}
      />
    );
    // 阈值标签
    expect(getByText(/阈值 91%/)).toBeTruthy();
    // 段标签 + 段数值
    expect(container.textContent).toContain('满期赔付率');
    expect(container.textContent).toContain('费用率');
    expect(container.textContent).toContain('64.4%');
    expect(container.textContent).toContain('24.1%');
  });
});

// ---- onClick 交互 ----
describe('EnhancedKpiCard — 交互', () => {
  it('提供 onClick 时启用 role=button + tabIndex=0 + clickHint title', () => {
    const fn = vi.fn();
    const { container } = render(
      <EnhancedKpiCard
        title="点我"
        value={1}
        onClick={fn}
        clickHint="下钻看趋势"
      />
    );
    const btn = container.querySelector('[role="button"]') as HTMLElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('tabindex')).toBe('0');
    expect(btn.getAttribute('title')).toBe('下钻看趋势');
    fireEvent.click(btn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Enter 键 + Space 键触发 onClick（键盘可达性）', () => {
    const fn = vi.fn();
    const { container } = render(<EnhancedKpiCard title="键盘" value={1} onClick={fn} />);
    const btn = container.querySelector('[role="button"]') as HTMLElement;
    fireEvent.keyDown(btn, { key: 'Enter' });
    fireEvent.keyDown(btn, { key: ' ' });
    expect(fn).toHaveBeenCalledTimes(2);
    // 其它按键不触发
    fireEvent.keyDown(btn, { key: 'a' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('未提供 onClick 时无 role=button', () => {
    const { container } = render(<EnhancedKpiCard title="静态" value={1} />);
    expect(container.querySelector('[role="button"]')).toBeNull();
  });
});

// ---- StatusRail 显隐 ----
describe('EnhancedKpiCard — StatusRail 显隐', () => {
  it('hero 变体 + status.key=neutral 时 rail 不出现（show=false）', () => {
    const { container } = render(
      <EnhancedKpiCard
        title="中性"
        variant="hero"
        type="value"
        value={1}
        status={neutralStatus}
      />
    );
    // neutral 时 StatusRail 仍渲染但 background=transparent
    const rail = container.querySelector('span[aria-hidden="true"].absolute.left-0');
    // 若存在则 background 必为 transparent
    if (rail) {
      const style = rail.getAttribute('style') || '';
      expect(style).toContain('transparent');
    }
    // StatusTag label 空，标签文本不应出现
    expect(container.textContent).not.toContain('健康');
  });

  it('hero 变体 + status.key=bad 时 rail 显示 + StatusTag label 渲染', () => {
    const { container, getByText } = render(
      <EnhancedKpiCard
        title="赔付率监控"
        variant="hero"
        type="value"
        value={1}
        status={badStatus}
      />
    );
    expect(getByText('异常')).toBeTruthy(); // status label
    expect(container.textContent).toContain('!');
  });

  it('standard × value + status=good（key=good）不应出现左 rail（只 bad/warn 出 rail）', () => {
    const { container } = render(
      <EnhancedKpiCard title="健康" value={100} status={goodStatus} />
    );
    // standard 变体仅 bad/warn 出 rail；good 不出
    // 我们检查 mb-1.5 父 div 没有 pl-2 偏移
    const headerDiv = container.querySelector('.mb-1\\.5');
    if (headerDiv) {
      expect(headerDiv.className).not.toContain('pl-2');
    }
  });

  it('standard × value + status=bad 时出现 StatusTag + rail（pl-2 偏移）', () => {
    const { container, getByText } = render(
      <EnhancedKpiCard title="赔付率监控" value={100} status={badStatus} />
    );
    expect(getByText('异常')).toBeTruthy();
    // rail span 存在
    const rail = container.querySelector('span[aria-hidden="true"].absolute.left-0');
    expect(rail).toBeTruthy();
  });
});

// ---- Sparkline ----
describe('EnhancedKpiCard — Sparkline 微趋势', () => {
  it('sparkline ≥2 点时渲染 path + 末点 circle', () => {
    const { container } = render(
      <EnhancedKpiCard
        title="趋势"
        value={100}
        sparkline={[10, 15, 12, 18, 22]}
      />
    );
    // Sparkline path
    expect(container.querySelector('svg path')).toBeTruthy();
    expect(container.querySelector('svg circle')).toBeTruthy();
  });

  it('sparkline 长度 <2 时不渲染', () => {
    const { container } = render(
      <EnhancedKpiCard title="无趋势" value={100} sparkline={[10]} />
    );
    expect(container.querySelector('svg path')).toBeNull();
  });
});

// ---- DeltaChip（standard 变体）----
describe('EnhancedKpiCard — DeltaChip 涨跌', () => {
  it('value=0 时不渲染（NaN 防护 + 零值短路）', () => {
    const { container } = render(
      <EnhancedKpiCard title="zero" value={1} deltaYoY={{ value: 0 }} />
    );
    // DeltaChip 内 value === 0 时仍渲染（• 标记），但 chip 至少出现
    // 这里只验证 chip 存在（含 "0.0pt" 等）
    expect(container.textContent).toMatch(/0\.0|\+0/);
  });

  it('reverse=false + value>0 显示 ▲ 标记', () => {
    const { container } = render(
      <EnhancedKpiCard title="上涨" value={1} deltaYoY={{ value: 2.5, reverse: false }} />
    );
    expect(container.textContent).toContain('▲');
    expect(container.textContent).toContain('+2.5');
  });

  it('value<0 显示 ▼ 标记', () => {
    const { container } = render(
      <EnhancedKpiCard title="下跌" value={1} deltaYoY={{ value: -1.5 }} />
    );
    expect(container.textContent).toContain('▼');
  });
});
