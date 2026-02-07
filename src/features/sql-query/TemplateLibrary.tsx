/**
 * TemplateLibrary 组件
 *
 * 预置查询模板库侧边栏
 */

import { useState } from 'react';
import { QUERY_TEMPLATES } from './QUERY_TEMPLATES';
import type { QueryTemplate, QueryCategory } from '../../shared/types/sql-query';

export interface TemplateLibraryProps {
  /** 选择模板回调 */
  onSelectTemplate: (template: QueryTemplate) => void;
}

const CATEGORIES: QueryCategory[] = ['KPI', '分析', '趋势', '示例'];

/**
 * 模板库组件
 */
export function TemplateLibrary({ onSelectTemplate }: TemplateLibraryProps) {
  const [selectedCategory, setSelectedCategory] = useState<QueryCategory | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  /**
   * 过滤模板
   */
  const filteredTemplates = QUERY_TEMPLATES.filter((template) => {
    // 分类过滤
    if (selectedCategory !== 'all' && template.category !== selectedCategory) {
      return false;
    }

    // 搜索过滤
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      return (
        template.name.toLowerCase().includes(lowerSearch) ||
        template.description.toLowerCase().includes(lowerSearch)
      );
    }

    return true;
  });

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 搜索框 */}
      <div className="p-3 border-b border-gray-200">
        <input
          type="text"
          placeholder="搜索模板..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* 分类标签 */}
      <div className="p-3 border-b border-gray-200">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md ${
              selectedCategory === 'all'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            全部 ({QUERY_TEMPLATES.length})
          </button>
          {CATEGORIES.map((category) => {
            const count = QUERY_TEMPLATES.filter((t) => t.category === category).length;
            return (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md ${
                  selectedCategory === category
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {category} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* 模板列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredTemplates.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-8">未找到匹配的模板</div>
        ) : (
          filteredTemplates.map((template) => (
            <button
              key={template.id}
              onClick={() => onSelectTemplate(template)}
              className="w-full text-left p-3 border border-gray-200 rounded-md hover:bg-blue-50 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-medium text-sm text-gray-900">{template.name}</div>
                  <div className="text-xs text-gray-500 mt-1">{template.description}</div>
                </div>
                <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-md">
                  {template.category}
                </span>
              </div>
            </button>
          ))
        )}
      </div>

      {/* 底部提示 */}
      <div className="p-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
        共 {filteredTemplates.length} 个模板
      </div>
    </div>
  );
}
