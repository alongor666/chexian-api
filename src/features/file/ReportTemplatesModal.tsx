/**
 * 报表模板管理弹窗
 *
 * 提供报表模板的查看和管理功能
 */

import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  TrendingUp,
  ClipboardList,
  RefreshCw,
  Calculator,
  Search,
  X,
  FileQuestion,
} from 'lucide-react';

interface ReportTemplatesModalProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: string;
  route: string;
}

const templates: ReportTemplate[] = [
  {
    id: 'daily-kpi',
    name: '日度经营快报',
    description: '展示当日核心 KPI 指标和趋势对比',
    icon: BarChart3,
    category: '日报',
    route: '/dashboard',
  },
  {
    id: 'weekly-summary',
    name: '周度汇总分析',
    description: '按自然周汇总保费、件数和增长率',
    icon: TrendingUp,
    category: '周报',
    route: '/growth',
  },
  {
    id: 'monthly-report',
    name: '月度经营报告',
    description: '月度全量数据分析和机构排名',
    icon: ClipboardList,
    category: '月报',
    route: '/comparison',
  },
  {
    id: 'renewal-analysis',
    name: '续保专项分析',
    description: '续保率、续保模式和到期预警',
    icon: RefreshCw,
    category: '专项',
    route: '/renewal',
  },
  {
    id: 'cost-analysis',
    name: '成本分析报告',
    description: '赔付率、费用率和综合成本',
    icon: Calculator,
    category: '专项',
    route: '/cost',
  },
  {
    id: 'coefficient-monitor',
    name: '系数合规监控',
    description: '商车自主定价系数监控和预警',
    icon: Search,
    category: '专项',
    route: '/coefficient',
  },
];

const categories = ['全部', '日报', '周报', '月报', '专项'];

/**
 * 报表模板管理弹窗
 */
export const ReportTemplatesModal: React.FC<ReportTemplatesModalProps> = ({
  isOpen,
  onClose,
}) => {
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTemplates = templates.filter((template) => {
    const matchesCategory =
      selectedCategory === '全部' || template.category === selectedCategory;
    const matchesSearch =
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleSelectTemplate = useCallback(
    (template: ReportTemplate) => {
      onClose();
      navigate(template.route);
    },
    [navigate, onClose]
  );

  if (!isOpen) return null;

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-templates-title"
      >
        {/* 弹窗内容 */}
        <div
          className="bg-white dark:bg-neutral-900 rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[80vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 头部 */}
          <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-700">
            <h2
              id="report-templates-title"
              className="text-lg font-semibold text-neutral-900 dark:text-white flex items-center"
            >
              <ClipboardList size={24} className="mr-2 text-primary" aria-hidden="true" />
              报表模板
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-full transition-colors"
              aria-label="关闭"
            >
              <X size={20} className="text-neutral-500" />
            </button>
          </div>

          {/* 搜索和筛选 */}
          <div className="p-4 border-b border-neutral-200 dark:border-neutral-700 space-y-3">
            {/* 搜索框 */}
            <div className="relative">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                aria-hidden="true"
              />
              <input
                type="text"
                placeholder="搜索模板..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
                aria-label="搜索模板"
              />
            </div>

            {/* 分类标签 */}
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="模板分类">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    selectedCategory === category
                      ? 'bg-primary-bg text-primary-dark'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                  }`}
                  role="tab"
                  aria-selected={selectedCategory === category}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          {/* 模板列表 */}
          <div className="flex-1 overflow-y-auto p-4">
            {filteredTemplates.length === 0 ? (
              <div className="text-center py-8">
                <FileQuestion size={48} className="mx-auto text-neutral-300" aria-hidden="true" />
                <p className="mt-2 text-neutral-500 dark:text-neutral-400">
                  没有找到匹配的模板
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredTemplates.map((template) => {
                  const IconComponent = template.icon;
                  return (
                    <button
                      key={template.id}
                      onClick={() => handleSelectTemplate(template)}
                      className="flex items-start p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:border-primary-border hover:bg-primary-bg/50 transition-all text-left"
                    >
                      <IconComponent
                        size={24}
                        className="mr-3 mt-0.5 text-primary flex-shrink-0"
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-neutral-900 dark:text-white truncate">
                            {template.name}
                          </span>
                          <span className="text-xs px-2 py-0.5 bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 rounded-full flex-shrink-0">
                            {template.category}
                          </span>
                        </div>
                        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
                          {template.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 底部提示 */}
          <div className="p-4 border-t border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800">
            <p className="text-xs text-neutral-500 dark:text-neutral-400 text-center">
              点击模板可快速跳转到对应的分析页面
            </p>
          </div>
        </div>
      </div>
    </>
  );
};
