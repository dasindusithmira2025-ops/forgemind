import Image from 'next/image';
import Link from 'next/link';
import markSrc from '../../public/brand/corelith-mark.png';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
}

/**
 * The Corelith company mark — a white hexagonal C opened on the right, with a
 * single blue facet closing it — locked up with the wordmark.
 *
 * The symbol is the master artwork with its flat #070707 ground keyed out to
 * alpha, rather than a redrawing. That is deliberate on two counts: the brand
 * guidelines forbid redrawing or re-cutting the symbol, and there is no vector
 * master of this revision to redraw from — the supplied vector pack still holds
 * the earlier blue-to-cyan gradient mark. Keying to alpha rather than shipping
 * the artwork on its own black matters because the header crosses two weights
 * of stock; a baked-in ground would show as a patch against the lighter one.
 *
 * The wordmark stays live text so it scales, stays selectable, and needs no
 * second asset. It is set uppercase and widely tracked to follow the lockup
 * rather than the body voice, which is title-case and tight.
 */
export function BrandLogo({ size = 'md', showTagline = false }: BrandLogoProps) {
  const mark = {
    sm: 'h-7',
    md: 'h-9',
    lg: 'h-11',
  }[size];

  // A step below the old title-case sizes: tracked uppercase occupies more
  // width and reads larger at the same nominal size.
  const word = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  }[size];

  return (
    <Link
      href="/"
      className="group inline-flex items-center gap-3"
      aria-label="Corelith Technologies — homepage"
    >
      <Image
        src={markSrc}
        alt=""
        aria-hidden="true"
        priority
        className={`${mark} w-auto shrink-0 transition-transform duration-200 group-hover:-translate-y-0.5`}
      />

      <span className="flex flex-col leading-none">
        <span className={`${word} text-ink font-display font-medium tracking-[0.18em] uppercase`}>
          Corelith
        </span>
        {showTagline && <span className="stamp text-ink-faint mt-2">Technologies</span>}
      </span>
    </Link>
  );
}
