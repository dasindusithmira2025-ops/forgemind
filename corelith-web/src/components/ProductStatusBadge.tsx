import { ProductStatus } from '@/types';

interface ProductStatusBadgeProps {
  status: ProductStatus;
  size?: 'sm' | 'md';
}

export function ProductStatusBadge({ status, size = 'md' }: ProductStatusBadgeProps) {
  const styles: Record<ProductStatus, { bg: string; text: string; dot: string }> = {
    Available: {
      bg: 'bg-emerald-500/10 border-emerald-500/30',
      text: 'text-emerald-400',
      dot: 'bg-emerald-400',
    },
    'Early Access': {
      bg: 'bg-indigo-500/10 border-indigo-500/30',
      text: 'text-indigo-400',
      dot: 'bg-indigo-400',
    },
    'Private Beta': {
      bg: 'bg-cyan-500/10 border-cyan-500/30',
      text: 'text-cyan-400',
      dot: 'bg-cyan-400',
    },
    'In Development': {
      bg: 'bg-amber-500/10 border-amber-500/30',
      text: 'text-amber-400',
      dot: 'bg-amber-400',
    },
  };

  const current = styles[status];
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono font-medium rounded-full border ${current.bg} ${current.text} ${sizeClasses}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${current.dot} animate-pulse`} />
      {status}
    </span>
  );
}
