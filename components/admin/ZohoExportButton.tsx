"use client";

/**
 * "Export to Zoho Sheet" button + confirmation modal.
 *
 * Two-stage flow when the archive checkbox is on:
 *   1. POST .../export-zoho     → uploads CSV, returns file URL
 *   2. POST .../archive-audio   → loops in batches of 10 audios until
 *                                 the server reports remaining=0.
 *
 * The modal stays open during step 2 with progress numbers updating.
 * Failure in either step is shown without unwinding the other.
 */

import { useState } from "react";

type ExportResult = {
  workdrive_file_id: string;
  workdrive_file_url: string;
  file_name: string;
  response_count: number;
  voice_answer_count: number;
  voice_total_seconds: number;
  archive_started: boolean;
  archive_requested: boolean;
};

type ArchiveBatchResult = {
  archived: number;
  skipped_already_archived: number;
  failed: number;
  remaining: number;
  errors: { answer_id: string; message: string }[];
  zoho_folder_id: string;
};

type Phase =
  | "idle"
  | "exporting"
  | "exported"
  | "archiving"
  | "done"
  | "error";

export function ZohoExportButton({
  assessmentId,
}: {
  assessmentId: string;
}) {
  const [open, setOpen] = useState(false);
  const [archiveAudio, setArchiveAudio] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [archiveTotals, setArchiveTotals] = useState({
    archived: 0,
    failed: 0,
    remaining: 0,
    errors: [] as ArchiveBatchResult["errors"],
  });

  const close = () => {
    setOpen(false);
    setArchiveAudio(false);
    setPhase("idle");
    setError(null);
    setExportResult(null);
    setArchiveTotals({ archived: 0, failed: 0, remaining: 0, errors: [] });
  };

  async function runArchiveLoop(exportData: ExportResult) {
    setPhase("archiving");
    let totalArchived = 0;
    let totalFailed = 0;
    let lastRemaining = 0;
    let allErrors: ArchiveBatchResult["errors"] = [];

    // Hard cap: 200 batches × 10 = 2000 audios per click. Safety net so we
    // never spin forever if the server reports a stuck `remaining`.
    for (let batchIndex = 0; batchIndex < 200; batchIndex++) {
      const res = await fetch(
        `/api/admin/assessments/${assessmentId}/responses/archive-audio`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 10 }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(data.message ?? data.error ?? `failed (${res.status})`);
      }
      const batch = (await res.json()) as ArchiveBatchResult;
      totalArchived += batch.archived;
      totalFailed += batch.failed;
      lastRemaining = batch.remaining;
      if (batch.errors.length > 0) {
        allErrors = allErrors.concat(batch.errors);
      }
      setArchiveTotals({
        archived: totalArchived,
        failed: totalFailed,
        remaining: lastRemaining,
        errors: allErrors,
      });
      if (batch.remaining === 0) break;
      // No remaining reduction this batch → likely all failures, stop to avoid loop.
      if (batch.archived === 0 && batch.skipped_already_archived === 0) break;
    }

    // Fire-and-forget the summary email. Failure is non-fatal — the archive
    // already happened and the UI shows the totals.
    void fetch(
      `/api/admin/assessments/${assessmentId}/responses/archive-summary-email`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archived: totalArchived,
          failed: totalFailed,
          remaining: lastRemaining,
          workdrive_url: exportData.workdrive_file_url,
          file_name: exportData.file_name,
          response_count: exportData.response_count,
          voice_answer_count: exportData.voice_answer_count,
          errors: allErrors.slice(0, 50),
        }),
      },
    ).catch(() => {
      // Swallow — summary email is a nice-to-have.
    });

    setPhase("done");
  }

  async function onConfirm() {
    setError(null);
    setPhase("exporting");
    try {
      // 1. Generate + upload the CSV.
      const res = await fetch(
        `/api/admin/assessments/${assessmentId}/responses/export-zoho`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archive_audio: archiveAudio }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(data.message ?? data.error ?? `failed (${res.status})`);
      }
      const data = (await res.json()) as ExportResult;
      setExportResult(data);
      setPhase("exported");

      // 2. Archive the audio if requested.
      if (archiveAudio && data.voice_answer_count > 0) {
        await runArchiveLoop(data);
      } else {
        setPhase("done");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
      setPhase("error");
    }
  }

  const busy = phase === "exporting" || phase === "archiving";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setPhase("idle");
        }}
        className="inline-flex h-10 items-center rounded-xl border border-border bg-background px-4 text-sm font-medium hover:border-etc-marigold"
      >
        Export to Zoho Sheet
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) close();
          }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-lg">
            <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Zoho export
            </p>
            <h2 className="mt-1 text-xl font-bold">
              {phase === "done"
                ? "Done"
                : phase === "archiving"
                  ? "Archiving audio…"
                  : phase === "exporting"
                    ? "Exporting…"
                    : "Export to Zoho Sheet"}
            </h2>

            {phase === "idle" && (
              <>
                <p className="mt-3 text-sm text-muted-foreground">
                  Generates a CSV of all submitted responses (preview-tagged
                  sessions excluded) and uploads it to your WorkDrive
                  archive folder for this assessment.
                </p>

                <label className="mt-4 flex items-start gap-2 rounded-xl border border-dashed border-border bg-background/40 p-3">
                  <input
                    type="checkbox"
                    checked={archiveAudio}
                    onChange={(e) => setArchiveAudio(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-border accent-etc-marigold"
                  />
                  <span className="text-xs">
                    <span className="font-medium">
                      Archive audio to Zoho Drive after export
                    </span>
                    <span className="ml-1 text-muted-foreground">
                      Frees Supabase Storage. Each voice answer moves into
                      the assessment&rsquo;s WorkDrive folder; future
                      playback fetches from Zoho.
                    </span>
                  </span>
                </label>

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="inline-flex h-10 items-center rounded-xl border border-border bg-background px-4 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void onConfirm()}
                    className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
                  >
                    Export
                  </button>
                </div>
              </>
            )}

            {(phase === "exporting" || phase === "archiving") && (
              <div className="mt-4 space-y-2">
                {phase === "exporting" && (
                  <p className="text-sm text-muted-foreground">
                    Building CSV and uploading to WorkDrive…
                  </p>
                )}
                {phase === "archiving" && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Migrating audio to Zoho. This runs in batches of 10 to
                      stay within request budgets.
                    </p>
                    <p className="tabular-nums text-sm">
                      <strong>{archiveTotals.archived}</strong> migrated ·{" "}
                      <strong>{archiveTotals.failed}</strong> failed ·{" "}
                      <strong>{archiveTotals.remaining}</strong> remaining
                    </p>
                  </>
                )}
              </div>
            )}

            {phase === "done" && exportResult && (
              <div className="mt-4 space-y-3">
                <p className="text-sm">
                  Uploaded{" "}
                  <span className="font-medium">{exportResult.file_name}</span>{" "}
                  with <strong>{exportResult.response_count}</strong>{" "}
                  response{exportResult.response_count === 1 ? "" : "s"}
                  {exportResult.voice_answer_count > 0 && (
                    <>
                      {" "}
                      ({exportResult.voice_answer_count} voice answer
                      {exportResult.voice_answer_count === 1 ? "" : "s"}{" "}
                      referenced)
                    </>
                  )}
                  .
                </p>

                {archiveAudio && exportResult.voice_answer_count > 0 && (
                  <p className="rounded-xl border border-etc-marigold bg-etc-marigold/10 p-3 text-xs">
                    Archive complete: <strong>{archiveTotals.archived}</strong>{" "}
                    audio file{archiveTotals.archived === 1 ? "" : "s"}{" "}
                    moved to Zoho.
                    {archiveTotals.failed > 0 && (
                      <>
                        {" "}
                        <span className="text-destructive">
                          {archiveTotals.failed} failed.
                        </span>
                      </>
                    )}
                    {archiveTotals.remaining > 0 && (
                      <>
                        {" "}
                        {archiveTotals.remaining} skipped (likely failed) —
                        re-run to retry.
                      </>
                    )}
                    <span className="block pt-1 text-muted-foreground">
                      Summary email sent to your inbox.
                    </span>
                  </p>
                )}

                {archiveTotals.errors.length > 0 && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      Show {archiveTotals.errors.length} archive error
                      {archiveTotals.errors.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {archiveTotals.errors.slice(0, 10).map((e) => (
                        <li key={e.answer_id} className="font-mono text-[0.65rem]">
                          {e.answer_id.slice(0, 8)}: {e.message}
                        </li>
                      ))}
                      {archiveTotals.errors.length > 10 && (
                        <li>… and {archiveTotals.errors.length - 10} more.</li>
                      )}
                    </ul>
                  </details>
                )}

                <a
                  href={exportResult.workdrive_file_url}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  Open in Zoho WorkDrive ↗
                </a>
                <p className="text-[0.7rem] text-muted-foreground">
                  Link works for anyone signed in to your Zoho team.
                </p>
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={close}
                    className="inline-flex h-10 items-center rounded-xl border border-border bg-background px-4 text-sm"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {phase === "error" && (
              <div className="mt-4 space-y-3">
                {error && (
                  <p className="rounded-lg border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
                    {error}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setPhase("idle");
                    }}
                    className="inline-flex h-10 items-center rounded-xl border border-border bg-background px-4 text-sm"
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
