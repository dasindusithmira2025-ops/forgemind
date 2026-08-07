/**
 * The Paralith product film.
 *
 * The asset is the showcase cut rendered by `marketing/paralith-video`
 * (`ParalithShowcase1080p`), which replaced the earlier launch film. Every frame of interface in
 * it is Paralith's own stylesheet and theme engine under a camera, not a mock-up.
 *
 * It carries a score, so it is never given `autoPlay` — a page that starts making noise on load is
 * a page people close. The captions track is generated from the film's own copy table, so it
 * cannot drift out of step with the words on screen.
 */
export function ParalithLaunchFilm() {
  return (
    <figure className="crop" aria-labelledby="paralith-launch-film-title">
      <div className="panel overflow-hidden rounded-xl">
        <figcaption className="bg-paper-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-[var(--hair)] px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="node" />
            <span id="paralith-launch-film-title" className="stamp text-ink">
              Paralith product film
            </span>
          </div>

          <span className="stamp text-ink-faint">01:30 · Sound on</span>
        </figcaption>

        <video
          className="bg-paper block aspect-video w-full object-cover"
          controls
          playsInline
          preload="metadata"
          poster="/media/paralith-showcase-poster.jpg"
          aria-label="Paralith product film. Build beyond the editor."
        >
          <source src="/media/paralith-showcase.mp4" type="video/mp4" />
          <track
            kind="captions"
            srcLang="en"
            label="English"
            src="/media/paralith-showcase-captions.vtt"
            default
          />
          Your browser cannot play this video.{' '}
          <a className="text-core-ink underline" href="/media/paralith-showcase.mp4">
            Open the product film directly.
          </a>
        </video>

        <div className="bg-paper-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-[var(--hair)] px-4 py-3 sm:px-5">
          <p className="stamp text-ink-soft">Build beyond the editor.</p>
          <p className="stamp text-ink-faint">Press proof / 2026</p>
        </div>
      </div>
    </figure>
  );
}
