import { ProductStatus } from '@/types';

interface ProductStatusBadgeProps {
  status: ProductStatus;
}

/**
 * A release-state marker.
 *
 * Colour never carries the meaning on its own: the label is always present, and
 * the marker's fill (solid vs. hollow) is a second, non-chromatic channel.
 */
export function ProductStatusBadge({ status }: ProductStatusBadgeProps) {
  const styles: Record<ProductStatus, { tone: string; marker: string }> = {
    Available: {
      tone: 'border-success/40 bg-success/10 text-success',
      marker: 'bg-success',
    },
    'Early Access': {
      tone: 'border-ember/45 bg-ember/10 text-ember-ink',
      marker: 'bg-ember',
    },
    'Private Beta': {
      tone: 'border-warning/40 bg-warning/10 text-warning',
      marker: 'bg-warning',
    },
    'In Development': {
      tone: 'border-[var(--hair-strong)] text-ink-soft',
      marker: 'border border-ink-soft bg-transparent',
    },
  };

  const current = styles[status];

  return (
    <span className={`stamp chip ${current.tone}`}>
      <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 rounded-full ${current.marker}`} />
      {status}
    </span>
  );
}
