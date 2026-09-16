/**
 * POST /api/internal/tenant-banks — create a tenant assessment bank from a JD,
 * server to server.
 * GET  /api/internal/tenant-banks?id=<uuid> — poll one until it is ready.
 *
 * Cross-engine endpoint. JD Studio (matching-engine on Railway) calls this when
 * a company turns on applications for a published role: the JD it already wrote
 * becomes the assessment every applicant takes, so the questions are about that
 * job rather than about a generic skillboard.
 *
 * Why a separate route from /api/v1/tenant/assessment-banks rather than a flag
 * on it: that one is a browser endpoint behind a tenant *user session*
 * (requireTenantMemberApi), and there is no browser or session here. The shared
 * part is the row it writes, which is why the columns below mirror it exactly.
 *
 * Auth: Bearer ETC_ASSESSMENT_SERVICE_TOKEN, same as every other /api/internal
 * route.
 *
 * Billing: this path deliberately does NOT call canSubmitForGeneration. The
 * caller's tenant already paid in JD Studio's own credit ledger to publish the
 * JD, and the two ledgers are separate systems that do not reconcile yet.
 * Charging again here would bill the same company twice for one role, in a
 * ledger they cannot see. Banks created this way are stamped with
 * intake_source='upload' and a context note naming JD Studio, so the two can be
 * reconciled when the ledgers merge.
 */

import { createHash } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { extractBearer, isValidServiceToken } from "@/lib/auth/service-token";
import { db } from "@/lib/db/client";
import { tenantAssessmentBank, tenantUsers, tenants } from "@/lib/db/schema";
import { sanitiseUserText } from "@/lib/tenant/sanitise";

const inputSchema = z.object({
  /** Stable id of the calling system's tenant, e.g. JD Studio's 'etc'. */
  external_tenant_id: z.string().trim().min(1).max(60),
  /** Display name, used when this tenant has to be created here. */
  tenant_name: z.string().trim().min(1).max(200),
  /** Who is asking. Becomes the tenant_users row that owns the bank. */
  created_by_email: z.string().trim().email().max(200),
  intake_type: z.enum(["job_description", "scope_of_work"]).default("job_description"),
  intake_text: z.string().min(100).max(50_000).transform(sanitiseUserText),
  context_text: z
    .string()
    .max(5000)
    .optional()
    .transform((v) => (v == null ? v : sanitiseUserText(v))),
  claimed_seniority: z.enum(["junior", "mid", "senior"]).nullable().optional(),
  role_location: z
    .string()
    .max(120)
    .optional()
    .transform((v) => (v == null ? v : sanitiseUserText(v).trim())),
  country_code: z.string().trim().length(2).default("NG"),
  currency_code: z.string().trim().length(3).default("NGN"),
});

/**
 * Resolve the calling system's tenant to one here, creating it if this is the
 * first role that company has sent over.
 *
 * Matched on name rather than on a shared key, because there is no shared key:
 * JD Studio's tenants are text ids in another database and this platform's are
 * UUIDs. That is the known three-tenant-system problem, and inventing a third
 * mapping table here would deepen it. Name matching is exact and case-
 * insensitive, which is right for the handful of tenants that exist today and
 * is the seam to replace when the ledgers merge.
 */
async function resolveTenant(
  name: string,
  countryCode: string,
  currencyCode: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);
  const hit = existing.find(
    (t) => t.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (hit) return { id: hit.id, created: false };

  const [row] = await db
    .insert(tenants)
    .values({
      name: name.trim(),
      countryCode: countryCode.toUpperCase(),
      currencyCode: currencyCode.toUpperCase(),
      // Tiers are geographic, not plan levels. NG is the default market and
      // the only one JD Studio serves today; anything else lands on
      // 'international' rather than being guessed at more precisely.
      pricingTier: countryCode.toUpperCase() === "NG" ? "nigeria" : "international",
    })
    .returning({ id: tenants.id });
  return { id: row.id, created: true };
}

/** tenant_users.email is globally unique, so an existing row wins outright. */
async function resolveTenantUser(tenantId: string, email: string): Promise<string> {
  const normalised = email.trim().toLowerCase();
  const [existing] = await db
    .select({ id: tenantUsers.id })
    .from(tenantUsers)
    .where(eq(tenantUsers.email, normalised))
    .limit(1);
  if (existing) return existing.id;

  const [row] = await db
    .insert(tenantUsers)
    .values({ tenantId, email: normalised, role: "admin" })
    .returning({ id: tenantUsers.id });
  return row.id;
}

