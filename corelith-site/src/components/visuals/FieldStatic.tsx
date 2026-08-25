import { fieldElevation } from "./field";

/**
 * The Corelith Field as a flat elevation.
 *
 * Not a placeholder image: it is the same dotted shell the rendered scene
 * builds, frozen and projected through the same camera with the same depth
 * fade. It renders on the server, so what a reader sees before hydration, on a
 * device without WebGL and on a printed page is the real object.
 */
export function FieldStatic({ className = "" }: { className?: string }) {
  const points = fieldElevation("reduced");
  const round = (n: number) => n.toFixed(2);

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      role="img"
      aria-label="The Corelith Field: a shell of fine points turning slowly, denser toward the viewer."
    >
      <g fill="currentColor">
        {points.map((point, i) =>
          point.marked ? null : (
            <circle
              key={i}
              cx={round(point.x)}
              cy={round(point.y)}
              r={round(point.r)}
              opacity={point.o.toFixed(3)}
            />
          ),
        )}
      </g>
      {/* State. The only colour in the object. */}
      <g fill="var(--accent)">
        {points.map((point, i) =>
          point.marked ? (
            <circle
              key={i}
              cx={round(point.x)}
              cy={round(point.y)}
              r={round(point.r * 1.9)}
              opacity={Math.min(point.o * 1.6, 1).toFixed(3)}
            />
          ) : null,
        )}
      </g>
    </svg>
  );
}
