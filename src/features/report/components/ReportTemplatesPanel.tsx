import React from 'react';

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  features: string[];
}

interface ReportTemplatesPanelProps {
  onSelectTemplate: (template: ReportTemplate) => void;
}

const templates: ReportTemplate[] = [
  {
    id: 'monthly-summary',
    name: '月度经营汇总',
    description: '月度保费收入、业务员业绩、机构排名等核心指标汇总',
    category: '综合分析',
    icon: '📊',
    features: ['月度保费趋势', '业务员Top10', '机构业绩对比', '续保率分析']
  },
  {
    id: 'sales-performance',
    name: '业务员业绩分析',
    description: '聚焦业务员维度，分析个人业绩、客户结构、增长趋势',
    category: '业绩分析',
    icon: '👥',
    features: ['个人业绩排名', '客户类别分布', '月度增长对比', '优质业务占比']
  },
  {
    id: 'renewal-analysis',
    name: '续保专项分析',
    description: '深入分析续保业务，识别续保机会和风险点',
    category: '续保分析',
    icon: '🔄',
    features: ['续保率趋势', '分机构续保排名', '续保明细表格', '到期提醒']
  },
  {
    id: 'truck-specialized',
    name: '营业货车专项',
    description: '针对营业货车业务的专业分析模板',
    category: '专项分析',
    icon: '🚛',
    features: ['吨位分布分析', '机构货车占比', '保费vs吨位对比', '下钻分析']
  },
  {
    id: 'growth-analysis',
    name: '增长率分析',
    description: '分析业务增长情况，同比/环比数据对比',
    category: '增长分析',
    icon: '📈',
    features: ['同比增长率', '环比增长率', 'YTD累计增长', '预测分析']
  },
  {
    id: 'comparison-report',
    name: '数据对比分析',
    description: '多维度数据对比，帮助发现业务机会和问题',
    category: '对比分析',
    icon: '⚖️',
    features: ['时间段对比', '机构间对比', '业务员对比', '自定义对比']
  }
];

const categories = ['全部', ...Array.from(new Set(templates.map(t => t.category)))];

export const ReportTemplatesPanel: React.FC<ReportTemplatesPanelProps> = ({
  onSelectTemplate
}) => {
  const [selectedCategory, setSelectedCategory] = React.useState('全部');

  const filteredTemplates = selectedCategory === '全部'
    ? templates
    : templates.filter(t => t.category === selectedCategory);

  return (
    <div className="bg-white p-4 sm:p-6 rounded shadow">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800 mb-2">📋 报表模板</h2>
        <p className="text-sm text-gray-600">选择预设模板快速生成常用分析报告</p>
      </div>

      {/* Category Filter */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {categories.map(category => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                selectedCategory === category
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTemplates.map(template => (
          <div
            key={template.id}
            className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group"
            onClick={() => onSelectTemplate(template)}
          >
            <div className="flex items-start gap-3 mb-3">
              <span className="text-2xl">{template.icon}</span>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-800 group-hover:text-blue-600 transition-colors">
                  {template.name}
                </h3>
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                  {template.category}
                </span>
              </div>
            </div>

            <p className="text-sm text-gray-600 mb-3 line-clamp-2">
              {template.description}
            </p>

            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-700">包含功能：</p>
              <div className="flex flex-wrap gap-1">
                {template.features.slice(0, 3).map(feature => (
                  <span
                    key={feature}
                    className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded"
                  >
                    {feature}
                  </span>
                ))}
                {template.features.length > 3 && (
                  <span className="text-xs text-gray-500">
                    +{template.features.length - 3}个功能
                  </span>
                )}
              </div>
            </div>

            <button className="w-full mt-4 px-4 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors group-hover:bg-blue-600">
              使用此模板
            </button>
          </div>
        ))}
      </div>

      {filteredTemplates.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <p>该分类下暂无模板</p>
        </div>
      )}
    </div>
  );
};