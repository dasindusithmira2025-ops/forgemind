import Image from "next/image";
import Link from "next/link";

/**
 * The Corelith mark.
 *
 * The official monogram, cropped square out of the master lockup in
 * `Media/Official Logos/`. It carries its own deep-navy field, so it reads the
 * same on the white ground, inside a deep band, and in either theme — the
 * rounded corner is what makes that field a tile rather than a stray rectangle.
 */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/brand/corelith-mark.png"
      alt=""
      width={512}
      height={512}
      sizes="36px"
      className={`rounded-[24%] object-cover ${className}`}
    />
  );
}

export function Wordmark({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const mark = { sm: "h-[22px] w-[22px]", md: "h-7 w-7", lg: "h-9 w-9" }[size];
  const type = { sm: "text-[16px]", md: "text-[19px]", lg: "text-[25px]" }[size];

  return (
    <Link
      href="/"
      aria-label="Corelith Technologies — home"
      className={`group inline-flex items-center gap-2.5 text-[var(--ink)] ${className}`}
    >
      <Mark
        className={`${mark} shrink-0 transition-transform duration-[600ms] ease-[var(--ease)] group-hover:rotate-[19deg]`}
      />
      <span className={`font-display font-medium tracking-[-0.025em] ${type} leading-none`}>
        Corelith
      </span>
    </Link>
  );
}
