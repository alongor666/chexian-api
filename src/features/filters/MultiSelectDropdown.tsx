import React from 'react';
import Select, { components, type MultiValue, type OptionProps } from 'react-select';
import { colorClasses } from '../../shared/styles';
import { useTheme } from '../../shared/theme';

export type MultiSelectOption = {
  value: string;
  label: string;
  count?: number;
};

interface MultiSelectDropdownProps {
  title: string;
  options: MultiSelectOption[];
  selectedValues: string[];
  placeholder?: string;
  onChange: (values: string[]) => void;
  actions?: React.ReactNode;
  variant?: 'default' | 'compact';
  disabled?: boolean;
  /** 单选模式 - 只允许选择一个选项 */
  singleSelect?: boolean;
  /** 是否显示内置的操作按钮 (全选/反选) */
  showButtons?: boolean;
}

const Option: React.FC<OptionProps<MultiSelectOption, true>> = (props) => {
  const { data, isSelected } = props;
  return (
    <components.Option {...props}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <input type="checkbox" checked={isSelected} readOnly className="rounded" />
          <span className="text-sm">{data.label}</span>
        </span>
        {data.count !== undefined && (
          <span className={`text-xs ${colorClasses.text.neutralMuted}`}>{data.count}</span>
        )}
      </div>
    </components.Option>
  );
};

export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  title,
  options,
  selectedValues,
  placeholder,
  onChange,
  actions,
  variant = 'default',
  disabled = false,
  singleSelect = false,
  showButtons = true,
}) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const allValues = options.map((option) => option.value);
  const isAllSelected = selectedValues.length === 0;
  const selectedOptions = options.filter((option) => selectedValues.includes(option.value));

  const handleSelectAll = () => {
    onChange([]);
  };

  const handleInvertSelection = () => {
    const inverted = allValues.filter((value) => !selectedValues.includes(value));
    onChange(inverted);
  };

  const handleChange = (values: MultiValue<MultiSelectOption>) => {
    if (singleSelect && values.length > 1) {
      // 单选模式：只保留最新选择的值
      onChange([values[values.length - 1].value]);
    } else {
      onChange(values.map((value) => value.value));
    }
  };

  return (
    <div className="space-y-2">
      {showButtons && (
        <div className="flex items-center justify-between gap-2">
          <label className={variant === 'compact' ? 'sr-only' : `text-sm font-medium ${colorClasses.text.neutral}`}>
            {title}{singleSelect && '（单选）'}
          </label>
          <div className="flex items-center gap-1 ml-auto">
            {actions}
            {!singleSelect && (
              <>
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className={`text-xs px-2 py-1 rounded hover:bg-primary-200 ${colorClasses.bg.primary} ${colorClasses.text.primary}`}
                  disabled={isAllSelected}
                >
                  全选
                </button>
                <button
                  type="button"
                  onClick={handleInvertSelection}
                  className={`text-xs px-2 py-1 rounded hover:bg-purple-border ${colorClasses.bg.purple} ${colorClasses.text.purple}`}
                >
                  反选
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <Select
        isMulti
        isDisabled={disabled}
        closeMenuOnSelect={false}
        options={options}
        components={{ Option }}
        value={selectedOptions}
        placeholder={placeholder || (isAllSelected ? '全部' : '请选择')}
        onChange={handleChange}
        styles={{
          control: (base) => ({
            ...base,
            minHeight: '38px',
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#d1d5db',
            backgroundColor: isDark ? '#1c1c1f' : base.backgroundColor,
            boxShadow: 'none',
          }),
          menu: (base) => ({
            ...base,
            backgroundColor: isDark ? '#1c1c1f' : base.backgroundColor,
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : undefined,
          }),
          option: (base, state) => ({
            ...base,
            backgroundColor: state.isFocused
              ? (isDark ? 'rgba(255,255,255,0.08)' : '#f3f4f6')
              : state.isSelected
                ? (isDark ? 'rgba(24,144,255,0.15)' : '#eff6ff')
                : (isDark ? 'transparent' : base.backgroundColor),
            color: isDark ? '#f0f0f0' : '#111827',
          }),
          multiValue: (base) => ({
            ...base,
            backgroundColor: isDark ? 'rgba(24,144,255,0.2)' : '#eff6ff',
          }),
          multiValueLabel: (base) => ({
            ...base,
            color: isDark ? '#69c0ff' : '#1d4ed8',
          }),
          multiValueRemove: (base) => ({
            ...base,
            color: isDark ? '#69c0ff' : undefined,
            ':hover': {
              backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : undefined,
              color: isDark ? '#ff7875' : undefined,
            },
          }),
          placeholder: (base) => ({
            ...base,
            color: isDark ? '#737373' : '#9ca3af',
          }),
          singleValue: (base) => ({
            ...base,
            color: isDark ? '#f0f0f0' : base.color,
          }),
          input: (base) => ({
            ...base,
            color: isDark ? '#f0f0f0' : base.color,
          }),
        }}
        noOptionsMessage={() => '暂无数据'}
      />
    </div>
  );
};
