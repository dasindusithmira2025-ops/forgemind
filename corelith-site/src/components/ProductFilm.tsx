"use client";

import Image, { type StaticImageData } from "next/image";
import { useRef, useState } from "react";

/**
 * The Paralith film.
 *
 * The file is 25 MB, so nothing is fetched until someone asks for it: the
 * poster is a plain image and the <video> element is not mounted at all until
 * the play control is used. Autoplaying it in the background would cost every
 * visitor the download to decorate a section most of them will scroll past.
 */
export function ProductFilm({
  poster,
  posterClassName = "object-cover",
  src,
  captions,
  label,
}: {
  /** Imported statically so its dimensions are known at build time — the
      element then reserves its own space and the page never shifts. */
  poster: StaticImageData;
  posterClassName?: string;
  src: string;
  captions?: string;
  label: string;
}) {
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  return (
    <figure
      className="relative overflow-hidden border"
      style={{ borderColor: "var(--hair-strong)", borderRadius: "var(--r-md)" }}
    >
      {playing ? (
        <video
          ref={video}
          className="block aspect-video w-full bg-black"
          src={src}
          poster={poster.src}
          controls
          autoPlay
          playsInline
          preload="metadata"
        >
          {captions ? (
            <track kind="captions" src={captions} srcLang="en" label="English" default />
          ) : null}
        </video>
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="group relative block w-full cursor-pointer"
          aria-label={`Play: ${label}`}
        >
          <Image
            src={poster}
            alt={label}
            className={`block aspect-video w-full ${posterClassName}`}
            sizes="(min-width: 1100px) 60vw, 100vw"
            placeholder="blur"
          />
          <span
            className="absolute inset-0 flex items-center justify-center transition-colors duration-[260ms]"
            style={{ backgroundColor: "rgba(12,14,16,0.28)" }}
          >
            <span
              className="btn btn-primary pointer-events-none"
              style={{ backgroundColor: "var(--ink)", color: "var(--ground)" }}
            >
              <svg viewBox="0 0 12 14" className="h-3 w-3" aria-hidden="true" fill="currentColor">
                <path d="M0 0v14l12-7z" />
              </svg>
              Play film
            </span>
          </span>
        </button>
      )}
      <figcaption className="mono border-t px-4 py-3 text-[var(--ink-3)]" style={{ borderColor: "var(--hair)" }}>
        {label}
      </figcaption>
    </figure>
  );
}
