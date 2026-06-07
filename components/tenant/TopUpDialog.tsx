"use client";

/**
 * Top-up + subscription purchase surface. Reads the catalog once on
 * mount and renders every purchasable pack + subscription tier for the
 * tenant's locked pricing tier.
 *
 * Card-on-file flow: POST to /api/v1/tenant/billing/purchase-pack with
 * just the pack_id. The server simulates success when
 * TENANT_BILLING_SIMULATE=1; otherwise it returns 402 until the real
 * processor integration lands.
 */

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type Pack = {
  id: string;
  label: string;
  generationCreditsDelta: number;
  candidateSlotsDelta: number;
  amount: number;
  currency: string;
};

type SubscriptionTierConfig = {
  id: "starter" | "growth";
  label: string;
  monthlyAmount: number;
  currency: string;
  generationCreditsPerCycle: number;
  candidateSlotsPerCycle: number;
};

type Catalog = {
  tier: string;
  currency: string;
  pay_as_you_go: Pack;
  slot_top_ups: Pack[];
  subscriptions: SubscriptionTierConfig[];
};

export function TopUpDialog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/v1/tenant/billing/catalog", { cache: "no-store" })
      .then((r) => r.json())
      .then(setCatalog)
      .catch(() => setError("Could not load pricing."));
  }, []);

  if (!catalog) {
    return (
      <p className="text-sm text-muted-foreground">Loading pricing...</p>
    );
  }

  const buyPack = async (packId: string) => {
    setBusyId(packId);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/v1/tenant/billing/purchase-pack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pack_id: packId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `${res.status}`);
      } else {
        setOk(`${data.packLabel} added to your balance.`);
      }
    } catch {
      setError("Purchase failed.");
    } finally {
      setBusyId(null);
    }
  };

  const buySub = async (tier: "starter" | "growth") => {
    setBusyId(`sub_${tier}`);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(
        "/api/v1/tenant/billing/purchase-subscription",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tier }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `${res.status}`);
      } else {
        setOk(`${data.packLabel} subscription active.`);
      }
    } catch {
      setError("Subscription failed.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-etc-marigold bg-etc-marigold/10 px-3 py-2 text-[0.7rem] font-medium text-etc-black">
        Launch pricing - limited time
      </div>

      <section>
        <h2 className="text-sm font-semibold">One-time</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <PackCard
            pack={catalog.pay_as_you_go}
            currency={catalog.currency}
            busy={busyId === catalog.pay_as_you_go.id}
            onBuy={() => buyPack(catalog.pay_as_you_go.id)}
            highlight
          />
          {catalog.slot_top_ups.map((p) => (
            <PackCard
              key={p.id}
              pack={p}
              currency={catalog.currency}
              busy={busyId === p.id}
              onBuy={() => buyPack(p.id)}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Monthly subscription</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {catalog.subscriptions.map((s) => (
            <SubCard
              key={s.id}
              sub={s}
              currency={catalog.currency}
              busy={busyId === `sub_${s.id}`}
              onBuy={() => buySub(s.id)}
            />
          ))}
        </div>
      </section>

      {error && (
        <p className="rounded-lg border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded-lg border border-green-300 bg-green-50 p-2 text-xs text-green-900">
          {ok}
        </p>
      )}
    </div>
  );
}

function PackCard({
  pack,
  currency,
  busy,
  onBuy,
  highlight,
}: {
  pack: Pack;
  currency: string;
  busy: boolean;
  onBuy: () => void;
  highlight?: boolean;
}) {
  return (
    <article
      className={cn(
        "rounded-2xl border p-4",
        highlight ? "border-foreground bg-foreground/5" : "border-border bg-card",
      )}
    >
      <p className="text-sm font-semibold">{pack.label}</p>
      <p className="mt-1 text-[0.7rem] text-muted-foreground">
        +{pack.generationCreditsDelta} gen
        {pack.candidateSlotsDelta > 0 ? ` · +${pack.candidateSlotsDelta} slots` : ""}
      </p>
      <p className="mt-3 text-base font-semibold">
        {formatAmount(pack.amount, currency)}
      </p>
      <button
        type="button"
        onClick={onBuy}
        disabled={busy}
        className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg bg-foreground text-xs font-semibold text-background disabled:opacity-60"
      >
        {busy ? "Charging..." : "Buy"}
      </button>
    </article>
  );
}

function SubCard({
  sub,
  currency,
  busy,
  onBuy,
}: {
  sub: SubscriptionTierConfig;
  currency: string;
  busy: boolean;
  onBuy: () => void;
}) {
  return (
    <article className="rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-semibold">{sub.label}</p>
      <p className="mt-1 text-[0.7rem] text-muted-foreground">
        {sub.generationCreditsPerCycle} gen / month ·{" "}
        {sub.candidateSlotsPerCycle} slots / month
      </p>
      <p className="mt-3 text-base font-semibold">
        {formatAmount(sub.monthlyAmount, currency)} <span className="text-[0.6rem] text-muted-foreground">/ mo</span>
      </p>
      <button
        type="button"
        onClick={onBuy}
        disabled={busy}
        className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg border border-foreground text-xs font-semibold text-foreground disabled:opacity-60"
      >
        {busy ? "Charging..." : "Subscribe"}
      </button>
    </article>
  );
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}
