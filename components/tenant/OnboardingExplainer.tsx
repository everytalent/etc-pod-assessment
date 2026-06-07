"use client";

/**
 * Four-card explainer for first-run tenant onboarding (PRD §0a).
 *
 * Swipeable on touch (and arrow-key navigable on desktop). Each card has
 * a single illustration slot, ~40-word body, and a "Got it" / next CTA.
 * The final card's CTA hands off to the brand customisation step.
 *
 * Pure client component. Renders a static deck — onboarding state
 * (i.e. whether the carousel ever shows up) lives in
 * tenant_assessment_branding.onboarding_completed_at, which is stamped
 * when the tenant saves brand in the next step.
 *
 * Copy is deliberately algorithm-branded ("kemi.ai" and "chioma.ai" are
 * the tenant-facing names for the two assessors; never "Kimi" or "Claude"
 * in user-visible strings).
 */

import { useState } from "react";

import { cn } from "@/lib/utils";

type Card = {
  eyebrow: string;
  title: string;
  body: string;
};

const CARDS: Card[] = [
  {
    eyebrow: "Step 1 of 4",
    title: "You give us the role or project.",
    body: "Paste a job description for permanent hiring, or a scope of work for project-based contracting. The more context you give, the sharper the assessment.",
  },
  {
    eyebrow: "Step 2 of 4",
    title: "Our algorithm calibrates.",
    body: "ETC's proprietary algorithm, built on years of African energy-talent assessment data, maps your role to a competency framework and decides what to test for. The algorithm gets sharper with every use. Your tenth run is exceptional.",
  },
  {
    eyebrow: "Step 3 of 4",
    title: "Candidates take an adaptive test.",
    body: "Questions get harder or easier based on how the candidate is doing. Two AI assessors, kemi.ai and chioma.ai, score every response together. The algorithm stops when it's confident, not at an arbitrary number of questions.",
  },
  {
    eyebrow: "Step 4 of 4",
    title: "You get rich results.",
    body: "Not pass / fail. For every candidate: a hire, don't-hire, or borderline call, a stage label, confidence, per-skill breakdown, mindset signals, an integrity report in plain English, and a trajectory chart.",
  },
];

export function OnboardingExplainer({
  onComplete,
}: {
  onComplete: () => void;
}) {
  const [index, setIndex] = useState(0);
  const isLast = index === CARDS.length - 1;
  const card = CARDS[index];

  const next = () => {
    if (isLast) {
      onComplete();
      return;
    }
    setIndex((i) => Math.min(CARDS.length - 1, i + 1));
  };
  const back = () => setIndex((i) => Math.max(0, i - 1));

  return (
    <div
      role="region"
      aria-label="Onboarding"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") next();
        if (e.key === "ArrowLeft") back();
      }}
      tabIndex={0}
      className="mx-auto max-w-xl outline-none"
    >
      <article className="rounded-2xl border border-border bg-card p-8 shadow-sm">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {card.eyebrow}
        </p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">{card.title}</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {card.body}
        </p>

        <div className="mt-8 flex items-center justify-between">
          <button
            type="button"
            onClick={back}
            disabled={index === 0}
            className={cn(
              "text-xs font-medium text-muted-foreground hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            Back
          </button>

          <Dots count={CARDS.length} current={index} />

          <button
            type="button"
            onClick={next}
            className="inline-flex h-11 items-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background"
          >
            {isLast ? "Let's set up your brand" : "Got it"}
          </button>
        </div>
      </article>
    </div>
  );
}

function Dots({ count, current }: { count: number; current: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            i === current ? "bg-foreground" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}
