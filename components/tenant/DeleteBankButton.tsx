"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Small icon button that soft-deletes a tenant assessment bank.
 * Confirms first, then hits DELETE /api/v1/tenant/assessment-banks/:id
 * and refreshes the current route so the row disappears from any
 * list rendered above it.
 */
export function DeleteBankButton({ bankId }: { bankId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const onClick = async () => {
    if (
      !confirm(
        "Delete this assessment? Candidates who have not yet started won't be able to open the link. Existing results stay in your history.",
      )
    ) {
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/v1/tenant/assessment-banks/${bankId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Could not delete this assessment.");
        setPending(false);
        return;
      }
      router.refresh();
    } catch {
      alert("Could not delete this assessment.");
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title="Delete assessment"
      aria-label="Delete assessment"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
    >
      {pending ? (
        <span className="text-[0.65rem]">…</span>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden
        >
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      )}
    </button>
  );
}
