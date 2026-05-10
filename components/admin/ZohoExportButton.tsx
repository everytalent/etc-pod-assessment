"use client";

/**
 * "Export to Zoho Sheet" button + confirmation modal.
 *
 * Currently exports all (non-preview) responses for the assessment to a
 * CSV file uploaded into the assessment's WorkDrive folder. The
 * `archive_audio` checkbox is rendered but the audio archive flow lands
 * in a follow-up commit — for now the request is sent and the API
 * responds with archive_started=false.
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

export function ZohoExportButton({
  assessmentId,
}: {
  assessmentId: string;
}) {
  const [open, setOpen] = useState(false);
  const [archiveAudio, setArchiveAudio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);

  const close = () => {
    setOpen(false);
    setArchiveAudio(false);
    setBusy(false);
    setError(null);
    setResult(null);
  };

  const onExport = async () => {
    setBusy(true);
    setError(null);
    try {
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
        throw new Error(
          data.message ?? data.error ?? `failed (${res.status})`,
        );
      }
      const data = (await res.json()) as ExportResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
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
              {result ? "Export complete" : "Export to Zoho Sheet"}
            </h2>

            {!result && !error && (
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
                    disabled={busy}
                    className="mt-0.5 h-4 w-4 rounded border-border accent-etc-marigold"
                  />
                  <span className="text-xs">
                    <span className="font-medium">
                      Archive audio to Zoho Drive after export
                    </span>
                    <span className="ml-1 text-muted-foreground">
                      (frees Supabase storage; future audio playback fetches
                      from Zoho instead). <em>Coming in next commit — flag
                      is recorded but the migration job lands shortly.</em>
                    </span>
                  </span>
                </label>

                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={busy}
                    className="inline-flex h-10 items-center rounded-xl border border-border bg-background px-4 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void onExport()}
                    disabled={busy}
                    className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {busy ? "Exporting…" : "Export"}
                  </button>
                </div>
              </>
            )}

            {error && (
              <>
                <p className="mt-3 rounded-lg border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
                  {error}
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setError(null)}
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
              </>
            )}

            {result && (
              <>
                <p className="mt-3 text-sm">
                  Uploaded <span className="font-medium">{result.file_name}</span>{" "}
                  with <strong>{result.response_count}</strong>{" "}
                  response{result.response_count === 1 ? "" : "s"}
                  {result.voice_answer_count > 0 && (
                    <>
                      {" "}
                      ({result.voice_answer_count} voice answer
                      {result.voice_answer_count === 1 ? "" : "s"} referenced)
                    </>
                  )}
                  .
                </p>
                <a
                  href={result.workdrive_file_url}
                  target="_blank"
                  rel="noopener"
                  className="mt-3 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  Open in Zoho WorkDrive ↗
                </a>
                <p className="mt-3 text-[0.7rem] text-muted-foreground">
                  Link works for anyone signed in to your Zoho team.
                  {result.archive_requested && (
                    <span className="ml-1 italic">
                      Audio archive was requested but isn&rsquo;t wired yet —
                      see release notes.
                    </span>
                  )}
                </p>
                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={close}
                    className="inline-flex h-10 items-center rounded-xl border border-border bg-background px-4 text-sm"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
