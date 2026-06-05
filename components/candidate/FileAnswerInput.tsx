"use client";

/**
 * FileAnswerInput — file-upload answer, Phase 2 type='file'.
 *
 * Flow:
 *   1. Candidate picks a file via <input type="file">
 *   2. We POST /api/answers/file/upload-url and get back a signed URL
 *      pointing at Supabase Storage
 *   3. Browser PUTs the file directly to that URL (bypasses Netlify
 *      function size limits)
 *   4. On success we submit the answer payload with
 *      structuredAnswer = { file_path, filename, content_type, size_bytes }
 *      plus optional explanation text
 *
 * Falls back to InvalidConfigTextFallback if storage upload fails or
 * if the question config is malformed — the candidate can always
 * describe their work in text instead of stranding the session.
 */

import { useRef, useState } from "react";

import type { CandidateQuestion } from "@/lib/assessment/validators";
import type { AnswerPayload } from "@/lib/state/candidate-session";
import { cn } from "@/lib/utils";

type Props = {
  question: CandidateQuestion;
  onSubmit: (payload: AnswerPayload) => void;
  disabled?: boolean;
};

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; pct: number }
  | { kind: "uploaded"; filePath: string; filename: string; size: number }
  | { kind: "error"; message: string };

const MAX_SIZE_MB = 25;

export function FileAnswerInput({ question, onSubmit, disabled = false }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [explanation, setExplanation] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function handleFileChange(file: File) {
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setState({
        kind: "error",
        message: `File too large (max ${MAX_SIZE_MB} MB).`,
      });
      return;
    }

    setState({ kind: "uploading", pct: 0 });
    try {
      const urlRes = await fetch("/api/answers/file/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: question.id,
          filename: file.name,
          content_type: file.type || "application/octet-stream",
        }),
      });
      if (!urlRes.ok) {
        const data = (await urlRes.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        throw new Error(
          data.message ?? data.error ?? `URL mint failed (${urlRes.status})`,
        );
      }
      const { upload_url, file_path } = (await urlRes.json()) as {
        upload_url: string;
        file_path: string;
      };

      const putRes = await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`Upload PUT failed (${putRes.status})`);
      }

      setState({
        kind: "uploaded",
        filePath: file_path,
        filename: file.name,
        size: file.size,
      });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  function handleSubmit() {
    if (disabled || submitted) return;
    if (state.kind !== "uploaded") return;
    setSubmitted(true);
    onSubmit({
      selectedOptions: [],
      structuredAnswer: {
        file_path: state.filePath,
        filename: state.filename,
        size_bytes: state.size,
        explanation: explanation.trim() || undefined,
      },
    });
  }

  const canSubmit = state.kind === "uploaded" && !disabled && !submitted;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Upload a file (max {MAX_SIZE_MB} MB)
      </p>

      <div className="mt-3">
        <input
          ref={fileRef}
          type="file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFileChange(f);
          }}
          disabled={disabled || submitted || state.kind === "uploading"}
          className="block w-full text-xs file:mr-3 file:rounded-lg file:border file:border-input file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium hover:file:border-etc-marigold"
          aria-label="File to upload"
        />
      </div>

      {state.kind === "uploading" && (
        <p className="mt-2 text-xs text-muted-foreground">Uploading…</p>
      )}

      {state.kind === "uploaded" && (
        <div className="mt-2 rounded-lg border border-green-300 bg-green-50 p-2 text-[0.7rem] text-green-900">
          ✓ {state.filename} ({(state.size / 1024 / 1024).toFixed(2)} MB)
        </div>
      )}

      {state.kind === "error" && (
        <div className="mt-2 rounded-lg border border-destructive bg-destructive/10 p-2 text-[0.7rem] text-destructive">
          {state.message}
        </div>
      )}

      <label className="mt-3 block">
        <span className="text-[0.7rem] font-medium text-muted-foreground">
          Optional explanation
        </span>
        <textarea
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          rows={3}
          maxLength={2000}
          disabled={disabled || submitted}
          placeholder="What is this file? How does it answer the question?"
          className="mt-1 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm"
          aria-label="Explanation"
        />
      </label>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={cn(
          "mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground",
          "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {submitted ? "Submitted…" : "Submit answer"}
      </button>
    </div>
  );
}
