import React from 'react';

export interface RBACBreadcrumbProps<T extends string = string> {
    drillPath: { label: string; dimension?: T; level?: T; value?: string }[];
    currentGroupBy?: T | null;
    onDrillUp: (toIndex: number) => void;
    canGoToTop: boolean;
    dimensionLabels?: Record<T, string>;
    topLevelLabel?: string;
}

export function RBACBreadcrumb<T extends string>({
    drillPath,
    currentGroupBy,
    onDrillUp,
    canGoToTop,
    dimensionLabels,
    topLevelLabel = '四川分公司',
}: RBACBreadcrumbProps<T>) {
    return (
        <div className="flex items-center gap-1 text-sm flex-wrap">
            {canGoToTop ? (
                <button
                    onClick={() => onDrillUp(-1)}
                    className={`px-2 py-1 rounded transition-colors ${drillPath.length === 0 && !currentGroupBy
                            ? 'text-blue-600 font-semibold bg-blue-50'
                            : 'text-blue-500 hover:bg-blue-50 cursor-pointer'
                        }`}
                >
                    {topLevelLabel}
                </button>
            ) : (
                <span className="px-2 py-1 text-gray-800 font-semibold bg-gray-100 rounded">
                    {topLevelLabel}
                </span>
            )}
            {drillPath.map((step, idx) => (
                <React.Fragment key={idx}>
                    <span className="text-gray-300">/</span>
                    <button
                        onClick={() => onDrillUp(idx)}
                        className={`px-2 py-1 rounded transition-colors ${canGoToTop || idx > 0
                                ? 'text-blue-500 hover:bg-blue-50 cursor-pointer'
                                : 'text-gray-800 font-semibold bg-gray-100'
                            }`}
                        disabled={!canGoToTop && idx === 0}
                    >
                        {step.label}
                    </button>
                </React.Fragment>
            ))}
            {currentGroupBy && dimensionLabels && (
                <>
                    <span className="text-gray-300">/</span>
                    <span className="px-2 py-1 text-gray-800 font-semibold bg-gray-100 rounded">
                        {dimensionLabels[currentGroupBy] || currentGroupBy}
                    </span>
                </>
            )}
        </div>
    );
}
