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

type AnswerRow = {
  answerId: string;
  questionId: string;
  selectedOptions: string[];
  textResponse: string | null;
  audioPath: string | null;
  audioDurationSeconds: number | null;
  transcript: string | null;
  scoredBy: string | null;
  scoredAt: string | null;
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

            <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Path ({data.answers.length} answer{data.answers.length === 1 ? "" : "s"})
            </h3>
            <ol className="mt-3 flex flex-col gap-3">
              {data.answers.map((a, i) => (
                <AnswerCard
                  key={a.answerId}
                  index={i}
                  answer={a}
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
  onScored,
}: {
  index: number;
  answer: AnswerRow;
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
        <OpenEndedReviewBlock answer={answer} onScored={onScored} />
      )}
    </li>
  );
}

/* ---------- Open-ended review ---------- */

function OpenEndedReviewBlock({
  answer,
  onScored,
}: {
  answer: AnswerRow;
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
        body: JSON.stringify({ score_awarded: score }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `failed (${res.status})`);
      }
      setSavedAt(new Date().toISOString());
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
            onChange={(e) => setScore(Number(e.target.value))}
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
          <span className="text-[0.7rem] text-muted-foreground">
            Last scored {new Date(savedAt).toLocaleString()}
          </span>
        )}
      </div>
      {scoreError && (
        <p className="text-[0.7rem] text-destructive">{scoreError}</p>
      )}
    </div>
  );
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
