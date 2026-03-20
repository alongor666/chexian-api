import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Loader2, ExternalLink, MessageSquare, Sparkles, Star, Zap } from 'lucide-react';
import { apiClient, type CapabilityInfo } from '../../shared/api/client';
import { useDataStatus } from '../../shared/contexts/DataContext';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { cn } from '../../shared/styles';
import { parseIntent } from './intentParser/intentParser';
import type { ExtractedFilters } from './intentParser/types';
import type { QuickLink } from './intentParser/types';

/** 飞书需求提交链接 */
const FEATURE_REQUEST_URL = import.meta.env.VITE_FEATURE_REQUEST_URL || '';

/** 对话消息类型 */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type?: 'match' | 'clarify' | 'no_match' | 'loading' | 'error' | 'local_match';
  capabilities?: CapabilityInfo[];
  options?: string[];
  /** 本地匹配的快捷链接 */
  quickLinks?: QuickLink[];
  /** 是否显示"AI 深度分析"按钮（LOW 置信度时） */
  showAiFallback?: boolean;
  /** 本地匹配的原始输入（用于 AI fallback） */
  originalInput?: string;
}

/**
 * AI 助手首页
 *
 * 极简对话界面：用户输入自然语言 → AI 识别需求 → 跳转报表或提交需求
 */
