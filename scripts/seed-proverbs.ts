/**
 * Seed ~24 proverbs across Yoruba, Igbo, Hausa, Swahili, Zulu (and a
 * couple of Twi/Wolof flavours). Run once after migration 0020 has
 * been applied:
 *
 *   pnpm tsx scripts/seed-proverbs.ts
 *
 * Idempotent: skips inserts when a proverb with the same
 * (language, original_text) already exists.
 *
 * Curation note: every proverb has been chosen for tone (warm, patient,
 * craft-respecting) and tagged against one or more of the four
 * tenant-visible stages. Tenants who flag a proverb as off-key can
 * have it pulled by flipping `active = false` from psql.
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { proverb, type NewProverb, type ProverbStage } from "@/lib/db/schema";

type Seed = Omit<NewProverb, "id" | "createdAt">;

const SEEDS: Seed[] = [
  // ---------- Yoruba ----------
  {
    language: "yoruba",
    originalText: "Bí a kò bá mọ̀ Ìjẹbu, a kò lè jẹ ọbẹ̀ rẹ̀.",
    transliteration: "Bi a ko ba mo Ijebu, a ko le je obe re.",
    englishTranslation: "You can't enjoy the soup of a town you don't know.",
    stages: ["reading_role"] as ProverbStage[],
    contextualNote: "We're learning your role before we test for it.",
  },
  {
    language: "yoruba",
    originalText: "Sùúrù ni baba ìwà.",
    transliteration: "Suuru ni baba iwa.",
    englishTranslation: "Patience is the father of character.",
    stages: ["calibrating", "crafting"] as ProverbStage[],
    contextualNote: "Calibration takes the time it takes.",
  },
  {
    language: "yoruba",
    originalText: "Bí ọmọdé bá ní aṣọ bí àgbà, kò lè ní àkísà bí àgbà.",
    transliteration: "Bi omode ba ni aso bi agba, ko le ni akisa bi agba.",
    englishTranslation:
      "A child may have as many clothes as an elder, but not as many rags.",
    stages: ["calibrating"] as ProverbStage[],
    contextualNote: "Experience leaves its own marks. We're reading them.",
  },
  {
    language: "yoruba",
    originalText: "Owó ọmọdé kò tó pẹpẹ, ti àgbà kò wọ akèèrègbè.",
    transliteration: "Owo omode ko to pepe, ti agba ko wo akeeregbe.",
    englishTranslation:
      "A child's hand can't reach the shelf; an elder's hand can't fit a gourd.",
    stages: ["crafting"] as ProverbStage[],
    contextualNote: "Every level has its own measure.",
  },
  // ---------- Igbo ----------
  {
    language: "igbo",
    originalText: "Egbe bere, ugo bere; nke si ibe ya ebene, nku kwaa ya.",
    transliteration:
      "Egbe bere, ugo bere; nke si ibe ya ebene, nku kwaa ya.",
    englishTranslation:
      "Let the eagle perch, let the kite perch; whoever denies the other a perch, let its wings break.",
    stages: ["calibrating"] as ProverbStage[],
    contextualNote: "Every craft has its own measure.",
  },
  {
    language: "igbo",
    originalText: "Onye agụ na-acho mma ya na-acho ndụ ya.",
    transliteration: "Onye agu na-acho mma ya na-acho ndu ya.",
    englishTranslation: "The one who seeks well, seeks long.",
    stages: ["reading_role", "calibrating"] as ProverbStage[],
    contextualNote: "We're searching carefully so the result is sharp.",
  },
  {
    language: "igbo",
    originalText: "A na-eji nwayoo aracha ofe di oku.",
    transliteration: "A na-eji nwayoo aracha ofe di oku.",
    englishTranslation: "Hot soup is eaten slowly.",
    stages: ["crafting", "finalising"] as ProverbStage[],
    contextualNote: "Good craft takes its time.",
  },
  {
    language: "igbo",
    originalText: "Ihe onye metere bu uru ya.",
    transliteration: "Ihe onye metere bu uru ya.",
    englishTranslation: "What a person does becomes their reward.",
    stages: ["finalising"] as ProverbStage[],
    contextualNote: "The assessment is for someone real. Almost there.",
  },
  // ---------- Hausa ----------
  {
    language: "hausa",
    originalText: "Hankuri shi ne sirrin nasara.",
    transliteration: "Hankuri shi ne sirrin nasara.",
    englishTranslation: "Patience is the secret of success.",
    stages: ["calibrating", "crafting"] as ProverbStage[],
    contextualNote: "Good craft takes its time.",
  },
  {
    language: "hausa",
    originalText: "Sannu ba ta hana zuwa.",
    transliteration: "Sannu ba ta hana zuwa.",
    englishTranslation: "Going slowly does not stop you from arriving.",
    stages: ["crafting", "finalising"] as ProverbStage[],
    contextualNote: "Steady wins.",
  },
  {
    language: "hausa",
    originalText: "Komai nisan jifa, kasa zai fado.",
    transliteration: "Komai nisan jifa, kasa zai fado.",
    englishTranslation: "However far a stone is thrown, it falls to the ground.",
    stages: ["finalising"] as ProverbStage[],
    contextualNote: "Every assessment lands somewhere real.",
  },
  {
    language: "hausa",
    originalText: "Mai hannu shi ne mai gaskiya.",
    transliteration: "Mai hannu shi ne mai gaskiya.",
    englishTranslation: "The one with hands tells the truth.",
    stages: ["reading_role"] as ProverbStage[],
    contextualNote: "Tell us what the person actually does, and we'll test for it.",
  },
  // ---------- Swahili ----------
  {
    language: "swahili",
    originalText: "Haraka haraka haina baraka.",
    transliteration: "Haraka haraka haina baraka.",
    englishTranslation: "Hurry, hurry has no blessing.",
    stages: ["crafting"] as ProverbStage[],
    contextualNote: "Questions worth asking are worth waiting for.",
  },
  {
    language: "swahili",
    originalText: "Pole pole ndio mwendo.",
    transliteration: "Pole pole ndio mwendo.",
    englishTranslation: "Slowly, slowly is the way.",
    stages: ["calibrating", "crafting"] as ProverbStage[],
    contextualNote: "Steady pace, real progress.",
  },
  {
    language: "swahili",
    originalText: "Mtoto wa nyoka ni nyoka.",
    transliteration: "Mtoto wa nyoka ni nyoka.",
    englishTranslation: "The child of a snake is a snake.",
    stages: ["calibrating"] as ProverbStage[],
    contextualNote: "Every role carries the shape of its craft.",
  },
  {
    language: "swahili",
    originalText: "Mgaagaa na upwa hali wali mkavu.",
    transliteration: "Mgaagaa na upwa hali wali mkavu.",
    englishTranslation: "One who patrols the shore does not eat dry rice.",
    stages: ["finalising"] as ProverbStage[],
    contextualNote: "Persistence shapes the meal.",
  },
  // ---------- Zulu ----------
  {
    language: "zulu",
    originalText: "Umuntu ngumuntu ngabantu.",
    transliteration: "Umuntu ngumuntu ngabantu.",
    englishTranslation: "A person is a person through other people.",
    stages: ["reading_role", "finalising"] as ProverbStage[],
    contextualNote: "Built by ETC. For someone real.",
  },
  {
    language: "zulu",
    originalText: "Isandla siyageza esinye.",
    transliteration: "Isandla siyageza esinye.",
    englishTranslation: "One hand washes the other.",
    stages: ["crafting"] as ProverbStage[],
    contextualNote: "Tenant and algorithm, hand in hand.",
  },
  {
    language: "zulu",
    originalText: "Ukubona kanye ukubona kabili.",
    transliteration: "Ukubona kanye ukubona kabili.",
    englishTranslation: "To see once is to see twice.",
    stages: ["reading_role"] as ProverbStage[],
    contextualNote: "We read your input carefully so we only read it once.",
  },
  {
    language: "zulu",
    originalText: "Indlela ibuzwa kwabaphambili.",
    transliteration: "Indlela ibuzwa kwabaphambili.",
    englishTranslation: "The way is asked of those who have gone before.",
    stages: ["calibrating"] as ProverbStage[],
    contextualNote: "We're calibrating against thousands of past assessments.",
  },
  // ---------- A couple of guest languages ----------
  {
    language: "twi",
    originalText: "Tikoro nko agyina.",
    transliteration: "Tikoro nko agyina.",
    englishTranslation: "One head does not go into council.",
    stages: ["calibrating", "finalising"] as ProverbStage[],
    contextualNote: "Two assessors, kemi.ai and chioma.ai, are reviewing together.",
  },
  {
    language: "twi",
    originalText: "Wuhu sɛ wo yɔnko abɔdwoɔ rehyeɛ a, fa nsuo gu wo deɛ ho.",
    transliteration:
      "Wuhu se wo yonko abodwoo rehye a, fa nsuo gu wo dee ho.",
    englishTranslation:
      "When you see your neighbour's beard burning, fetch water for yours.",
    stages: ["reading_role"] as ProverbStage[],
    contextualNote: "Every JD teaches the next one. We're learning.",
  },
  {
    language: "wolof",
    originalText: "Ndank-ndank moo japp golo ci ñay.",
    transliteration: "Ndank-ndank moo japp golo ci nay.",
    englishTranslation: "Slowly, slowly catches the monkey in the bush.",
    stages: ["crafting"] as ProverbStage[],
    contextualNote: "Steady craft beats hurry.",
  },
  {
    language: "wolof",
    originalText: "Ku waxtaan ak boppam, du mer.",
    transliteration: "Ku waxtaan ak boppam, du mer.",
    englishTranslation: "One who talks with their own head does not get angry.",
    stages: ["finalising"] as ProverbStage[],
    contextualNote: "We're double-checking ourselves. Almost there.",
  },
];

async function main() {
  let inserted = 0;
  let skipped = 0;
  for (const seed of SEEDS) {
    const [existing] = await db
      .select({ id: proverb.id })
      .from(proverb)
      .where(
        and(
          eq(proverb.language, seed.language),
          eq(proverb.originalText, seed.originalText),
        ),
      )
      .limit(1);
    if (existing) {
      skipped += 1;
      continue;
    }
    await db.insert(proverb).values(seed);
    inserted += 1;
  }
  console.log(
    `[seed-proverbs] inserted=${inserted} skipped=${skipped} total=${SEEDS.length}`,
  );
}

main().catch((err) => {
  console.error("[seed-proverbs] failed:", err);
  process.exit(1);
});
