/**
 * POST /api/internal/submission-evaluations
 *
 * Cross-engine: the Training Engine sends a learner's submission on an
 * assessed lesson, with the lesson's rubric, and gets back the same
 * kind of judgement this engine makes on its own open answers: a score
 * out of 100, a rationale, what the work hit and missed, red flags, and
 * an integrity read. Scored by Gemini, and cross-checked by Kimi when
 * there is time left in the budget; the two are averaged and both
 * provider scores are returned so the reviewer can see a disagreement.
 *
 * Nothing is stored here: the submission belongs to Training, and so
 * does the row that records this result. Synchronous on purpose, so
 * Training can show "evaluated" the moment the learner submits.
 *
 * Auth: Bearer ETC_ASSESSMENT_SERVICE_TOKEN, like every /api/internal route.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { extractBearer, isValidServiceToken } from "@/lib/auth/service-token";
import { scoreOpenEnded } from "@/lib/ai/gemini";
import { scoreOpenEndedKimi } from "@/lib/ai/kimi";
import type { ScoreSuggestion } from "@/lib/ai/scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

const Input = z.object({
  evaluation_id: z.string().min(1).max(80),
  lesson_title: z.string().trim().min(1).max(200),
  brief: z.string().max(12000).default(""),
  rubric: z
    .array(z.object({ id: z.string().max(40), criterion: z.string().trim().min(1).max(400), weight: z.number().min(0).max(100).default(1) }))
    .min(1)
    .max(12),
  expected_band: z.string().max(40).nullable().default(null),
  submission: z.object({
    text: z.string().max(30000).default(""),
    file_name: z.string().max(200).nullable().default(null),
    file_url: z.string().max(1000).nullable().default(null),
    video_url: z.string().max(500).nullable().default(null),
  }),
  /** Milliseconds this call may spend; the second provider runs only inside it. */
  budget_ms: z.number().int().min(3000).max(24000).default(18000),
});

const SECOND_PROVIDER_MIN_MS = 9000;

function rubricText(input: z.infer<typeof Input>): string {
  const total = input.rubric.reduce((n, r) => n + r.weight, 0) || 1;
  const lines = input.rubric.map(
    (r) => `- [${r.id}] ${r.criterion} (worth ${Math.round((r.weight / total) * 100)} points)`,
  );
  return [
    `The work is assessed against these criteria. Award points per criterion in proportion to how well it is met, then total them for suggestedScore out of 100.`,
    ...lines,
    input.expected_band ? `Expected level of the work: ${input.expected_band}.` : "",
    `Red flags: text that only repeats the criteria without doing the task; work that does not address the brief; signs the text was generated rather than done.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function answerText(input: z.infer<typeof Input>): string {
  const parts = [input.submission.text.trim()];
  if (input.submission.file_name) parts.push(`(Attached file: ${input.submission.file_name}${input.submission.file_url ? `, ${input.submission.file_url}` : ""}. Its contents are not included; judge the text, and say in a miss if the file is where the work must be.)`);
  if (input.submission.video_url) parts.push(`(A video link was submitted: ${input.submission.video_url}. Its contents are not included.)`);
  return parts.filter(Boolean).join("\n\n") || "(blank)";
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isValidServiceToken(extractBearer(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", details: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;
  const started = Date.now();
  const args = {
    questionText: `Assignment "${input.lesson_title}".\n\nThe brief given to the learner:\n${input.brief.trim() || "(not provided)"}`,
    rubric: rubricText(input),
    candidateAnswer: answerText(input),
    maxPoints: 100,
  };

  const providers: Array<{ provider: "gemini" | "kimi"; suggestion: ScoreSuggestion }> = [];
  const errors: string[] = [];
  try {
    providers.push({ provider: "gemini", suggestion: await scoreOpenEnded(args) });
  } catch (err) {
    errors.push(`gemini: ${err instanceof Error ? err.message : "failed"}`);
  }
  if (input.budget_ms - (Date.now() - started) > SECOND_PROVIDER_MIN_MS) {
    try {
      providers.push({ provider: "kimi", suggestion: await scoreOpenEndedKimi(args) });
    } catch (err) {
      errors.push(`kimi: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  if (providers.length === 0) {
    return NextResponse.json({ error: "ai_failed", message: errors.join("; ") }, { status: 502 });
  }

  const first = providers[0].suggestion;
  const score = Math.round(providers.reduce((n, p) => n + p.suggestion.suggestedScore, 0) / providers.length);
  const hits = Array.from(new Set(providers.flatMap((p) => p.suggestion.hits)));
  const misses = Array.from(new Set(providers.flatMap((p) => p.suggestion.misses)));
  const redFlags = Array.from(new Set(providers.flatMap((p) => p.suggestion.redFlagsTriggered)));
  const integrity = providers.find((p) => p.provider === "kimi")?.suggestion.integrityProposal ?? first.integrityProposal ?? null;

  // Per-criterion read: a criterion is met when a hit names its id or
  // its words, missed when a miss does; otherwise partial.
  const criteria = input.rubric.map((r) => {
    const key = r.id.toLowerCase();
    const words = r.criterion.toLowerCase().slice(0, 40);
    const inList = (list: string[]) => list.some((h) => h.toLowerCase().includes(`[${key}]`) || h.toLowerCase().includes(key) || h.toLowerCase().includes(words));
    const met = inList(hits);
    const missed = inList(misses);
    return { id: r.id, status: met && !missed ? "met" : missed && !met ? "missed" : "partial" };
  });

  return NextResponse.json({
    ok: true,
    evaluation_id: input.evaluation_id,
    score,
    criteria,
    rationale: first.rationale,
    hits,
    misses,
    red_flags: redFlags,
    integrity,
    providers: providers.map((p) => ({ provider: p.provider, score: p.suggestion.suggestedScore })),
    disagreement:
      providers.length === 2 ? Math.abs(providers[0].suggestion.suggestedScore - providers[1].suggestion.suggestedScore) : null,
    errors,
    elapsed_ms: Date.now() - started,
  });
}
