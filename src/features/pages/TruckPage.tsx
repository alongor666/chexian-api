import React, { useState } from 'react';
import { TruckAnalysisPanel } from '../dashboard/TruckAnalysisPanel';
import { useGlobalFilters } from '../../shared/contexts/FilterContext';
import { PageFilterPanel } from '../../components/layout/PageFilterPanel';
import type { ViewPerspective } from '../../shared/types';

export const TruckPage: React.FC = () => {
  const { filters } = useGlobalFilters();
  const [perspective, setPerspective] = useState<ViewPerspective>('premium');

  return (
    <PageFilterPanel preset="full">
      <div className="p-4">
        <TruckAnalysisPanel
          filters={filters}
          perspective={perspective}
          setPerspective={setPerspective}
        />
      </div>
    </PageFilterPanel>
  );
};
