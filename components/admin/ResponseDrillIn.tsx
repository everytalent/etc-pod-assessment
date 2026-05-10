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

type AnswerRow = {
  answerId: string;
  questionId: string;
  selectedOptions: string[];
  textResponse: string | null;
  audioPath: string | null;
  audioDurationSeconds: number | null;
  transcript: string | null;
  scoringRubric: string | null;
  aiScores: Partial<Record<"gemini" | "kimi", PersistedAiScore>>;
  scorer: Scorer;
  /** Server-evaluated: should this viewer see AI panels for this answer? */
  canSeeAi: boolean;
  scoredBy: string | null;
  scoredAt: string | null;
  scoreSource: "manual" | "ai_gemini" | "ai_kimi";
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
        result: { accepted: number; skipped: number; provider: string };
      }
    | { phase: "error"; message: string }
  >({ phase: "idle" });

  const runBulkAccept = async () => {
    if (
      !confirm(
        "Apply every AI suggestion as the human score for this response? You can still tweak any individual answer afterwards.",
      )
    ) {
      return;
    }
    setBulkAccept({ phase: "running" });
    try {
      const res = await fetch(
        `/api/admin/responses/${responseId}/accept-ai-scores`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
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
        result: body as { accepted: number; skipped: number; provider: string },
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
        scorable: { answerId: string; maxPoints: number }[];
        skipped: string[];
        existing: { gemini: string[]; kimi: string[] };
      };
      if (plan.scorable.length === 0) {
        throw new Error(
          "No open-ended answers in this response have both a rubric and a candidate answer ready.",
        );
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
  const [saving, setSaving] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(
    answer.scoredAt,
  );
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

  const submitScore = async () => {
    if (score < 0 || score > answer.points) {
      setScoreError(`Score must be between 0 and ${answer.points}.`);
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

      {/* Persisted AI scores from the cross-check pipeline */}
      {answer.canSeeAi && (answer.aiScores.gemini || answer.aiScores.kimi) && (
        <div className="rounded-xl border border-etc-marigold bg-etc-marigold/10 p-3">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-etc-black">
            AI assessor scores
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {answer.aiScores.gemini && (
              <PersistedScoreCard
                provider={providerLabel("gemini")}
                data={answer.aiScores.gemini}
                maxPoints={answer.points}
                onAccept={() => {
                  setScore(answer.aiScores.gemini!.score);
                  setPendingSource("ai_gemini");
                }}
                onReassess={() => void reassessOne("gemini")}
                reassessing={reassessing === "gemini"}
              />
            )}
            {answer.aiScores.kimi && (
              <PersistedScoreCard
                provider={providerLabel("kimi")}
                data={answer.aiScores.kimi}
                maxPoints={answer.points}
                onAccept={() => {
                  setScore(answer.aiScores.kimi!.score);
                  setPendingSource("ai_kimi");
                }}
                onReassess={() => void reassessOne("kimi")}
                reassessing={reassessing === "kimi"}
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
      {reassessError && (
        <p className="text-[0.7rem] text-destructive">{reassessError}</p>
      )}
      {scoreError && (
        <p className="text-[0.7rem] text-destructive">{scoreError}</p>
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

/* ---------- Persisted per-answer AI score card ---------- */

function PersistedScoreCard({
  provider,
  data,
  maxPoints,
  onAccept,
  onReassess,
  reassessing,
}: {
  provider: string;
  data: PersistedAiScore;
  maxPoints: number;
  onAccept: () => void;
  onReassess: () => void;
  reassessing: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
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
          className="inline-flex h-7 items-center rounded-md bg-primary px-2 text-[0.7rem] font-semibold text-primary-foreground hover:opacity-90"
        >
          Use this score
        </button>
        <button
          type="button"
          onClick={onReassess}
          disabled={reassessing}
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
      result: { accepted: number; skipped: number; provider: string };
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
        <div className="mt-3 space-y-1 text-xs text-foreground">
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
          {pipeline.result.skipped.length > 0 && (
            <p className="text-muted-foreground">
              Skipped: {pipeline.result.skipped.join(", ")}
            </p>
          )}
          {pipeline.result.errors.length > 0 && (
            <details className="text-destructive">
              <summary className="cursor-pointer">
                {pipeline.result.errors.length} error
                {pipeline.result.errors.length === 1 ? "" : "s"}
              </summary>
              <ul className="ml-5 list-disc">
                {pipeline.result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </details>
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
