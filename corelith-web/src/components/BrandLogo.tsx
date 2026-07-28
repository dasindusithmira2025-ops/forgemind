import Link from 'next/link';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
}

/**
 * The Corelith mark: a dark slab cut by a pale obelisk with a lit iris core —
 * core + lith. Drawn rather than borrowed, so it carries no icon-set
 * fingerprint, and the core is the only element in the header allowed to glow.
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
        <rect
          x="0.5"
          y="0.5"
          width="31"
          height="31"
          rx="7.5"
          className="fill-panel-2 stroke-edge"
        />
        <path d="M13 6h6l3.5 20h-13Z" className="fill-lume" />
        <rect
          x="13"
          y="17"
          width="6"
          height="6"
          className="fill-iris drop-shadow-[0_0_6px_var(--color-iris)]"
        />
      </svg>

      <span className="flex flex-col leading-none">
        <span className={`${word} text-lume font-display font-semibold tracking-[-0.03em]`}>
          Corelith
        </span>
        {showTagline && <span className="stamp text-faint mt-1.5">Technologies</span>}
      </span>
    </Link>
  );
}
