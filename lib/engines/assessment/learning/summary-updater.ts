/**
 * Learning summary subscriber — PRD §8.
 *
 * Triggered on every override save. Loads the current learning_summaries
 * row for (specialisation, band), calls Kimi with the current summary +
 * the new override event + last 5 events in scope, writes the new
 * summary (replacing previous; old one archived).
 *
 * Bounded ~2000 tokens per summary so prompts stay cheap. Run
 * synchronously in the override route — typical update is one Kimi
 * call (~1s) so not worth queueing.
 */

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  aiSpendLedger,
  learningSummaries,
  learningSummaryHistory,
  validationOverrides,
  vettedTalentProfile,
  type SeniorityBand,
} from "@/lib/db/schema";
import { costUsdX10000 } from "@/lib/ai/pricing";

const KIMI_ENDPOINT = "https://api.moonshot.ai/v1/chat/completions";
const KIMI_MODEL = process.env.KIMI_MODEL ?? "moonshot-v1-8k";

export async function updateLearningSummaryOnOverride(args: {
  validationResultId: string;
  vettedTalentProfileId?: string;
  overriddenBy: string;
}): Promise<void> {
  // Resolve the (specialisation, band) scope of this override via the profile.
  if (!args.vettedTalentProfileId) {
    // Result-level override (e.g. hire_recommendation only) — not yet
    // wired to a per-spec summary. Skip; orchestration is fine.
    return;
  }
  const [profile] = await db
    .select({
      specialisation: vettedTalentProfile.specialisation,
      band: vettedTalentProfile.finalBand,
    })
    .from(vettedTalentProfile)
    .where(eq(vettedTalentProfile.id, args.vettedTalentProfileId))
    .limit(1);
  if (!profile) return;

  // Load current summary (may be missing for a fresh spec/band — that's fine).
  const [current] = await db
    .select()
    .from(learningSummaries)
    .where(
      and(
        eq(learningSummaries.specialisation, profile.specialisation),
        eq(learningSummaries.band, profile.band),
      ),
    )
    .limit(1);

  // Load this override + the 5 most recent overrides for the same scope.
  const recent = await db
    .select()
    .from(validationOverrides)
    .where(eq(validationOverrides.validationResultId, args.validationResultId))
    .orderBy(desc(validationOverrides.overriddenAt))
    .limit(6);

  const prompt = buildSummaryPrompt({
    currentSummary: current?.summary ?? "",
    recentEvents: recent.map((o) => ({
      field: o.field,
      old: o.oldValue,
      new: o.newValue,
      reasoning: o.reasoning,
      at: o.overriddenAt.toISOString(),
    })),
    specialisation: profile.specialisation,
    band: profile.band,
  });

  const newSummary = await callKimiSummary(prompt);

  // Archive old.
  if (current) {
    await db.insert(learningSummaryHistory).values({
      specialisation: current.specialisation,
      band: current.band,
      summary: current.summary,
      version: current.version,
    });
    await db
      .update(learningSummaries)
      .set({
        summary: newSummary,
        version: current.version + 1,
        updatedAt: new Date(),
        updatedBy: args.overriddenBy,
      })
      .where(eq(learningSummaries.id, current.id));
  } else {
    await db.insert(learningSummaries).values({
      specialisation: profile.specialisation,
      band: profile.band as SeniorityBand,
      summary: newSummary,
      version: 1,
      updatedBy: args.overriddenBy,
    });
  }
}

function buildSummaryPrompt(args: {
  currentSummary: string;
  recentEvents: Array<{ field: string; old: unknown; new: unknown; reasoning: string; at: string }>;
  specialisation: string;
  band: SeniorityBand;
}): string {
  const eventsBlock = args.recentEvents
    .map(
      (e, i) =>
        `Event ${i + 1} (${e.at}): field=${e.field} ${JSON.stringify(e.old)} → ${JSON.stringify(e.new)}\nReason: ${e.reasoning}`,
    )
    .join("\n\n");

  return `You maintain a rolling learning summary for ETC's Validation Engine, scoped to a single (specialisation, band).

Specialisation: ${args.specialisation}
Band: ${args.band}

Current summary (may be empty if first-time):
${args.currentSummary || "(no summary yet)"}

Recent override events on this scope:
${eventsBlock}

Produce an UPDATED summary that captures:
- New patterns observed across overrides
- Scoring adjustments to consider for future Kimi synthesis calls
- Known correction patterns
- Specific things to watch

Constraints:
- Plain prose, ≤ 1800 characters.
- Reference patterns, not individual candidate identifiers.
- Be concrete: "Reviewers downgrade 'mid → junior' when battery-sizing reasoning is keyword-only" beats "be careful with mid-band".

Return ONLY the updated summary text (no markdown, no JSON).`;
}

async function callKimiSummary(prompt: string): Promise<string> {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) throw new Error("KIMI_API_KEY not set");

  const res = await fetch(KIMI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: KIMI_MODEL,
      temperature: 0.3,
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Kimi summary ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("Kimi returned empty summary");

  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  await db.insert(aiSpendLedger).values({
    model: "kimi",
    purpose: "learning_summary",
    inputTokens,
    outputTokens,
    costUsdX10000: costUsdX10000("kimi", inputTokens, outputTokens),
    success: true,
  });

  return text.slice(0, 1900);
}
