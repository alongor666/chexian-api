import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { colorClasses } from '../../shared/styles';
import { GlobalFilters } from './components/GlobalFilters';
import { VersionSwitcher } from './components/VersionSwitcher';
import { VersionAView } from './components/VersionAView';
import { VersionBView } from './components/VersionBView';
import { DashboardAnchorNav } from '../../components/layout/DashboardAnchorNav';
import type { QuoteConversionVersion, QuoteFilters } from './types';

function parseVersion(raw: string | null): QuoteConversionVersion {
  return raw === 'B' ? 'B' : 'A';
}

export function QuoteConversionPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<QuoteFilters>({});

  const version = useMemo(
    () => parseVersion(searchParams.get('version')),
    [searchParams]
  );

  const setVersion = useCallback(
    (next: QuoteConversionVersion) => {
      setSearchParams((prev) => {
        const nextParams = new URLSearchParams(prev);
        nextParams.set('version', next);
        return nextParams;
      }, { replace: true });
    },
    [setSearchParams]
  );

  return (
    <div className="relative p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <DashboardAnchorNav
        sections={[
          { id: 'quote-filters', label: '筛选配置' },
          { id: 'quote-content', label: '分析内容' },
        ]}
      />
      <div id="quote-filters" className="space-y-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className={`text-lg font-bold ${colorClasses.text.neutralBlack}`}>
              旧车商业险报价转化分析
            </h1>
            <span className={`inline-flex items-center rounded-full bg-warning-bg px-2 py-0.5 text-[11px] font-medium ${colorClasses.text.warning}`}>
              开发阶段
            </span>
          </div>
          <p className={`mt-1 text-xs ${colorClasses.text.neutralMuted}`}>
            基于报价单据的<strong>承保率</strong>分析（单据级，每条报价单一行）。
          </p>
        </div>

        <VersionSwitcher version={version} onChange={setVersion} />
      </div>

      <GlobalFilters version={version} filters={filters} onChange={setFilters} />

      <div id="quote-content">
        {version === 'A' ? <VersionAView filters={filters} /> : <VersionBView filters={filters} />}
      </div>
    </div>
  );
}
