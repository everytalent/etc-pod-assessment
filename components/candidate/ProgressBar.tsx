/**
 * Top-of-session progress bar. Branching means `total` is an upper-bound
 * estimate of the assessment, not a guarantee — the bar may freeze for a
 * step if a `skip_to_end` rule fires early. That's acceptable for Phase 1.
 *
 * Sticks to the top of the viewport so the candidate always knows where
 * they are in the paper, even after scrolling through long question
 * bubbles. The wrapper has its own background + a soft bottom border so
 * content doesn't bleed through.
 */

"use client";

import { useEffect, useRef } from "react";

export function ProgressBar({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  const safeTotal = Math.max(1, total);
  const pct = Math.min(100, Math.round((current / safeTotal) * 100));
  // Set the --progress-pct custom property on the track via setProperty
  // rather than the JSX style prop. The width: rule lives in
  // styles/globals.css under .progress-fill, so the only "inline" thing
  // here is a runtime DOM call — no style attribute on the JSX itself.
  const trackRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    trackRef.current?.style.setProperty("--progress-pct", `${pct}%`);
  }, [pct]);

  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-border/60 bg-background/90 px-4 py-3 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
          Question {Math.min(current + 1, total)} of {total}
        </span>
        <span className="tabular-nums text-[0.7rem] font-medium text-muted-foreground">
          {pct}%
        </span>
      </div>
      <div
        ref={trackRef}
        aria-label={`Question ${current + 1} of ${total}`}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-etc-gray"
      >
        <div className="progress-fill h-full bg-etc-marigold transition-[width] duration-300 ease-out" />
      </div>
    </div>
  );
}
