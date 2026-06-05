"use client";

/**
 * Skillboard detail view — the cell grid + approval workflow.
 *
 * Responsibilities:
 *   - Render skills/tasks/cells in the 15-grid layout
 *   - Per-cell: approve, reject (with notes), edit-inline, regenerate
 *   - Bulk approve: by-row, by-skill, all-pending
 *   - Activation banner with the "X cells pending" count
 *   - Poll the worker loop while authoring is in progress
 *   - Re-fetch the board snapshot after every mutation
 *
 * State is held locally; we re-fetch the board after every write to
 * keep the visible counts honest without leaning on Zustand.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SkillboardDetail } from "@/lib/engines/assessment/skillboards/types";
import { BAND_LABELS, LEVEL_LABELS } from "@/lib/engines/assessment/types";
import type {
  LevelExpectationCell,
  SkillWithTasks,
  TaskWithCells,
} from "@/lib/engines/assessment/skillboards/types";

const BANDS = ["junior", "mid", "senior"] as const;
const LEVELS = ["below", "nh", "g", "p", "tp"] as const;

type AuthoringStatus = {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  /**
   * Regeneration jobs created via bulk-reject regen_mode='stage'. Sit
   * pending but paused_until_review=true; worker skips them; banner
   * lets admin Start (release) or Cancel (delete) them.
   */
  staged: number;
  last_error: string | null;
};

