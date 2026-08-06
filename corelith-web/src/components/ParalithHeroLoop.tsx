'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The silent workspace loop that opens the Paralith page.
 *
 * The asset is `ParalithShowcaseLoop` from `marketing/paralith-video` — nine
 * seconds of the product under a slow push-in. Every interface frame in it is
 * Paralith's own stylesheet and theme engine rendered by the digital twin, not
 * a mock-up, which is the only reason it is allowed to stand in for a
 * screenshot.
 *
 * It carries no audio and never will: this is the establishing shot, not the
 * film. The film itself lives on the home page with controls and captions.
 *
 * Autoplay is conditional. Anything that moves for longer than five seconds
 * needs a way to stop it (WCAG 2.2.2), so there is a real pause control, and
 * readers who have asked their system for reduced motion get the poster frame
 * held still until they press play.
 */
export function ParalithHeroLoop() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // `autoPlay` as an attribute would fire before this check could stop it, so the
    // decision is made here instead and the attribute is never set.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // A rejected play() is not an error worth surfacing — some browsers refuse
    // autoplay under power-saving or data-saver rules, and the poster is a
    // perfectly good outcome.
    void video.play().catch(() => {});
  }, []);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  return (
    <figure className="crop" aria-labelledby="paralith-hero-loop-title">
      <div className="panel overflow-hidden rounded-xl">
        <figcaption className="bg-paper-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-[var(--hair)] px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className={`node ${playing ? 'pulse' : ''}`} />
            <span id="paralith-hero-loop-title" className="stamp text-ink">
              The workspace
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="stamp text-ink-faint hidden sm:inline">Six agents · one build</span>
            <button
              type="button"
              onClick={toggle}
              className="stamp text-ink-soft hover:text-ink cursor-pointer transition-colors"
            >
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
          </div>
        </figcaption>

        <video
          ref={videoRef}
          className="bg-paper block aspect-video w-full object-cover"
          muted
          loop
          playsInline
          preload="metadata"
          poster="/media/paralith-hero-loop-poster.jpg"
          // `playing` rather than `play`: play() resolving only means playback was
          // requested. A backgrounded tab, a stalled network, or a browser that
          // defers autoplay all leave the element unpaused with nothing on screen,
          // and the control would then offer to pause a still frame.
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onWaiting={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          aria-label="Silent loop of the Paralith workspace: six agents working in parallel across terminal panes, with their changes held for review."
        >
          <source src="/media/paralith-hero-loop.mp4" type="video/mp4" />
        </video>

        <div className="bg-paper-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-[var(--hair)] px-4 py-3 sm:px-5">
          <p className="stamp text-ink-soft">Recorded from the product</p>
          <p className="stamp text-ink-faint">v0.9.4 preview</p>
        </div>
      </div>
    </figure>
  );
}
