"use client";

import { useEffect, useState } from "react";

type Entry = {
  id: string;
  event_type: string;
  generation_credits_delta: number;
  candidate_slots_delta: number;
  amount_local: string | null;
  currency_code: string | null;
  reason: string | null;
  payment_processor: string | null;
  created_at: string;
};

export function BillingLedger() {
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    void fetch("/api/v1/tenant/billing/ledger?limit=50", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setEntries(data.entries ?? []));
  }, []);

  if (!entries) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-xs text-muted-foreground">
        No transactions yet.
      </p>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="py-2 pr-3 font-medium">When</th>
          <th className="py-2 pr-3 font-medium">Event</th>
          <th className="py-2 pr-3 text-right font-medium">Gens</th>
          <th className="py-2 pr-3 text-right font-medium">Slots</th>
          <th className="py-2 pr-3 text-right font-medium">Amount</th>
          <th className="py-2 font-medium">Note</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {entries.map((e) => (
          <tr key={e.id}>
            <td className="py-2 pr-3 text-muted-foreground">
              {new Date(e.created_at).toLocaleDateString()}
            </td>
            <td className="py-2 pr-3 font-mono text-[0.65rem]">
              {e.event_type}
            </td>
            <td className="py-2 pr-3 text-right">
              {fmtDelta(e.generation_credits_delta)}
            </td>
            <td className="py-2 pr-3 text-right">
              {fmtDelta(e.candidate_slots_delta)}
            </td>
            <td className="py-2 pr-3 text-right">
              {e.amount_local
                ? `${parseFloat(e.amount_local).toLocaleString()} ${e.currency_code ?? ""}`
                : ""}
            </td>
            <td className="py-2 text-muted-foreground">{e.reason ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function fmtDelta(n: number): string {
  if (n === 0) return "";
  return n > 0 ? `+${n}` : `${n}`;
}