export function SkillboardDetailView({
  initial,
  canApprove,
  canDelete = false,
}: {
  initial: SkillboardDetail;
  canApprove: boolean;
  /**
   * Superadmin-only — gates the destructive Delete button. Editors with
   * skillboard_access can still rename + edit metadata, but only
   * superadmin can hard-delete a board.
   */
  canDelete?: boolean;
}) {
  const [board, setBoard] = useState<SkillboardDetail>(initial);
  const [authoringStatus, setAuthoringStatus] =
    useState<AuthoringStatus | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [editingBoard, setEditingBoard] = useState(false);
  const pollingRef = useRef(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/admin/skillboards/${initial.id}`);
    if (res.ok) {
      setBoard((await res.json()) as SkillboardDetail);
    }
  }, [initial.id]);

  // Poll loop: while there are pending or in_progress authoring jobs,
  // hit process-next-job every 2s, fetch status, and refresh the board.
  useEffect(() => {
    let cancelled = false;
    async function pollOnce() {
      if (cancelled) return;
      // Get status first; if no work, stop polling.
      const statusRes = await fetch(
        `/api/admin/skillboards/${initial.id}/authoring-status`,
      );
      if (!statusRes.ok) return;
      const status = (await statusRes.json()) as AuthoringStatus;
      if (cancelled) return;
      setAuthoringStatus(status);
      if (status.pending + status.in_progress === 0) {
        pollingRef.current = false;
        await refresh();
        return;
      }
      // Try to process a job (if no other tab beat us to it, this
      // consumes the next pending row).
      await fetch(
        `/api/admin/skillboards/${initial.id}/process-next-job`,
        { method: "POST" },
      );
      if (cancelled) return;
      await refresh();
      // Schedule next tick after a 2s breather.
      setTimeout(pollOnce, 2000);
    }
    if (!pollingRef.current) {
      pollingRef.current = true;
      void pollOnce();
    }
    return () => {
      cancelled = true;
      pollingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id]);

  async function onApprove(cellId: string) {
    await fetch(`/api/admin/level-expectations/${cellId}/approve`, {
      method: "POST",
    });
    await refresh();
  }
  async function onReject(cellId: string, notes: string) {
    await fetch(`/api/admin/level-expectations/${cellId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rejection_notes: notes }),
    });
    await refresh();
  }
  async function onEdit(cellId: string, text: string) {
    await fetch(`/api/admin/level-expectations/${cellId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectation_text: text }),
    });
    await refresh();
  }
  async function onRegenerate(cellId: string) {
    await fetch(`/api/admin/level-expectations/${cellId}/regenerate`, {
      method: "POST",
    });
    await refresh();
  }
  async function onBulkApprove(scope: "row" | "skill" | "all", id?: string) {
    const body: Record<string, unknown> = { scope };
    if (scope === "row") body.task_id = id;
    if (scope === "skill") body.skill_id = id;
    await fetch(`/api/admin/skillboards/${initial.id}/approve-bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await refresh();
  }
  async function onBulkReject(
    scope: "row" | "skill" | "all",
    id: string | undefined,
    notes: string,
    regenMode: "none" | "stage" | "immediate",
  ) {
    const body: Record<string, unknown> = {
      scope,
      rejection_notes: notes,
      regen_mode: regenMode,
    };
    if (scope === "row") body.task_id = id;
    if (scope === "skill") body.skill_id = id;
    const res = await fetch(`/api/admin/skillboards/${initial.id}/reject-bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json()) as { message?: string; error?: string };
      alert(data.message ?? data.error ?? "Bulk reject failed.");
      return;
    }
    await refresh();
  }
  async function onStagedRegens(action: "start" | "cancel") {
    const verb = action === "start" ? "release" : "cancel";
    const noun = authoringStatus?.staged ?? 0;
    if (
      !confirm(
        `${action === "start" ? "Release" : "Cancel"} ${noun} staged regen${noun === 1 ? "" : "s"}? ` +
          (action === "start"
            ? "Worker will start spending Opus credit on the next poll."
            : "Paused jobs will be deleted permanently."),
      )
    ) {
      return;
    }
    const res = await fetch(
      `/api/admin/skillboards/${initial.id}/staged-regens`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    );
    if (!res.ok) {
      const data = (await res.json()) as { message?: string; error?: string };
      alert(data.message ?? data.error ?? `Could not ${verb} staged regens.`);
      return;
    }
    await refresh();
  }
  async function onRenameTask(taskId: string, name: string) {
    const res = await fetch(`/api/admin/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { message?: string; error?: string };
      alert(data.message ?? data.error ?? "Rename failed.");
      return;
    }
    await refresh();
  }

  /**
   * Patch board-level metadata (specialisation, description, mindsets,
   * behavioural_skills). Used by the EditBoardPanel.
   */
  /**
   * Delete the board. Superadmin-only (button gated by canDelete).
   * Asks the user to type the exact specialisation as confirmation so a
   * misclick can't wipe months of authoring work.
   */
  async function onDeleteBoard(): Promise<void> {
    const confirmed = prompt(
      `Type the board name exactly to confirm DELETE:\n\n${board.specialisation}\n\nThis cannot be undone. Every skill, task, cell, and authoring job will be removed.`,
    );
    if (confirmed === null) return; // cancelled
    if (confirmed.trim() !== board.specialisation) {
      alert("Name didn't match. Delete cancelled.");
      return;
    }
    const res = await fetch(`/api/admin/skillboards/${initial.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json()) as { message?: string; error?: string };
      alert(data.message ?? data.error ?? "Delete failed.");
      return;
    }
    window.location.href = "/admin/skillboards";
  }

  /**
   * Archive / restore. Non-destructive — flips skillboards.archived_at.
   * Archived boards stop showing on /admin/skillboards and stop being
   * resolvable from POST /api/internal/sessions, but historical
   * responses + profiles still resolve their structure.
   */
  async function onArchiveToggle(): Promise<void> {
    const isArchiving = !board.archived_at;
    const verb = isArchiving ? "archive" : "restore";
    if (
      !confirm(
        `${verb[0].toUpperCase()}${verb.slice(1)} this skillboard?\n\n${
          isArchiving
            ? "It will disappear from the main list and stop being available for new candidate sessions. Historical results are unaffected. You can restore it later."
            : "It will reappear in the main list and become available for new sessions again."
        }`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin/skillboards/${initial.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive: isArchiving }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { message?: string; error?: string };
      alert(data.message ?? data.error ?? `${verb} failed.`);
      return;
    }
    await refresh();
  }

  async function onPatchBoard(updates: {
    specialisation?: string;
    description?: string;
    mindsets?: { name: string; description: string }[];
    behavioural_skills?: { name: string; description: string }[];
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    const res = await fetch(`/api/admin/skillboards/${initial.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const data = (await res.json()) as { message?: string; error?: string };
      return { ok: false, message: data.message ?? data.error ?? "Save failed." };
    }
    await refresh();
    return { ok: true };
  }
  async function onActivate() {
    setActivationError(null);
    const res = await fetch(
      `/api/admin/skillboards/${initial.id}/activate`,
      { method: "POST" },
    );
    if (!res.ok) {
      const data = (await res.json()) as { reason?: string; message?: string };
      setActivationError(
        data.reason ?? data.message ?? "Activation failed.",
      );
      return;
    }
    await refresh();
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-4">
        <Link
          href="/admin/skillboards"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← back to skillboards
        </Link>
      </div>

      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {board.specialisation}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {board.creation_path === "claude_authored" ? "chioma.ai-authored" : "Excel upload"}
            {" · "}
            {board.role_family}
            {" · "}
            {board.cell_counts.total} cells total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditingBoard(true)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-etc-marigold"
          >
            ✏️ Edit board
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={onArchiveToggle}
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              {board.archived_at ? "↩️ Restore" : "📥 Archive"}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={onDeleteBoard}
              className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-900 hover:bg-red-100"
            >
              🗑 Delete
            </button>
          )}
        </div>
      </header>

      {editingBoard && (
        <EditBoardPanel
          board={board}
          onClose={() => setEditingBoard(false)}
          onSave={onPatchBoard}
        />
      )}

      {/* Authoring progress / activation banner */}
      <ActivationBanner
        board={board}
        authoringStatus={authoringStatus}
        canApprove={canApprove}
        canDelete={canDelete}
        onActivate={onActivate}
        onBulkApproveAll={() => onBulkApprove("all")}
        activationError={activationError}
      />

      {/* Staged regens banner — visible when bulk-reject staged jobs for review */}
      {canApprove &&
        authoringStatus &&
        authoringStatus.staged > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div>
              <p className="font-semibold">
                {authoringStatus.staged} regeneration
                {authoringStatus.staged === 1 ? "" : "s"} staged for review
              </p>
              <p className="mt-0.5 text-xs">
                Created from a bulk-reject with &ldquo;Stage for review&rdquo;.
                Worker is ignoring these — your call when to spend Opus credit.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onStagedRegens("cancel")}
                className="rounded-md border border-amber-400 bg-background px-3 py-1.5 text-xs font-medium hover:bg-amber-100"
              >
                Cancel all
              </button>
              <button
                type="button"
                onClick={() => onStagedRegens("start")}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Start {authoringStatus.staged} regen
                {authoringStatus.staged === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        )}

      {/* Board-wide tools */}
      {canApprove && board.skills.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <button
            onClick={() => setFindReplaceOpen(true)}
            className="rounded-md border border-border bg-card px-3 py-1.5 font-medium hover:border-etc-marigold"
          >
            🔍 Find &amp; replace…
          </button>
          <span className="text-muted-foreground">
            applies to cells across the whole board, by skill, or by task
          </span>
        </div>
      )}

      {board.skills.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            Structure pass is still running. The page will update
            automatically.
          </p>
        </div>
      )}

      {/* Skill blocks */}
      <div className="mt-8 space-y-12">
        {board.skills.map((skill) => (
          <SkillBlock
            key={skill.id}
            skill={skill}
            canApprove={canApprove}
            onApprove={onApprove}
            onReject={onReject}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
            onBulkApprove={onBulkApprove}
            onBulkReject={onBulkReject}
            onRenameTask={onRenameTask}
          />
        ))}
      </div>

      {/* Find/Replace modal */}
      {findReplaceOpen && (
        <FindReplaceModal
          board={board}
          onClose={() => setFindReplaceOpen(false)}
          onApplied={refresh}
        />
      )}
    </main>
  );
}

