"use client";

/**
 * Living backdrop for the cockpit. Two slow-drifting tonal blobs plus a
 * faint contour ring field, all decorative SVG with CSS motion. Never
 * intercepts input, freezes under reduced motion via globals.css.
 */
export function AmbientField() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <svg
        className="ambient-drift-a absolute -top-[20%] -left-[10%] h-[70%] w-[60%] opacity-70"
        viewBox="0 0 400 400"
        fill="none"
      >
        <ellipse
          cx="200"
          cy="200"
          rx="190"
          ry="150"
          fill="url(#ambientWarm)"
          opacity="0.55"
        />
        <defs>
          <radialGradient id="ambientWarm" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#e9c896" />
            <stop offset="100%" stopColor="#e9c896" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>
      <svg
        className="ambient-drift-b absolute -right-[15%] -bottom-[25%] h-[75%] w-[65%] opacity-60"
        viewBox="0 0 400 400"
        fill="none"
      >
        <ellipse
          cx="200"
          cy="200"
          rx="180"
          ry="170"
          fill="url(#ambientCopper)"
          opacity="0.4"
        />
        <defs>
          <radialGradient id="ambientCopper" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#c67c48" />
            <stop offset="100%" stopColor="#c67c48" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>
      <svg
        className="absolute top-1/2 left-1/2 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 opacity-[0.35]"
        viewBox="0 0 800 800"
        fill="none"
      >
        {[260, 310, 360].map((r) => (
          <circle
            key={r}
            cx="400"
            cy="400"
            r={r}
            stroke="#9a7a4a"
            strokeOpacity="0.28"
            strokeWidth="1"
            strokeDasharray="3 9"
          />
        ))}
      </svg>
    </div>
  );
}
