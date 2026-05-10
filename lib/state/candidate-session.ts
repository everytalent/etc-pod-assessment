/**
 * Zustand store for the in-flight candidate session — PRD §10 ("Use Zustand
 * for in-flight session state only"). Holds the current question, history of
 * locked bubbles, running score, and the submit action.
 *
 * Server-side rendering: this module is only imported by Client Components
 * (the file is marked "use client"), so the store is never created on the
 * server. Initial state is hydrated from a Server Component prop, not from
 * a global ref.
 */

"use client";

import { create } from "zustand";

import type {
  AnswerResponse,
  CandidateQuestion,
} from "@/lib/assessment/validators";

export type AnsweredEntry = {
  questionId: string;
  questionText: string;
  selectedOptions: string[];
  /** Joined label of the chosen option(s), for the locked-bubble display. */
  selectedLabel: string | null;
  /** Open-ended candidate-typed answer, if they chose "Type instead". */
  textResponse: string | null;
  /** Open-ended audio path (Supabase Storage), if voice was used. */
  audioPath: string | null;
  /** Score awarded for this answer (delta from total). */
  scoreDelta: number;
};

/** Submission payload — only one of selectedOptions/text/audio populated per answer. */
export type AnswerPayload = {
  selectedOptions: string[];
  textResponse?: string;
  audioPath?: string;
  audioDurationSeconds?: number;
};

export type CandidateSessionState = {
  responseId: string;
  assessmentSlug: string;
  currentQuestion: CandidateQuestion | null;
  scoreSoFar: number;
  history: AnsweredEntry[];
  isSubmitting: boolean;
  isComplete: boolean;
  /** performance.now() timestamp at the moment the current question rendered. */
  questionShownAt: number;
  /** Last error message, surfaced to the UI. Cleared on next successful submit. */
  errorMessage: string | null;

  init: (args: {
    responseId: string;
    slug: string;
    question: CandidateQuestion | null;
    score: number;
    /** Past Q&A entries hydrated from the server on resume. */
    history?: AnsweredEntry[];
  }) => void;

  /** Submit the current question's answer. Caller picks one shape per type. */
  submitAnswer: (payload: AnswerPayload) => Promise<void>;
};

function nowMs(): number {
  if (typeof performance !== "undefined") return performance.now();
  return Date.now();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const useCandidateSession = create<CandidateSessionState>((set, get) => ({
  responseId: "",
  assessmentSlug: "",
  currentQuestion: null,
  scoreSoFar: 0,
  history: [],
  isSubmitting: false,
  isComplete: false,
  questionShownAt: 0,
  errorMessage: null,

  init: ({ responseId, slug, question, score, history }) => {
    set({
      responseId,
      assessmentSlug: slug,
      currentQuestion: question,
      scoreSoFar: score,
      // Hydrate locked-bubble history from the server on resume so the
      // candidate doesn't see their progress vanish after a refresh.
      history: history ?? [],
      isSubmitting: false,
      isComplete: question === null,
      questionShownAt: nowMs(),
      errorMessage: null,
    });
  },

  submitAnswer: async (payload) => {
    const state = get();
    const q = state.currentQuestion;
    if (!q || state.isSubmitting) return;

    const elapsedMs = nowMs() - state.questionShownAt;
    const timeSpentSeconds = Math.max(0, Math.round(elapsedMs / 1000));

    set({ isSubmitting: true, errorMessage: null });

    try {
      const res = await fetch("/api/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: q.id,
          selected_options: payload.selectedOptions,
          time_spent_seconds: timeSpentSeconds,
          text_response: payload.textResponse,
          audio_path: payload.audioPath,
          audio_duration_seconds: payload.audioDurationSeconds,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`/api/answers ${res.status}: ${text || res.statusText}`);
      }

      const data = (await res.json()) as AnswerResponse & {
        total_score?: number;
      };

      const selectedLabels = payload.selectedOptions
        .map((id) => q.options.find((o) => o.id === id)?.label)
        .filter((l): l is string => Boolean(l));

      const entry: AnsweredEntry = {
        questionId: q.id,
        questionText: q.questionText,
        selectedOptions: payload.selectedOptions,
        selectedLabel:
          selectedLabels.length > 0
            ? selectedLabels.join(", ")
            : payload.textResponse
              ? truncate(payload.textResponse, 80)
              : payload.audioPath
                ? "🎙️ Voice answer recorded"
                : null,
        textResponse: payload.textResponse ?? null,
        audioPath: payload.audioPath ?? null,
        scoreDelta: data.score_so_far - state.scoreSoFar,
      };

      set({
        history: [...state.history, entry],
        scoreSoFar: data.score_so_far,
        currentQuestion: data.next_question,
        isComplete: data.is_complete,
        isSubmitting: false,
        questionShownAt: nowMs(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "submission failed";
      set({ isSubmitting: false, errorMessage: message });
    }
  },
}));
