import { describe, it, expect } from 'vitest';
import { routeToTool, type RouteMeta } from '../tools/build-tools.js';

const sampleRoute: RouteMeta = {
  key: 'KPI',
  path: '/kpi',
  fullPath: '/api/query/kpi',
  method: 'GET',
  summary: 'KPI 大盘指标',
  description: '返回保费/件数/赔款核心 KPI',
  parameters: [
    { name: 'year', type: 'number', description: '保单年度' },
    { name: 'start_date', type: 'date', description: '开始日期' },
    { name: 'granularity', type: 'string', description: '粒度', enum: ['week', 'month'] },
    { name: 'org', type: 'string', description: '机构', required: true },
  ],
  tags: ['kpi'],
};

describe('routeToTool', () => {
  it('生成 cx_query_<key> 名字（小写）', () => {
    expect(routeToTool(sampleRoute).name).toBe('cx_query_kpi');
  });

  it('描述拼接 summary + description', () => {
    const tool = routeToTool(sampleRoute);
    expect(tool.description).toContain('KPI 大盘指标');
    expect(tool.description).toContain('返回保费');
  });

  it('参数类型转 JSON Schema：number → number, date → string', () => {
    const props = routeToTool(sampleRoute).inputSchema.properties;
    expect(props.year.type).toBe('number');
    expect(props.start_date.type).toBe('string');
    expect(props.start_date.description).toMatch(/YYYY-MM-DD/);
  });

  it('enum 透传', () => {
    expect(routeToTool(sampleRoute).inputSchema.properties.granularity.enum)
      .toEqual(['week', 'month']);
  });

  it('required 仅当至少一个参数标注 required', () => {
    const tool = routeToTool(sampleRoute);
    expect(tool.inputSchema.required).toEqual(['org']);
  });

  it('无 required 参数时 required 字段为 undefined（不出现空数组）', () => {
    const noReq: RouteMeta = { ...sampleRoute, parameters: [{ name: 'a', type: 'string', description: 'x' }] };
    expect(routeToTool(noReq).inputSchema.required).toBeUndefined();
  });
});
