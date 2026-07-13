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
  // PRD §2a: the candidate never sees a fixed endpoint. Display the
  // answered count only; the bar is a soft indeterminate motion tied
  // to the current step, not a percentage-of-bank. `total` stays in
  // the signature for future confidence-driven progress (Phase 3).
  void total;
  const trackRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    trackRef.current?.style.setProperty(
      "--progress-pct",
      `${Math.min(100, 8 + current * 6)}%`,
    );
  }, [current]);

  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-border/60 bg-background/90 px-4 py-3 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
          Question {current + 1}
        </span>
      </div>
      <div
        ref={trackRef}
        aria-label={`Question ${current + 1}`}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-etc-gray"
      >
        <div className="progress-fill h-full bg-etc-marigold transition-[width] duration-300 ease-out" />
      </div>
    </div>
  );
}
