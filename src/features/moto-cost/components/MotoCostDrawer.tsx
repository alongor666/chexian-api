/**
 * 摩意模型 - 参数抽屉组件
 */
import React from 'react';
import { cardStyles, textStyles, buttonStyles, inputStyles, cn } from '@/shared/styles';
import type { MotoCostInputs } from '../types';

interface MotoCostDrawerProps {
  open: boolean;
  onClose: () => void;
  inputs: MotoCostInputs;
  onUpdate: <K extends keyof MotoCostInputs>(key: K, value: MotoCostInputs[K]) => void;
  onReset: () => void;
  onApply: () => void;
}

// 输入字段配置
const FIELD_GROUPS = [
  {
    title: '管理成本',
    fields: [
      { key: 'laborBaseRate', label: '人力成本基数', unit: '%', step: 0.1 },
      { key: 'fixedOperationRate', label: '固定运营成本率', unit: '%', step: 0.01 },
    ],
  },
  {
    title: '摩意险保费配比计算因子',
    fields: [
      { key: 'carAveragePremium', label: '摩托车单均保费', unit: '元', step: 1 },
      { key: 'motoAveragePremium', label: '摩意险件均保费', unit: '元', step: 1 },
      { key: 'motoQuantity', label: '摩意险份数', unit: '份', step: 0.01 },
    ],
  },
  {
    title: '摩意险手续费率计算因子',
    fields: [
      { key: 'motoWithCarFeeRate', label: '随车业务费用率', unit: '%', step: 0.1 },
      { key: 'motoCardFeeRate', label: '卡单费用率', unit: '%', step: 0.1 },
    ],
  },
];

const TABLE_FIELDS = [
  { key: 'carPremium', label: '保费', unit: '万元', step: 100 },
  { key: 'carLossRatio', label: '赔付率', unit: '%', step: 0.1 },
  { key: 'carHandlingFeeRate', label: '手续费率', unit: '%', step: 0.1 },
  { key: 'carSalesPromotionRate', label: '销推费用率', unit: '%', step: 0.1 },
  { key: 'carStandardPremiumRatio', label: '标保系数', unit: 'x', step: 0.1 },
];

const MOTO_TABLE_FIELDS = [
  { key: 'motoPremium', label: '保费', unit: '万元', step: 100 },
  { key: 'motoLossRatio', label: '赔付率', unit: '%', step: 0.1 },
  // 手续费率只读
  { key: 'motoHandlingFeeRateDisplay', label: '手续费率', unit: '%', step: 0, readonly: true },
  { key: 'motoSalesPromotionRate', label: '销推费用率', unit: '%', step: 0.1 },
  { key: 'motoStandardPremiumRatio', label: '标保系数', unit: 'x', step: 0.1 },
];

export const MotoCostDrawer: React.FC<MotoCostDrawerProps> = ({
  open,
  onClose,
  inputs,
  onUpdate,
  onReset,
  onApply,
}) => {
  // 计算摩意险手续费率
  const motoHandlingFeeRate = ((inputs.motoWithCarFeeRate + inputs.motoCardFeeRate) / 2).toFixed(1);

  // 渲染输入字段
  const renderInput = (key: string, label: string, unit: string, step: number, readonly?: boolean) => {
    const value = key === 'motoHandlingFeeRateDisplay' ? motoHandlingFeeRate : inputs[key as keyof MotoCostInputs];

    return (
      <div className="flex-1">
        <label className={cn(textStyles.caption, 'block mb-1')}>{label}</label>
        <div className="relative">
          <input
            type="number"
            value={value ?? ''}
            onChange={(e) => {
              if (readonly) return;
              const val = parseFloat(e.target.value) || 0;
              onUpdate(key as keyof MotoCostInputs, val);
            }}
            step={step}
            readOnly={readonly}
            className={cn(
              inputStyles.base,
              inputStyles.default,
              readonly && inputStyles.disabled,
              'pr-10'
            )}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">
            {unit}
          </span>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* 遮罩层 */}
      <div
        className={cn(
          'fixed inset-0 bg-black/50 z-40 transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />

      {/* 抽屉 */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-[520px] max-w-[48vw] bg-white shadow-xl z-50',
          'flex flex-col transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
          <h2 className={textStyles.titleMedium}>测算参数配置</h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 p-1">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 分组字段 */}
          {FIELD_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className={cn(textStyles.label, 'text-primary mb-3 pb-1 border-b border-neutral-200')}>
                {group.title}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {group.fields.map((field) => (
                  <div key={field.key}>
                    {renderInput(field.key, field.label, field.unit, field.step)}
                  </div>
                ))}
              </div>
            </section>
          ))}

          {/* 分产品变动成本表格 */}
          <section>
            <h3 className={cn(textStyles.label, 'text-primary mb-3 pb-1 border-b border-neutral-200')}>
              分产品变动成本
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-neutral-50">
                    <th className={cn(textStyles.caption, 'px-3 py-2 text-left border-b border-neutral-200')}>
                      指标名称
                    </th>
                    <th className={cn(textStyles.caption, 'px-3 py-2 text-center border-b border-neutral-200')}>
                      车险值
                    </th>
                    <th className={cn(textStyles.caption, 'px-3 py-2 text-center border-b border-neutral-200')}>
                      摩意险值
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TABLE_FIELDS.map((field, index) => (
                    <tr key={field.key} className="border-b border-neutral-100">
                      <td className={cn(textStyles.label, 'px-3 py-2 bg-neutral-50')}>
                        {field.label}
                      </td>
                      <td className="px-3 py-2">
                        {renderInput(
                          field.key,
                          '',
                          field.unit,
                          field.step
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {renderInput(
                          MOTO_TABLE_FIELDS[index].key,
                          '',
                          MOTO_TABLE_FIELDS[index].unit,
                          MOTO_TABLE_FIELDS[index].step,
                          MOTO_TABLE_FIELDS[index].readonly
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-neutral-200">
          <button onClick={onReset} className={cn(buttonStyles.base, buttonStyles.ghost, buttonStyles.sizeMedium)}>
            重置
          </button>
          <button onClick={onApply} className={cn(buttonStyles.base, buttonStyles.primary, buttonStyles.sizeMedium)}>
            应用
          </button>
        </div>
      </div>
    </>
  );
};

export default MotoCostDrawer;
