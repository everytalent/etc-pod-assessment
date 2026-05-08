/**
 * Tiny shared bits for the admin forms — kept here so QuestionEditor,
 * AssessmentForm, and BranchingRuleEditor share the same field layout
 * without spreading these primitives across each component.
 */

"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const fieldInputClass =
  "h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold focus-visible:ring-offset-1 focus-visible:ring-offset-background";

export function FieldRow({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && !error && (
        <span className="text-[0.7rem] text-muted-foreground">{hint}</span>
      )}
      {error && <span className="text-[0.7rem] text-destructive">{error}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border accent-etc-marigold"
      />
      {label}
    </label>
  );
}
