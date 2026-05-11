/**
 * Admin settings — superadmin only. Currently a single feature flag
 * (AI scoring visibility); designed to grow more rows as new flags
 * land.
 */

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { FeatureFlagEditor } from "@/components/admin/FeatureFlagEditor";
import { getAdminSession } from "@/lib/auth/admin";
import { AI_SCORING_FLAG_KEY } from "@/lib/auth/feature-flags";
import { db } from "@/lib/db/client";
import { featureFlags } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getAdminSession();
  if (!session || session.admin.role !== "superadmin") notFound();

  const [aiFlag] = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.key, AI_SCORING_FLAG_KEY))
    .limit(1);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        Settings
      </p>
      <h1 className="mt-2 text-3xl font-bold">Feature flags</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Toggle who can see and run AI scoring across the whole tenant.
        Changes take effect immediately — no deploy required.
      </p>

      <section className="mt-8">
        <FeatureFlagEditor
          flagKey={AI_SCORING_FLAG_KEY}
          title="AI scoring visibility"
          description="Which admin roles see AI assessor panels and can run the cross-check pipeline. Assessors still only see AI on an answer AFTER they've saved their own score on it — that behaviour is not configurable."
          initialRoles={aiFlag?.enabledForRoles ?? ["superadmin"]}
        />
      </section>
    </main>
  );
}
