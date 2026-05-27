/**
 * /api/admin/candidate-profiles
 *
 *   GET  — list all rows
 *   POST — create-or-upsert one row (admin-authored profile)
 *
 * Permission: editor+.
 *
 * Shape of profile_json matches the OnboardingProfile type — the same
 * shape Onboarding will produce in production. Keeping the shape
 * identical here makes the eventual cutover a one-line config change.
 */

import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireEditorApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { candidateProfiles } from "@/lib/db/schema";

const profileSchema = z.object({
  candidate_id: z.string().trim().min(1).max(60),
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(40).nullable().optional(),
  country: z.string().trim().min(1).max(60),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().max(120).nullable().optional(),
  specialisation: z.string().trim().min(1).max(120),
  has_solar_experience: z.boolean(),
  // v1.1 contract (2026-05-26): 4 buckets, matches Onboarding's actual UI.
  years_bucket: z
    .enum(["less_than_3", "3_to_5", "5_to_10", "10_plus"])
    .nullable(),
  non_solar_industry: z.string().trim().max(120).nullable().optional(),
  work_types: z.array(z.string().min(1).max(120)).max(20).default([]),
  skills: z.array(z.string().min(1).max(120)).max(50).default([]),
  certifications: z.array(z.string().min(1).max(200)).max(30).default([]),
  portfolio: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        role: z.string().max(200).nullable(),
        scope: z.string().max(200).nullable(),
        period: z.string().max(60).nullable(),
        activities: z.array(z.string().min(1).max(160)).max(30).default([]),
      }),
    )
    .max(20)
    .default([]),
});

const inputSchema = z.object({
  /**
   * If candidate_id matches an existing row, it's updated. Otherwise inserted.
   * (UPSERT pattern keeps the admin form simple — no "edit vs new" modes.)
   */
  profile: profileSchema,
  /**
   * Optional override of the claimed band the band-deducer would output.
   * Stored alongside the profile so the engine can use it directly.
   */
  claimed_band_override: z
    .enum(["junior", "mid", "senior"])
    .nullable()
    .optional(),
});

export async function GET(): Promise<NextResponse> {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;

  const rows = await db
    .select()
    .from(candidateProfiles)
    .orderBy(desc(candidateProfiles.updatedAt));
  return NextResponse.json({ candidate_profiles: rows });
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;

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

  // Stash the override on the profile json itself so downstream readers
  // (OnboardingProfile consumers, including the validation flow) see a
  // single normalised shape.
  const payload = {
    ...input.profile,
    claimed_band_override: input.claimed_band_override ?? null,
  };

  // Upsert by candidate_id.
  const [existing] = await db
    .select({ candidateId: candidateProfiles.candidateId })
    .from(candidateProfiles)
    .where(eq(candidateProfiles.candidateId, input.profile.candidate_id))
    .limit(1);

  if (existing) {
    await db
      .update(candidateProfiles)
      .set({
        profileJson: payload,
        updatedAt: new Date(),
      })
      .where(eq(candidateProfiles.candidateId, input.profile.candidate_id));
    return NextResponse.json({ updated: true });
  }

  await db.insert(candidateProfiles).values({
    candidateId: input.profile.candidate_id,
    profileJson: payload,
    createdBy: auth.session.admin.id,
  });
  return NextResponse.json({ created: true }, { status: 201 });
}
