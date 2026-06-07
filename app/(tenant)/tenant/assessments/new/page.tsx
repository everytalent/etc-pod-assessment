/**
 * /tenant/assessments/new — intake form (PRD §1).
 *
 * Redirects to onboarding if the tenant hasn't completed brand setup,
 * then renders the two-step <IntakeForm />. The form posts directly to
 * /api/v1/tenant/assessment-banks and forwards to the waiting page on
 * success.
 */

import { redirect } from "next/navigation";

import { getTenantSession } from "@/lib/auth/tenant";
import { getTenantBrand } from "@/lib/tenant/branding";
import { IntakeForm } from "@/components/tenant/IntakeForm";

export const dynamic = "force-dynamic";

export default async function NewAssessmentPage() {
  const session = await getTenantSession();
  if (!session) redirect("/tenant/login");

  const brand = await getTenantBrand(session.tenant.id);
  if (!brand.onboardingCompletedAt) {
    redirect("/tenant/assessments/onboarding");
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Create an assessment</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Paste a role or project. The algorithm does the rest.
        </p>
      </header>
      <IntakeForm />
    </div>
  );
}
