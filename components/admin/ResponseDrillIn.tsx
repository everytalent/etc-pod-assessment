"use client";

/**
 * Drill-in modal — full per-response review.
 *
 * For open-ended answers (text or voice), the admin sees an inline scoring
 * input — set the score awarded (0..points), click Save, the row updates
 * and the parent response totals are recomputed by the API.
 *
 * Voice playback uses a short-lived signed URL fetched on-demand from
 * /api/admin/answers/[id]/audio-url.
 */

import { useEffect, useState } from "react";

import type { QuestionOption, Response } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

type PersistedAiScore = {
  score: number;
  rationale: string;
  hits: string[];
  misses: string[];
  redFlags: string[];
  createdAt: string;
};

type AdminRoleClient = "superadmin" | "admin" | "editor" | "assessor";

type Scorer = { id: string; email: string; role: AdminRoleClient } | null;

type ScoreHistoryRow = {
  scoreAwarded: number;
  scoreSource: "manual" | "ai_gemini" | "ai_kimi";
  scoreRationale: string | null;
  scoredBy: string | null;
  scoredAt: string | null;
  replacedAt: string;
  replacedBy: string | null;
  scorer: Scorer;
  replacedByUser: Scorer;
};

type AnswerRow = {
  answerId: string;
  questionId: string;
  selectedOptions: string[];
  textResponse: string | null;
  audioPath: string | null;
  audioDurationSeconds: number | null;
  transcript: string | null;
  // Translation surface (Phase 4) — populated when the answer was
  // detected as non-English and ran through Gemini translation.
  detectedLanguage?: string | null;
  translatedText?: string | null;
  translatedTranscript?: string | null;
  translationStatus?: "not_needed" | "pending" | "done" | "failed" | null;
  scoringRubric: string | null;
  aiScores: Partial<Record<"gemini" | "kimi", PersistedAiScore>>;
  scorer: Scorer;
  /** Server-evaluated: should this viewer see AI panels for this answer? */
  canSeeAi: boolean;
  scoredBy: string | null;
  scoredAt: string | null;
  scoreSource: "manual" | "ai_gemini" | "ai_kimi";
  scoreRationale: string | null;
  integrityLevel: "low" | "mid" | "high" | null;
  integrityLevelSource: "manual" | "ai_kimi" | "ai_gemini" | null;
  integrityLevelSetBy: string | null;
  integrityLevelSetAt: string | null;
  integrityLevelSetByUser: Scorer;
  history: ScoreHistoryRow[];
  timeSpentSeconds: number;
  timedOut: boolean;
  scoreAwarded: number;
  answeredAt: string;
  questionText: string;
  questionType: string;
  options: QuestionOption[];
  correctAnswer: string[];
  orderIndex: number;
  points: number;
  negativePoints: number;
  section: string | null;
};

type Detail = {
  response: Response;
  answers: AnswerRow[];
  viewer: {
    role: AdminRoleClient;
    email: string;
    canRunAiPipeline: boolean;
  };
};

