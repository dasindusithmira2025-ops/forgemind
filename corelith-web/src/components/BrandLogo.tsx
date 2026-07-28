import Link from 'next/link';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
}

export function BrandLogo({ size = 'md', showTagline = false }: BrandLogoProps) {
  const sizeClasses = {
    sm: 'text-lg gap-2',
    md: 'text-xl gap-2.5',
    lg: 'text-2xl gap-3',
  };

  const iconSizes = {
    sm: 'w-5 h-5',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };

  return (
    <Link
      href="/"
      className={`group inline-flex items-center font-bold tracking-tight text-white transition-opacity hover:opacity-90 ${sizeClasses[size]}`}
      aria-label="Corelith Technologies Homepage"
    >
      {/* Precision Corelith Mark */}
      <div className={`relative flex items-center justify-center rounded-lg bg-indigo-600/10 border border-indigo-500/30 p-1.5 transition-transform group-hover:scale-105 ${iconSizes[size]}`}>
        <svg viewBox="0 0 24 24" fill="none" className="w-full h-full text-indigo-400" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      </div>

      <div className="flex flex-col">
        <span className="font-extrabold tracking-tight text-white font-heading">
          CORELITH<span className="text-indigo-400 font-medium">.</span>
        </span>
        {showTagline && (
          <span className="text-[10px] tracking-wider uppercase text-gray-400 font-mono font-medium -mt-1">
            Technologies
          </span>
        )}
      </div>
    </Link>
  );
}
