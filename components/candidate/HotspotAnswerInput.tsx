"use client";

/**
 * HotspotAnswerInput — click-the-region-on-image, Phase 2 question type.
 *
 * Reads `image_path` (the URL the browser can load — public Supabase
 * Storage URL, or a server-resolved signed URL injected at projection
 * time) and `regions[]` from question.interactiveConfig. The regions
 * are NOT used by the client — the scoring is done server-side via
 * point-in-bbox so the candidate can't snoop the "is_correct" flag.
 *
 * Submits AnswerPayload.structuredAnswer = { click_x, click_y, time_to_answer_ms }
 * where (click_x, click_y) are in 0-1 normalised coords.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import type { CandidateQuestion } from "@/lib/assessment/validators";
import type { AnswerPayload } from "@/lib/state/candidate-session";
import { cn } from "@/lib/utils";

import { InvalidConfigTextFallback } from "./InvalidConfigTextFallback";

const hotspotConfigSchema = z.object({
  image_path: z.string().min(1),
});

type Props = {
  question: CandidateQuestion;
  onSubmit: (payload: AnswerPayload) => void;
  disabled?: boolean;
};

export function HotspotAnswerInput({ question, onSubmit, disabled = false }: Props) {
  const parsed = useMemo(() => {
    const result = hotspotConfigSchema.safeParse(question.interactiveConfig);
    return result.success ? result.data : null;
  }, [question.interactiveConfig]);

  // Initialise to null; the effect below stamps it on mount. Avoids
  // calling Date.now() during render (react-hooks/purity).
  const mountedAtRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [click, setClick] = useState<{ x: number; y: number } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    mountedAtRef.current = Date.now();
  }, []);

  if (!parsed) {
    return (
      <InvalidConfigTextFallback
        onSubmit={onSubmit}
        disabled={disabled}
        hint="Describe the location/region you would click, with reasoning."
      />
    );
  }

  function handleImageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (disabled || submitted) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setClick({
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    });
  }

  function handleSubmit() {
    if (disabled || submitted || !click) return;
    setSubmitted(true);
    onSubmit({
      selectedOptions: [],
      structuredAnswer: {
        click_x: click.x,
        click_y: click.y,
        time_to_answer_ms: mountedAtRef.current ? Date.now() - mountedAtRef.current : 0,
      },
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Click the area on the image that answers the question
      </p>

      <div
        ref={containerRef}
        onClick={handleImageClick}
        className={cn(
          "relative mt-3 w-full overflow-hidden rounded-xl border border-border bg-muted",
          !disabled && !submitted && imgLoaded
            ? "cursor-crosshair hover:border-etc-marigold"
            : "cursor-default",
        )}
        style={{ aspectRatio: "16/10" }}
      >
        {!imgError ? (
          // next/image needs explicit width/height or fill mode + a
          // configured remotePatterns whitelist. Hotspot images come
          // from arbitrary upload URLs at runtime, so plain <img> is
          // simpler. Revisit if LCP becomes a real issue.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={parsed.image_path}
            alt="Click the relevant region"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-destructive">
            Could not load the image. Skip to continue.
          </div>
        )}

        {click && (
          <div
            aria-hidden
            style={{
              left: `${click.x * 100}%`,
              top: `${click.y * 100}%`,
            }}
            className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-etc-marigold bg-etc-marigold/40"
          />
        )}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || submitted || !click || imgError}
        title={!click ? "Click on the image first" : undefined}
        className={cn(
          "mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground",
          "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {submitted ? "Submitted…" : click ? "Submit click" : "Click the image first"}
      </button>
    </div>
  );
}
