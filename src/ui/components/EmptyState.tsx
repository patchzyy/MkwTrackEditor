import type { ReactNode } from 'react';

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/**
 * "Nothing to show yet" placeholder: icon, one-line title, one sentence of explanation and
 * an optional call to action. Use it instead of a bare grey paragraph.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <div className={classNames('uiEmptyState', `uiEmptyState--${size}`, className)}>
      {icon && <span className="uiEmptyStateIcon">{icon}</span>}
      <strong className="uiEmptyStateTitle">{title}</strong>
      {description && <span className="uiEmptyStateDescription">{description}</span>}
      {action && <div className="uiEmptyStateAction">{action}</div>}
    </div>
  );
}

/** Shimmering placeholder block shown while a thumbnail or list is still resolving. */
export function Skeleton({ width, height, radius, className }: { width?: string | number; height?: string | number; radius?: string; className?: string }) {
  return (
    <span
      className={classNames('uiSkeleton', className)}
      aria-hidden="true"
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: radius,
      }}
    />
  );
}