function takeUrl(token: string): string {
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://assess.energytalentco.com"
  ).replace(/\/$/, "");
  return `${base}/take-tenant/${token}`;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isValidServiceToken(extractBearer(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let input;
  try {
    input = inputSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const intakeTextHash = createHash("sha256")
    .update(input.intake_text.trim())
    .digest("hex");

  // Same JD, same bank. The caller is an automated system that may retry, and a
  // retry must not generate (and pay for) the role's assessment a second time.
  // Unlike the browser path there is no 24 hour window here: a JD's assessment
  // should stay the same assessment for as long as the role is open, so every
  // applicant is measured against the same questions. Only a failed bank falls
  // through to a fresh attempt.
  const [existing] = await db
    .select({
      id: tenantAssessmentBank.id,
      status: tenantAssessmentBank.status,
      token: tenantAssessmentBank.assessmentLinkToken,
      expires: tenantAssessmentBank.linkExpiresAt,
    })
    .from(tenantAssessmentBank)
    .where(
      and(
        eq(tenantAssessmentBank.intakeTextHash, intakeTextHash),
        isNull(tenantAssessmentBank.deletedAt),
      ),
    )
    .limit(1);
  if (existing && existing.status !== "failed") {
    return NextResponse.json({
      id: existing.id,
      status: existing.status,
      duplicate: true,
      candidate_url: existing.token ? takeUrl(existing.token) : null,
      link_expires_at: existing.expires?.toISOString() ?? null,
    });
  }

  let tenantId: string;
  let userId: string;
  try {
    const tenant = await resolveTenant(
      input.tenant_name,
      input.country_code,
      input.currency_code,
    );
    tenantId = tenant.id;
    userId = await resolveTenantUser(tenantId, input.created_by_email);
  } catch (err) {
    console.error(`[internal/tenant-banks] tenant resolve failed: ${String(err)}`);
    return NextResponse.json(
      { error: "tenant_resolve_failed", message: String(err).slice(0, 300) },
      { status: 500 },
    );
  }

  const [row] = await db
    .insert(tenantAssessmentBank)
    .values({
      tenantId,
      createdByUserId: userId,
      intakeType: input.intake_type,
      intakeText: input.intake_text,
      intakeTextHash,
      intakeSource: "upload",
      intakeUploadFilename: null,
      // Names the origin so a bank created this way is identifiable later,
      // both for reconciling the two credit ledgers and for an admin asking
      // why a bank exists that no tenant user remembers creating.
      contextText: [
        `Created from JD Studio (external tenant: ${input.external_tenant_id}).`,
        input.context_text ?? "",
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 5000),
      claimedSeniority: input.claimed_seniority ?? null,
      roleLocation: input.role_location || null,
      tenantSuppliedQuestions: null,
      status: "queued",
    })
    .returning({ id: tenantAssessmentBank.id, status: tenantAssessmentBank.status });

  // The scheduled worker (netlify/functions/scheduled-process-authoring-queue-
  // background.mts, every 5 minutes) picks the row up from 'queued'. The caller
  // polls GET on this route until status is 'ready' and a candidate_url exists.
  return NextResponse.json(
    {
      id: row.id,
      status: row.status,
      duplicate: false,
      candidate_url: null,
      poll_url: `/api/internal/tenant-banks?id=${row.id}`,
    },
    { status: 201 },
  );
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isValidServiceToken(extractBearer(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: tenantAssessmentBank.id,
      status: tenantAssessmentBank.status,
      token: tenantAssessmentBank.assessmentLinkToken,
      expires: tenantAssessmentBank.linkExpiresAt,
      failureReason: tenantAssessmentBank.failureReason,
    })
    .from(tenantAssessmentBank)
    .where(
      and(eq(tenantAssessmentBank.id, id), isNull(tenantAssessmentBank.deletedAt)),
    )
    .limit(1);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    status: row.status,
    candidate_url: row.token ? takeUrl(row.token) : null,
    link_expires_at: row.expires?.toISOString() ?? null,
    failure_reason: row.failureReason ?? null,
  });
}
