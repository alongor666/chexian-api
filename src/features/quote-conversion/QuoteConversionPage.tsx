import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GlobalFilters } from './components/GlobalFilters';
import { VersionSwitcher } from './components/VersionSwitcher';
import { VersionAView } from './components/VersionAView';
import { VersionBView } from './components/VersionBView';
import type { QuoteConversionVersion, QuoteFilters } from './types';

function parseVersion(raw: string | null): QuoteConversionVersion {
  return raw === 'B' ? 'B' : 'A';
}

export function QuoteConversionPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<QuoteFilters>({});
  const versionFromUrl = useMemo(
    () => parseVersion(searchParams.get('version')),
    [searchParams]
  );
  const [version, setVersion] = useState<QuoteConversionVersion>(versionFromUrl);

  useEffect(() => {
    setVersion(versionFromUrl);
  }, [versionFromUrl]);

  useEffect(() => {
    const currentVersion = searchParams.get('version');
    if (currentVersion === version) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('version', version);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, version]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="space-y-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
              旧车商业险报价转化分析
            </h1>
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
              开发阶段
            </span>
          </div>
        </div>

        <VersionSwitcher version={version} onChange={setVersion} />
      </div>

      <GlobalFilters version={version} filters={filters} onChange={setFilters} />

      {version === 'A' ? <VersionAView filters={filters} /> : <VersionBView filters={filters} />}
    </div>
  );
}
