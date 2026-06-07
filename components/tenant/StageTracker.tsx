"use client";

/**
 * Tenant-visible four-stage tracker (PRD §2 visible labels).
 * Never references internal stage names.
 */

import { cn } from "@/lib/utils";

const STAGES: { key: string; label: string }[] = [
  { key: "reading_role", label: "Reading your input" },
  { key: "calibrating", label: "Calibrating the framework" },
  { key: "crafting", label: "Crafting the questions" },
  { key: "finalising", label: "Finalising your assessment" },
];

export function StageTracker({ current }: { current: string }) {
  const idx = STAGES.findIndex((s) => s.key === current);
  return (
    <ol className="mx-auto flex w-full max-w-md items-center gap-2 text-[0.65rem]">
      {STAGES.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <li key={s.key} className="flex-1">
            <div
              className={cn(
                "h-1.5 w-full rounded-full transition-colors",
                active
                  ? "bg-foreground"
                  : done
                    ? "bg-foreground/60"
                    : "bg-muted",
              )}
              style={
                active
                  ? { background: "var(--tenant-primary, #f1b240)" }
                  : undefined
              }
              aria-current={active ? "step" : undefined}
            />
            <p
              className={cn(
                "mt-1.5 truncate text-center text-muted-foreground",
                active ? "text-foreground" : "",
              )}
            >
              {s.label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
