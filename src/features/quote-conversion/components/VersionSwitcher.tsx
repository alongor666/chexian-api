import { Tabs } from '../../../shared/ui/Tabs';
import type { QuoteConversionVersion } from '../types';

interface Props {
  version: QuoteConversionVersion;
  onChange: (version: QuoteConversionVersion) => void;
}

const VERSION_ITEMS = [
  { key: 'A', label: '版本 A' },
  { key: 'B', label: '版本 B' },
] as const;

export function VersionSwitcher({ version, onChange }: Props) {
  return (
    <Tabs
      items={[...VERSION_ITEMS]}
      activeKey={version}
      onChange={(key) => onChange(key as QuoteConversionVersion)}
      variant="pills"
      size="small"
    />
  );
}
