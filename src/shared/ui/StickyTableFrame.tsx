import React, { forwardRef, type CSSProperties, type HTMLAttributes } from 'react';
import { cn, stickyTableStyles } from '../styles';

export interface StickyTableFrameProps extends HTMLAttributes<HTMLDivElement> {
  maxHeight?: number | string;
}

function toStyleHeight(value?: number | string): CSSProperties | undefined {
  if (value === undefined) return undefined;
  return { maxHeight: typeof value === 'number' ? `${value}px` : value };
}

function StickyTableFrameInner(
  { children, className, maxHeight, style, ...props }: StickyTableFrameProps,
  ref: React.ForwardedRef<HTMLDivElement>
) {
  return (
    <div
      ref={ref}
      className={cn(stickyTableStyles.scrollFrame, className)}
      style={{ ...toStyleHeight(maxHeight), ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

export const StickyTableFrame = forwardRef<HTMLDivElement, StickyTableFrameProps>(StickyTableFrameInner);

export default StickyTableFrame;