export const AIAssistantPage: React.FC = () => {
  const navigate = useNavigate();
  const { isDataLoaded } = useDataStatus();
  const { filterOptions, setFilters } = useGlobalFilters();
  const { userPermission } = usePermission();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ text: string; capabilityId: string }>>([]);
  const [capabilities, setCapabilities] = useState<CapabilityInfo[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 加载快捷建议
  useEffect(() => {
    apiClient.getQuickSuggestions().then((res) => {
      if (res.success && res.data) {
        setSuggestions(res.data);
      }
    }).catch(() => {
      // 静默失败，快捷建议非关键功能
    });
  }, []);

  // 加载能力列表（用于本地意图匹配）
  useEffect(() => {
    apiClient.getCapabilities().then((res) => {
      if (res.success && res.data) {
        setCapabilities(res.data);
      }
    }).catch(() => {
      // 静默失败，能力列表缺失时退化为纯 AI 模式
    });
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 构建对话历史（给 AI 用的）
  const getConversationHistory = useCallback(() => {
    return messages
      .filter((m) => m.type !== 'loading' && m.type !== 'error')
      .map((m) => ({ role: m.role, content: m.content }));
  }, [messages]);

  // 发送消息（双路径：本地规则匹配 → AI fallback）
  const sendMessage = useCallback(async (text: string, forceAI = false) => {
    if (!text.trim() || isLoading) return;

    const trimmed = text.trim();

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    // ─── 路径 1：本地意图匹配（<10ms） ───
    if (!forceAI && capabilities.length > 0) {
      const result = parseIntent(trimmed, capabilities, filterOptions, {
        allowedRoutes: userPermission?.allowedRoutes,
      });

      if (result.confidence !== 'none') {
        const localMsg: ChatMessage = {
          id: `local-${Date.now()}`,
          role: 'assistant',
          content: result.confidence === 'high'
            ? '为您找到以下匹配功能：'
            : '可能相关的功能（不确定时可点击 AI 深度分析）：',
          type: 'local_match',
          quickLinks: result.links,
          showAiFallback: result.confidence === 'low',
          originalInput: trimmed,
        };

        setMessages((prev) => [...prev, userMsg, localMsg]);
        setInput('');
        return;
      }
    }

    // ─── 路径 2：后端 AI 分析（原有逻辑） ───
    const loadingMsg: ChatMessage = {
      id: `loading-${Date.now()}`,
      role: 'assistant',
      content: '',
      type: 'loading',
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await apiClient.detectRequirement({
        message: trimmed,
        conversationHistory: getConversationHistory(),
      });

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: '',
        type: response.type,
      };

      if (response.type === 'match' && response.capabilities) {
        assistantMsg.content = `为您找到以下相关功能：`;
        assistantMsg.capabilities = response.capabilities;
      } else if (response.type === 'clarify') {
        assistantMsg.content = response.followUp || '请问您想查看哪方面的数据？';
        assistantMsg.options = response.options;
      } else {
        assistantMsg.content = response.suggestion || '这个功能暂未上线';
      }

      setMessages((prev) =>
        prev.filter((m) => m.type !== 'loading').concat(assistantMsg)
      );
    } catch {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: '抱歉，服务暂时不可用。您可以使用左侧菜单直接访问功能。',
        type: 'error',
      };
      setMessages((prev) =>
        prev.filter((m) => m.type !== 'loading').concat(errorMsg)
      );
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, getConversationHistory, capabilities, filterOptions, userPermission]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleSuggestionClick = (text: string) => {
    sendMessage(text);
  };

  const handleOptionClick = (option: string) => {
    sendMessage(option);
  };

  // 带筛选参数的跳转（本地匹配专用）
  const handleNavigateWithFilters = useCallback((route: string, filters: ExtractedFilters) => {
    // 将提取的筛选参数写入 FilterContext
    setFilters((prev) => {
      const next = { ...prev };
      if (Array.isArray(filters.org_level_3)) {
        next.org_level_3 = filters.org_level_3;
      }
      if (Array.isArray(filters.salesman_name)) {
        next.salesman_name = filters.salesman_name;
      }
      if (Array.isArray(filters.customer_category)) {
        next.customer_category = filters.customer_category;
      }
      if (typeof filters.policy_date_start === 'string') {
        next.policy_date_start = filters.policy_date_start;
      }
      if (typeof filters.policy_date_end === 'string') {
        next.policy_date_end = filters.policy_date_end;
      }
      return next;
    });
    navigate(route);
  }, [setFilters, navigate]);

  const handleNavigate = (route: string) => {
    navigate(route);
  };

  // AI 深度分析（用户点击 fallback 按钮时触发）
  const handleAiFallback = useCallback((originalInput: string) => {
    sendMessage(originalInput, true);
  }, [sendMessage]);

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 对话区域 */}
      <div className="flex-1 overflow-y-auto">
        {!hasMessages ? (
          /* 空状态：居中的欢迎界面 */
          <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={28} className="text-blue-500" />
              <h1 className="text-2xl font-semibold text-neutral-800 dark:text-neutral-200">
                车险数据分析平台
              </h1>
            </div>
            <p className="text-neutral-500 dark:text-neutral-400 text-sm mb-8">
              告诉我您想查看什么数据，我来帮您找到对应的分析报表
            </p>

            {/* 快捷建议 */}
            {suggestions.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 max-w-xl">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestionClick(s.text)}
                    className="px-3 py-1.5 text-sm rounded-full border border-neutral-200 dark:border-neutral-600 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:border-neutral-300 transition-colors"
                  >
                    {s.text}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* 对话消息列表 */
          <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onOptionClick={handleOptionClick}
                onNavigate={handleNavigate}
                onNavigateWithFilters={handleNavigateWithFilters}
                onAiFallback={handleAiFallback}
                isDataLoaded={isDataLoaded}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 输入框区域 */}
      <div className={cn(
        'border-t border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-4 py-3',
        !hasMessages && 'border-t-0'
      )}>
        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
          <div className="flex items-end gap-2 bg-neutral-50 dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-600 px-3 py-2 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400 transition-all">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="请描述您想查看的数据或分析..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-neutral-800 dark:text-neutral-200 placeholder-neutral-400 outline-none max-h-24"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="flex-shrink-0 p-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-300 dark:disabled:bg-neutral-600 text-white transition-colors"
            >
              {isLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </div>
          <p className="text-[11px] text-neutral-400 mt-1.5 text-center">
            AI 会根据您的描述推荐合适的分析报表
          </p>
        </form>
      </div>
    </div>
  );
};

/**
 * 单条消息气泡组件
 */
const MessageBubble: React.FC<{
  message: ChatMessage;
  onOptionClick: (option: string) => void;
  onNavigate: (route: string) => void;
  onNavigateWithFilters: (route: string, filters: ExtractedFilters) => void;
  onAiFallback: (originalInput: string) => void;
  isDataLoaded: boolean;
}> = ({ message, onOptionClick, onNavigate, onNavigateWithFilters, onAiFallback, isDataLoaded }) => {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-blue-500 text-white text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  // Loading 状态
  if (message.type === 'loading') {
    return (
      <div className="flex justify-start">
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl rounded-tl-sm bg-neutral-100 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 text-sm">
          <Loader2 size={14} className="animate-spin" />
          正在分析您的需求...
        </div>
      </div>
    );
  }

  // Error 状态
  if (message.type === 'error') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-tl-sm bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  // ─── 本地匹配的快捷链接 ───
  if (message.type === 'local_match' && message.quickLinks) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] space-y-3">
          <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-neutral-100 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200 text-sm">
            <div className="flex items-start gap-2">
              <Zap size={14} className="mt-0.5 text-amber-500 flex-shrink-0" />
              <span>{message.content}</span>
            </div>
          </div>

          {/* 快捷链接卡片 */}
          <div className="space-y-2 pl-2">
            {message.quickLinks.map((link, idx) => (
              <button
                key={link.capability.id}
                onClick={() => onNavigateWithFilters(link.capability.route, link.filters)}
                className={cn(
                  'w-full text-left p-3 rounded-xl border transition-all group',
                  link.isPrimary
                    ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20 hover:border-blue-400 hover:shadow-md'
                    : 'border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 hover:border-blue-300 hover:shadow-sm'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {link.isPrimary && <Star size={13} className="text-amber-500" />}
                    <span className="font-medium text-sm text-neutral-800 dark:text-neutral-200">
                      {link.label}
                    </span>
                  </div>
                  <ExternalLink
                    size={14}
                    className="text-neutral-400 group-hover:text-blue-500 transition-colors"
                  />
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
                  {link.capability.description}
                </p>
                {/* 筛选参数标签 */}
                <FilterChips filters={link.filters} />
                {idx === 0 && link.isPrimary && (
                  <p className="text-[11px] text-blue-500 dark:text-blue-400 mt-1.5">
                    ⭐ 最佳匹配 — 点击直接跳转
                  </p>
                )}
              </button>
            ))}
          </div>

          {/* LOW 置信度：显示 AI 深度分析按钮 */}
          {message.showAiFallback && message.originalInput && (
            <div className="pl-2">
              <button
                onClick={() => onAiFallback(message.originalInput!)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-purple-200 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
              >
                <Sparkles size={13} />
                不对？AI 深度分析
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-3">
        {/* 文本内容 */}
        <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-neutral-100 dark:bg-neutral-700 text-neutral-800 dark:text-neutral-200 text-sm">
          <div className="flex items-start gap-2">
            <MessageSquare size={14} className="mt-0.5 text-blue-500 flex-shrink-0" />
            <span>{message.content}</span>
          </div>
        </div>

        {/* 能力卡片 */}
        {message.capabilities && message.capabilities.length > 0 && (
          <div className="space-y-2 pl-2">
            {message.capabilities.map((cap) => (
              <button
                key={cap.id}
                onClick={() => onNavigate(cap.route)}
                className="w-full text-left p-3 rounded-xl border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-800 hover:border-blue-300 hover:shadow-sm transition-all group"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm text-neutral-800 dark:text-neutral-200">
                    {cap.name}
                  </span>
                  <ExternalLink
                    size={14}
                    className="text-neutral-400 group-hover:text-blue-500 transition-colors"
                  />
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
                  {cap.description}
                </p>
                {!isDataLoaded && (
                  <p className="text-[11px] text-amber-500 mt-1">
                    请先加载数据文件后再查看
                  </p>
                )}
              </button>
            ))}
          </div>
        )}

        {/* 澄清选项 */}
        {message.options && message.options.length > 0 && (
          <div className="flex flex-wrap gap-2 pl-2">
            {message.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => onOptionClick(opt)}
                className="px-3 py-1.5 text-sm rounded-full border border-blue-200 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {/* 无匹配 → 飞书链接 */}
        {message.type === 'no_match' && FEATURE_REQUEST_URL && (
          <div className="pl-2">
            <a
              href={FEATURE_REQUEST_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-neutral-200 dark:border-neutral-600 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
            >
              <ExternalLink size={13} />
              提交需求到飞书
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * 筛选参数标签（显示提取到的机构/业务员/时间等）
 */
const FilterChips: React.FC<{ filters: ExtractedFilters }> = ({ filters }) => {
  const chips: string[] = [];

  if (Array.isArray(filters.org_level_3)) {
    chips.push(...(filters.org_level_3 as string[]));
  }
  if (Array.isArray(filters.salesman_name)) {
    chips.push(...(filters.salesman_name as string[]));
  }
  if (Array.isArray(filters.customer_category)) {
    chips.push(...(filters.customer_category as string[]));
  }
  if (typeof filters.policy_date_start === 'string') {
    const end = typeof filters.policy_date_end === 'string' ? filters.policy_date_end : '';
    chips.push(`${filters.policy_date_start} ~ ${end}`);
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {chips.map((chip, i) => (
        <span
          key={i}
          className="inline-flex items-center px-2 py-0.5 text-[11px] rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
        >
          {chip}
        </span>
      ))}
    </div>
  );
};
