/**
 * Top-of-session progress bar. Branching means `total` is an upper-bound
 * estimate of the assessment, not a guarantee — the bar may freeze for a
 * step if a `skip_to_end` rule fires early. That's acceptable for Phase 1.
 */

"use client";

export function ProgressBar({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  const safeTotal = Math.max(1, total);
  const pct = Math.min(100, Math.round((current / safeTotal) * 100));
  return (
    <div
      aria-label={`Question ${current} of ${total}`}
      className="h-1.5 w-full overflow-hidden rounded-full bg-etc-gray"
    >
      <div
        className="h-full bg-etc-marigold transition-[width] duration-300 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
