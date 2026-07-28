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
      tone: 'border-signal/40 bg-signal/10 text-signal',
      marker: 'bg-signal',
    },
    'Early Access': {
      tone: 'border-iris/45 bg-iris/10 text-iris-lift',
      marker: 'bg-iris',
    },
    'Private Beta': {
      tone: 'border-warn/40 bg-warn/10 text-warn',
      marker: 'bg-warn',
    },
    'In Development': {
      tone: 'border-[var(--hair-strong)] text-mute',
      marker: 'border border-mute bg-transparent',
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
