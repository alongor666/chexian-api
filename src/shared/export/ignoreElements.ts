export type ExportIgnoreElementsOptions = {
  ignoreTagNames?: readonly string[];
  ignoreClassNames?: readonly string[];
};

const DEFAULT_IGNORE_TAG_NAMES = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'] as const;
const DEFAULT_IGNORE_CLASS_NAMES = ['no-export', 'echarts-toolbox', 'export-button'] as const;

function normalizeTagName(tagName: string): string {
  return tagName.trim().toUpperCase();
}

export function createExportIgnoreElements(
  options: ExportIgnoreElementsOptions = {}
): (element: Element) => boolean {
  const tagNames = new Set<string>(DEFAULT_IGNORE_TAG_NAMES);
  const classNames = new Set<string>(DEFAULT_IGNORE_CLASS_NAMES);

  for (const tagName of options.ignoreTagNames ?? []) {
    tagNames.add(normalizeTagName(tagName));
  }
  for (const className of options.ignoreClassNames ?? []) {
    const normalized = className.trim();
    if (normalized) classNames.add(normalized);
  }

  return (element: Element): boolean => {
    for (const className of classNames) {
      if (element.classList.contains(className)) return true;
    }

    const tagName = element.tagName?.toUpperCase?.();
    if (tagName && tagNames.has(tagName)) return true;

    return false;
  };
}

