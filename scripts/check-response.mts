import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname2 = resolve(fileURLToPath(import.meta.url), "..");
const root = resolve(__dirname2, "..");
for (const f of [".env", ".env.local"]) {
  const p = resolve(root, f);
  if (existsSync(p)) loadEnv({ path: p, override: true });
}

const id = process.argv[2] ?? "fb78e3ee-0794-4fef-a13b-fca114603cd3";
const { eq } = await import("drizzle-orm");
const { db } = await import("../lib/db/client.js");
const { responses, vettedTalentProfile, validationResults, answers } =
  await import("../lib/db/schema.js");

const [r] = await db
  .select({
    status: responses.status,
    validationStatus: responses.validationStatus,
    submittedAt: responses.submittedAt,
    metadata: responses.metadata,
  })
  .from(responses)
  .where(eq(responses.id, id))
  .limit(1);

console.log("Response:", r);

const a = await db
  .select({ id: answers.id, scoreAwarded: answers.scoreAwarded })
  .from(answers)
  .where(eq(answers.responseId, id));
console.log("Answer rows:", a.length);

const v = await db
  .select()
  .from(validationResults)
  .where(eq(validationResults.responseId, id));
console.log(
  "validation_results rows:",
  v.length,
  v[0] && {
    hire: v[0].hireRecommendation,
    confidence: v[0].confidence,
    synthesisedAt: v[0].synthesisedAt,
  },
);

const p = await db
  .select()
  .from(vettedTalentProfile)
  .where(eq(vettedTalentProfile.responseId, id));
console.log(
  "vetted_talent_profile rows:",
  p.length,
  p[0] && {
    spec: p[0].specialisation,
    band: p[0].finalBand,
    level: p[0].finalLevel,
    cadre: p[0].cadre,
    displayLabel: p[0].displayLabel,
  },
);

process.exit(0);
