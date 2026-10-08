import { redirect } from "next/navigation";

import { BillingLedger } from "@/components/tenant/BillingLedger";
import { TopUpDialog } from "@/components/tenant/TopUpDialog";
import { getTenantSession, hasTenantRoleAtLeast } from "@/lib/auth/tenant";
import { getBalance } from "@/lib/tenant/billing/balance";
import { isUnlimitedTenant } from "@/lib/tenant/billing/unlimited";

export const dynamic = "force-dynamic";

export default async function TenantBillingPage() {
  const session = await getTenantSession();
  if (!session) redirect("/tenant/login");
  if (!hasTenantRoleAtLeast(session.tenantUser.role, "admin")) {
    redirect("/tenant");
  }

  const balance = await getBalance(session.tenant.id);
  const unlimited = await isUnlimitedTenant(session.tenant.id);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Current balance, top-up options, and transaction history.
        </p>
      </header>

      {unlimited && (
        <section className="rounded-2xl border border-etc-marigold bg-etc-marigold/10 p-5 text-sm">
          <p className="font-semibold">Unlimited plan</p>
          <p className="mt-1 text-muted-foreground">
            This workspace is covered by its platform plan: assessments are generated and candidates assessed without
            credits or slots being charged. The balances below are kept for the record only.
          </p>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Generation credits
          </p>
          <p className="mt-2 text-3xl font-bold">
            {balance?.generationCredits ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Candidate slots
          </p>
          <p className="mt-2 text-3xl font-bold">
            {(balance?.candidateSlots ?? 0).toLocaleString()}
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold">Top up</h2>
        <div className="mt-3">
          <TopUpDialog />
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold">Transaction history</h2>
        <div className="mt-3 rounded-2xl border border-border bg-card p-4">
          <BillingLedger />
        </div>
      </section>
    </div>
  );
}