/* ---------- Activation banner ---------- */

function ActivationBanner({
  board,
  authoringStatus,
  canApprove,
  canDelete,
  onActivate,
  onBulkApproveAll,
  activationError,
}: {
  board: SkillboardDetail;
  authoringStatus: AuthoringStatus | null;
  canApprove: boolean;
  canDelete: boolean;
  onActivate: () => void;
  onBulkApproveAll: () => void;
  activationError: string | null;
}) {
  const { total, pending, approved, rejected } = board.cell_counts;

  // Authoring still running?
  const authoring =
    authoringStatus &&
    authoringStatus.pending + authoringStatus.in_progress > 0;

  if (authoring) {
    return (
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-900">
          Authoring in progress
        </p>
        <p className="mt-1 text-xs text-blue-900">
          {authoringStatus!.completed} of {authoringStatus!.total} tasks
          done · {authoringStatus!.failed} failed
        </p>
        {authoringStatus!.last_error && (
          <p className="mt-2 text-[0.7rem] text-blue-900/80">
            Last error: {authoringStatus!.last_error}
          </p>
        )}
      </div>
    );
  }

  if (board.activated_at) {
    return (
      <div className="rounded-2xl border border-green-300 bg-green-50 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-green-900">
              ✓ Active since {new Date(board.activated_at).toLocaleDateString()}
            </p>
            <p className="mt-1 text-xs text-green-900">
              Validation Engine is pulling questions anchored to this board.
            </p>
          </div>
          {canDelete && <TestSeedButton boardId={board.id} />}
        </div>
      </div>
    );
  }

  if (pending === 0 && rejected === 0 && total > 0 && canApprove) {
    return (
      <div className="rounded-2xl border border-etc-marigold bg-etc-marigold/10 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Ready to activate</p>
            <p className="mt-1 text-xs text-muted-foreground">
              All {total} cells approved. Activating makes this board
              available to the CAT engine.
            </p>
          </div>
          <button
            onClick={onActivate}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Activate
          </button>
        </div>
        {activationError && (
          <p className="mt-3 text-xs text-destructive">{activationError}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-amber-900">
            {pending} of {total} cells pending · {approved} approved · {rejected}{" "}
            rejected
          </p>
          <p className="mt-1 text-xs text-amber-900">
            Approve every cell (Learning Expert) before this board can
            activate.
          </p>
        </div>
        {canApprove && pending > 0 && (
          <button
            onClick={onBulkApproveAll}
            className="inline-flex h-9 items-center justify-center rounded-xl border border-amber-400 bg-amber-100 px-4 text-xs font-semibold text-amber-900 hover:bg-amber-200"
          >
            Approve all {pending} pending
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Skill block ---------- */

function SkillBlock(props: {
  skill: SkillWithTasks;
  canApprove: boolean;
  onApprove: (cellId: string) => void;
  onReject: (cellId: string, notes: string) => void;
  onEdit: (cellId: string, text: string) => void;
  onRegenerate: (cellId: string) => void;
  onBulkApprove: (scope: "row" | "skill" | "all", id?: string) => void;
  onBulkReject: (
    scope: "row" | "skill" | "all",
    id: string | undefined,
    notes: string,
    regenMode: "none" | "stage" | "immediate",
  ) => void;
  onRenameTask: (taskId: string, name: string) => void;
}) {
  const { skill, canApprove } = props;
  const [rejectingSkill, setRejectingSkill] = useState(false);
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{skill.name}</h2>
        {canApprove && (
          <div className="flex gap-3 text-xs">
            <button
              type="button"
              onClick={() => props.onBulkApprove("skill", skill.id)}
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              Approve all pending in this skill
            </button>
            <button
              type="button"
              onClick={() => setRejectingSkill(true)}
              className="text-red-700 hover:text-red-900 hover:underline"
            >
              Reject all in this skill
            </button>
          </div>
        )}
      </div>
      {rejectingSkill && (
        <BulkRejectInline
          onCancel={() => setRejectingSkill(false)}
          onConfirm={(notes, regen) => {
            props.onBulkReject("skill", skill.id, notes, regen);
            setRejectingSkill(false);
          }}
        />
      )}
      <div className="space-y-6">
        {skill.tasks.map((task) => (
          <TaskGrid
            key={task.id}
            task={task}
            canApprove={canApprove}
            onApprove={props.onApprove}
            onReject={props.onReject}
            onEdit={props.onEdit}
            onRegenerate={props.onRegenerate}
            onBulkApproveRow={() => props.onBulkApprove("row", task.id)}
            onBulkRejectRow={(notes, regen) =>
              props.onBulkReject("row", task.id, notes, regen)
            }
            onRename={(name) => props.onRenameTask(task.id, name)}
          />
        ))}
      </div>
    </section>
  );
}

/* ---------- Bulk reject inline (used by skill block) ---------- */

function BulkRejectInline({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (notes: string, regenMode: "none" | "stage" | "immediate") => void;
}) {
  const [notes, setNotes] = useState("");
  // Default to "stage" — safest: regen jobs are created but paused
  // until admin reviews scope + clicks Start. Prevents accidental
  // Opus burn from a bulk reject on the wrong scope.
  const [regenMode, setRegenMode] = useState<"none" | "stage" | "immediate">(
    "stage",
  );
  const ready = notes.trim().length >= 20;
  return (
    <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3">
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Why are these cells wrong? (one note applies to all cells in scope, ≥20 chars)"
        className="w-full resize-y rounded-lg border border-red-300 bg-background p-2 text-xs"
        aria-label="Rejection notes"
      />
      <fieldset className="mt-2">
        <legend className="text-[0.65rem] font-semibold uppercase tracking-wider text-red-900">
          After rejection
        </legend>
        <div className="mt-1 flex flex-wrap gap-3 text-[0.7rem] text-red-900">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="regen-mode"
              checked={regenMode === "stage"}
              onChange={() => setRegenMode("stage")}
              aria-label="Stage regenerations for review"
            />
            <span>
              <strong>Stage for review</strong> — create regen jobs but pause
              them; review scope before Opus spends
            </span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="regen-mode"
              checked={regenMode === "immediate"}
              onChange={() => setRegenMode("immediate")}
              aria-label="Regenerate immediately"
            />
            <span>Regenerate immediately</span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="regen-mode"
              checked={regenMode === "none"}
              onChange={() => setRegenMode("none")}
              aria-label="Reject only without regenerating"
            />
            <span>Reject only (no regen)</span>
          </label>
        </div>
      </fieldset>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-background px-2 py-1 text-[0.7rem] hover:border-etc-marigold"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => onConfirm(notes.trim(), regenMode)}
          className="rounded-md bg-destructive px-2 py-1 text-[0.7rem] font-semibold text-destructive-foreground hover:opacity-90 disabled:opacity-50"
        >
          Confirm bulk reject
        </button>
      </div>
    </div>
  );
}

/* ---------- Task grid (15 cells, 3 bands × 5 levels) ---------- */

function TaskGrid(props: {
  task: TaskWithCells;
  canApprove: boolean;
  onApprove: (cellId: string) => void;
  onReject: (cellId: string, notes: string) => void;
  onEdit: (cellId: string, text: string) => void;
  onRegenerate: (cellId: string) => void;
  onBulkApproveRow: () => void;
  onBulkRejectRow: (notes: string, regenMode: "none" | "stage" | "immediate") => void;
  onRename: (name: string) => void;
}) {
  const { task, canApprove } = props;
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(task.name);
  const [rejectingTask, setRejectingTask] = useState(false);

  // Index cells by (band|level) for O(1) lookup in the grid render.
  const cellByKey = new Map<string, LevelExpectationCell>();
  for (const c of task.cells) cellByKey.set(`${c.band}|${c.level}`, c);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2">
        {renaming ? (
          <div className="flex flex-1 items-center gap-2">
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              minLength={5}
              maxLength={160}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
              autoFocus
            />
            <button
              type="button"
              onClick={() => {
                if (nameDraft.trim().length >= 5 && nameDraft !== task.name) {
                  props.onRename(nameDraft.trim());
                }
                setRenaming(false);
              }}
              className="rounded-md bg-primary px-2 py-1 text-[0.7rem] font-semibold text-primary-foreground hover:opacity-90"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setNameDraft(task.name);
                setRenaming(false);
              }}
              className="rounded-md border border-border bg-background px-2 py-1 text-[0.7rem] hover:border-etc-marigold"
            >
              Cancel
            </button>
          </div>
        ) : (
          <p className="flex-1 text-sm font-medium">
            {task.name}
            {canApprove && (
              <button
                type="button"
                onClick={() => {
                  setNameDraft(task.name);
                  setRenaming(true);
                }}
                className="ml-2 text-[0.65rem] font-normal text-muted-foreground hover:text-foreground hover:underline"
              >
                rename
              </button>
            )}
          </p>
        )}
        {canApprove && !renaming && (
          <div className="flex gap-3 text-[0.7rem]">
            <button
              type="button"
              onClick={props.onBulkApproveRow}
              className="text-muted-foreground hover:text-foreground hover:underline"
            >
              Approve all pending
            </button>
            <button
              type="button"
              onClick={() => setRejectingTask(true)}
              className="text-red-700 hover:text-red-900 hover:underline"
            >
              Reject all
            </button>
          </div>
        )}
      </div>
      {rejectingTask && (
        <div className="border-b border-border bg-red-50 px-4 py-3">
          <BulkRejectInline
            onCancel={() => setRejectingTask(false)}
            onConfirm={(notes, regen) => {
              props.onBulkRejectRow(notes, regen);
              setRejectingTask(false);
            }}
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="w-24 px-3 py-2 text-left font-medium">Band</th>
              {LEVELS.map((l) => (
                <th key={l} className="px-3 py-2 text-left font-medium">
                  {LEVEL_LABELS[l]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BANDS.map((band) => (
              <tr key={band} className="border-t border-border">
                <td className="w-24 bg-muted/20 px-3 py-2 align-top text-xs font-medium">
                  {BAND_LABELS[band]}
                </td>
                {LEVELS.map((level) => {
                  const cell = cellByKey.get(`${band}|${level}`);
                  if (!cell) return <td key={level} className="px-3 py-2" />;
                  return (
                    <td
                      key={level}
                      className="border-l border-border align-top"
                    >
                      <CellEditor
                        cell={cell}
                        canApprove={canApprove}
                        onApprove={() => props.onApprove(cell.id)}
                        onReject={(notes) => props.onReject(cell.id, notes)}
                        onEdit={(text) => props.onEdit(cell.id, text)}
                        onRegenerate={() => props.onRegenerate(cell.id)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- One cell ---------- */

function CellEditor(props: {
  cell: LevelExpectationCell;
  canApprove: boolean;
  onApprove: () => void;
  onReject: (notes: string) => void;
  onEdit: (text: string) => void;
  onRegenerate: () => void;
}) {
  const { cell, canApprove } = props;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(cell.expectation_text);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionNotes, setRejectionNotes] = useState("");

  const stateColor =
    cell.approval_state === "approved"
      ? "border-l-green-400"
      : cell.approval_state === "rejected"
        ? "border-l-red-400"
        : "border-l-amber-300";

  if (editing) {
    return (
      <div className={`flex h-full flex-col gap-2 border-l-2 p-2 ${stateColor}`}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="w-full resize-y rounded-lg border border-input bg-background p-2 text-xs"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setEditing(false)}
            className="text-[0.65rem] text-muted-foreground hover:underline"
          >
            cancel
          </button>
          <button
            onClick={async () => {
              await props.onEdit(text);
              setEditing(false);
            }}
            className="rounded-md bg-primary px-2 py-1 text-[0.65rem] font-medium text-primary-foreground hover:opacity-90"
          >
            save + approve
          </button>
        </div>
      </div>
    );
  }

  if (rejecting) {
    return (
      <div className={`flex h-full flex-col gap-2 border-l-2 p-2 ${stateColor}`}>
        <textarea
          value={rejectionNotes}
          onChange={(e) => setRejectionNotes(e.target.value)}
          rows={3}
          minLength={20}
          placeholder="Why is this wrong? (≥20 chars, used to regen)"
          className="w-full resize-y rounded-lg border border-input bg-background p-2 text-xs"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setRejecting(false)}
            className="text-[0.65rem] text-muted-foreground hover:underline"
          >
            cancel
          </button>
          <button
            disabled={rejectionNotes.trim().length < 20}
            onClick={async () => {
              await props.onReject(rejectionNotes.trim());
              setRejecting(false);
              setRejectionNotes("");
            }}
            className="rounded-md bg-destructive px-2 py-1 text-[0.65rem] font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
          >
            reject
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full min-h-[120px] flex-col gap-2 border-l-2 p-2 ${stateColor}`}>
      <p className="flex-1 whitespace-pre-wrap text-xs leading-relaxed">
        {cell.expectation_text || (
          <span className="italic text-muted-foreground">— empty —</span>
        )}
      </p>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[0.6rem] tracking-wider text-muted-foreground">
          {cell.synthesised ? "chioma.ai" : "HUMAN"}
          {cell.regeneration_count > 0 ? ` · regen ×${cell.regeneration_count}` : ""}
        </span>
        {canApprove && (
          <div className="flex gap-1 text-[0.6rem]">
            {cell.approval_state !== "approved" && cell.expectation_text && (
              <button
                onClick={props.onApprove}
                className="rounded bg-green-50 px-1.5 py-0.5 text-green-800 hover:bg-green-100"
              >
                ✓ approve
              </button>
            )}
            <button
              onClick={() => {
                setText(cell.expectation_text);
                setEditing(true);
              }}
              className="rounded bg-muted px-1.5 py-0.5 hover:bg-muted/80"
            >
              edit
            </button>
            {cell.approval_state !== "rejected" && (
              <button
                onClick={() => setRejecting(true)}
                className="rounded bg-red-50 px-1.5 py-0.5 text-red-800 hover:bg-red-100"
              >
                ✗ reject
              </button>
            )}
            {cell.approval_state === "rejected" &&
              cell.regeneration_count < 3 && (
                <button
                  onClick={props.onRegenerate}
                  className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-800 hover:bg-blue-100"
                >
                  ↻ regen
                </button>
              )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Find / replace modal ---------- */

type FindReplaceScope =
  | { kind: "board" }
  | { kind: "skill"; skill_id: string }
  | { kind: "task"; task_id: string };

type FindReplaceMatch = {
  cell_id: string;
  task_id: string;
  band: string;
  level: string;
  current_text: string;
  preview_text: string;
  match_count: number;
};

function FindReplaceModal({
  board,
  onClose,
  onApplied,
}: {
  board: SkillboardDetail;
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const [find, setFind] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [scope, setScope] = useState<FindReplaceScope>({ kind: "board" });
  const [preview, setPreview] = useState<{
    matches: FindReplaceMatch[];
    total_matches: number;
    cells_affected: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function runPreview() {
    if (find.trim().length === 0) return;
    setLoading(true);
    setErrorMsg(null);
    const res = await fetch(
      `/api/admin/skillboards/${board.id}/find-replace`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "preview",
          find,
          replace_with: replaceWith,
          scope,
          case_sensitive: caseSensitive,
        }),
      },
    );
    setLoading(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string; message?: string };
      setErrorMsg(data.message ?? data.error ?? "Preview failed.");
      return;
    }
    setPreview(await res.json());
  }

  async function applyReplacement() {
    setLoading(true);
    setErrorMsg(null);
    const res = await fetch(
      `/api/admin/skillboards/${board.id}/find-replace`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "apply",
          find,
          replace_with: replaceWith,
          scope,
          case_sensitive: caseSensitive,
        }),
      },
    );
    setLoading(false);
    if (!res.ok) {
      const data = (await res.json()) as { error?: string; message?: string };
      setErrorMsg(data.message ?? data.error ?? "Apply failed.");
      return;
    }
    await onApplied();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Find &amp; replace</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ✕ close
          </button>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Find
            </span>
            <input
              type="text"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="e.g. CBN"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Replace with
            </span>
            <input
              type="text"
              value={replaceWith}
              onChange={(e) => setReplaceWith(e.target.value)}
              placeholder="e.g. Fidelity"
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Scope
            </span>
            <select
              value={
                scope.kind === "board"
                  ? "board"
                  : scope.kind === "skill"
                    ? `skill:${scope.skill_id}`
                    : `task:${scope.task_id}`
              }
              onChange={(e) => {
                const v = e.target.value;
                if (v === "board") setScope({ kind: "board" });
                else if (v.startsWith("skill:"))
                  setScope({ kind: "skill", skill_id: v.slice(6) });
                else if (v.startsWith("task:"))
                  setScope({ kind: "task", task_id: v.slice(5) });
              }}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="board">Whole board ({board.specialisation})</option>
              {board.skills.map((s) => (
                <optgroup key={s.id} label={`Skill: ${s.name}`}>
                  <option value={`skill:${s.id}`}>↳ All tasks in this skill</option>
                  {s.tasks.map((t) => (
                    <option key={t.id} value={`task:${t.id}`}>
                      &nbsp;&nbsp;↳ Task: {t.name.slice(0, 80)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              aria-label="Case sensitive"
            />
            <span className="text-xs">Case-sensitive</span>
          </label>
        </div>

        {errorMsg && (
          <p className="mt-3 rounded-lg border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
            {errorMsg}
          </p>
        )}

        {/* Actions */}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:border-etc-marigold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={find.trim().length === 0 || loading}
            onClick={runPreview}
            className="rounded-lg border border-etc-marigold bg-etc-marigold/10 px-3 py-2 text-xs font-medium text-etc-black hover:bg-etc-marigold/20 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Preview matches"}
          </button>
          <button
            type="button"
            disabled={!preview || preview.cells_affected === 0 || loading}
            onClick={applyReplacement}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Apply (auto-approves edited cells)
          </button>
        </div>

        {/* Preview results */}
        {preview && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-xs">
              <span className="font-semibold">
                {preview.total_matches} match{preview.total_matches === 1 ? "" : "es"}
              </span>{" "}
              across{" "}
              <span className="font-semibold">{preview.cells_affected}</span>{" "}
              cells.
            </p>
            {preview.matches.length > 0 && (
              <div className="max-h-96 space-y-2 overflow-y-auto">
                {preview.matches.slice(0, 20).map((m) => (
                  <div
                    key={m.cell_id}
                    className="rounded-lg border border-border bg-background p-2 text-[0.7rem]"
                  >
                    <p className="mb-1 font-mono text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                      {m.band} · {m.level} · {m.match_count} match
                      {m.match_count === 1 ? "" : "es"}
                    </p>
                    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                      <p className="rounded bg-red-50 p-1 line-through opacity-70">
                        {m.current_text}
                      </p>
                      <p className="rounded bg-green-50 p-1">{m.preview_text}</p>
                    </div>
                  </div>
                ))}
                {preview.matches.length > 20 && (
                  <p className="text-center text-[0.65rem] text-muted-foreground">
                    + {preview.matches.length - 20} more cells (preview limited
                    to first 20 — all will be replaced on Apply)
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Edit board metadata panel ---------- */

/**
 * Edit board-level fields: specialisation (name), description,
 * mindsets, behavioural skills. These feed back into Claude's prompt
 * for any future regenerations, so changes don't auto-rewrite existing
 * cells — they just shape the basis for the next round.
 */
function EditBoardPanel({
  board,
  onClose,
  onSave,
}: {
  board: SkillboardDetail;
  onClose: () => void;
  onSave: (updates: {
    specialisation?: string;
    description?: string;
    mindsets?: { name: string; description: string }[];
    behavioural_skills?: { name: string; description: string }[];
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const [specialisation, setSpecialisation] = useState(board.specialisation);
  const [description, setDescription] = useState(board.description ?? "");
  const [mindsets, setMindsets] = useState(
    board.mindsets.map((m) => ({ name: m.name, description: m.description })),
  );
  const [behavioural, setBehavioural] = useState(
    board.behavioural_skills.map((s) => ({
      name: s.name,
      description: s.description,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setErrorMsg(null);
    const trimmedSpec = specialisation.trim();
    if (trimmedSpec.length < 3) {
      setErrorMsg("Specialisation must be at least 3 characters.");
      setSaving(false);
      return;
    }
    const updates: Parameters<typeof onSave>[0] = {};
    if (trimmedSpec !== board.specialisation) updates.specialisation = trimmedSpec;
    if (description.trim() !== (board.description ?? "")) {
      updates.description = description.trim();
    }
    updates.mindsets = mindsets
      .filter((m) => m.name.trim().length > 0)
      .map((m) => ({ name: m.name.trim(), description: m.description.trim() }));
    updates.behavioural_skills = behavioural
      .filter((s) => s.name.trim().length > 0)
      .map((s) => ({ name: s.name.trim(), description: s.description.trim() }));

    const result = await onSave(updates);
    setSaving(false);
    if (result.ok) onClose();
    else setErrorMsg(result.message);
  }

  return (
    <section className="mb-6 rounded-2xl border border-etc-marigold bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Edit board metadata</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ✕ close
        </button>
      </div>

      <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[0.7rem] text-amber-900">
        Heads up: changes here update the basis for future regenerations, not
        the existing cell text. Renaming the board ripples to the public
        specialisation key — make sure candidate profiles and the sentinel
        Validation Bank assessment reference the new name where needed.
      </p>

      <div className="space-y-4">
        <label className="block">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Name (specialisation)
          </span>
          <input
            type="text"
            value={specialisation}
            onChange={(e) => setSpecialisation(e.target.value)}
            minLength={3}
            maxLength={120}
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
            aria-label="Skillboard specialisation"
          />
        </label>

        <label className="block">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Description / brief
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="A good brief: project size/scale, primary geography, 2-3 example deliverables, how this differs from adjacent roles."
            className="mt-1 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[0.65rem] text-muted-foreground">
            {description.length} / 2000 characters
          </p>
        </label>

        <NameDescriptionListEditor
          label="Mindsets"
          rows={mindsets}
          onChange={setMindsets}
          maxRows={20}
        />

        <NameDescriptionListEditor
          label="Behavioural skills"
          rows={behavioural}
          onChange={setBehavioural}
          maxRows={20}
        />
      </div>

      {errorMsg && (
        <p className="mt-3 rounded-lg border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {errorMsg}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:border-etc-marigold"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </section>
  );
}

function NameDescriptionListEditor({
  label,
  rows,
  onChange,
  maxRows,
}: {
  label: string;
  rows: { name: string; description: string }[];
  onChange: (rows: { name: string; description: string }[]) => void;
  maxRows: number;
}) {
  return (
    <div>
      <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {label} ({rows.length}/{maxRows})
      </p>
      <div className="mt-1 space-y-2">
        {rows.map((row, i) => (
          <div
            key={i}
            className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-start"
          >
            <input
              type="text"
              value={row.name}
              onChange={(e) => {
                const next = [...rows];
                next[i] = { ...next[i], name: e.target.value };
                onChange(next);
              }}
              placeholder="Name"
              maxLength={120}
              className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
              aria-label={`${label} ${i + 1} name`}
            />
            <input
              type="text"
              value={row.description}
              onChange={(e) => {
                const next = [...rows];
                next[i] = { ...next[i], description: e.target.value };
                onChange(next);
              }}
              placeholder="Short description (optional)"
              maxLength={500}
              className="rounded-lg border border-input bg-background px-2 py-1 text-xs"
              aria-label={`${label} ${i + 1} description`}
            />
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              className="rounded-md border border-border bg-background px-2 py-1 text-[0.65rem] text-muted-foreground hover:border-destructive hover:text-destructive"
            >
              remove
            </button>
          </div>
        ))}
        {rows.length < maxRows && (
          <button
            type="button"
            onClick={() => onChange([...rows, { name: "", description: "" }])}
            className="text-[0.7rem] text-muted-foreground hover:text-foreground hover:underline"
          >
            + add {label.toLowerCase().replace(/s$/, "")}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Bank-seed button (superadmin only, activated boards) ---------- */

/**
 * Seed the validation bank with Opus-generated questions.
 *
 * Two modes via the inline config:
 *   - "Stage for review" (default): jobs created, proposals land in
 *     /admin/question-bank-proposals for human review before they hit
 *     the candidate-facing bank
 *   - "Auto-approve": proposals merge straight into the bank (test-only
 *     speed path; admin still owns the consequence)
 *
 * Cell count + questions-per-cell are picker-controlled. Each cell is
 * one Opus call (~$0.50). The estimate displayed before submit is
 * conservative — actual is usually lower.
 */
function TestSeedButton({ boardId }: { boardId: string }) {
  const [open, setOpen] = useState(false);
  const [maxCells, setMaxCells] = useState(5);
  const [questionsPerCell, setQuestionsPerCell] = useState(3);
  const [autoApprove, setAutoApprove] = useState(false);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "done"; approved: number; enqueued: number; staged?: boolean }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const estimateUsd = (maxCells * 0.5).toFixed(2);

  async function handleRun() {
    if (state.kind === "running") return;
    const verb = autoApprove ? "auto-approve" : "stage for review";
    if (
      !confirm(
        `Seed Opus for ${maxCells} cell(s) × ${questionsPerCell} questions and ${verb}?\n\nEstimated cost: ~$${estimateUsd}. Worker processes asynchronously — check the proposals page or refresh this page in a few minutes.`,
      )
    ) {
      return;
    }
    setState({ kind: "running" });
    const res = await fetch(`/api/admin/skillboards/${boardId}/test-seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        max_cells: maxCells,
        questions_per_cell: questionsPerCell,
        auto_approve: autoApprove,
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      setState({
        kind: "error",
        message: data.message ?? data.error ?? `Failed (${res.status}).`,
      });
      return;
    }
    const data = (await res.json()) as {
      jobs_enqueued?: number;
      proposals_enqueued?: number;
      proposals_auto_approved?: number;
    };
    setState({
      kind: "done",
      approved: data.proposals_auto_approved ?? 0,
      enqueued: data.proposals_enqueued ?? data.jobs_enqueued ?? 0,
      staged: !autoApprove,
    });
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-green-300 bg-white px-3 py-1.5 text-xs font-medium text-green-900 hover:bg-green-100"
        >
          🎯 Seed bank…
        </button>
        {state.kind === "done" && (
          <p className="text-[0.65rem] text-green-900">
            {state.staged
              ? `${state.enqueued} jobs queued · review at /admin/question-bank-proposals`
              : `${state.approved} approved, ${state.enqueued} into bank`}
          </p>
        )}
        {state.kind === "error" && (
          <p className="text-[0.65rem] text-destructive">{state.message}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-green-300 bg-white p-3 text-xs">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block">
          <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            Cells
          </span>
          <select
            value={maxCells}
            onChange={(e) => setMaxCells(Number(e.target.value))}
            className="mt-1 w-full rounded border border-input bg-background px-2 py-1"
            aria-label="Cells to seed"
          >
            <option value={1}>1 (test)</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            Qs/cell
          </span>
          <select
            value={questionsPerCell}
            onChange={(e) => setQuestionsPerCell(Number(e.target.value))}
            className="mt-1 w-full rounded border border-input bg-background px-2 py-1"
            aria-label="Questions per cell"
          >
            <option value={3}>3</option>
            <option value={5}>5</option>
            <option value={7}>7</option>
            <option value={10}>10</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            Approval
          </span>
          <label className="mt-1.5 flex items-center gap-1">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => setAutoApprove(e.target.checked)}
              aria-label="Auto-approve into bank"
            />
            <span className="text-[0.7rem]">Auto-approve</span>
          </label>
        </label>
        <div className="flex flex-col justify-end">
          <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            Est. cost
          </span>
          <span className="mt-1.5 text-sm font-semibold tabular-nums">
            ~${estimateUsd}
          </span>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-border bg-background px-3 py-1 text-[0.7rem] hover:border-etc-marigold"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleRun}
          disabled={state.kind === "running"}
          className="rounded-md bg-primary px-3 py-1 text-[0.7rem] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {state.kind === "running" ? "Queueing…" : "Run seed"}
        </button>
      </div>
      <p className="mt-2 text-[0.65rem] text-muted-foreground">
        Worker processes jobs asynchronously (Railway). Refresh the
        proposals page to watch them land.
      </p>
    </div>
  );
}
