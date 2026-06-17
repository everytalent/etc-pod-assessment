"use client";

/**
 * Inline retry + delete buttons for a failed assessment bank row.
 * Used on the assessments list and the home dashboard so tenants can
 * clear / re-run failed banks without opening each one's waiting page.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

export function FailedBankActions({ bankId }: { bankId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"retry" | "delete" | null>(null);

  const retry = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy("retry");
    try {
      const res = await fetch(
        `/api/v1/tenant/assessment-banks/${bankId}/retry`,
        { method: "POST" },
      );
      if (res.ok) {
        router.push(`/tenant/assessments/${bankId}/waiting`);
      }
    } finally {
      setBusy(null);
    }
  };

  const remove = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this failed assessment? This cannot be undone.")) {
      return;
    }
    setBusy("delete");
    try {
      const res = await fetch(`/api/v1/tenant/assessment-banks/${bankId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={retry}
        disabled={busy !== null}
        className="rounded-lg border border-border bg-background px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider hover:border-etc-marigold disabled:opacity-50"
      >
        {busy === "retry" ? "..." : "Retry"}
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={busy !== null}
        className="rounded-lg border border-destructive/40 px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/5 disabled:opacity-50"
      >
        {busy === "delete" ? "..." : "Delete"}
      </button>
    </div>
  );
}
