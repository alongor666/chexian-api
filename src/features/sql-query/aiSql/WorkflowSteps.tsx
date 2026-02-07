/**
 * 工作流步骤可视化组件
 */

import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import type { WorkflowStep, WorkflowState } from './types';
import { cn } from '../../../shared/styles';

interface WorkflowStepsProps {
  workflow: WorkflowState;
}

const statusIcons = {
  pending: Circle,
  running: Loader2,
  success: CheckCircle2,
  error: XCircle,
};

const statusColors = {
  pending: 'text-neutral-300',
  running: 'text-blue-500',
  success: 'text-green-500',
  error: 'text-red-500',
};

const statusBgColors = {
  pending: 'bg-neutral-100',
  running: 'bg-blue-50',
  success: 'bg-green-50',
  error: 'bg-red-50',
};

export function WorkflowSteps({ workflow }: WorkflowStepsProps) {
  const { steps, totalDuration } = workflow;

  // 检查是否所有步骤都是 pending
  const allPending = steps.every((s) => s.status === 'pending');
  if (allPending) {
    return null;
  }

  return (
    <div className="bg-neutral-50 rounded-lg p-3 space-y-2">
      {/* 步骤列表 */}
      <div className="flex items-center justify-between gap-1">
        {steps.map((step, index) => (
          <StepItem key={step.id} step={step} isLast={index === steps.length - 1} />
        ))}
      </div>

      {/* 总耗时 */}
      {totalDuration !== undefined && totalDuration > 0 && (
        <div className="text-xs text-neutral-500 text-right">
          总耗时: {totalDuration}ms
        </div>
      )}
    </div>
  );
}

function StepItem({ step, isLast }: { step: WorkflowStep; isLast: boolean }) {
  const Icon = statusIcons[step.status];
  const colorClass = statusColors[step.status];
  const bgClass = statusBgColors[step.status];

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md transition-all',
          bgClass,
          step.status === 'running' && 'ring-1 ring-blue-300'
        )}
      >
        <Icon
          size={14}
          className={cn(colorClass, step.status === 'running' && 'animate-spin')}
        />
        <div className="flex flex-col">
          <span
            className={cn(
              'text-xs font-medium',
              step.status === 'pending' ? 'text-neutral-400' : 'text-neutral-700'
            )}
          >
            {step.name}
          </span>
          {step.duration !== undefined && step.status !== 'pending' && (
            <span className="text-[10px] text-neutral-400">{step.duration}ms</span>
          )}
        </div>
      </div>

      {/* 连接线 */}
      {!isLast && (
        <div
          className={cn(
            'h-0.5 flex-1 max-w-4 rounded',
            step.status === 'success' ? 'bg-green-300' : 'bg-neutral-200'
          )}
        />
      )}
    </>
  );
}
