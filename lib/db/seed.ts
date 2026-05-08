/**
 * Seed script — idempotent. Re-running wipes and re-creates the demo data.
 *
 * Creates per /db spec:
 *   1 admin user (Supabase Auth, only if SUPABASE_SERVICE_ROLE_KEY is set)
 *   1 demo assessment ("Solar Tech POD Vetting — Demo")
 *   8 MCQ questions covering installation / safety / sizing
 *   2 timed questions (30s and 15s)
 *   2 branching rules (1 score-based, 1 answer-based)
 *   100 fake completed responses with realistic score distributions
 *
 * Run: pnpm db:seed
 */

import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";

import { db } from "./client";
import {
  answers,
  assessments,
  branchingRules,
  questions,
  responses,
  type NewAnswer,
  type NewQuestion,
  type NewResponse,
  type QuestionOption,
  type RuleAction,
  type RuleCondition,
} from "./schema";

const ADMIN_EMAIL = "admin@etc.local";
const ADMIN_PASSWORD = "DemoPass!2026";

const FIRST_NAMES = [
  "Adaeze", "Tunde", "Ngozi", "Chinedu", "Funke", "Emeka", "Aisha", "Yusuf",
  "Bolanle", "Ifeoma", "Olamide", "Kehinde", "Tobi", "Sade", "Bayo",
  "Chiamaka", "Kola", "Amara", "Segun", "Folake",
];
const LAST_NAMES = [
  "Okafor", "Adeyemi", "Bello", "Okonkwo", "Adebayo", "Ibrahim", "Ojo",
  "Eze", "Lawal", "Ogundimu",
];

type DemoQuestion = Omit<NewQuestion, "assessmentId" | "orderIndex"> & {
  options: QuestionOption[];
  correctAnswer: string[];
};

const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    questionText: "Standard Test Conditions for a PV module are:",
    type: "mcq",
    options: [
      { id: "a", label: "800 W/m², 25°C, AM 1.0" },
      { id: "b", label: "1000 W/m², 25°C, AM 1.5" },
      { id: "c", label: "1000 W/m², 45°C, AM 1.5" },
      { id: "d", label: "1200 W/m², 25°C, AM 1.0" },
    ],
    correctAnswer: ["b"],
    points: 5,
    negativePoints: 1,
    section: "fundamentals",
  },
  {
    questionText:
      "Which set of PPE is mandatory before walking a hot rooftop array?",
    type: "mcq",
    options: [
      { id: "a", label: "Insulated gloves + harness + steel-toed boots" },
      { id: "b", label: "Cotton gloves and rubber boots" },
      { id: "c", label: "Reflective vest only" },
      { id: "d", label: "No PPE needed if voltage is below 120V" },
    ],
    correctAnswer: ["a"],
    points: 5,
    negativePoints: 2,
    timerEnabled: true,
    timeLimitSeconds: 15,
    timeoutAction: "mark_incorrect",
    section: "safety",
  },
  {
    questionText:
      "A string of 12 modules with Voc 40V each. Total string Voc?",
    type: "mcq",
    options: [
      { id: "a", label: "120 V" },
      { id: "b", label: "240 V" },
      { id: "c", label: "480 V" },
      { id: "d", label: "960 V" },
    ],
    correctAnswer: ["c"],
    points: 6,
    negativePoints: 2,
    timerEnabled: true,
    timeLimitSeconds: 30,
    timeoutAction: "auto_submit",
    section: "sizing",
  },
  {
    questionText:
      "DC arc-flash risk drops to zero once the inverter is switched off.",
    type: "true_false",
    options: [
      { id: "a", label: "True" },
      { id: "b", label: "False" },
    ],
    correctAnswer: ["b"],
    points: 4,
    negativePoints: 2,
    section: "safety",
  },
  {
    questionText: "MPPT stands for:",
    type: "mcq",
    options: [
      { id: "a", label: "Multi-Phase Power Tracker" },
      { id: "b", label: "Maximum Power Point Tracking" },
      { id: "c", label: "Module Peak Performance Test" },
      { id: "d", label: "Microgrid Power Pulse Transfer" },
    ],
    correctAnswer: ["b"],
    points: 4,
    negativePoints: 0,
    section: "fundamentals",
  },
  {
    questionText:
      "A 5kW residential array is producing only 2kW at noon on a clear day. Which is the most appropriate first check?",
    type: "mcq",
    options: [
      { id: "a", label: "Check inverter status / error codes" },
      { id: "b", label: "Replace all modules" },
      { id: "c", label: "Reduce string length" },
      { id: "d", label: "Add another battery" },
    ],
    correctAnswer: ["a"],
    points: 5,
    negativePoints: 1,
    section: "installation",
  },
  {
    questionText:
      "An I-V curve shows a sharp 'step' below Vmp. The most likely cause is:",
    type: "mcq",
    options: [
      { id: "a", label: "Module-level partial shading" },
      { id: "b", label: "Inverter clipping" },
      { id: "c", label: "Loose AC connector" },
      { id: "d", label: "Incorrect tilt angle" },
    ],
    correctAnswer: ["a"],
    points: 7,
    negativePoints: 2,
    section: "installation",
  },
  {
    questionText:
      "When sizing inverter capacity vs. array DC capacity, the typical DC:AC ratio is:",
    type: "mcq",
    options: [
      { id: "a", label: "0.5 to 0.8" },
      { id: "b", label: "1.0 to 1.3" },
      { id: "c", label: "1.5 to 2.0" },
      { id: "d", label: "2.0 to 3.0" },
    ],
    correctAnswer: ["b"],
    points: 6,
    negativePoints: 2,
    section: "sizing",
  },
];

