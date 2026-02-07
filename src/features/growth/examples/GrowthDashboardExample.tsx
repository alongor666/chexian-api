import React, { useState } from 'react';
import GrowthAnalysisPanel from '../components/GrowthAnalysisPanel';
import type { AdvancedFilterState } from '../../../shared/types/data';

/**
 * 增长率分析集成示例
 * 展示如何在现有Dashboard中集成增长率分析功能
 */
export const GrowthDashboardExample: React.FC = () => {
  const [selectedOrg, setSelectedOrg] = useState<string>('');
  const [selectedSalesman, setSelectedSalesman] = useState<string>('');
  const [filters] = useState<AdvancedFilterState>({});

  // 模拟机构数据（实际使用时从API获取）
  const mockOrgs = [
    '北京分公司',
    '上海分公司', 
    '广州分公司',
    '深圳分公司'
  ];

  const mockSalesmen = [
    '张三',
    '李四',
    '王五',
    '赵六'
  ];

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '8px' }}>
          销售人员业绩增长率分析
        </h1>
        <p style={{ color: '#666', fontSize: '14px' }}>
          基于2025年数据对比2026年业绩表现，支持多维度增长率分析
        </p>
      </div>

      {/* 筛选控制面板 */}
      <div style={{ 
        display: 'flex', 
        gap: '16px', 
        marginBottom: '24px',
        padding: '16px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px'
      }}>
        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>
            选择机构
          </label>
          <select 
            value={selectedOrg} 
            onChange={(e) => setSelectedOrg(e.target.value)}
            style={{ 
              padding: '8px 12px', 
              borderRadius: '6px', 
              border: '1px solid #ddd',
              minWidth: '150px'
            }}
          >
            <option value="">全部机构</option>
            {mockOrgs.map(org => (
              <option key={org} value={org}>{org}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>
            选择业务员
          </label>
          <select 
            value={selectedSalesman} 
            onChange={(e) => setSelectedSalesman(e.target.value)}
            style={{ 
              padding: '8px 12px', 
              borderRadius: '6px', 
              border: '1px solid #ddd',
              minWidth: '150px'
            }}
          >
            <option value="">全部业务员</option>
            {mockSalesmen.map(salesman => (
              <option key={salesman} value={salesman}>{salesman}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 增长率分析面板 */}
      <div style={{ 
        backgroundColor: 'white', 
        borderRadius: '8px', 
        border: '1px solid #e0e0e0',
        overflow: 'hidden'
      }}>
        <GrowthAnalysisPanel
          filters={filters}
        />
      </div>

      {/* 使用说明 */}
      <div style={{ 
        marginTop: '24px',
        padding: '16px',
        backgroundColor: '#f0f7ff',
        border: '1px solid #b3d9ff',
        borderRadius: '8px'
      }}>
        <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>
          📊 使用说明
        </h3>
        <ul style={{ margin: '0', paddingLeft: '20px', fontSize: '14px', lineHeight: '1.6' }}>
          <li><strong>机构分析</strong>：查看各机构保费增长率趋势，支持同比、环比分析</li>
          <li><strong>业务员分析</strong>：分析特定业务员的业绩表现，按险类细分增长率</li>
          <li><strong>KPI分析</strong>：跟踪续保率等关键指标的增长变化</li>
          <li><strong>时间维度</strong>：支持月度、季度的不同时间粒度分析</li>
          <li><strong>数据筛选</strong>：可按机构、业务员筛选，聚焦特定范围分析</li>
        </ul>
      </div>
    </div>
  );
};

export default GrowthDashboardExample;
