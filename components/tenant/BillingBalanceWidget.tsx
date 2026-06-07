/**
 * Header-mounted balance widget. Server Component — reads the tenant's
 * billing balance once per request via getBalance().
 */

import Link from "next/link";

import { getBalance } from "@/lib/tenant/billing/balance";

export async function BillingBalanceWidget({
  tenantId,
}: {
  tenantId: string;
}) {
  const balance = await getBalance(tenantId);
  const credits = balance?.generationCredits ?? 0;
  const slots = balance?.candidateSlots ?? 0;
  const lowSlots = slots > 0 && slots < 25;
  const noCredits = credits === 0;

  return (
    <div className="flex items-center gap-3 text-[0.7rem]">
      <div className="hidden items-center gap-3 sm:flex">
        <Pill
          label="Gens"
          value={credits.toString()}
          tone={noCredits ? "warn" : "ok"}
        />
        <Pill
          label="Slots"
          value={slots.toLocaleString()}
          tone={lowSlots ? "warn" : "ok"}
        />
      </div>
      <Link
        href="/tenant/billing"
        className="inline-flex h-7 items-center rounded-lg border border-border px-3 text-[0.65rem] font-semibold hover:border-etc-marigold"
      >
        Top up
      </Link>
    </div>
  );
}

function Pill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn";
}) {
  const toneClass =
    tone === "warn"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-border bg-muted text-foreground";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${toneClass}`}
    >
      <span className="font-semibold">{value}</span>
      <span className="opacity-70">{label}</span>
    </span>
  );
}
