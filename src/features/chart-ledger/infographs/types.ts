/**
 * 图表账本 · 读图指南（infograph）类型定义
 *
 * infograph 是每张图的「深读版」方法论：图形解剖 + 读图步骤 + 判定规则 + 决策映射。
 * 纯静态内容（零查询）；实时数据在卡片本体。内容 SSOT：infographMeta.tsx。
 */
import type React from 'react';
import type { LedgerAction } from '../types';

/** 单张图的读图指南定义（五段式，见 design-handoff/chart-ledger-infograph-20260704/design-spec.md） */
export interface InfographDef {
  /** 对应卡片 id（chart-01 … chart-12） */
  id: string;
  /** ① 这张图回答什么经营问题（一句话） */
  question: string;
  /** ② 图形解剖 SVG 组件（560×240 注解示意图） */
  anatomy: React.ComponentType;
  /** ② 解剖图下方的补充图注（细节不挤进 SVG） */
  anatomyNotes: string[];
  /** ③ 读图三步（快速路径） */
  steps: string[];
  /** ④ 判定规则（阈值/统计规则 + 局限说明） */
  rules: { label: string; desc: string }[];
  /** ⑤ 决策映射（图上信号 → 经营动作 → 下一步） */
  decisions: { signal: string; action: LedgerAction; move: string }[];
}