const MAX_POSSIBLE_SCORE = DEMO_QUESTIONS.reduce((s, q) => s + (q.points ?? 0), 0);

async function seedAdminUser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.log(
      "[seed] SUPABASE_SERVICE_ROLE_KEY missing — skipping admin user.",
    );
    return;
  }
  const supabase = createClient(url, serviceKey);
  const { error } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { role: "admin" },
  });
  if (error) {
    if (error.message.toLowerCase().includes("already")) {
      console.log(`[seed] admin user already exists (${ADMIN_EMAIL}).`);
    } else {
      console.warn("[seed] admin user error:", error.message);
    }
  } else {
    console.log(`[seed] admin user created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  }
}

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]!;
}

/** Bell-curve-ish performance band so the table has realistic spread. */
function pickPerformanceBand(): "strong" | "average" | "weak" {
  const r = Math.random();
  if (r < 0.25) return "strong";
  if (r < 0.85) return "average";
  return "weak";
}

function correctnessRollFor(band: "strong" | "average" | "weak"): number {
  // Probability that a single answer is correct.
  if (band === "strong") return 0.88;
  if (band === "average") return 0.65;
  return 0.35;
}

async function main() {
  console.log("[seed] starting…");

  await seedAdminUser();

  // Wipe demo data. Cascading FK from assessments handles everything else.
  console.log("[seed] wiping existing demo assessment if present…");
  await db.execute(sql`DELETE FROM assessments WHERE slug = 'demo'`);

  console.log("[seed] inserting demo assessment…");
  const [assessment] = await db
    .insert(assessments)
    .values({
      title: "Solar Tech POD Vetting — Demo",
      slug: "demo",
      roleType: "tech",
      status: "published",
      passThreshold: 70,
      introText:
        "Welcome — this is a short conversational vetting assessment. Some questions are timed. Wrong answers may deduct points.",
      outroText:
        "Thanks. We'll review your responses and reach out within 48 hours.",
    })
    .returning();
  if (!assessment) throw new Error("[seed] failed to insert assessment");

  console.log(`[seed] inserting ${DEMO_QUESTIONS.length} questions…`);
  const insertedQuestions = await db
    .insert(questions)
    .values(
      DEMO_QUESTIONS.map((q, i) => ({
        ...q,
        assessmentId: assessment.id,
        orderIndex: i,
      })),
    )
    .returning();

  // Branching rules — PRD §10 /db: one score-based, one answer-based.
  // 1) After the timed PPE question (idx 1), if the candidate selected the
  //    "no PPE needed" option, end the assessment immediately.
  // 2) After question 4 (MPPT), if running score is already >= 20 the
  //    candidate is on track — keep going (sample of jump_to is harmless,
  //    used here to prove the structure round-trips through the DB).
  const ppeQ = insertedQuestions[1]!;
  const mpptQ = insertedQuestions[4]!;
  const advancedQ = insertedQuestions[6]!;

  const noPpeOption = ppeQ.options.find((o) => o.label.startsWith("No PPE"));
  if (!noPpeOption) throw new Error("[seed] PPE option not found");

  const answerBasedRule: { condition: RuleCondition; action: RuleAction } = {
    condition: { op: "answer_equals", value: noPpeOption.id },
    action: { type: "skip_to_end" },
  };
  const scoreBasedRule: { condition: RuleCondition; action: RuleAction } = {
    condition: { op: "score_gte", value: 20 },
    action: { type: "jump_to", target_question_id: advancedQ.id },
  };

  console.log("[seed] inserting 2 branching rules…");
  await db.insert(branchingRules).values([
    {
      assessmentId: assessment.id,
      fromQuestionId: ppeQ.id,
      condition: answerBasedRule.condition,
      action: answerBasedRule.action,
      priority: 1,
    },
    {
      assessmentId: assessment.id,
      fromQuestionId: mpptQ.id,
      condition: scoreBasedRule.condition,
      action: scoreBasedRule.action,
      priority: 2,
    },
  ]);

  console.log("[seed] generating 100 fake responses…");
  const responseRows: NewResponse[] = [];
  const allAnswerPlans: { responseEmail: string; rows: Omit<NewAnswer, "responseId">[] }[] =
    [];

  for (let i = 0; i < 100; i++) {
    const fname = pick(FIRST_NAMES, i);
    const lname = pick(LAST_NAMES, i + 3);
    const email = `${fname.toLowerCase()}.${lname.toLowerCase()}.${i}@example.test`;

    const band = pickPerformanceBand();
    const correctRate = correctnessRollFor(band);

    const answerRows: Omit<NewAnswer, "responseId">[] = [];
    let totalScore = 0;

    for (const q of insertedQuestions) {
      const correct = Math.random() < correctRate;
      const correctId = q.correctAnswer[0]!;
      const wrongOption =
        q.options.find((o) => o.id !== correctId) ?? q.options[0]!;
      const selectedId = correct ? correctId : wrongOption.id;
      const scoreAwarded = correct ? q.points : -q.negativePoints;
      totalScore += scoreAwarded;
      answerRows.push({
        questionId: q.id,
        selectedOptions: [selectedId],
        timeSpentSeconds: 5 + Math.floor(Math.random() * 25),
        timedOut: false,
        scoreAwarded,
        answeredAt: new Date(),
      });
    }

    totalScore = Math.max(0, Math.min(MAX_POSSIBLE_SCORE, totalScore));
    const passed = totalScore / MAX_POSSIBLE_SCORE >= 0.7;

    const startedAt = new Date(
      Date.now() - Math.floor(Math.random() * 30 * 86_400_000),
    );
    const submittedAt = new Date(
      startedAt.getTime() + (5 + Math.floor(Math.random() * 25)) * 60_000,
    );
    answerRows.forEach((r) => {
      r.answeredAt = submittedAt;
    });

    responseRows.push({
      assessmentId: assessment.id,
      candidateName: `${fname} ${lname}`,
      candidateEmail: email,
      candidatePhone: `+23480${String(10_000_000 + i).padStart(8, "0")}`,
      startedAt,
      submittedAt,
      totalScore,
      maxPossibleScore: MAX_POSSIBLE_SCORE,
      status: "submitted",
      pass: passed,
      metadata: {
        user_agent: "seed-script",
        time_on_task_seconds: Math.floor(
          (submittedAt.getTime() - startedAt.getTime()) / 1000,
        ),
        path: insertedQuestions.map((q) => q.id),
      },
    });
    allAnswerPlans.push({ responseEmail: email, rows: answerRows });
  }

  console.log("[seed] inserting responses…");
  const insertedResponses = await db
    .insert(responses)
    .values(responseRows)
    .returning({ id: responses.id, candidateEmail: responses.candidateEmail });

  // Match by email so we don't depend on RETURNING preserving insert order.
  const idByEmail = new Map(
    insertedResponses.map((r) => [r.candidateEmail, r.id] as const),
  );

  const allAnswerRows: NewAnswer[] = allAnswerPlans.flatMap(({ responseEmail, rows }) => {
    const responseId = idByEmail.get(responseEmail);
    if (!responseId) {
      throw new Error(`[seed] response id missing for ${responseEmail}`);
    }
    return rows.map((r) => ({ ...r, responseId }));
  });

  console.log(`[seed] inserting ${allAnswerRows.length} answer rows…`);
  // Postgres has a per-statement parameter limit; chunk to be safe.
  const CHUNK = 200;
  for (let i = 0; i < allAnswerRows.length; i += CHUNK) {
    await db.insert(answers).values(allAnswerRows.slice(i, i + CHUNK));
  }

  console.log("[seed] done.");
  console.log(
    `       max possible score: ${MAX_POSSIBLE_SCORE}  ·  pass threshold: 70%`,
  );
  console.log(`       admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  });
