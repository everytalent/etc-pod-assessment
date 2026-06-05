/**
 * /admin/ai-spend
 *
 * Monthly Opus-and-friends spend dashboard. Pulls the
 * ai_spend_ledger table and rolls up:
 *
 *   - Month-to-date total (USD, current calendar month UTC)
 *   - Breakdown by model + purpose
 *   - Projection to month-end based on daily run-rate
 *   - Last 30 days as a daily strip
 *   - Cap utilisation vs OPUS_MONTHLY_CAP_USD (default 130)
 *
 * Superadmin only — spend is sensitive operational info.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { notFound } from "next/navigation";

import { getAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { aiSpendLedger } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const CAP_USD = Number(process.env.OPUS_MONTHLY_CAP_USD ?? "130");

type Row = {
  model: string;
  purpose: string;
  input_tokens: number;
  output_tokens: number;
  cost_x10000: number;
  call_count: number;
};

type DailyRow = { day: string; cost_x10000: number; call_count: number };

export default async function AiSpendPage() {
  const session = await getAdminSession();
  if (!session || session.admin.role !== "superadmin") notFound();

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // 1) Month-to-date breakdown by (model, purpose).
  const breakdown = (await db.execute(
    sql`
      SELECT model::text, purpose::text,
             COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
             COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
             COALESCE(SUM(cost_usd_x10000), 0)::int AS cost_x10000,
             COUNT(*)::int AS call_count
      FROM ai_spend_ledger
      WHERE called_at >= ${monthStart}
      GROUP BY model, purpose
      ORDER BY cost_x10000 DESC
    `,
  )) as unknown as Row[];

  // 2) Daily totals for the last 30 days.
  const dailyRaw = (await db.execute(
    sql`
      SELECT to_char(date_trunc('day', called_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(cost_usd_x10000), 0)::int AS cost_x10000,
             COUNT(*)::int AS call_count
      FROM ai_spend_ledger
      WHERE called_at >= ${thirtyDaysAgo}
      GROUP BY day
      ORDER BY day ASC
    `,
  )) as unknown as DailyRow[];

  // 3) MTD total + projection.
  const mtdCostUsd =
    breakdown.reduce((sum, r) => sum + r.cost_x10000, 0) / 10000;
  const mtdCallCount = breakdown.reduce((sum, r) => sum + r.call_count, 0);
  const daysElapsed = now.getUTCDate(); // 1-31
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const projectedMonthEnd = (mtdCostUsd / daysElapsed) * daysInMonth;
  const capUtilisationPct = (mtdCostUsd / CAP_USD) * 100;
  const projectedUtilisationPct = (projectedMonthEnd / CAP_USD) * 100;

  // 4) 30-day total (for context).
  const last30CostUsd =
    dailyRaw.reduce((sum, r) => sum + r.cost_x10000, 0) / 10000;

  // 5) Last 20 calls (failures highlighted).
  const recentCalls = await db
    .select({
      id: aiSpendLedger.id,
      model: aiSpendLedger.model,
      purpose: aiSpendLedger.purpose,
      costUsdX10000: aiSpendLedger.costUsdX10000,
      calledAt: aiSpendLedger.calledAt,
      success: aiSpendLedger.success,
    })
    .from(aiSpendLedger)
    .where(and(gte(aiSpendLedger.calledAt, thirtyDaysAgo), eq(aiSpendLedger.success, true)))
    .orderBy(desc(aiSpendLedger.calledAt))
    .limit(20);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Operations
        </p>
        <h1 className="mt-2 text-3xl font-bold">AI Spend</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Monthly Opus + Gemini + Kimi cost. Cap is{" "}
          <span className="font-semibold">${CAP_USD}/month</span>{" "}
          (configured via <code>OPUS_MONTHLY_CAP_USD</code>).
        </p>
      </header>

      {/* MTD scorecards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Scorecard
          label="Month-to-date"
          value={`$${mtdCostUsd.toFixed(2)}`}
          sub={`${mtdCallCount} calls · day ${daysElapsed} of ${daysInMonth}`}
        />
        <Scorecard
          label="Cap utilisation (MTD)"
          value={`${capUtilisationPct.toFixed(1)}%`}
          sub={`of $${CAP_USD}/month`}
          tone={
            capUtilisationPct > 80
              ? "danger"
              : capUtilisationPct > 60
                ? "warn"
                : "ok"
          }
        />
        <Scorecard
          label="Projected month-end"
          value={`$${projectedMonthEnd.toFixed(2)}`}
          sub={`${projectedUtilisationPct.toFixed(0)}% of cap`}
          tone={
            projectedUtilisationPct > 100
              ? "danger"
              : projectedUtilisationPct > 80
                ? "warn"
                : "ok"
          }
        />
        <Scorecard
          label="Last 30 days"
          value={`$${last30CostUsd.toFixed(2)}`}
          sub={`${dailyRaw.reduce((s, r) => s + r.call_count, 0)} calls`}
        />
      </section>

      {/* Breakdown by model + purpose */}
      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Month-to-date by model + purpose
        </h2>
        {breakdown.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-xs text-muted-foreground">
            No AI calls this month yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Model</th>
                  <th className="px-4 py-3 text-left font-medium">Purpose</th>
                  <th className="px-4 py-3 text-right font-medium">Calls</th>
                  <th className="px-4 py-3 text-right font-medium">In tokens</th>
                  <th className="px-4 py-3 text-right font-medium">Out tokens</th>
                  <th className="px-4 py-3 text-right font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {breakdown.map((r) => (
                  <tr key={`${r.model}-${r.purpose}`} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">{r.model}</td>
                    <td className="px-4 py-3 text-xs">{r.purpose}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.call_count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">
                      {r.input_tokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">
                      {r.output_tokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      ${(r.cost_x10000 / 10000).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Daily strip — last 30 days */}
      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Last 30 days — daily spend
        </h2>
        {dailyRaw.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-xs text-muted-foreground">
            No AI calls in the last 30 days.
          </p>
        ) : (
          <DailyStrip rows={dailyRaw} />
        )}
      </section>

      {/* Recent calls */}
      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Recent calls (latest 20 successful)
        </h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card text-xs">
          <table className="w-full">
            <thead className="bg-muted/50 uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Model</th>
                <th className="px-3 py-2 text-left font-medium">Purpose</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recentCalls.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.calledAt.toISOString().slice(0, 19).replace("T", " ")}
                  </td>
                  <td className="px-3 py-2 font-mono">{r.model}</td>
                  <td className="px-3 py-2">{r.purpose}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    ${(r.costUsdX10000 / 10000).toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Scorecard({
  label,
  value,
  sub,
  tone = "ok",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "ok" | "warn" | "danger";
}) {
  const ring =
    tone === "danger"
      ? "border-red-300 bg-red-50"
      : tone === "warn"
        ? "border-amber-300 bg-amber-50"
        : "border-border bg-card";
  const valueColor =
    tone === "danger"
      ? "text-red-900"
      : tone === "warn"
        ? "text-amber-900"
        : "text-foreground";
  return (
    <div className={`rounded-2xl border p-4 ${ring}`}>
      <p className="text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${valueColor}`}>
        {value}
      </p>
      <p className="mt-1 text-[0.7rem] text-muted-foreground">{sub}</p>
    </div>
  );
}

function DailyStrip({ rows }: { rows: DailyRow[] }) {
  // Backfill missing days with 0 so the strip is dense.
  const indexed = new Map(rows.map((r) => [r.day, r]));
  const days: DailyRow[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    days.push(
      indexed.get(key) ?? { day: key, cost_x10000: 0, call_count: 0 },
    );
  }
  const max = Math.max(...days.map((d) => d.cost_x10000), 1);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex h-32 items-end gap-1">
        {days.map((d) => {
          const heightPct = (d.cost_x10000 / max) * 100;
          return (
            <div
              key={d.day}
              className="flex-1 rounded-t bg-etc-marigold/60 hover:bg-etc-marigold"
              style={{ height: `${Math.max(heightPct, 2)}%` }}
              title={`${d.day} · $${(d.cost_x10000 / 10000).toFixed(2)} · ${d.call_count} calls`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[0.65rem] text-muted-foreground">
        <span>{days[0]?.day.slice(5)}</span>
        <span>{days[days.length - 1]?.day.slice(5)}</span>
      </div>
    </div>
  );
}
