"use client";

/**
 * Proverb Engine (PRD §3) — the quiet, branded wait experience.
 *
 * Polls /api/v1/proverbs/next every 8 seconds, never repeating within
 * a session (tracks seen IDs in state). On stage transitions an
 * immediate fade-swap fires so the proverb tracks the current step.
 *
 * Tenant brand colours come in via CSS vars set by <TenantThemeProvider />.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type ProverbPayload = {
  id: string;
  language: string;
  original_text: string;
  transliteration: string | null;
  english_translation: string;
  contextual_note: string;
  source_attribution: string | null;
  wrap_around: boolean;
};

const ROTATE_MS = 8000;

export function ProverbEngine({ stage }: { stage: string }) {
  const [current, setCurrent] = useState<ProverbPayload | null>(null);
  const [fade, setFade] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const lastStageRef = useRef<string>(stage);

  const fetchNext = useCallback(
    async (forStage: string) => {
      const seen = Array.from(seenRef.current).join(",");
      try {
        const res = await fetch(
          `/api/v1/proverbs/next?stage=${encodeURIComponent(forStage)}${seen ? `&seen=${encodeURIComponent(seen)}` : ""}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data: ProverbPayload = await res.json();
        if (data.wrap_around) {
          // Library exhausted; reset so we don't permanently filter
          // everything out.
          seenRef.current = new Set();
        }
        seenRef.current.add(data.id);
        setFade(true);
        // Brief fade-out then swap to new content.
        setTimeout(() => {
          setCurrent(data);
          setFade(false);
        }, 200);
      } catch {
        // Swallow; next tick will retry.
      }
    },
    [],
  );

  // Initial load.
  useEffect(() => {
    void fetchNext(stage);
  }, [fetchNext, stage]);

  // Rotation timer.
  useEffect(() => {
    const t = window.setInterval(() => {
      void fetchNext(stage);
    }, ROTATE_MS);
    return () => window.clearInterval(t);
  }, [fetchNext, stage]);

  // Stage transition — fire an immediate swap.
  useEffect(() => {
    if (lastStageRef.current !== stage) {
      lastStageRef.current = stage;
      void fetchNext(stage);
    }
  }, [fetchNext, stage]);

  if (!current) {
    return (
      <div className="mx-auto mt-8 h-32 max-w-md animate-pulse rounded-2xl bg-muted/40" />
    );
  }

  return (
    <article
      className={`mx-auto mt-8 max-w-md rounded-2xl border border-border bg-card p-5 text-center transition-opacity duration-200 ${fade ? "opacity-30" : "opacity-100"}`}
    >
      <p
        className="text-base font-medium leading-snug text-foreground"
        lang={current.language}
      >
        {current.original_text}
      </p>
      {current.transliteration &&
        current.transliteration !== current.original_text && (
          <p className="mt-1 text-xs italic text-muted-foreground">
            {current.transliteration}
          </p>
        )}
      <p className="mt-3 text-sm text-foreground">
        {current.english_translation}
      </p>
      <p className="mt-3 text-[0.7rem] text-muted-foreground">
        {current.contextual_note}
      </p>
      <p className="mt-3 text-[0.6rem] uppercase tracking-wider text-muted-foreground">
        {current.language}
        {current.source_attribution ? ` · ${current.source_attribution}` : ""}
      </p>
    </article>
  );
}
