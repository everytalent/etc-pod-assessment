/**
 * Per-question countdown chip — PRD §5.2 / §6.
 *
 * Self-contained: takes a limit + an onTimeout callback, runs its own loop.
 * Last 5s: pulse animation + colour shift to destructive (red).
 *
 * Use a unique React `key` on the parent to force remount on a new question
 * — that's how the countdown resets cleanly without a ref dance.
 */

"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export function Timer({
  limitSeconds,
  onTimeout,
  warnAt = 5,
}: {
  limitSeconds: number;
  onTimeout: () => void;
  warnAt?: number;
}) {
  // The parent re-mounts <Timer> with a fresh key per question, so useState's
  // initial value is correct for the lifetime of this instance — no need to
  // reset inside the effect.
  const [secondsLeft, setSecondsLeft] = useState(limitSeconds);
  const firedRef = useRef(false);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const remaining = Math.max(0, limitSeconds - elapsed);
      setSecondsLeft(remaining);
      if (remaining <= 0 && !firedRef.current) {
        firedRef.current = true;
        clearInterval(id);
        onTimeout();
      }
    }, 250);
    return () => clearInterval(id);
  }, [limitSeconds, onTimeout]);

  const isUrgent = secondsLeft <= warnAt;

  return (
    <motion.span
      role="timer"
      aria-live="polite"
      animate={isUrgent ? { scale: [1, 1.1, 1] } : { scale: 1 }}
      transition={
        isUrgent
          ? { duration: 1, repeat: Infinity, ease: "easeInOut" }
          : { duration: 0.2 }
      }
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium tabular-nums transition-colors",
        isUrgent
          ? "border-destructive bg-destructive/10 text-destructive"
          : "border-border bg-card text-foreground",
      )}
    >
      {secondsLeft}s
    </motion.span>
  );
}