export function ResponseDrillIn({
  responseId,
  onClose,
}: {
  responseId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [pipeline, setPipeline] = useState<
    | { phase: "idle" }
    | {
        phase: "running";
        progress?: { label: string; done: number; total: number };
      }
    | {
        phase: "done";
        result: {
          consensus: "agree" | "override" | "gemini_only";
          gemini_scored: number;
          kimi_scored: number;
          sample_diff: number | null;
          skipped: string[];
          errors: string[];
        };
      }
    | { phase: "error"; message: string }
  >({ phase: "idle" });

  const [bulkAccept, setBulkAccept] = useState<
    | { phase: "idle" }
    | { phase: "running" }
    | {
        phase: "done";
        result: {
          accepted: number;
          skipped: number;
          skipped_manual?: number;
          provider: string;
        };
      }
    | { phase: "error"; message: string }
  >({ phase: "idle" });

  const runBulkAccept = async () => {
    // Two-step confirm so the reviewer makes a deliberate choice
    // about manual scores rather than discovering the behaviour
    // after the fact.
    if (
      !confirm(
        "Apply every AI suggestion as the human score for this response? You can still tweak any individual answer afterwards.",
      )
    ) {
      return;
    }
    const overrideManual = confirm(
      "OK = also override answers you've already scored manually.\n\nCancel = keep your manual scores (only apply AI to answers not yet scored).",
    );
    setBulkAccept({ phase: "running" });
    try {
      const res = await fetch(
        `/api/admin/responses/${responseId}/accept-ai-scores`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ override_manual: overrideManual }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(
          (body.message as string) ??
            (body.error as string) ??
            `failed (${res.status})`,
        );
      }
      setBulkAccept({
        phase: "done",
        result: body as {
          accepted: number;
          skipped: number;
          skipped_manual?: number;
          provider: string;
        },
      });
      setReload((r) => r + 1);
    } catch (err) {
      setBulkAccept({
        phase: "error",
        message: err instanceof Error ? err.message : "Bulk accept failed",
      });
    }
  };

  const runPipeline = async () => {
    // Multi-step orchestration on the client. Each /cross-check-step call
    // does ONE Gemini or Kimi scoring of ONE answer, well within Netlify's
    // 30 s function limit. Same shape as the audio archive batch loop.
    setPipeline({ phase: "running" });
    try {
      // 1. Plan: list scorable answers + already-scored ones.
      const planRes = await fetch(
        `/api/admin/responses/${responseId}/cross-check-plan`,
        { method: "GET" },
      );
      if (!planRes.ok) {
        const body = (await planRes.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(
          (body.message as string) ??
            (body.error as string) ??
            `plan failed (${planRes.status})`,
        );
      }
      const plan = (await planRes.json()) as {
        scorable: {
          answerId: string;
          maxPoints: number;
          needsTranscription?: boolean;
        }[];
        skipped: string[];
        existing: { gemini: string[]; kimi: string[] };
      };
      // Nothing scorable → finish in "done" so the reviewer sees the
      // per-answer reasons (no rubric / no answer / etc.) instead of a
      // single generic error.
      if (plan.scorable.length === 0) {
        setPipeline({
          phase: "done",
          result: {
            consensus: "gemini_only",
            gemini_scored: 0,
            kimi_scored: 0,
            sample_diff: null,
            skipped: plan.skipped,
            errors: [],
          },
        });
        return;
      }

      const errors: string[] = [];
      let geminiCount = 0;
      let kimiCount = 0;

      const stepFor = async (answerId: string, provider: "gemini" | "kimi") => {
        const res = await fetch(
          `/api/admin/answers/${answerId}/cross-check-step`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          errors.push(
            `${provider} ${answerId.slice(0, 8)}: ${(body.message as string) ?? (body.error as string) ?? `failed (${res.status})`}`,
          );
          return null;
        }
        return (await res.json()) as {
          suggestion: { suggestedScore: number };
        };
      };

      // 2. 1st assessor (Gemini) for any answer that doesn't yet have one.
      const geminiSet = new Set(plan.existing.gemini);
      const needsGemini = plan.scorable.filter((a) => !geminiSet.has(a.answerId));
      for (const a of needsGemini) {
        const result = await stepFor(a.answerId, "gemini");
        if (result) geminiCount += 1;
        setPipeline({
          phase: "running",
          progress: {
            label: "1st assessor",
            done: geminiCount + (geminiSet.size),
            total: plan.scorable.length,
          },
        });
      }

      // 3. Validation (2nd assessor / Kimi) on a sample of 3 random answers.
      const sampleSize = Math.min(3, plan.scorable.length);
      const sample = pickRandom(plan.scorable, sampleSize);
      for (const a of sample) {
        const result = await stepFor(a.answerId, "kimi");
        if (result) kimiCount += 1;
        setPipeline({
          phase: "running",
          progress: {
            label: "Validation sample",
            done: kimiCount,
            total: sampleSize,
          },
        });
      }

      // 4. Finalize once: server reads ai_scores, computes consensus, returns it.
      const finRes = await fetch(
        `/api/admin/responses/${responseId}/cross-check-plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!finRes.ok) throw new Error(`finalize failed (${finRes.status})`);
      let summary = (await finRes.json()) as {
        consensus: "agree" | "override" | "gemini_only";
        gemini_scored: number;
        kimi_scored: number;
        sample_size: number;
        sample_diff: number | null;
      };

      // 5. If override, run Kimi on the remaining answers and re-finalize.
      if (summary.consensus === "override") {
        const sampleIds = new Set(sample.map((a) => a.answerId));
        const rest = plan.scorable.filter((a) => !sampleIds.has(a.answerId));
        for (const a of rest) {
          const result = await stepFor(a.answerId, "kimi");
          if (result) kimiCount += 1;
          setPipeline({
            phase: "running",
            progress: {
              label: "2nd assessor (rescoring)",
              done: kimiCount,
              total: sampleSize + rest.length,
            },
          });
        }
        const finRes2 = await fetch(
          `/api/admin/responses/${responseId}/cross-check-plan`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        if (finRes2.ok) {
          summary = (await finRes2.json()) as typeof summary;
        }
      }

      setPipeline({
        phase: "done",
        result: {
          consensus: summary.consensus,
          gemini_scored: summary.gemini_scored,
          kimi_scored: summary.kimi_scored,
          sample_diff: summary.sample_diff,
          skipped: plan.skipped,
          errors,
        },
      });
      setReload((r) => r + 1);
    } catch (err) {
      setPipeline({
        phase: "error",
        message: err instanceof Error ? err.message : "Pipeline failed",
      });
    }
  };

  function pickRandom<T>(arr: T[], n: number): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy.slice(0, n);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/responses/${responseId}`);
        if (!res.ok) throw new Error(`load failed: ${res.status}`);
        const json = (await res.json()) as Detail;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [responseId, reload]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Response
            </p>
            <h2 className="mt-1 text-xl font-bold">
              {data ? data.response.candidateName : "Loading…"}
            </h2>
            {data && (
              <p className="text-xs text-muted-foreground">
                {data.response.candidateEmail}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs hover:border-etc-marigold"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </p>
        )}

        {data && (
          <>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Stat label="Status" value={data.response.status.replace("_", " ")} />
              <Stat
                label="Score"
                value={
                  data.response.totalScore !== null
                    ? `${data.response.totalScore} / ${data.response.maxPossibleScore}`
                    : "—"
                }
              />
              <Stat
                label="Pass"
                value={
                  data.response.pass === true
                    ? "Yes"
                    : data.response.pass === false
                      ? "No"
                      : "—"
                }
              />
              <Stat
                label="Time"
                value={
                  data.response.metadata.time_on_task_seconds != null
                    ? `${Math.round(
                        data.response.metadata.time_on_task_seconds / 60,
                      )}m`
                    : "—"
                }
              />
            </dl>

            <IntegritySignals metadata={data.response.metadata} />

            <IntegrityDeductionPanel
              responseId={responseId}
              initialPct={data.response.integrityDeductionPct ?? null}
              initialRationale={data.response.integrityDeductionRationale ?? ""}
              canEdit={data.viewer.role !== "assessor"}
              onSaved={() => setReload((r) => r + 1)}
            />

            {data.viewer.canRunAiPipeline && (
              <CrossCheckPanel
                consensus={data.response.aiConsensus}
                ranAt={
                  // JSON serialisation turns timestamptz into ISO strings;
                  // the Drizzle Response type still claims Date, so coerce.
                  data.response.aiPipelineRanAt
                    ? String(data.response.aiPipelineRanAt)
                    : null
                }
                pipeline={pipeline}
                bulkAccept={bulkAccept}
                onRun={runPipeline}
                onBulkAccept={runBulkAccept}
              />
            )}

            <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Path ({data.answers.length} answer{data.answers.length === 1 ? "" : "s"})
            </h3>
            <ol className="mt-3 flex flex-col gap-3">
              {data.answers.map((a, i) => (
                <AnswerCard
                  key={a.answerId}
                  index={i}
                  answer={a}
                  viewerRole={data.viewer.role}
                  onScored={() => setReload((r) => r + 1)}
                />
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Per-answer card ---------- */

function AnswerCard({
  index,
  answer,
  viewerRole,
  onScored,
}: {
  index: number;
  answer: AnswerRow;
  viewerRole: AdminRoleClient;
  onScored: () => void;
}) {
  const isOpen = answer.questionType === "open";

  return (
    <li className="rounded-2xl border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] uppercase text-muted-foreground">
          #{index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{answer.questionText}</p>
          <p className="mt-1 text-[0.7rem] text-muted-foreground">
            {summariseSelection(answer)} · {answer.scoreAwarded > 0 ? "+" : ""}
            {answer.scoreAwarded} pts · {answer.timeSpentSeconds}s
            {answer.timedOut && " · TIMED OUT"}
          </p>
          {answer.correctAnswer.length > 0 && (
            <p className="mt-1 text-[0.7rem] text-muted-foreground">
              Correct: {labelsFor(answer.correctAnswer, answer.options)}
            </p>
          )}
        </div>
      </div>

      {isOpen && (
        <OpenEndedReviewBlock
          answer={answer}
          viewerRole={viewerRole}
          onScored={onScored}
        />
      )}
    </li>
  );
}

/* ---------- Open-ended review ---------- */

function OpenEndedReviewBlock({
  answer,
  viewerRole,
  onScored,
}: {
  answer: AnswerRow;
  viewerRole: AdminRoleClient;
  onScored: () => void;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioTier, setAudioTier] = useState<"supabase" | "zoho" | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [score, setScore] = useState<number>(answer.scoreAwarded);
  const [rationale, setRationale] = useState<string>(answer.scoreRationale ?? "");
  const [saving, setSaving] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(
    answer.scoredAt,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [integrityLevel, setIntegrityLevel] = useState<
    "low" | "mid" | "high" | null
  >(answer.integrityLevel);
  const [integritySaving, setIntegritySaving] = useState(false);
  const [integrityError, setIntegrityError] = useState<string | null>(null);

  const setIntegrity = async (level: "low" | "mid" | "high" | null) => {
    setIntegritySaving(true);
    setIntegrityError(null);
    try {
      const res = await fetch(
        `/api/admin/answers/${answer.answerId}/integrity`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level, source: "manual" }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `failed (${res.status})`);
      }
      setIntegrityLevel(level);
      onScored();
    } catch (err) {
      setIntegrityError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIntegritySaving(false);
    }
  };

  /**
   * Most recent manual score: the current row if its source is manual,
   * otherwise the most recent score_history row with source=manual.
   * Used to render the Human card alongside AI cards so reviewers can
   * compare side-by-side even when the live score is an accepted AI value.
   */
  type LatestHuman = {
    score: number;
    rationale: string | null;
    scorer: Scorer;
    at: string | null;
  } | null;
  const latestHumanScore: LatestHuman =
    answer.scoreSource === "manual" && answer.scoredAt
      ? {
          score: answer.scoreAwarded,
          rationale: answer.scoreRationale,
          scorer: answer.scorer,
          at: answer.scoredAt,
        }
      : (() => {
          const h = answer.history.find((x) => x.scoreSource === "manual");
          return h
            ? {
                score: h.scoreAwarded,
                rationale: h.scoreRationale,
                scorer: h.scorer,
                at: h.scoredAt,
              }
            : null;
        })();
  const [transcript, setTranscript] = useState<string | null>(answer.transcript);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  type ScoreSuggestion = {
    suggestedScore: number;
    rationale: string;
    hits: string[];
    misses: string[];
    redFlagsTriggered: string[];
  };
  const [suggestion, setSuggestion] = useState<ScoreSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const runSuggest = async () => {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const res = await fetch(
        `/api/admin/answers/${answer.answerId}/auto-score`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      const data = (await res.json().catch(() => ({}))) as {
        suggestion?: ScoreSuggestion;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.suggestion) {
        throw new Error(data.message ?? data.error ?? `failed (${res.status})`);
      }
      setSuggestion(data.suggestion);
    } catch (err) {
      setSuggestError(
        err instanceof Error ? err.message : "Couldn't get a suggestion",
      );
    } finally {
      setSuggesting(false);
    }
  };

  const acceptSuggestion = () => {
    if (suggestion) {
      setScore(suggestion.suggestedScore);
    }
  };

  const runTranscribe = async () => {
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const res = await fetch(
        `/api/admin/answers/${answer.answerId}/transcribe`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      const data = (await res.json().catch(() => ({}))) as {
        transcript?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? `failed (${res.status})`);
      }
      setTranscript(data.transcript ?? "");
    } catch (err) {
      setTranscribeError(
        err instanceof Error ? err.message : "Transcription failed",
      );
    } finally {
      setTranscribing(false);
    }
  };

  const loadAudio = async () => {
    if (audioUrl || !answer.audioPath) return;
    setAudioLoading(true);
    setAudioError(null);
    try {
      const res = await fetch(`/api/admin/answers/${answer.answerId}/audio-url`);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const data = (await res.json()) as {
        url: string;
        tier?: "supabase" | "zoho";
      };
      setAudioUrl(data.url);
      setAudioTier(data.tier ?? "supabase");
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : "Couldn't load audio");
    } finally {
      setAudioLoading(false);
    }
  };

  // pendingSource tracks how the next save should be tagged. Clicking
  // "Use this score" on an AI card sets it; manual edits to the input
  // reset it to 'manual'. Cleared after a successful save.
  const [pendingSource, setPendingSource] = useState<
    "manual" | "ai_gemini" | "ai_kimi"
  >("manual");

  const [reassessing, setReassessing] = useState<"gemini" | "kimi" | null>(null);
  const [reassessError, setReassessError] = useState<string | null>(null);

  const reassessOne = async (provider: "gemini" | "kimi") => {
    setReassessing(provider);
    setReassessError(null);
    try {
      const res = await fetch(
        `/api/admin/answers/${answer.answerId}/cross-check-step`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(
          (body.message as string) ??
            (body.error as string) ??
            `failed (${res.status})`,
        );
      }
      // The persisted card reads from data.aiScores; the parent reload
      // refreshes it after this returns.
      onScored();
    } catch (err) {
      setReassessError(
        err instanceof Error ? err.message : "Re-assess failed",
      );
    } finally {
      setReassessing(null);
    }
  };

  /**
   * One-click accept of an AI suggestion — fills the score input AND
   * PATCHes the answer in the same gesture. Reviewers had been
   * confused by the two-step flow (Use → Save), thinking the button
   * was broken when only the input updated.
   */
  const acceptAiScore = async (
    value: number,
    source: "ai_gemini" | "ai_kimi",
  ) => {
    if (value < 0 || value > answer.points) {
      setScoreError(`Score must be between 0 and ${answer.points}.`);
      return;
    }
    setSaving(true);
    setScoreError(null);
    setScore(value);
    setPendingSource(source);
    try {
      const res = await fetch(`/api/admin/answers/${answer.answerId}/score`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score_awarded: value, source }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `failed (${res.status})`);
      }
      setSavedAt(new Date().toISOString());
      setPendingSource("manual");
      // We didn't send a rationale on accept (the AI's own rationale stands
      // in), so clear the local field — leaving stale text would be confusing
      // since it didn't actually save with this score.
      setRationale("");
      onScored();
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const submitScore = async () => {
    if (score < 0 || score > answer.points) {
      setScoreError(`Score must be between 0 and ${answer.points}.`);
      return;
    }
    // Manual scores need a written justification. Accepting an AI score
    // (pendingSource = ai_*) uses the AI's own rationale and so doesn't
    // require one from the reviewer.
    if (pendingSource === "manual" && rationale.trim().length === 0) {
      setScoreError("Add a short rationale before saving.");
      return;
    }
    setSaving(true);
    setScoreError(null);
    try {
      const res = await fetch(`/api/admin/answers/${answer.answerId}/score`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score_awarded: score,
          source: pendingSource,
          rationale: rationale.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `failed (${res.status})`);
      }
      setSavedAt(new Date().toISOString());
      setPendingSource("manual");
      onScored();
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-dashed border-border bg-muted/40 p-3">
      {answer.textResponse && (
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Text response
          </p>
          <p className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm leading-relaxed">
            {answer.textResponse}
          </p>
        </div>
      )}

      {answer.audioPath && (
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Voice response
            {answer.audioDurationSeconds != null && (
              <span className="ml-2 text-muted-foreground">
                · {formatDuration(answer.audioDurationSeconds)}
              </span>
            )}
          </p>
          {audioUrl && audioTier === "zoho" ? (
            <div className="mt-1 flex items-center gap-2">
              <a
                href={audioUrl}
                target="_blank"
                rel="noopener"
                className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                Open in Zoho WorkDrive ↗
              </a>
              <span className="text-[0.65rem] text-muted-foreground">
                Archived to Zoho — opens in WorkDrive (sign in required).
              </span>
            </div>
          ) : audioUrl ? (
            <audio
              controls
              src={audioUrl}
              preload="metadata"
              className="mt-1 w-full"
            >
              Your browser doesn&rsquo;t support audio playback.
            </audio>
          ) : (
            <button
              type="button"
              onClick={() => void loadAudio()}
              disabled={audioLoading}
              className="mt-1 inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs hover:border-etc-marigold disabled:opacity-60"
            >
              {audioLoading ? "Loading…" : "▶ Load audio"}
            </button>
          )}
          {audioError && (
            <p className="mt-1 text-[0.7rem] text-destructive">{audioError}</p>
          )}

          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                Transcript
              </p>
              {transcript ? (
                <button
                  type="button"
                  onClick={() => void runTranscribe()}
                  disabled={transcribing}
                  className="text-[0.65rem] text-muted-foreground underline-offset-2 hover:text-etc-marigold hover:underline disabled:opacity-60"
                >
                  {transcribing ? "Re-transcribing…" : "Re-transcribe"}
                </button>
              ) : null}
            </div>
            {transcript ? (
              <p className="mt-1 whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-sm leading-relaxed">
                {transcript}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void runTranscribe()}
                disabled={transcribing}
                className="mt-1 inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs hover:border-etc-marigold disabled:opacity-60"
              >
                {transcribing ? "Transcribing…" : "✨ Transcribe with Gemini"}
              </button>
            )}
            {transcribeError && (
              <div className="mt-2 rounded-lg border border-destructive bg-destructive/10 p-2 text-[0.7rem] text-destructive">
                <p className="leading-relaxed">{transcribeError}</p>
                <button
                  type="button"
                  onClick={() => void runTranscribe()}
                  disabled={transcribing}
                  className="mt-1 text-[0.65rem] font-medium underline-offset-2 hover:underline disabled:opacity-60"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!answer.textResponse && !answer.audioPath && (
        <p className="text-xs text-muted-foreground">
          (no response submitted)
        </p>
      )}

      {/* Translation surface (Phase 4) — visible only when the answer
          was detected as non-English. Shows the detected language +
          translated text/transcript side-by-side. */}
      {(answer.translatedText ||
        answer.translatedTranscript ||
        (answer.detectedLanguage && answer.detectedLanguage !== "en")) && (
        <details
          className="rounded-xl border border-blue-200 bg-blue-50/60 p-3"
          open
        >
          <summary className="cursor-pointer text-[0.65rem] font-semibold uppercase tracking-wider text-blue-900">
            🌐 Translation
            {answer.detectedLanguage && (
              <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-blue-900">
                {answer.detectedLanguage}
              </span>
            )}
            {answer.translationStatus && (
              <span className="ml-2 text-[0.65rem] text-blue-900/70">
                · {answer.translationStatus}
              </span>
            )}
          </summary>
          <div className="mt-2 space-y-2">
            {answer.translatedText && (
              <div>
                <p className="text-[0.65rem] font-medium uppercase tracking-wider text-blue-900/70">
                  Translated text (English)
                </p>
                <p className="mt-1 whitespace-pre-wrap rounded-lg border border-blue-200 bg-background p-3 text-sm leading-relaxed">
                  {answer.translatedText}
                </p>
              </div>
            )}
            {answer.translatedTranscript && (
              <div>
                <p className="text-[0.65rem] font-medium uppercase tracking-wider text-blue-900/70">
                  Translated transcript (English)
                </p>
                <p className="mt-1 whitespace-pre-wrap rounded-lg border border-blue-200 bg-background p-3 text-sm leading-relaxed">
                  {answer.translatedTranscript}
                </p>
              </div>
            )}
            {answer.translationStatus === "failed" && (
              <p className="text-[0.7rem] text-destructive">
                Translation failed. Check the original text/voice above —
                the AI scorers will fall back to the source language.
              </p>
            )}
          </div>
        </details>
      )}

      {/* Assessor scores side-by-side: human + Gemini + Kimi, whichever
          exist. Active card (currently the live score) gets a marigold
          ring so reviewers can tell what's being used at a glance. */}
      {(latestHumanScore ||
        (answer.canSeeAi && (answer.aiScores.gemini || answer.aiScores.kimi))) && (
        <div className="rounded-xl border border-etc-marigold bg-etc-marigold/10 p-3">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-etc-black">
            Assessor scores
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <HumanScoreCard
              data={latestHumanScore}
              maxPoints={answer.points}
              isActive={answer.scoreSource === "manual"}
            />
            {answer.canSeeAi && answer.aiScores.gemini && (
              <PersistedScoreCard
                provider={providerLabel("gemini")}
                data={answer.aiScores.gemini}
                maxPoints={answer.points}
                onAccept={() =>
                  void acceptAiScore(answer.aiScores.gemini!.score, "ai_gemini")
                }
                accepting={saving && pendingSource === "ai_gemini"}
                onReassess={() => void reassessOne("gemini")}
                reassessing={reassessing === "gemini"}
                isActive={answer.scoreSource === "ai_gemini"}
              />
            )}
            {answer.canSeeAi && answer.aiScores.kimi && (
              <PersistedScoreCard
                provider={providerLabel("kimi")}
                data={answer.aiScores.kimi}
                maxPoints={answer.points}
                onAccept={() =>
                  void acceptAiScore(answer.aiScores.kimi!.score, "ai_kimi")
                }
                accepting={saving && pendingSource === "ai_kimi"}
                onReassess={() => void reassessOne("kimi")}
                reassessing={reassessing === "kimi"}
                isActive={answer.scoreSource === "ai_kimi"}
              />
            )}
          </div>
        </div>
      )}

      {/* Assessor pre-grade nudge: panel reveals after they save a score.
          Only shown for assessors — for other roles where AI is gated off
          entirely (e.g. admin/editor in month 1), saving doesn't unlock
          anything, so the message would be misleading. */}
      {!answer.canSeeAi && viewerRole === "assessor" && answer.scoringRubric && (
        <div className="rounded-xl border border-dashed border-border bg-background/40 p-3 text-[0.7rem] text-muted-foreground">
          AI score suggestion will appear here after you save your own score.
        </div>
      )}

      {/* AI suggestion (ad-hoc, per-answer) */}
      {answer.canSeeAi && answer.scoringRubric && (transcript || answer.textResponse) && (
        <div className="rounded-xl border border-dashed border-etc-marigold bg-etc-marigold/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-etc-black">
              AI score suggestion (one-off)
            </p>
            <button
              type="button"
              onClick={() => void runSuggest()}
              disabled={suggesting}
              className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs hover:border-etc-marigold disabled:opacity-60"
            >
              {suggesting
                ? "Thinking…"
                : suggestion
                  ? "Re-suggest"
                  : "✨ Suggest score"}
            </button>
          </div>
          {suggestion && (
            <div className="mt-2 space-y-2">
              <p className="text-sm">
                Suggested:{" "}
                <strong className="text-base">
                  {suggestion.suggestedScore}
                </strong>{" "}
                / {answer.points}
                <button
                  type="button"
                  onClick={acceptSuggestion}
                  className="ml-3 inline-flex h-7 items-center rounded-md bg-primary px-2 text-[0.7rem] font-semibold text-primary-foreground hover:opacity-90"
                >
                  Accept
                </button>
              </p>
              {suggestion.rationale && (
                <p className="text-xs text-foreground">
                  {suggestion.rationale}
                </p>
              )}
              {suggestion.hits.length > 0 && (
                <p className="text-[0.7rem] text-muted-foreground">
                  <span className="font-semibold">Hits:</span>{" "}
                  {suggestion.hits.join(" · ")}
                </p>
              )}
              {suggestion.misses.length > 0 && (
                <p className="text-[0.7rem] text-muted-foreground">
                  <span className="font-semibold">Missed:</span>{" "}
                  {suggestion.misses.join(" · ")}
                </p>
              )}
              {suggestion.redFlagsTriggered.length > 0 && (
                <p className="text-[0.7rem] text-destructive">
                  <span className="font-semibold">Red flags:</span>{" "}
                  {suggestion.redFlagsTriggered.join(" · ")}
                </p>
              )}
            </div>
          )}
          {suggestError && (
            <div className="mt-2 rounded-lg border border-destructive bg-destructive/10 p-2 text-[0.7rem] text-destructive">
              {suggestError}
            </div>
          )}
        </div>
      )}

      {/* Scoring */}
      <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">
            Score (0&ndash;{answer.points})
          </span>
          <input
            type="number"
            min={0}
            max={answer.points}
            value={score}
            onChange={(e) => {
              setScore(Number(e.target.value));
              // A manual edit reverts the next save to 'manual', even
              // if "Use this score" was just clicked.
              setPendingSource("manual");
            }}
            className="h-9 w-20 rounded-lg border border-input bg-background px-2 text-sm tabular-nums focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold"
          />
        </label>
        <button
          type="button"
          onClick={() => void submitScore()}
          disabled={saving}
          className={cn(
            "inline-flex h-9 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60",
          )}
        >
          {saving ? "Saving…" : "Save score"}
        </button>
        {savedAt && (
          <span className="flex flex-wrap items-center gap-2 text-[0.7rem] text-muted-foreground">
            <span>
              Last scored {new Date(savedAt).toLocaleString()}
              {answer.scorer && (
                <>
                  {" "}by <strong>{answer.scorer.email}</strong> ({answer.scorer.role})
                </>
              )}
            </span>
            <SourceBadge source={answer.scoreSource} />
          </span>
        )}
      </div>
      {/* Reviewer rationale. Required when source = manual (validated client-
          and server-side). For ai_* sources the AI's own rationale is the
          authoritative note; this field is optional context. */}
      <label className="mt-2 flex flex-col gap-1 text-xs">
        <span className="font-medium">
          Your rationale{" "}
          <span className="text-muted-foreground">
            ({pendingSource === "manual" ? "required" : "optional"})
          </span>
        </span>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={3}
          placeholder="What earned this score? Note anything an assessor (or the AI later) would want to know."
          className="w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold"
        />
      </label>
      {reassessError && (
        <p className="text-[0.7rem] text-destructive">{reassessError}</p>
      )}
      {scoreError && (
        <p className="text-[0.7rem] text-destructive">{scoreError}</p>
      )}
      {/* Integrity tag (cheating-risk dimension). Independent of the score
          itself — high = -1 from this answer's contribution to the total,
          mid = zeroes the contribution, low = labelled only. Stored on the
          answer; recompute runs server-side on every PATCH. */}
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Integrity tag
          </p>
          {integrityLevel && answer.integrityLevelSource === "ai_kimi" && (
            <span className="rounded-md bg-etc-marigold/30 px-1.5 py-0.5 text-[0.65rem] text-etc-black">
              AI-suggested
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(["low", "mid", "high"] as const).map((lvl) => {
            const selected = integrityLevel === lvl;
            return (
              <button
                key={lvl}
                type="button"
                disabled={integritySaving}
                onClick={() => void setIntegrity(selected ? null : lvl)}
                className={cn(
                  "inline-flex h-7 items-center rounded-md border px-2 text-[0.7rem] font-medium disabled:opacity-60",
                  selected
                    ? lvl === "high"
                      ? "border-destructive bg-destructive text-destructive-foreground"
                      : lvl === "mid"
                        ? "border-amber-500 bg-amber-500 text-white"
                        : "border-etc-marigold bg-etc-marigold text-etc-black"
                    : "border-border bg-background hover:border-etc-marigold",
                )}
              >
                {lvl === "high"
                  ? "High (−1)"
                  : lvl === "mid"
                    ? "Mid (0)"
                    : "Low"}
              </button>
            );
          })}
          {integrityLevel && (
            <button
              type="button"
              disabled={integritySaving}
              onClick={() => void setIntegrity(null)}
              className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2 text-[0.65rem] text-muted-foreground hover:border-etc-marigold disabled:opacity-60"
            >
              Clear
            </button>
          )}
        </div>
        {answer.integrityLevelSetByUser && integrityLevel && (
          <p className="mt-1.5 text-[0.65rem] text-muted-foreground">
            Set by {answer.integrityLevelSetByUser.email}
            {answer.integrityLevelSetAt && (
              <> · {new Date(answer.integrityLevelSetAt).toLocaleString()}</>
            )}
          </p>
        )}
        {integrityError && (
          <p className="mt-1 text-[0.65rem] text-destructive">{integrityError}</p>
        )}
      </div>
      {answer.history.length > 0 && (
        <div className="rounded-lg border border-dashed border-border bg-muted/30">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-[0.7rem] font-medium text-muted-foreground hover:text-foreground"
          >
            <span>
              Prior scores ({answer.history.length})
            </span>
            <span>{historyOpen ? "−" : "+"}</span>
          </button>
          {historyOpen && (
            <ul className="divide-y divide-border border-t border-border">
              {answer.history.map((h, i) => (
                <li key={i} className="flex flex-col gap-1 px-3 py-2 text-[0.7rem]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono tabular-nums">
                      {h.scoreAwarded}/{answer.points}
                    </span>
                    <SourceBadge source={h.scoreSource} />
                    {h.scorer && (
                      <span className="text-muted-foreground">
                        by <strong>{h.scorer.email}</strong>
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      · replaced {new Date(h.replacedAt).toLocaleString()}
                      {h.replacedByUser && (
                        <> by <strong>{h.replacedByUser.email}</strong></>
                      )}
                    </span>
                  </div>
                  {h.scoreRationale && (
                    <p className="whitespace-pre-wrap text-muted-foreground">
                      {h.scoreRationale}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Integrity signals (anti-cheating, soft) ---------- */

type ResponseMetadataShape = {
  session_loads?: number;
  tab_blur_count?: number;
  paste_count?: number;
  start_ip_hash?: string;
  submit_ip_hash?: string;
};

function IntegritySignals({ metadata }: { metadata: ResponseMetadataShape }) {
  const items: { label: string; value: string; tone: "muted" | "warn" }[] = [];

  if ((metadata.session_loads ?? 0) > 1) {
    const n = metadata.session_loads ?? 0;
    items.push({
      label: "Session loads",
      value: String(n),
      tone: n >= 4 ? "warn" : "muted",
    });
  }
  if ((metadata.tab_blur_count ?? 0) > 0) {
    const n = metadata.tab_blur_count ?? 0;
    items.push({
      label: "Tab switches",
      value: String(n),
      tone: n >= 3 ? "warn" : "muted",
    });
  }
  if ((metadata.paste_count ?? 0) > 0) {
    const n = metadata.paste_count ?? 0;
    items.push({
      label: "Paste events",
      value: String(n),
      tone: n >= 1 ? "warn" : "muted",
    });
  }
  if (
    metadata.start_ip_hash &&
    metadata.submit_ip_hash &&
    metadata.start_ip_hash !== metadata.submit_ip_hash
  ) {
    items.push({
      label: "IP changed",
      value: "start ≠ submit",
      tone: "warn",
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="mt-3 rounded-xl border border-dashed border-border bg-background/60 p-3">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Integrity signals
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {items.map((it) => (
          <li key={it.label}>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[0.7rem]",
                it.tone === "warn"
                  ? "bg-amber-100 text-amber-900"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <span className="font-medium">{it.label}:</span> {it.value}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[0.65rem] text-muted-foreground">
        Soft signals only — never auto-blocking. Poor field connectivity
        can drive loads / tab switches up on legitimate candidates.
      </p>
    </div>
  );
}

/* ---------- Response-level integrity deduction ---------- */

function IntegrityDeductionPanel({
  responseId,
  initialPct,
  initialRationale,
  canEdit,
  onSaved,
}: {
  responseId: string;
  initialPct: number | null;
  initialRationale: string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [pct, setPct] = useState<string>(
    initialPct === null ? "" : String(initialPct),
  );
  const [rationale, setRationale] = useState<string>(initialRationale);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (clear = false) => {
    setSaving(true);
    setError(null);
    try {
      const body = clear
        ? { pct: null }
        : (() => {
            const n = Number(pct);
            if (!Number.isInteger(n) || n < 0 || n > 100) {
              throw new Error("Enter a whole number between 0 and 100.");
            }
            return { pct: n, rationale: rationale.trim() || undefined };
          })();
      const res = await fetch(
        `/api/admin/responses/${responseId}/integrity-deduction`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `failed (${res.status})`);
      }
      if (clear) {
        setPct("");
        setRationale("");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-dashed border-border bg-background/60 p-3">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Response integrity deduction
      </p>
      <p className="mt-1 text-[0.65rem] text-muted-foreground">
        Whole-response cheating penalty as a percentage of the total. Applied
        on top of any per-question integrity tags.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[0.7rem]">
          <span className="font-medium">% deducted</span>
          <input
            type="number"
            min={0}
            max={100}
            disabled={!canEdit || saving}
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            placeholder="0–100"
            className="h-8 w-24 rounded-lg border border-input bg-background px-2 text-xs tabular-nums focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold disabled:opacity-60"
          />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[0.7rem]">
          <span className="font-medium">
            Rationale <span className="text-muted-foreground">(optional)</span>
          </span>
          <input
            type="text"
            disabled={!canEdit || saving}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="e.g. IP changed mid-assessment + 5 tab switches"
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold disabled:opacity-60"
          />
        </label>
        <button
          type="button"
          disabled={!canEdit || saving}
          onClick={() => void save(false)}
          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[0.7rem] font-semibold text-primary-foreground disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {initialPct !== null && canEdit && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void save(true)}
            className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-[0.7rem] hover:border-etc-marigold disabled:opacity-60"
          >
            Clear
          </button>
        )}
      </div>
      {error && (
        <p className="mt-1 text-[0.65rem] text-destructive">{error}</p>
      )}
      {!canEdit && (
        <p className="mt-1 text-[0.65rem] text-muted-foreground">
          Editor+ can set the response-level deduction. Assessors only tag
          individual answers.
        </p>
      )}
    </div>
  );
}

/* ---------- Score-source badge ---------- */

function SourceBadge({ source }: { source: "manual" | "ai_gemini" | "ai_kimi" }) {
  if (source === "manual") {
    return (
      <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
        Manual score
      </span>
    );
  }
  const label =
    source === "ai_gemini"
      ? "Accepted from 1st assessor (Gemini)"
      : "Accepted from 2nd assessor (Kimi)";
  return (
    <span className="inline-flex items-center rounded-md bg-etc-marigold/30 px-1.5 py-0.5 text-[0.65rem] font-medium text-etc-black">
      {label}
    </span>
  );
}

/* ---------- AI provider display labels ---------- */

/**
 * UI-facing labels for the AI scorers. The DB and API still speak in
 * 'gemini' / 'kimi' but reviewers see the role they play in the
 * pipeline — first assessor, validation assessor — with the underlying
 * model name parenthesised so superadmins can still see what ran.
 */
function providerLabel(provider: "gemini" | "kimi" | string): string {
  if (provider === "gemini") return "1st assessor (Gemini)";
  if (provider === "kimi") return "2nd assessor (Kimi)";
  return provider;
}

function providerShort(provider: "gemini" | "kimi" | string): string {
  if (provider === "gemini") return "1st assessor";
  if (provider === "kimi") return "2nd assessor";
  return provider;
}

/* ---------- Human score card (mirror of PersistedScoreCard for AI) ---------- */

function HumanScoreCard({
  data,
  maxPoints,
  isActive,
}: {
  data: {
    score: number;
    rationale: string | null;
    scorer: Scorer;
    at: string | null;
  } | null;
  maxPoints: number;
  isActive: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-background p-3",
        isActive ? "border-etc-marigold ring-2 ring-etc-marigold" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.7rem] font-semibold">Human reviewer</p>
        <p className="text-sm tabular-nums">
          {data ? (
            <>
              <strong>{data.score}</strong>{" "}
              <span className="text-muted-foreground">/ {maxPoints}</span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </p>
      </div>
      {data?.rationale ? (
        <p className="mt-1 whitespace-pre-wrap text-[0.7rem] text-foreground">
          {data.rationale}
        </p>
      ) : (
        <p className="mt-1 text-[0.7rem] italic text-muted-foreground">
          {data ? "No rationale captured." : "No human score yet."}
        </p>
      )}
      {data?.scorer && (
        <p className="mt-1 text-[0.65rem] text-muted-foreground">
          by {data.scorer.email}
          {data.at && <> · {new Date(data.at).toLocaleString()}</>}
        </p>
      )}
    </div>
  );
}

/* ---------- Persisted per-answer AI score card ---------- */

function PersistedScoreCard({
  provider,
  data,
  maxPoints,
  onAccept,
  accepting,
  onReassess,
  reassessing,
  isActive = false,
}: {
  provider: string;
  data: PersistedAiScore;
  maxPoints: number;
  onAccept: () => void;
  accepting: boolean;
  onReassess: () => void;
  reassessing: boolean;
  isActive?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-background p-3",
        isActive ? "border-etc-marigold ring-2 ring-etc-marigold" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.7rem] font-semibold">{provider}</p>
        <p className="text-sm tabular-nums">
          <strong>{data.score}</strong>{" "}
          <span className="text-muted-foreground">/ {maxPoints}</span>
        </p>
      </div>
      {data.rationale && (
        <p className="mt-1 text-[0.7rem] text-foreground">{data.rationale}</p>
      )}
      {data.redFlags.length > 0 && (
        <p className="mt-1 text-[0.65rem] text-destructive">
          Red flags: {data.redFlags.join(" · ")}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAccept}
          disabled={accepting || reassessing}
          className="inline-flex h-7 items-center rounded-md bg-primary px-2 text-[0.7rem] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {accepting ? "Saving…" : "Use this score"}
        </button>
        <button
          type="button"
          onClick={onReassess}
          disabled={reassessing || accepting}
          className="inline-flex h-7 items-center rounded-md border border-border bg-background px-2 text-[0.7rem] hover:border-etc-marigold disabled:opacity-60"
        >
          {reassessing ? "Re-assessing…" : "Re-assess"}
        </button>
      </div>
    </div>
  );
}

/* ---------- Cross-check pipeline panel ---------- */

type PipelineState =
  | { phase: "idle" }
  | {
      phase: "running";
      progress?: { label: string; done: number; total: number };
    }
  | {
      phase: "done";
      result: {
        consensus: "agree" | "override" | "gemini_only";
        gemini_scored: number;
        kimi_scored: number;
        sample_diff: number | null;
        skipped: string[];
        errors: string[];
      };
    }
  | { phase: "error"; message: string };

type BulkAcceptState =
  | { phase: "idle" }
  | { phase: "running" }
  | {
      phase: "done";
      result: {
        accepted: number;
        skipped: number;
        skipped_manual?: number;
        provider: string;
      };
    }
  | { phase: "error"; message: string };

function CrossCheckPanel({
  consensus,
  ranAt,
  pipeline,
  bulkAccept,
  onRun,
  onBulkAccept,
}: {
  consensus: "pending" | "gemini_only" | "agree" | "override";
  ranAt: string | null;
  pipeline: PipelineState;
  bulkAccept: BulkAcceptState;
  onRun: () => void;
  onBulkAccept: () => void;
}) {
  const running = pipeline.phase === "running";
  const accepting = bulkAccept.phase === "running";
  const canBulkAccept = consensus !== "pending" && !running && !accepting;
  const badge = consensusBadge(consensus);
  return (
    <section className="mt-5 rounded-2xl border border-dashed border-etc-marigold bg-etc-marigold/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-etc-black">
            AI assessor cross-check
          </p>
          <p className="mt-1 text-sm">
            <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-[0.7rem] font-medium", badge.className)}>
              {badge.label}
            </span>
            {ranAt && (
              <span className="ml-2 text-[0.7rem] text-muted-foreground">
                last run {new Date(ranAt).toLocaleString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canBulkAccept && (
            <button
              type="button"
              onClick={onBulkAccept}
              disabled={accepting}
              className="inline-flex h-9 items-center rounded-xl border border-border bg-background px-4 text-xs hover:border-etc-marigold disabled:opacity-60"
            >
              {accepting ? "Accepting…" : "Accept all AI suggestions"}
            </button>
          )}
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {running ? "Scoring…" : "✨ Run AI scoring"}
          </button>
        </div>
      </div>

      {pipeline.phase === "running" && pipeline.progress && (
        <p className="mt-3 text-xs text-foreground">
          {pipeline.progress.label}:{" "}
          <strong>
            {pipeline.progress.done}/{pipeline.progress.total}
          </strong>
        </p>
      )}

      {pipeline.phase === "done" && (
        <div className="mt-3 space-y-2 text-xs text-foreground">
          {pipeline.result.gemini_scored === 0 &&
          pipeline.result.kimi_scored === 0 ? (
            <p>
              No open-ended answers were scored. See the reasons below to fix
              and re-run.
            </p>
          ) : (
            <p>
              1st assessor (Gemini) scored{" "}
              <strong>{pipeline.result.gemini_scored}</strong>{" "}
              answer{pipeline.result.gemini_scored === 1 ? "" : "s"}; 2nd assessor
              (Kimi) scored <strong>{pipeline.result.kimi_scored}</strong>.
              {pipeline.result.sample_diff !== null && (
                <>
                  {" "}Sample mean abs diff:{" "}
                  <strong>{pipeline.result.sample_diff.toFixed(2)}</strong>.
                </>
              )}
            </p>
          )}
          {pipeline.result.skipped.length > 0 && (
            <div className="rounded-lg border border-border bg-background/60 p-2">
              <p className="font-medium text-muted-foreground">
                Skipped {pipeline.result.skipped.length} answer
                {pipeline.result.skipped.length === 1 ? "" : "s"} (no rubric or
                no candidate answer):
              </p>
              <ul className="mt-1 ml-4 list-disc text-muted-foreground">
                {pipeline.result.skipped.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {pipeline.result.errors.length > 0 && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-2">
              <p className="font-medium text-destructive">
                {pipeline.result.errors.length} answer
                {pipeline.result.errors.length === 1 ? "" : "s"} failed to
                score — these did NOT contribute to consensus:
              </p>
              <ul className="mt-1 ml-4 list-disc text-destructive">
                {pipeline.result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {pipeline.phase === "error" && (
        <p className="mt-3 rounded-lg border border-destructive bg-destructive/10 p-2 text-[0.7rem] text-destructive">
          {pipeline.message}
        </p>
      )}

      {bulkAccept.phase === "done" && (
        <p className="mt-3 text-xs text-foreground">
          Applied <strong>{bulkAccept.result.accepted}</strong>{" "}
          {providerShort(bulkAccept.result.provider)} suggestion
          {bulkAccept.result.accepted === 1 ? "" : "s"}.
          {(bulkAccept.result.skipped_manual ?? 0) > 0 && (
            <>
              {" "}Kept <strong>{bulkAccept.result.skipped_manual}</strong>{" "}
              manual score
              {bulkAccept.result.skipped_manual === 1 ? "" : "s"} untouched.
            </>
          )}
          {bulkAccept.result.skipped > 0 && (
            <> {bulkAccept.result.skipped} answer(s) had no suggestion and were left as-is.</>
          )}
        </p>
      )}

      {bulkAccept.phase === "error" && (
        <p className="mt-3 rounded-lg border border-destructive bg-destructive/10 p-2 text-[0.7rem] text-destructive">
          {bulkAccept.message}
        </p>
      )}
    </section>
  );
}

function consensusBadge(c: "pending" | "gemini_only" | "agree" | "override"): {
  label: string;
  className: string;
} {
  switch (c) {
    case "pending":
      return { label: "Not run yet", className: "bg-muted text-muted-foreground" };
    case "gemini_only":
      return {
        label: "1st assessor scored",
        className: "bg-etc-marigold/30 text-etc-black",
      };
    case "agree":
      return {
        label: "Validation agrees · 1st assessor stands",
        className: "bg-emerald-100 text-emerald-900",
      };
    case "override":
      return {
        label: "Validation overrode · using 2nd assessor",
        className: "bg-amber-100 text-amber-900",
      };
  }
}

/* ---------- helpers ---------- */

function summariseSelection(a: AnswerRow): string {
  if (a.questionType === "open") {
    if (a.audioPath) return "🎙️ Voice response";
    if (a.textResponse) return "📝 Text response";
    return "(no response)";
  }
  if (a.selectedOptions.length === 0) return "(no answer)";
  return `Picked: ${labelsFor(a.selectedOptions, a.options)}`;
}

function labelsFor(ids: string[], options: QuestionOption[]): string {
  return ids
    .map((id) => options.find((o) => o.id === id)?.label ?? id)
    .join(", ");
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <dt className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}
