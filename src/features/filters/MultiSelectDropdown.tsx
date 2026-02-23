import React from 'react';
import Select, { components, type MultiValue, type OptionProps } from 'react-select';

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
          <span className="text-xs text-gray-500">{data.count}</span>
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
          <label className={variant === 'compact' ? 'sr-only' : 'text-sm font-medium text-gray-700'}>
            {title}{singleSelect && '（单选）'}
          </label>
          <div className="flex items-center gap-1 ml-auto">
            {actions}
            {!singleSelect && (
              <>
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                  disabled={isAllSelected}
                >
                  全选
                </button>
                <button
                  type="button"
                  onClick={handleInvertSelection}
                  className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
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
            borderColor: '#d1d5db',
            boxShadow: 'none',
          }),
          option: (base, state) => ({
            ...base,
            backgroundColor: state.isFocused ? '#f3f4f6' : state.isSelected ? '#eff6ff' : base.backgroundColor,
            color: '#111827',
          }),
          multiValue: (base) => ({
            ...base,
            backgroundColor: '#eff6ff',
          }),
          multiValueLabel: (base) => ({
            ...base,
            color: '#1d4ed8',
          }),
          placeholder: (base) => ({
            ...base,
            color: '#9ca3af',
          }),
        }}
        noOptionsMessage={() => '暂无数据'}
      />
    </div>
  );
};
