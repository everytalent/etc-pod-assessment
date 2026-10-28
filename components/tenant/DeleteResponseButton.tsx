"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Delete one candidate's submission. Permanent, so it asks first. After it
 * goes, the page is refreshed in place, or the browser is sent to
 * `redirectTo` when the page being viewed is the submission itself.
 */
export function DeleteResponseButton({
  responseId,
  candidateName,
  redirectTo,
  className,
}: {
  responseId: string;
  candidateName: string;
  redirectTo?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (
      !window.confirm(
        `Delete ${candidateName}'s submission? Their answers and score are removed for good. There is no undo.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/tenant/candidate-responses/${responseId}`, { method: "DELETE" });
      if (!res.ok) {
        setError(res.status === 403 ? "Only workspace admins can delete submissions." : "Could not delete. Try again.");
        setBusy(false);
        return;
      }
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } catch {
      setError("Could not delete. Check your connection.");
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void remove()}
        disabled={busy}
        className={cn(
          "text-red-700 underline-offset-4 hover:underline disabled:opacity-50",
          className,
        )}
      >
        {busy ? "Deleting…" : "Delete"}
      </button>
      {error && <span className="text-[0.65rem] text-red-700">{error}</span>}
    </span>
  );
}
