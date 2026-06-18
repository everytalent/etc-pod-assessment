/**
 * Validation-bank assessment helper.
 *
 * Each specialisation has ONE sentinel `assessments` row with
 * `mode='validation'` and `specialisation=<name>`. All approved
 * question-bank proposals for that specialisation FK into it. This
 * lets us reuse the existing `questions.assessment_id NOT NULL`
 * constraint without rewriting half the codebase.
 *
 * The sentinel is invisible to candidates — they take a real
 * `mode='validation'` assessment whose engine code pulls questions
 * via `(specialisation, band, level)` from the bank.
 *
 * Why a helper: the lazy-create logic is shared between proposal
 * approval and any future direct-insert path (Excel upload's
 * Claude-filled cells, manual question authoring against the bank).
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  assessments,
  skillboards,
  type Assessment,
} from "@/lib/db/schema";

const BANK_SLUG_PREFIX = "validation-bank-";

/**
 * Returns the existing sentinel assessment for `specialisation`, or
 * creates it if absent. Idempotent: safe to call from any code path
 * that inserts a bank question.
 */
export async function getOrCreateValidationBank(
  specialisation: string,
): Promise<Assessment> {
  // 1. Look up by (mode='validation', specialisation=X).
  const [existing] = await db
    .select()
    .from(assessments)
    .where(
      and(
        eq(assessments.mode, "validation"),
        eq(assessments.specialisation, specialisation),
      ),
    )
    .limit(1);
  if (existing) return existing;

  // 2. Derive role_type from the matching skillboard.role_family.
  //    Skillboard role_family is the authoritative source: technical
  //    → 'tech', bd_pm → 'bd', hybrid → 'tech' (closer to the engineering
  //    mental model used in V1).
  const [board] = await db
    .select({ roleFamily: skillboards.roleFamily })
    .from(skillboards)
    .where(eq(skillboards.specialisation, specialisation))
    .limit(1);
  const roleType: "tech" | "bd" =
    board?.roleFamily === "bd_pm" ? "bd" : "tech";

  // 3. Create the sentinel row.
  const slug = `${BANK_SLUG_PREFIX}${slugify(specialisation)}`;
  const [created] = await db
    .insert(assessments)
    .values({
      title: `Validation Bank — ${specialisation}`,
      slug,
      roleType,
      mode: "validation",
      specialisation,
      // status='published' is REQUIRED for candidates to reach the bank
      // via /take/<token> → /assess/<slug>/session (the candidate-facing
      // session loader gates on status='published'). visibility='unlisted'
      // is what keeps validation banks off the public assessment listing,
      // so it's safe to publish them.
      status: "published",
      visibility: "unlisted",
      introText: "",
      outroText: "",
    })
    .returning();
  return created;
}

/**
 * Kebab-case slug from a specialisation name. Validation bank slugs
 * are namespaced with `validation-bank-` so they never collide with
 * real candidate-facing assessment slugs.
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/** True when an assessment row is one of our validation-bank sentinels. */
export function isValidationBank(a: Assessment): boolean {
  return a.mode === "validation" && a.slug.startsWith(BANK_SLUG_PREFIX);
}
