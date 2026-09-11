export function ParalithLaunchFilm() {
  return (
    <figure className="crop" aria-labelledby="paralith-launch-film-title">
      <div className="panel overflow-hidden rounded-xl">
        <figcaption className="bg-paper-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-[var(--hair)] px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="node" />
            <span id="paralith-launch-film-title" className="stamp text-ink">
              Paralith launch film
            </span>
          </div>

          <span className="stamp text-ink-faint">01:01 · Silent</span>
        </figcaption>

        <video
          className="bg-paper block aspect-video w-full object-cover"
          controls
          playsInline
          preload="metadata"
          poster="/media/paralith-launch-poster.jpg"
          aria-label="Paralith launch film. Many agents, one build."
        >
          <source src="/media/paralith-launch.mp4" type="video/mp4" />
          Your browser cannot play this video.{' '}
          <a className="text-core-ink underline" href="/media/paralith-launch.mp4">
            Open the launch film directly.
          </a>
        </video>

        <div className="bg-paper-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-[var(--hair)] px-4 py-3 sm:px-5">
          <p className="stamp text-ink-soft">Many agents. One build.</p>
          <p className="stamp text-ink-faint">Press proof / 2026</p>
        </div>
      </div>
    </figure>
  );
}
