import Link from 'next/link';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
}

/**
 * The Corelith mark: an ink slab cut by a cream obelisk with an amber core —
 * core + lith. Drawn rather than borrowed, so it carries no icon-set
 * fingerprint, and printed flat: on paper the core reads as a struck block of
 * brand colour, which is the graphic equivalent of the glow it replaces.
 */
export function BrandLogo({ size = 'md', showTagline = false }: BrandLogoProps) {
  const mark = {
    sm: 'h-7 w-7',
    md: 'h-9 w-9',
    lg: 'h-11 w-11',
  }[size];

  const word = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-xl',
  }[size];

  return (
    <Link
      href="/"
      className="group inline-flex items-center gap-3"
      aria-label="Corelith Technologies — homepage"
    >
      <svg
        viewBox="0 0 32 32"
        aria-hidden="true"
        className={`${mark} shrink-0 transition-transform duration-200 group-hover:-translate-y-0.5`}
      >
        <rect x="0" y="0" width="32" height="32" rx="5" className="fill-ink" />
        <path d="M13 6h6l3.5 20h-13Z" className="fill-paper" />
        <rect x="13" y="17" width="6" height="6" className="fill-amber" />
      </svg>

      <span className="flex flex-col leading-none">
        <span className={`${word} text-ink font-display font-semibold tracking-[-0.03em]`}>
          Corelith
        </span>
        {showTagline && <span className="stamp text-ink-faint mt-1.5">Technologies</span>}
      </span>
    </Link>
  );
}
