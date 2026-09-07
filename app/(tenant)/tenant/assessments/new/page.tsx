/**
 * /tenant/assessments/new: intake form (PRD §1).
 *
 * Redirects to onboarding if the tenant hasn't completed brand setup,
 * then renders the two-step <IntakeForm />. The form posts directly to
 * /api/v1/tenant/assessment-banks and forwards to the waiting page on
 * success.
 *
 * Handoff from JD Studio: a company that has already written a JD in JD
 * Studio can arrive here with `?from_jd=<jd_id>` and find it prefilled,
 * rather than pasting the same text twice.
 *
 * This is the TENANT assessment and nothing else. It creates a
 * tenant_assessment_bank, served to the company's own candidates at
 * /take-tenant/[token]. It is not the validation-mode runner at
 * /take/[token], and not the ETC candidate intake at /assess/[slug]. The JD is fetched server-side
 * from the matching-engine's EXISTING public JD endpoint, which returns a
 * client JD only when it is published. That is the whole integration: no
 * new auth, no new storage, no shared database. The company still signs in
 * here as itself and still confirms the text before anything is created.
 */

import { redirect } from "next/navigation";

import { getTenantSession } from "@/lib/auth/tenant";
import { getTenantBrand } from "@/lib/tenant/branding";
import { IntakeForm, type IntakeInitial } from "@/components/tenant/IntakeForm";

export const dynamic = "force-dynamic";

// The matching-engine API that owns JD Studio's records. Configurable so
// staging does not read production JDs; falls back to the deployed host.
const MATCHING_API =
  process.env.ETC_MATCHING_API_URL?.replace(/\/+$/, "") ??
  "https://etc-platform-production.up.railway.app";

/**
 * The subset of the published-JD response this page uses. The JD fields are
 * nested under `record`; the response also carries tenant branding, apply_url
 * and a pdf_model that are irrelevant here.
 */
type PublicJdResponse = {
  record?: {
    role_title?: string;
    jd_markdown?: string;
    location?: string;
    seniority?: string;
  };
};

/**
 * Best-effort fetch of a published JD. A failure here must never block the
 * page: the form still works, it just starts empty, which is the same thing
 * the user would get by navigating here directly.
 */
async function loadJdStudioJd(jdId: string): Promise<IntakeInitial | null> {
  try {
    const res = await fetch(
      `${MATCHING_API}/client-jd/public/${encodeURIComponent(jdId)}`,
      { cache: "no-store", signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;

    const { record: jd } = (await res.json()) as PublicJdResponse;
    if (!jd) return null;
    const text = (jd.jd_markdown ?? "").trim();
    // The API rejects intake text under 100 characters, so a stub JD would
    // prefill a form that cannot submit. Better to start empty than to hand
    // someone a form that fails validation on text they did not write.
    if (text.length < 100) return null;

    return {
      intakeType: "job_description",
      intakeText: text,
      roleLocation: jd.location?.trim() || undefined,
      sourceLabel: jd.role_title?.trim()
        ? `JD Studio: ${jd.role_title.trim()}`
        : "JD Studio",
    };
  } catch {
    // Network fault, timeout, or malformed payload. Degrade to a blank form.
    return null;
  }
}

export default async function NewAssessmentPage({
  searchParams,
}: {
  searchParams: Promise<{ from_jd?: string }>;
}) {
  const { from_jd: fromJd } = await searchParams;

  // Arriving from JD Studio usually means arriving signed out. The login page
  // already honours ?next=, so carry the handoff through it: without this the
  // JD is silently dropped and the company lands on an empty form wondering
  // where their job description went.
  const here = fromJd
    ? `/tenant/assessments/new?from_jd=${encodeURIComponent(fromJd)}`
    : "/tenant/assessments/new";

  const session = await getTenantSession();
  if (!session) redirect(`/tenant/login?next=${encodeURIComponent(here)}`);

  // First-run BRAND setup (logo and colours), despite the path being called
  // "onboarding". It is not an onboarding assessment. Tenant assessments are
  // branded, so a company has to complete it once before creating one. Same
  // reasoning as the login redirect: it must not lose the handoff either.
  const brand = await getTenantBrand(session.tenant.id);
  if (!brand.onboardingCompletedAt) {
    redirect(`/tenant/assessments/onboarding?next=${encodeURIComponent(here)}`);
  }

  const initial = fromJd ? await loadJdStudioJd(fromJd) : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Create an assessment</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Paste a role or project. The algorithm does the rest.
        </p>
      </header>
      <IntakeForm initial={initial ?? undefined} />
    </div>
  );
}
