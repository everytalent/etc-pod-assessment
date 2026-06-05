"use client";

/**
 * UploadSkillboardForm — Excel upload UI for skillboard creation.
 *
 * Just a file picker + submit. Surfaces structured validation errors
 * returned by the upload endpoint (sheet, row, message) so the user
 * can fix the spreadsheet and retry without guesswork.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

type State =
  | { kind: "idle" }
  | { kind: "uploading" }
  | {
      kind: "errors";
      generalMessage?: string;
      errors: Array<{ sheet: string; row?: number; message: string }>;
    }
  | { kind: "conflict"; existingId: string; message: string };

export function UploadSkillboardForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (state.kind === "uploading") return;

    setState({ kind: "uploading" });

    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/skillboards/upload", {
      method: "POST",
      body: fd,
    });

    if (res.status === 201) {
      const data = (await res.json()) as { skillboard_id: string };
      router.push(`/admin/skillboards/${data.skillboard_id}`);
      return;
    }
    if (res.status === 409) {
      const data = (await res.json()) as {
        message?: string;
        existing_id?: string;
      };
      setState({
        kind: "conflict",
        existingId: data.existing_id ?? "",
        message: data.message ?? "A skillboard with this specialisation already exists.",
      });
      return;
    }
    if (res.status === 422) {
      const data = (await res.json()) as {
        message?: string;
        errors?: Array<{ sheet: string; row?: number; message: string }>;
      };
      setState({
        kind: "errors",
        generalMessage: data.message,
        errors: data.errors ?? [
          { sheet: "(unknown)", message: "Validation failed." },
        ],
      });
      return;
    }
    // Fallback
    const text = await res.text().catch(() => "");
    setState({
      kind: "errors",
      generalMessage: `Upload failed (${res.status}).`,
      errors: [{ sheet: "(server)", message: text.slice(0, 200) || "unknown" }],
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-2xl border border-border bg-card p-6"
    >
      <label className="block">
        <span className="block text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
          Excel file (.xlsx)
        </span>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={state.kind === "uploading"}
          className="mt-2 block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-input file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium hover:file:border-etc-marigold"
          required
          aria-label="Skillboard Excel file"
        />
      </label>

      {state.kind === "errors" && (
        <div className="rounded-xl border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {state.generalMessage && (
            <p className="font-semibold">{state.generalMessage}</p>
          )}
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
            {state.errors.map((err, i) => (
              <li key={i} className="rounded bg-background/60 p-1.5">
                <span className="font-mono text-[0.65rem] uppercase tracking-wider">
                  {err.sheet}
                  {err.row !== undefined ? ` row ${err.row}` : ""}
                </span>
                <span className="ml-2">{err.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.kind === "conflict" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">{state.message}</p>
          {state.existingId && (
            <p className="mt-1">
              <a
                href={`/admin/skillboards/${state.existingId}`}
                className="underline"
              >
                Open the existing board →
              </a>
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!file || state.kind === "uploading"}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {state.kind === "uploading" ? "Uploading…" : "Upload skillboard"}
        </button>
      </div>
    </form>
  );
}
